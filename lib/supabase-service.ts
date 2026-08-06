/**
 * Camada de persistência no Supabase.
 * Usada apenas no servidor (API routes do Next.js).
 */

import { createClient } from '@supabase/supabase-js'
import type { EmailProcessado, AnexoXML } from './anexos'
import type { ItemNFe } from './nfe-parser'
import { classificarOperacaoFedrigoni, classificarOperacaoV2 } from './nfe-classificacao'
import { calcularPallets } from './calculations'

// Cliente servidor — usa service_role se disponível, anon caso contrário
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function getServerClient(): ReturnType<typeof createClient<any, any, any>> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  return createClient(url, key) as any
}

// ─────────────────────────────────────────────
// DEDUPLICAÇÃO
// ─────────────────────────────────────────────

/** Verifica se o email já foi importado (pelo message_id). */
export async function emailJaImportado(messageId: string): Promise<boolean> {
  const supabase = getServerClient()
  const { data } = await supabase
    .from('emails_importados')
    .select('id')
    .eq('message_id', messageId)
    .maybeSingle()
  return !!data
}

/**
 * Uma linha de `arquivos_nfe` sem natureza NEM tipo de operação é uma
 * LINHA-FANTASMA: o anexo foi registrado, mas a leitura não extraiu nada dele.
 * Ela nunca vai gerar movimentação.
 *
 * Isso acontece quando o parse do PDF falha (a lib devolve texto vazio sem
 * lançar erro) e o nome do arquivo ainda assim identifica uma NF-e. Em julho de
 * 2026 foram 153 linhas assim; 128 notas não existiam em nenhum outro registro.
 *
 * O agravante era a deduplicação: `hash_arquivo` é UNIQUE, e tanto o hash
 * quanto a chave davam a nota por processada. Reenviar o mesmo PDF não
 * recuperava nada — era descartado como duplicado, para sempre. Por isso
 * linha-fantasma NÃO bloqueia: ela é COMPLETADA por `persistirAnexo` quando o
 * arquivo volta e a leitura funciona.
 */
const COLUNAS_FANTASMA = 'id, natureza_operacao, tipo_operacao'
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const ehFantasma = (linha: any) => !linha?.natureza_operacao && !linha?.tipo_operacao

/** Linha-fantasma existente para este anexo (por hash ou por chave), se houver. */
export async function arquivoFantasmaExistente(
  hash: string,
  chaveNfe?: string | null,
): Promise<string | null> {
  const supabase = getServerClient()
  const { data: porHash } = await supabase
    .from('arquivos_nfe').select(COLUNAS_FANTASMA).eq('hash_arquivo', hash).maybeSingle()
  if (porHash) return ehFantasma(porHash) ? porHash.id : null
  if (!chaveNfe || chaveNfe.length < 44) return null
  const { data: porChave } = await supabase
    .from('arquivos_nfe').select(COLUNAS_FANTASMA).eq('chave_nfe', chaveNfe).maybeSingle()
  return porChave && ehFantasma(porChave) ? porChave.id : null
}

/** Verifica se o arquivo já foi processado (pelo hash SHA-256). */
export async function arquivoJaProcessado(hash: string): Promise<boolean> {
  const supabase = getServerClient()
  const { data } = await supabase
    .from('arquivos_nfe')
    .select(COLUNAS_FANTASMA)
    .eq('hash_arquivo', hash)
    .maybeSingle()
  return !!data && !ehFantasma(data)
}

/** Verifica se a NFe já foi importada (pela chave de acesso de 44 dígitos). */
export async function nfeJaImportada(chaveNfe: string): Promise<boolean> {
  if (!chaveNfe || chaveNfe.length < 44) return false
  const supabase = getServerClient()
  const { data } = await supabase
    .from('arquivos_nfe')
    .select(COLUNAS_FANTASMA)
    .eq('chave_nfe', chaveNfe)
    .maybeSingle()
  return !!data && !ehFantasma(data)
}

/**
 * Chave de acesso lida do NOME do arquivo (44 dígitos), usada quando a leitura
 * do documento não extraiu nada. Não gera movimentação sozinha, mas deixa a
 * linha-fantasma identificável — sem isso, descobrir QUAL nota se perdeu exige
 * garimpar nome de arquivo à mão.
 */
export function chaveDoNomeArquivo(nomeArquivo: string): string | null {
  const base = (nomeArquivo || '').replace(/^.*[/\\]/, '')
  return base.match(/^(\d{44})(?!\d)/)?.[1] ?? null
}

// ─────────────────────────────────────────────
// IDENTIFICAÇÃO DE CLIENTE
// ─────────────────────────────────────────────

/** Tenta identificar o cliente pelo CNPJ do emitente ou destinatário. */
export async function identificarCliente(
  cnpjEmitente: string,
  cnpjDestinatario: string,
  remetente?: string,
  remetenteNome?: string,
  nomeEmitente?: string,
  assunto?: string,
  cnpjsCorpo: string[] = [],
): Promise<string | null> {
  const supabase = getServerClient()

  // Carrega todos os clientes (CNPJ cadastrado) uma vez para os fallbacks
  const { data: todosClientes } = await supabase
    .from('clientes')
    .select('id, cnpj')
    .eq('ativo', true)
    .not('cnpj', 'is', null)

  // Busca em clientes_cnpj com tipo específico para evitar colisão emitente/destinatário
  async function buscarCnpjComTipo(cnpj: string, tipo: string): Promise<string | null> {
    if (!cnpj) return null
    const { data } = await supabase
      .from('clientes_cnpj')
      .select('cliente_id')
      .eq('cnpj', cnpj)
      .eq('tipo', tipo)
      .limit(1)
      .maybeSingle()
    return data?.cliente_id ?? null
  }

  // Busca CNPJ em clientes.cnpj (cadastro principal) — apenas match exato
  function buscarNoCadastro(cnpj: string): string | null {
    if (!cnpj) return null
    return (todosClientes ?? []).find((c: any) =>
      (c.cnpj as string).replace(/\D/g, '') === cnpj
    )?.id ?? null
  }

  // 1. CNPJ do EMITENTE da NF-e — identifica quem enviou os produtos (cliente mais provável)
  if (cnpjEmitente) {
    const r = await buscarCnpjComTipo(cnpjEmitente, 'emitente')
           ?? buscarNoCadastro(cnpjEmitente)
    if (r) return r
  }

  // 2. CNPJ do DESTINATÁRIO — só usado se o emitente não identificou
  //    (ex: nota de RETORNO em que o XPS emite e o cliente é o destinatário).
  //    Busca em clientes_cnpj (tipo='destinatario') e também no cadastro principal
  //    (clientes.cnpj) — assim a Fedrigoni, cadastrada como emitente, é encontrada
  //    quando aparece como destinatário de uma devolução do armazém.
  if (cnpjDestinatario) {
    const r = await buscarCnpjComTipo(cnpjDestinatario, 'destinatario')
           ?? buscarNoCadastro(cnpjDestinatario)
    if (r) return r
  }

  // 3. CNPJs extraídos do corpo do email — fallback quando NF-e não identificou
  //    Testa apenas emitentes cadastrados (nunca auto-registra destinatários do corpo)
  for (const cnpj of cnpjsCorpo) {
    if (cnpj === cnpjEmitente || cnpj === cnpjDestinatario) continue
    const r = await buscarCnpjComTipo(cnpj, 'emitente') ?? buscarNoCadastro(cnpj)
    if (r) return r
  }

  // 3. Busca por email_remetente cadastrado no cliente
  if (remetente) {
    const dominio = remetente.includes('@') ? remetente.split('@')[1] : remetente
    const { data: clientes } = await supabase
      .from('clientes')
      .select('id, email_remetente')
      .not('email_remetente', 'is', null)
      .eq('ativo', true)

    for (const c of clientes ?? []) {
      const emailCad = (c.email_remetente as string).toLowerCase()
      if (
        remetente.toLowerCase().includes(emailCad) ||
        emailCad.includes(dominio.toLowerCase()) ||
        dominio.toLowerCase().includes(emailCad)
      ) {
        return c.id
      }
    }
  }

  // 4. Busca por nome do emitente da NF-e ou assunto contra nome_fantasia / nome do cliente
  const textosBusca = [nomeEmitente, remetenteNome, assunto].filter(Boolean) as string[]
  if (textosBusca.length > 0) {
    const { data: clientes } = await supabase
      .from('clientes')
      .select('id, nome, nome_fantasia, email_remetente')
      .eq('ativo', true)

    // Normaliza: minúsculas, sem acentos, sem pontuação, sem sufixos empresariais
    const normalizarNome = (s: string) =>
      s.toLowerCase()
        .normalize('NFD').replace(/[̀-ͯ]/g, '')
        .replace(/\b(ltda|s\.?a\.?|eireli|me|epp|ss|sa|industria|comercio|com|ind|self|adhesives|brasil|do|de|da)\b/g, '')
        .replace(/[^a-z0-9]/g, '')

    for (const c of clientes ?? []) {
      const nomeCliente = normalizarNome(c.nome_fantasia || c.nome || '')
      if (nomeCliente.length < 4) continue
      for (const texto of textosBusca) {
        const t = normalizarNome(texto)
        if (t.includes(nomeCliente) || nomeCliente.includes(t)) {
          return c.id
        }
      }
    }
  }

  return null
}

/** Sincroniza todos os clientes.cnpj → clientes_cnpj (backfill). */
export async function sincronizarCnpjsClientes(): Promise<number> {
  const supabase = getServerClient()
  const { data: clientes } = await supabase
    .from('clientes')
    .select('id, cnpj')
    .not('cnpj', 'is', null)

  let count = 0
  for (const c of clientes ?? []) {
    const cnpjNorm = (c.cnpj as string).replace(/\D/g, '')
    if (!cnpjNorm) continue
    const { error } = await supabase.from('clientes_cnpj').upsert(
      { cliente_id: c.id, cnpj: cnpjNorm, tipo: 'emitente' },
      { onConflict: 'cliente_id,cnpj' }
    )
    if (!error) count++
  }
  return count
}

// ─────────────────────────────────────────────
// IDENTIFICAÇÃO DE PRODUTO
// ─────────────────────────────────────────────

interface ProdutoMatch {
  produto_id: string
  produto_nome: string
  valor_pallet: number
  aliquota_imposto: number
  regra_fator_pallet: number
}

/**
 * Tenta identificar o produto do cliente a partir dos itens da NF-e.
 * Prioridade: NCM exato > cProd exato > keywords na descrição > keywords no texto bruto PDF.
 */
async function identificarProduto(
  clienteId: string,
  itens: ItemNFe[],
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  textoBruto?: string,
): Promise<ProdutoMatch | null> {
  const semItens = !itens || itens.length === 0
  if (semItens && !textoBruto) return null

  const { data: produtos } = await supabase
    .from('cliente_produtos')
    .select('id, nome, codigo_ncm, palavras_chave, valor_pallet, aliquota_imposto, regra_fator_pallet')
    .eq('cliente_id', clienteId)
    .eq('ativo', true)
    .order('ordem', { ascending: true })

  if (!produtos || produtos.length === 0) return null

  const retornar = (prod: any): ProdutoMatch => ({
    produto_id: prod.id,
    produto_nome: prod.nome,
    valor_pallet: prod.valor_pallet,
    aliquota_imposto: prod.aliquota_imposto,
    regra_fator_pallet: prod.regra_fator_pallet,
  })

  // 1ª passagem: match por NCM exato
  for (const item of itens) {
    const ncmItem = (item.ncm || '').replace(/\D/g, '').trim()
    if (!ncmItem) continue
    for (const prod of produtos) {
      if (!prod.codigo_ncm) continue
      if (ncmItem === prod.codigo_ncm.replace(/\D/g, '').trim()) return retornar(prod)
    }
  }

  // 2ª passagem: match por código do produto (cProd) — exato, case-insensitive
  for (const item of itens) {
    const codigoItem = (item.codigo || '').trim().toLowerCase()
    if (!codigoItem) continue
    for (const prod of produtos) {
      if (!prod.palavras_chave) continue
      const keywords = (prod.palavras_chave as string)
        .split(',')
        .map((k: string) => k.trim().toLowerCase())
        .filter(Boolean)
      if (keywords.includes(codigoItem)) return retornar(prod)
    }
  }

  // 3ª passagem: match por palavras-chave na descrição do produto
  for (const item of itens) {
    const descLower = (item.descricao || '').toLowerCase()
    if (!descLower) continue
    for (const prod of produtos) {
      if (!prod.palavras_chave) continue
      const keywords = (prod.palavras_chave as string)
        .split(',')
        .map((k: string) => k.trim().toLowerCase())
        .filter(Boolean)
      if (keywords.some((kw: string) => kw.length >= 4 && descLower.includes(kw))) return retornar(prod)
    }
  }

  // 4ª passagem: fallback — busca palavras-chave no texto bruto do PDF
  // Cobre DANFEs cujos itens não foram extraídos pelo parser mas cujo texto contém os códigos
  if (textoBruto) {
    const textoLower = textoBruto.toLowerCase()
    // Primeiro tenta match exato de código (mais confiável)
    for (const prod of produtos) {
      if (!prod.palavras_chave) continue
      const keywords = (prod.palavras_chave as string)
        .split(',')
        .map((k: string) => k.trim().toLowerCase())
        .filter(Boolean)
      // Códigos de produto têm letras e números — match exato como palavra
      const codigosKw = keywords.filter(k => /[a-z]/.test(k) && /[0-9]/.test(k) && k.length >= 5)
      if (codigosKw.some(kw => textoLower.includes(kw))) return retornar(prod)
    }
    // Depois tenta keywords descritivos (mínimo 5 chars para evitar falsos positivos)
    for (const prod of produtos) {
      if (!prod.palavras_chave) continue
      const keywords = (prod.palavras_chave as string)
        .split(',')
        .map((k: string) => k.trim().toLowerCase())
        .filter(k => k.length >= 5 && !/^[0-9]+$/.test(k))
      if (keywords.some(kw => textoLower.includes(kw))) return retornar(prod)
    }
  }

  return null
}

// ─────────────────────────────────────────────
// HELPERS PARA NF-E MULTI-PRODUTO
// ─────────────────────────────────────────────

/**
 * Retorna o peso líquido de um item em toneladas.
 * Prioridade: campo pesoL do XML → quantidade + unidade comercial.
 */
function pesoTonItem(item: ItemNFe): number {
  if (item.peso_liquido > 0) return item.peso_liquido / 1000
  const u = (item.unidade ?? '').toUpperCase().replace(/[^A-Z]/g, '')
  if (u === 'KG' || u === 'KGS') return item.quantidade / 1000
  if (u === 'T' || u === 'TN' || u === 'TON') return item.quantidade
  return 0
}

/** Item cuja unidade comercial é quilo — o único caso ambíguo (ver pesosTonDosItens). */
function itemEmKg(item: ItemNFe): boolean {
  if (item.peso_liquido > 0) return false
  const u = (item.unidade ?? '').toUpperCase().replace(/[^A-Z]/g, '')
  return u === 'KG' || u === 'KGS'
}

/**
 * Peso em toneladas de cada item, com a unidade dos itens em KG conferida
 * contra o peso líquido total do documento.
 *
 * Há emitentes que rotulam a coluna UNID. como "KG" mas preenchem a QUANT. em
 * TONELADAS. A Alphalum é um deles: na NF-e 248 as linhas são TON 7,0000 +
 * KG 2,0000 + KG 12,0000 e o PESO LÍQUIDO do DANFE é 21.000,000 kg — os três
 * números somam 21 só se todos forem lidos como tonelada. O valor unitário
 * confirma: é o mesmo (R$ 3.700,41) nas linhas TON e nas linhas KG. Dividindo
 * as linhas KG por mil, essa nota entrava como 7,014 t em vez de 21 t.
 *
 * Corrigir isso para todo mundo seria pior — em NF-e normal "KG" é quilo mesmo.
 * Então a decisão não é por cliente, é por documento: só troca a interpretação
 * quando o PESO LÍQUIDO do próprio DANFE desempata, isto é, quando a soma em
 * quilo NÃO bate com o total e a soma em tonelada bate. Sem peso líquido no
 * documento, ou com as duas somas igualmente (im)plausíveis, mantém KG = quilo.
 */
function pesosTonDosItens(itens: ItemNFe[], pesoLiquidoTotalKg: number): number[] {
  const comoQuilo = itens.map(pesoTonItem)
  if (!itens.some(itemEmKg)) return comoQuilo
  if (!(pesoLiquidoTotalKg > 0)) return comoQuilo

  const comoTonelada = itens.map((item, i) => (itemEmKg(item) ? item.quantidade : comoQuilo[i]))
  const totalTon = pesoLiquidoTotalKg / 1000
  // 1% de folga absorve arredondamento do DANFE; o piso de 10 kg evita que
  // notas muito pequenas fiquem sem tolerância nenhuma.
  const folga = Math.max(totalTon * 0.01, 0.01)
  const soma = (v: number[]) => v.reduce((a, b) => a + b, 0)
  const bateQuilo = Math.abs(soma(comoQuilo) - totalTon) <= folga
  const bateTonelada = Math.abs(soma(comoTonelada) - totalTon) <= folga

  return !bateQuilo && bateTonelada ? comoTonelada : comoQuilo
}

/**
 * Tenta casar um único item da NF-e com um produto cadastrado do cliente.
 * Mesma prioridade de identificarProduto: NCM > cProd > descrição.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function matchItemParaProduto(item: ItemNFe, produtos: any[]): any | null {
  const ncmItem = (item.ncm || '').replace(/\D/g, '').trim()
  for (const p of produtos) {
    if (ncmItem && p.codigo_ncm && ncmItem === p.codigo_ncm.replace(/\D/g, '').trim()) return p
  }
  const codigoItem = (item.codigo || '').trim().toLowerCase()
  for (const p of produtos) {
    if (!p.palavras_chave || !codigoItem) continue
    const kws = (p.palavras_chave as string).split(',').map((k: string) => k.trim().toLowerCase()).filter(Boolean)
    if (kws.includes(codigoItem)) return p
  }
  const descLower = (item.descricao || '').toLowerCase()
  for (const p of produtos) {
    if (!p.palavras_chave || !descLower) continue
    const kws = (p.palavras_chave as string).split(',').map((k: string) => k.trim().toLowerCase()).filter(Boolean)
    if (kws.some((kw: string) => kw.length >= 4 && descLower.includes(kw))) return p
  }
  return null
}

/**
 * Versão síncrona de identificarProduto usando lista já carregada.
 * Evita segunda consulta ao banco quando produtos já foram buscados.
 */
function matchProdutoComLista(
  itens: ItemNFe[],
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  produtos: any[],
  textoBruto?: string,
): ProdutoMatch | null {
  if (!produtos || produtos.length === 0) return null
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const retornar = (p: any): ProdutoMatch => ({
    produto_id: p.id,
    produto_nome: p.nome,
    valor_pallet: p.valor_pallet,
    aliquota_imposto: p.aliquota_imposto,
    regra_fator_pallet: p.regra_fator_pallet,
  })

  for (const item of itens) {
    const p = matchItemParaProduto(item, produtos)
    if (p) return retornar(p)
  }

  if (textoBruto) {
    const textoLower = textoBruto.toLowerCase()
    for (const prod of produtos) {
      if (!prod.palavras_chave) continue
      const kws = (prod.palavras_chave as string).split(',').map((k: string) => k.trim().toLowerCase()).filter(Boolean)
      const codigosKw = kws.filter((k: string) => /[a-z]/.test(k) && /[0-9]/.test(k) && k.length >= 5)
      if (codigosKw.some((kw: string) => textoLower.includes(kw))) return retornar(prod)
    }
    for (const prod of produtos) {
      if (!prod.palavras_chave) continue
      const kws = (prod.palavras_chave as string)
        .split(',')
        .map((k: string) => k.trim().toLowerCase())
        .filter((k: string) => k.length >= 5 && !/^[0-9]+$/.test(k))
      if (kws.some((kw: string) => textoLower.includes(kw))) return retornar(prod)
    }
  }

  return null
}

/**
 * Agrupa itens da NF-e por produto, somando seus pesos.
 * Chave de agrupamento: ID do produto cadastrado (se encontrado) OU
 * código do produto na NF-e (cProd) — permite split automático mesmo sem
 * produto cadastrado no sistema.
 * Retorna null se não houver ≥ 2 grupos distintos com pesos determináveis.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function agruparItensPorProduto(itens: ItemNFe[], produtos: any[], pesoLiquidoTotalKg = 0): Array<{ prod: any | null; pesoTon: number; descricaoItem: string }> | null {
  if (itens.length === 0) return null
  const pesos = pesosTonDosItens(itens, pesoLiquidoTotalKg)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const grupos = new Map<string, { prod: any | null; pesoTon: number; descricaoItem: string }>()
  for (const [i, item] of itens.entries()) {
    const peso = pesos[i]
    if (peso <= 0) continue
    const prod = produtos.length > 0 ? matchItemParaProduto(item, produtos) : null
    // Agrupa por: ID do produto cadastrado → código da NF-e → descrição
    const key = prod ? (prod.id as string) : (item.codigo || item.descricao || '_sem_codigo_')
    if (!grupos.has(key)) grupos.set(key, { prod, pesoTon: 0, descricaoItem: item.descricao })
    grupos.get(key)!.pesoTon += peso
  }
  if (grupos.size < 2) return null
  return [...grupos.values()]
}

// ─────────────────────────────────────────────
// IDENTIFICAÇÃO DE CATEGORIA — FEDRIGONI
// ─────────────────────────────────────────────
//
// Matcher dedicado à Fedrigoni (isolado da lógica padrão do Alphalum).
// As notas da Fedrigoni têm dezenas de variações de código por categoria
// (ex.: 8R0025GN0031520, 8R0042LN0031520, LTC038...). Em vez de catalogar
// cada código, as palavras-chave podem ser PADRÕES:
//   • token simples   → "0031520"      (casa qualquer código que o contenha)
//   • curinga         → "8r*0031520"   (* = sequência sem espaço; casa 8R0025GN0031520)
//   • código/descr.   → "mattplus"     (substring normal)
// Regras de seguro contra falso-positivo: token numérico puro exige ≥6 dígitos;
// alfanumérico exige ≥4 caracteres.

/** Testa uma única palavra-chave/padrão contra o texto (já em minúsculas). */
function categoriaKeywordMatch(keyword: string, texto: string): boolean {
  const kw = keyword.trim().toLowerCase()
  if (!kw) return false

  // Padrão com curinga "*" → vira regex (cada * = sequência de não-espaços)
  if (kw.includes('*')) {
    const re = new RegExp(
      kw.split('*')
        .map(s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
        .join('[^\\s]*')
    )
    return re.test(texto)
  }

  // Substring simples — com limites mínimos para evitar falso-positivo
  const ehNumericoPuro = /^[0-9]+$/.test(kw)
  const tamMin = ehNumericoPuro ? 6 : 4
  if (kw.length < tamMin) return false
  return texto.includes(kw)
}

/**
 * Identifica a categoria/produto da Fedrigoni a partir dos códigos no texto do
 * DANFE (e dos itens, quando houver). Retorna o primeiro produto cadastrado
 * (ordem ascendente) cujo padrão de palavra-chave ou NCM casar.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function identificarCategoriaFedrigoni(
  produtos: any[],
  textoPdf?: string,
  itens: ItemNFe[] = [],
): { produto_id: string; produto_nome: string } | null {
  if (!produtos || produtos.length === 0) return null

  // Texto de busca: texto bruto do PDF + códigos/descrições/NCM dos itens
  const itensTxt = itens
    .map(i => `${i.codigo ?? ''} ${i.descricao ?? ''} ${i.ncm ?? ''}`)
    .join(' ')
  const texto = `${textoPdf ?? ''} ${itensTxt}`.toLowerCase()

  for (const p of produtos) {
    // 1) NCM exato contra itens
    if (p.codigo_ncm) {
      const ncm = String(p.codigo_ncm).replace(/\D/g, '')
      if (ncm && itens.some(i => (i.ncm ?? '').replace(/\D/g, '') === ncm)) {
        return { produto_id: p.id, produto_nome: p.nome }
      }
    }
    // 2) Palavras-chave / padrões
    if (p.palavras_chave) {
      const kws = String(p.palavras_chave).split(',')
      if (kws.some((kw: string) => categoriaKeywordMatch(kw, texto))) {
        return { produto_id: p.id, produto_nome: p.nome }
      }
    }
  }
  return null
}

/**
 * Classifica a categoria de uma NF-e da Fedrigoni pela ESTRUTURA do COD. PROD,
 * conforme a regra do cliente (prefixo + tamanho do código no início da linha
 * de produto do DANFE):
 *   • 15 caracteres começando com "8R"        → Lintec / Casting
 *   • 15 caracteres (não 8R)                  → Produto Acabado
 *   • 10 dígitos numéricos (ex.: 8703819277)  → Semi-Acabado
 *   • 8 caracteres começando com "0P"         → Matéria-Prima
 *   • 8–9 caracteres começando com "0K"       → Embalagem
 *
 * Validado contra notas reais das 5 categorias. Retorna o rótulo da categoria
 * ou null se nenhum código for reconhecido.
 */
export function classificarCategoriaFedrigoniPorCodigo(textoPdf?: string): string | null {
  const linhas = (textoPdf ?? '').split(/\r?\n/).map(l => l.trim())
  // Restringe à seção de produtos para não casar com a chave/protocolo etc.
  // Cobre variações de cabeçalho: "DADOS DO PRODUTO/SERVIÇO",
  // "DADOS DOS PRODUTOS / SERVIÇOS" (layout de retorno), "COD. PROD", "CÓDIGO".
  const idx = linhas.findIndex(l =>
    /DADOS D[OE]S?\s+PRODUTOS?|COD\.?\s*PROD|^C[ÓO]DIGO$/i.test(l)
  )
  const escopo = idx >= 0 ? linhas.slice(idx + 1) : linhas

  for (const l of escopo) {
    if (!l || /^-+/.test(l) || /COD\.?\s*PROD|DESCRI|^PRODUTO$|^C[ÓO]DIGO$/i.test(l)) continue
    // Considera apenas a LINHA DE PRODUTO (começa com prefixo de código conhecido:
    // família "8…" (8R, 8E, 87, 8J, …), família "0…" de MP/Embalagem (0M/0P/0F/0L/0K),
    // ou família "B…" de produto revestido/semi-acabado (ex.: B1299 COATED MC 80).
    // Evita casar com chave/protocolo/valores.
    if (!/^(8[0-9A-Z]|0[MPFLK]|B\d)[0-9A-Z]/.test(l)) continue

    // Matéria-Prima e Embalagem: código de tamanho fixo com prefixo conhecido,
    // muitas vezes colado à DESCRIÇÃO (sem lote). Casa pelo padrão do prefixo.
    // Matéria-Prima: 0M / 0P / 0F / 0L (+ 6 dígitos). Embalagem: 0K.
    if (/^0[MPFL]\d{6}(?!\d)/.test(l)) return 'Matéria-Prima'
    if (/^0K\d{6,7}(?!\d)/.test(l)) return 'Embalagem'
    // "B####" (ex.: B1299 COATED MC 80 FSC): produto revestido/em processamento
    // intermediário → Semi-Acabado. Prefixo fixo, sem regra por tamanho (só 1
    // exemplo validado até agora; mesma abordagem do 0K acima).
    if (/^B\d{3,6}(?!\d)/.test(l)) return 'Semi-Acabado'

    // Família "8…" (8R/8E/87/8J/…): o COD. PROD vem seguido do LOTE
    // (B####/MP####/LTC###), colado ou separado por espaço, e PODE ter letras
    // embutidas (ex.: O015, ZZ, C46115016). Classifica pelo TAMANHO do código:
    //   8R + 14-15 → Lintec · 10 → Semi-Acabado · 14-15 → Produto Acabado
    if (/^8[0-9A-Z]/.test(l)) {
      const tok = (l.match(/^[0-9A-Z]+/) || [''])[0]
      const cod = tok.replace(/(B\d{3,5}|MP\d{2,}|LTC\d+)$/i, '')
      const len = cod.length
      if (/^8R/.test(cod) && len >= 14) return 'Lintec / Casting'
      if (len === 10) return 'Semi-Acabado'
      if (len >= 14) return 'Produto Acabado'
      // len 8 começando com 8E → código provavelmente QUEBRADO pela extração;
      // resolvido no fallback por família abaixo.
    }
  }

  // Fallback por FAMÍLIA do código (quando a linha foi quebrada pela extração).
  // "7730XXX"/"7731XXX" = Produto Acabado; "0031520" + 8R = Lintec.
  const corpo = (textoPdf ?? '')
  if (/\b8R/.test(corpo) && /0031520/.test(corpo)) return 'Lintec / Casting'
  if (/773[01]\d{3}/.test(corpo)) return 'Produto Acabado'

  return null
}

// ─────────────────────────────────────────────
// SALVAR EMAIL + ANEXOS + MOVIMENTAÇÕES
// ─────────────────────────────────────────────

export interface ResultadoPersistencia {
  email_id: string | null
  anexos_salvos: number
  movimentacoes_salvas: number
  erros: string[]
  duplicados: number
}

/**
 * Persiste um email processado (com seus anexos e movimentações) no Supabase.
 * Aplica deduplicação em todos os níveis.
 */
export async function persistirEmail(
  email: EmailProcessado
): Promise<ResultadoPersistencia> {
  const supabase = getServerClient()
  const resultado: ResultadoPersistencia = {
    email_id: null,
    anexos_salvos: 0,
    movimentacoes_salvas: 0,
    erros: [],
    duplicados: 0,
  }

  // 1. Verificar deduplicação do email
  if (await emailJaImportado(email.message_id)) {
    resultado.duplicados++
    resultado.erros.push(`Email já importado: ${email.message_id}`)
    return resultado
  }

  // 2. Salvar email
  const { data: emailSalvo, error: emailErr } = await supabase
    .from('emails_importados')
    .insert({
      message_id: email.message_id,
      assunto: email.assunto,
      remetente: email.remetente,
      data_recebimento: email.data_recebimento,
      status_processamento: 'processado',
    })
    .select('id')
    .single()

  if (emailErr || !emailSalvo) {
    resultado.erros.push(`Erro ao salvar email: ${emailErr?.message}`)
    return resultado
  }

  resultado.email_id = emailSalvo.id

  // 3. Processar cada anexo NFe
  for (const anexo of email.anexos_xml) {
    await persistirAnexo(supabase, emailSalvo.id, anexo, resultado, email.remetente, email.remetente_nome, email.assunto, email.cnpjs_corpo ?? [])
  }

  return resultado
}

async function persistirAnexo(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  emailId: string,
  anexo: AnexoXML,
  resultado: ResultadoPersistencia,
  remetente = '',
  remetenteNome = '',
  assunto = '',
  cnpjsCorpo: string[] = [],
): Promise<void> {
  // Deduplicação por hash
  if (await arquivoJaProcessado(anexo.hash)) {
    resultado.duplicados++
    return
  }

  // Deduplicação por chave NFe
  if (anexo.dados_nfe?.chave_nfe && await nfeJaImportada(anexo.dados_nfe.chave_nfe)) {
    resultado.duplicados++
    return
  }

  const nfe = anexo.dados_nfe
  const pesoTon = nfe ? nfe.peso_liquido_total / 1000 : null

  // Determina tipo de arquivo
  const tipoArquivo = anexo.nome_arquivo.toLowerCase().endsWith('.xml') ? 'xml' : 'pdf'

  const chaveArquivo = nfe?.chave_nfe || chaveDoNomeArquivo(anexo.nome_arquivo)

  // Linha-fantasma da mesma nota (ver arquivoFantasmaExistente): completa aquela
  // linha em vez de inserir — `hash_arquivo` é UNIQUE, um INSERT falharia e a
  // nota continuaria fora do sistema.
  const fantasmaId = await arquivoFantasmaExistente(anexo.hash, chaveArquivo)

  const camposArquivo = {
    email_id: emailId,
    nome_arquivo: anexo.nome_arquivo,
    tipo_arquivo: tipoArquivo,
    hash_arquivo: anexo.hash,
    chave_nfe: chaveArquivo,
    numero_nfe: nfe?.numero_nfe || null,
    data_emissao: nfe?.data_emissao || null,
    cnpj_emitente: nfe?.cnpj_emitente || null,
    nome_emitente: nfe?.nome_emitente || null,
    cnpj_destinatario: nfe?.cnpj_destinatario || null,
    nome_destinatario: nfe?.nome_destinatario || null,
    cfop: nfe?.cfop || null,
    natureza_operacao: nfe?.natureza_operacao || null,
    tipo_operacao: nfe?.tipo_operacao || null,
    peso_liquido_ton: pesoTon,
    pallets_calculados: anexo.pallets_calculados,
    processado: true,
  }

  const { data: arquivoSalvo, error: arquivoErr } = fantasmaId
    ? await supabase.from('arquivos_nfe').update(camposArquivo).eq('id', fantasmaId).select('id').single()
    : await supabase.from('arquivos_nfe').insert(camposArquivo).select('id').single()

  if (arquivoErr || !arquivoSalvo) {
    resultado.erros.push(
      `Erro ao salvar arquivo ${anexo.nome_arquivo}: ${arquivoErr?.message}`
    )
    return
  }

  resultado.anexos_salvos++

  // Identificar cliente: CNPJ NF-e → CNPJ corpo email → email remetente → nome/assunto
  const clienteId = await identificarCliente(
    nfe?.cnpj_emitente ?? '',
    nfe?.cnpj_destinatario ?? '',
    remetente,
    remetenteNome,
    nfe?.nome_emitente ?? '',
    assunto,
    cnpjsCorpo,
  )

  // Não cria movimentação sem cliente — registros sem vínculo não têm utilidade
  if (!clienteId) {
    resultado.erros.push(`Arquivo ${anexo.nome_arquivo}: cliente não identificado — sem CNPJ, remetente ou nome reconhecível.`)
    return
  }

  // Busca configuração do cliente sem depender de migrations opcionais.
  const { data: clienteConfig } = await supabase
    .from('clientes')
    .select('cnpj, nome, nome_fantasia, valor_pallet, aliquota_imposto')
    .eq('id', clienteId)
    .single()

  const { data: clienteModo } = await supabase
    .from('clientes')
    .select('modo_calculo')
    .eq('id', clienteId)
    .maybeSingle()

  const clienteCnpj = String(clienteConfig?.cnpj ?? '').replace(/\D/g, '')
  const clienteNome = `${clienteConfig?.nome ?? ''} ${clienteConfig?.nome_fantasia ?? ''}`.toLowerCase()
  const ehClienteFedrigoni =
    clienteCnpj === '34661762000150' ||
    nfe?.cnpj_emitente === '34661762000150' ||
    clienteNome.includes('fedrigoni')
  const ehClienteTecnia =
    clienteCnpj === '54945280000130' ||
    nfe?.cnpj_emitente === '54945280000130' ||
    nfe?.cnpj_destinatario === '54945280000130' ||
    clienteNome.includes('tecnia')
  const modoCalculo: string =
    clienteModo?.modo_calculo ??
    (ehClienteFedrigoni ? 'fedrigoni' : ehClienteTecnia ? 'tecnia' : 'padrao')

  // ─────────────────────────────────────────────────────────────────
  // LÓGICA ESPECÍFICA: FEDRIGONI
  // Regras diferentes do padrão:
  //   • Lê apenas PDFs (XMLs são ignorados)
  //   • NF-e com natureza "compra" é informativa e não gera movimentação
  //   • Entrada = natureza contendo "remessa"
  //   • Saída = natureza contendo "venda" ou "retorno"
  //   • Volume = QUANTIDADE do campo ESPÉCIE (fator 1:1, não usa peso)
  //   • Valor por volume usa valor_pallet do cadastro do cliente (padrão R$ 40)
  // ─────────────────────────────────────────────────────────────────
  if (modoCalculo === 'fedrigoni') {
    // Fedrigoni usa apenas PDFs — ignora XMLs (sem criar movimentação).
    // CRÍTICO: remove o arquivo_nfe recém-inserido para que o XML NÃO "reserve"
    // a chave de acesso. Senão, quando o mesmo e-mail (ou um anterior) traz o XML
    // e o PDF da mesma nota, o XML é processado primeiro, grava a chave e o PDF
    // — que é o único que gera movimentação — é descartado por dedup (nfeJaImportada).
    if (tipoArquivo !== 'pdf') {
      await supabase.from('arquivos_nfe').delete().eq('id', arquivoSalvo.id)
      resultado.anexos_salvos--
      return
    }

    // Classificação por texto da natureza (spec original Fedrigoni):
    //   • ENTRADA: "remessa para depósito"  (precisa conter "remessa" E "deposito")
    //   • SAÍDA:   "venda" OU "remessa de amostra" OU "retorno"
    //   • RETORNO SIMBÓLICO e demais informativas: não contabilizam
    //
    // Ordem importa: "remessa de amostra" contém "remessa" mas NÃO "deposito",
    // então cai corretamente em saída (e não em entrada). "Retorno de mercadoria
    // depositada em depósito" = devolução do armazém de volta ao cliente → saída
    // (mercadoria deixando o armazém; código DANFE 1).
    const tipoOpFedrigoni = classificarOperacaoFedrigoni(
      nfe?.natureza_operacao ?? '',
      nfe?.codigo_operacao_danfe,
    )

    if (!tipoOpFedrigoni) {
      // Informativa (compra / remessa industrial) ou sem código — não gera movimentação.
      resultado.erros.push(
        `Fedrigoni NF-e ${nfe?.numero_nfe ?? anexo.nome_arquivo}: natureza "${nfe?.natureza_operacao || 'sem natureza'}" não contabilizada (informativa).`
      )
      return
    }

    // Volume = QUANTIDADE do campo ESPÉCIE (fator 1:1)
    const volumesFedrigoni = nfe?.quantidade_especie ?? null
    const valorVolumeFedrigoni = clienteConfig?.valor_pallet ?? 40
    const aliquotaFedrigoni = clienteConfig?.aliquota_imposto ?? 0

    // Identificação da categoria cobrada na nota (APENAS especificação —
    // volume, fator e valor continuam vindo do total da ESPÉCIE).
    const { data: produtosFedrigoni } = await supabase
      .from('cliente_produtos')
      .select('id, nome, codigo_ncm, palavras_chave, valor_pallet, aliquota_imposto, regra_fator_pallet')
      .eq('cliente_id', clienteId)
      .eq('ativo', true)
      .order('ordem', { ascending: true })

    // PRIMÁRIO: classifica pela estrutura do COD. PROD (prefixo + tamanho) —
    // regra do cliente, validada contra notas reais das 5 categorias.
    const categoriaLabel = classificarCategoriaFedrigoniPorCodigo(nfe?.texto_pdf)

    let produtoFedrigoni: { produto_id: string | null; produto_nome: string } | null = null
    if (categoriaLabel) {
      // Mapeia o rótulo da categoria ao produto cadastrado (para o produto_id),
      // comparando por nome normalizado. Semi-Acabado pode não ter cadastro:
      // nesse caso grava só o produto_nome (produto_id null).
      const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]/g, '')
      const alvo = norm(categoriaLabel)
      const prodCad = (produtosFedrigoni ?? []).find((p: any) => norm(p.nome) === alvo)
      produtoFedrigoni = { produto_id: prodCad?.id ?? null, produto_nome: prodCad?.nome ?? categoriaLabel }
    } else {
      // FALLBACK: matcher por palavra-chave/padrão (caso surja um código fora do padrão)
      produtoFedrigoni = identificarCategoriaFedrigoni(produtosFedrigoni ?? [], nfe?.texto_pdf, nfe?.itens ?? [])
    }

    if (!produtoFedrigoni) {
      // Não impede a contabilização; apenas registra que a categoria não foi
      // reconhecida para revisão manual posterior.
      resultado.erros.push(
        `Fedrigoni NF-e ${nfe?.numero_nfe ?? anexo.nome_arquivo}: categoria não identificada (código fora do padrão).`
      )
    }

    // Embalagem: cada volume da ESPÉCIE conta como 2 pallets (regra do cliente).
    const volumesFedrigoniFinal =
      produtoFedrigoni?.produto_nome === 'Embalagem' && volumesFedrigoni != null
        ? volumesFedrigoni * 2
        : volumesFedrigoni

    const movFedrigoni = {
      cliente_id: clienteId,
      arquivo_nfe_id: arquivoSalvo.id,
      produto_id: produtoFedrigoni?.produto_id ?? null,
      produto_nome: produtoFedrigoni?.produto_nome ?? null,
      tipo_movimentacao: tipoOpFedrigoni,
      categoria_movimentacao: 'pa' as const,
      fornecedor: tipoOpFedrigoni === 'entrada' ? (nfe?.nome_emitente ?? null) : null,
      cliente_destino: tipoOpFedrigoni === 'saida' ? (nfe?.nome_destinatario ?? null) : null,
      numero_nfe: nfe?.numero_nfe ?? null,
      chave_nfe: nfe?.chave_nfe ?? null,
      data_entrada: tipoOpFedrigoni === 'entrada' ? (nfe?.data_emissao || null) : null,
      qtd_entrada_ton: null,
      pallets_entrada: tipoOpFedrigoni === 'entrada' ? volumesFedrigoniFinal : null,
      data_saida: tipoOpFedrigoni === 'saida' ? (nfe?.data_emissao || null) : null,
      qtd_saida_ton: null,
      pallets_saida: tipoOpFedrigoni === 'saida' ? volumesFedrigoniFinal : null,
      valor_pallet: valorVolumeFedrigoni,
      percentual_imposto: aliquotaFedrigoni,
    }

    const { error: movErrFedrigoni } = await supabase.from('movimentacoes').insert(movFedrigoni)
    if (movErrFedrigoni) {
      resultado.erros.push(
        `Erro ao salvar movimentação Fedrigoni ${nfe?.numero_nfe ?? anexo.nome_arquivo}: ${movErrFedrigoni.message}`
      )
    } else {
      resultado.movimentacoes_salvas++
    }
    return
  }

  // ─────────────────────────────────────────────────────────────────
  // LÓGICA ESPECÍFICA: TECNIA
  // Semelhante à Fedrigoni, mas sem identificação de categoria:
  //   • Lê apenas PDFs (XMLs são ignorados) — o volume vem do campo
  //     QUANTIDADE/ESPÉCIE do DANFE, que só existe no PDF
  //   • Entrada = natureza da operação contendo "remessa"
  //   • Saída   = natureza da operação contendo "retorno"
  //   • Demais naturezas (nenhuma das duas palavras, ou ambas) são
  //     desconsideradas — não geram movimentação
  //   • Volume = QUANTIDADE do campo ESPÉCIE (fator 1:1, não usa peso)
  //   • Valor por volume usa valor_pallet do cadastro do cliente (padrão R$ 40)
  // ─────────────────────────────────────────────────────────────────
  if (modoCalculo === 'tecnia') {
    // Tecnia usa apenas PDFs — ignora XMLs (sem criar movimentação).
    // Mesmo motivo da Fedrigoni: evita que o XML "reserve" a chave de acesso
    // e faça o PDF (único que gera movimentação) ser descartado por dedup.
    if (tipoArquivo !== 'pdf') {
      await supabase.from('arquivos_nfe').delete().eq('id', arquivoSalvo.id)
      resultado.anexos_salvos--
      return
    }

    // Regra da Tecnia (remessa = entrada, retorno = saída) agora mora no
    // classificador único, para a pré-filtragem enxergar a mesma coisa.
    const { tipo: tipoOpTecnia, motivo: motivoTecnia } =
      classificarOperacaoV2(nfe?.natureza_operacao ?? '', 'tecnia')
    if (!tipoOpTecnia) {
      resultado.erros.push(`Tecnia NF-e ${nfe?.numero_nfe ?? anexo.nome_arquivo}: ${motivoTecnia}`)
      return
    }

    // Volume = QUANTIDADE do campo ESPÉCIE (fator 1:1) — igual à Fedrigoni.
    const volumesTecnia = nfe?.quantidade_especie ?? null
    const valorVolumeTecnia = clienteConfig?.valor_pallet ?? 40
    const aliquotaTecnia = clienteConfig?.aliquota_imposto ?? 0

    const movTecnia = {
      cliente_id: clienteId,
      arquivo_nfe_id: arquivoSalvo.id,
      produto_id: null,
      produto_nome: null,
      tipo_movimentacao: tipoOpTecnia,
      categoria_movimentacao: 'pa' as const,
      fornecedor: tipoOpTecnia === 'entrada' ? (nfe?.nome_emitente ?? null) : null,
      cliente_destino: tipoOpTecnia === 'saida' ? (nfe?.nome_destinatario ?? null) : null,
      numero_nfe: nfe?.numero_nfe ?? null,
      chave_nfe: nfe?.chave_nfe ?? null,
      data_entrada: tipoOpTecnia === 'entrada' ? (nfe?.data_emissao || null) : null,
      qtd_entrada_ton: null,
      pallets_entrada: tipoOpTecnia === 'entrada' ? volumesTecnia : null,
      data_saida: tipoOpTecnia === 'saida' ? (nfe?.data_emissao || null) : null,
      qtd_saida_ton: null,
      pallets_saida: tipoOpTecnia === 'saida' ? volumesTecnia : null,
      valor_pallet: valorVolumeTecnia,
      percentual_imposto: aliquotaTecnia,
    }

    const { error: movErrTecnia } = await supabase.from('movimentacoes').insert(movTecnia)
    if (movErrTecnia) {
      resultado.erros.push(
        `Erro ao salvar movimentação Tecnia ${nfe?.numero_nfe ?? anexo.nome_arquivo}: ${movErrTecnia.message}`
      )
    } else {
      resultado.movimentacoes_salvas++
    }
    return
  }

  // ─────────────────────────────────────────────────────────────────
  // LÓGICA ESPECÍFICA: AVERY
  // A Avery não informa peso líquido nas NF-e (campo opcional que o
  // emitente deixa em branco), então o cálculo padrão por peso/ton
  // sempre zera a quantidade. Também não precisa de categorização por
  // produto — só a quantidade total da nota.
  //   • Lê XML e PDF normalmente (sem restrição de tipo de arquivo)
  //   • Entrada/saída classificados pela natureza da operação (regra padrão)
  //   • Volume = QUANTIDADE de volumes transportados (campo ESPÉCIE do
  //     DANFE / qVol do XML), fator 1:1 — sem produto associado
  // ─────────────────────────────────────────────────────────────────
  if (modoCalculo === 'avery') {
    // Mesmo classificador da pré-filtragem — antes usava a regra genérica, que
    // classificava "Retorno de mercadoria depositada" como entrada (invertendo
    // o sinal do estoque). Ver classificarOperacaoV2.
    const { tipo: tipoOpAvery, motivo: motivoAvery } =
      classificarOperacaoV2(nfe?.natureza_operacao ?? '', 'avery')
    if (!tipoOpAvery) {
      resultado.erros.push(`Avery NF-e ${nfe?.numero_nfe ?? anexo.nome_arquivo}: ${motivoAvery}`)
      return
    }
    const volumesAvery = nfe?.quantidade_especie ?? null
    const valorVolumeAvery = clienteConfig?.valor_pallet ?? 40
    const aliquotaAvery = clienteConfig?.aliquota_imposto ?? 0

    if (volumesAvery === null) {
      resultado.erros.push(
        `Avery NF-e ${nfe?.numero_nfe ?? anexo.nome_arquivo}: quantidade de volumes não identificada no documento — revisar manualmente.`
      )
    }

    const movAvery = {
      cliente_id: clienteId,
      arquivo_nfe_id: arquivoSalvo.id,
      produto_id: null,
      produto_nome: null,
      tipo_movimentacao: tipoOpAvery,
      categoria_movimentacao: 'pa' as const,
      fornecedor: tipoOpAvery === 'entrada' ? (nfe?.nome_emitente ?? null) : null,
      cliente_destino: tipoOpAvery === 'saida' ? (nfe?.nome_destinatario ?? null) : null,
      numero_nfe: nfe?.numero_nfe ?? null,
      chave_nfe: nfe?.chave_nfe ?? null,
      data_entrada: tipoOpAvery === 'entrada' ? (nfe?.data_emissao || null) : null,
      qtd_entrada_ton: null,
      pallets_entrada: tipoOpAvery === 'entrada' ? volumesAvery : null,
      data_saida: tipoOpAvery === 'saida' ? (nfe?.data_emissao || null) : null,
      qtd_saida_ton: null,
      pallets_saida: tipoOpAvery === 'saida' ? volumesAvery : null,
      valor_pallet: valorVolumeAvery,
      percentual_imposto: aliquotaAvery,
    }

    const { error: movErrAvery } = await supabase.from('movimentacoes').insert(movAvery)
    if (movErrAvery) {
      resultado.erros.push(
        `Erro ao salvar movimentação Avery ${nfe?.numero_nfe ?? anexo.nome_arquivo}: ${movErrAvery.message}`
      )
    } else {
      resultado.movimentacoes_salvas++
    }
    return
  }

  // ─────────────────────────────────────────────────────────────────
  // LÓGICA PADRÃO (Alphalum e demais clientes)
  // ─────────────────────────────────────────────────────────────────
  const { tipo: tipoOp, motivo: motivoPadrao } =
    classificarOperacaoV2(nfe?.natureza_operacao ?? '', modoCalculo)
  if (!tipoOp) {
    resultado.erros.push(`NF-e ${nfe?.numero_nfe ?? anexo.nome_arquivo}: ${motivoPadrao}`)
    return
  }
  const itensNfe = nfe?.itens ?? []

  // Buscar produtos do cliente para tentar detecção multi-produto
  const { data: produtosCliente } = await supabase
    .from('cliente_produtos')
    .select('id, nome, codigo_ncm, palavras_chave, valor_pallet, aliquota_imposto, regra_fator_pallet')
    .eq('cliente_id', clienteId)
    .eq('ativo', true)
    .order('ordem', { ascending: true })

  const gruposMultiProduto = agruparItensPorProduto(
    itensNfe,
    produtosCliente ?? [],
    nfe?.peso_liquido_total ?? 0,
  )

  if (gruposMultiProduto) {
    // NF-e com múltiplos produtos — uma movimentação por produto/código
    for (const grupo of gruposMultiProduto) {
      const fator = (grupo.prod?.regra_fator_pallet as number | undefined) ?? 1.2
      const palletsG = calcularPallets(grupo.pesoTon, fator)
      const mov = {
        cliente_id: clienteId,
        arquivo_nfe_id: arquivoSalvo.id,
        produto_id: grupo.prod?.id ?? null,
        // Usa nome do produto cadastrado se identificado; senão, descrição da NF-e
        produto_nome: grupo.prod?.nome ?? grupo.descricaoItem ?? null,
        tipo_movimentacao: tipoOp,
        categoria_movimentacao: 'pa' as const,
        fornecedor: tipoOp === 'entrada' ? (nfe?.nome_emitente ?? null) : null,
        cliente_destino: tipoOp === 'saida' ? (nfe?.nome_destinatario ?? null) : null,
        numero_nfe: nfe?.numero_nfe ?? null,
        chave_nfe: nfe?.chave_nfe ?? null,
        data_entrada: tipoOp === 'entrada' ? (nfe?.data_emissao || null) : null,
        qtd_entrada_ton: tipoOp === 'entrada' ? grupo.pesoTon : null,
        pallets_entrada: tipoOp === 'entrada' ? palletsG : null,
        data_saida: tipoOp === 'saida' ? (nfe?.data_emissao || null) : null,
        qtd_saida_ton: tipoOp === 'saida' ? grupo.pesoTon : null,
        pallets_saida: tipoOp === 'saida' ? palletsG : null,
        ...(grupo.prod ? {
          valor_pallet: grupo.prod.valor_pallet,
          percentual_imposto: grupo.prod.aliquota_imposto,
        } : {}),
      }
      const { error: movErr } = await supabase.from('movimentacoes').insert(mov)
      if (movErr) {
        resultado.erros.push(`Erro ao salvar movimentação (${grupo.prod.nome}): ${movErr.message}`)
      } else {
        resultado.movimentacoes_salvas++
      }
    }
  } else {
    // Produto único — usa lista já buscada (evita segunda query ao banco)
    const produtoMatch = matchProdutoComLista(itensNfe, produtosCliente ?? [], nfe?.texto_pdf)
    const fatorPallet = produtoMatch?.regra_fator_pallet ?? null
    const palletsCalc = fatorPallet && pesoTon
      ? calcularPallets(pesoTon, fatorPallet)
      : (anexo.pallets_calculados ?? null)

    const movimentacao = {
      cliente_id: clienteId,
      arquivo_nfe_id: arquivoSalvo.id,
      produto_id: produtoMatch?.produto_id ?? null,
      // Sem produto cadastrado, cai na descrição do item — mesmo critério do
      // caminho multi-produto acima. Antes ficava nulo, e uma NF-e de item único
      // aparecia sem nada na coluna de produto (ex.: NF-e 253 da Alphalum).
      produto_nome: produtoMatch?.produto_nome ?? itensNfe[0]?.descricao ?? null,
      tipo_movimentacao: tipoOp,
      categoria_movimentacao: 'pa' as const,
      fornecedor: tipoOp === 'entrada' ? (nfe?.nome_emitente ?? null) : null,
      cliente_destino: tipoOp === 'saida' ? (nfe?.nome_destinatario ?? null) : null,
      numero_nfe: nfe?.numero_nfe ?? null,
      chave_nfe: nfe?.chave_nfe ?? null,
      data_entrada: tipoOp === 'entrada' ? (nfe?.data_emissao || null) : null,
      qtd_entrada_ton: tipoOp === 'entrada' ? pesoTon : null,
      pallets_entrada: tipoOp === 'entrada' ? palletsCalc : null,
      data_saida: tipoOp === 'saida' ? (nfe?.data_emissao || null) : null,
      qtd_saida_ton: tipoOp === 'saida' ? pesoTon : null,
      pallets_saida: tipoOp === 'saida' ? palletsCalc : null,
      ...(produtoMatch ? {
        valor_pallet: produtoMatch.valor_pallet,
        percentual_imposto: produtoMatch.aliquota_imposto,
      } : {}),
    }

    const { error: movErr } = await supabase.from('movimentacoes').insert(movimentacao)
    if (movErr) {
      resultado.erros.push(
        `Erro ao salvar movimentação da NF-e ${nfe?.numero_nfe ?? anexo.nome_arquivo}: ${movErr.message}`
      )
    } else {
      resultado.movimentacoes_salvas++
    }
  }
}

// ─────────────────────────────────────────────
// LEITURA PARA O DASHBOARD
// ─────────────────────────────────────────────

export async function listarEmailsImportados(limit = 50) {
  const supabase = getServerClient()
  const { data, error } = await supabase
    .from('emails_importados')
    .select('*')
    .order('data_recebimento', { ascending: false })
    .limit(limit)

  if (error) throw error
  return data ?? []
}

export async function listarMovimentacoes(limit = 100) {
  const supabase = getServerClient()
  const { data, error } = await supabase
    .from('movimentacoes')
    .select(`
      *,
      arquivos_nfe (nome_arquivo, chave_nfe, nome_emitente, nome_destinatario),
      clientes (id, nome_fantasia)
    `)
    .order('data_entrada', { ascending: false, nullsFirst: false })
    .order('data_saida', { ascending: false, nullsFirst: false })
    .order('created_at', { ascending: false })
    .limit(limit)

  if (error) throw error
  return data ?? []
}

export async function listarClientes() {
  const supabase = getServerClient()
  const { data, error } = await supabase
    .from('clientes')
    .select('*')
    .eq('ativo', true)
    .order('nome_fantasia')

  if (error) throw error
  return data ?? []
}

export async function listarClientesComResumo() {
  const supabase = getServerClient()
  const { data: clientes, error } = await supabase
    .from('clientes')
    .select('*')
    .eq('ativo', true)
    .order('nome_fantasia')
  if (error) throw error

  const resultado = await Promise.all((clientes ?? []).map(async (c: any) => {
    let { data: movs, error: movErr } = await supabase
      .from('movimentacoes')
      .select('tipo_movimentacao, pallets_entrada, pallets_saida, qtd_entrada_ton, qtd_saida_ton, data_entrada, data_saida, cancelada')
      .eq('cliente_id', c.id)

    if (movErr) throw movErr

    // Filter out cancelled rows (handles case where column may not exist yet)
    const movsAtivas = (movs ?? []).filter((m: any) => !m.cancelada)

    const totalEntradas = movsAtivas.reduce((s: number, m: any) => s + (m.pallets_entrada || 0), 0)
    const totalSaidas = movsAtivas.reduce((s: number, m: any) => s + (m.pallets_saida || 0), 0)
    const totalNfes = movsAtivas.length

    return { ...c, totalEntradas, totalSaidas, totalNfes }
  }))

  return resultado
}

export async function buscarClientePorId(id: string) {
  const supabase = getServerClient()
  const { data: cliente, error } = await supabase
    .from('clientes')
    .select('*')
    .eq('id', id)
    .single()
  if (error) throw error

  const { data: movimentacoes, error: movErr } = await supabase
    .from('movimentacoes')
    .select(`
      *,
      arquivos_nfe (nome_arquivo, nome_emitente, nome_destinatario, cnpj_emitente, cnpj_destinatario)
    `)
    .eq('cliente_id', id)
    .order('data_entrada', { ascending: false, nullsFirst: false })
    .order('data_saida', { ascending: false, nullsFirst: false })
    .order('created_at', { ascending: false })
  if (movErr) throw movErr

  return { cliente, movimentacoes: movimentacoes ?? [] }
}

export async function atualizarCliente(id: string, dados: {
  nome_fantasia?: string
  nome?: string
  cnpj?: string
  email_remetente?: string | null
  valor_pallet?: number
  aliquota_imposto?: number
  regra_fator_pallet?: number
  cobrar_manuseio?: boolean
  cobrar_separacao_sacaria?: boolean
  modo_calculo?: string
}) {
  const supabase = getServerClient()
  const { data, error } = await supabase
    .from('clientes')
    .update({ ...dados, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select()
    .single()
  if (error) throw error

  // Sincroniza clientes_cnpj quando CNPJ é fornecido (upsert para cobrir criação e edição)
  if (dados.cnpj) {
    const cnpjLimpo = dados.cnpj.replace(/\D/g, '')
    if (cnpjLimpo) {
      await supabase.from('clientes_cnpj').upsert(
        { cliente_id: id, cnpj: cnpjLimpo, tipo: 'emitente' },
        { onConflict: 'cliente_id,cnpj' }
      )
    }
  }

  return data
}

export async function criarCliente(dados: {
  nome: string
  nome_fantasia?: string
  cnpj?: string
  valor_pallet?: number
  aliquota_imposto?: number
  regra_fator_pallet?: number
}) {
  const supabase = getServerClient()
  const { data, error } = await supabase
    .from('clientes')
    .insert(dados)
    .select()
    .single()
  if (error) throw error

  if (dados.cnpj) {
    await supabase.from('clientes_cnpj').insert({
      cliente_id: data.id,
      cnpj: dados.cnpj.replace(/\D/g, ''),
      tipo: 'emitente',
    }).select()
  }

  return data
}

/**
 * Após criar/atualizar um cliente, busca movimentações ainda sem cliente
 * e as vincula caso o CNPJ da NF-e coincida com o CNPJ do cliente.
 * Retorna o número de movimentações atualizadas.
 */
export async function reidentificarMovimentacoesOrfas(clienteId: string): Promise<number> {
  const supabase = getServerClient()

  const { data: cliente } = await supabase
    .from('clientes')
    .select('cnpj, valor_pallet, aliquota_imposto, regra_fator_pallet')
    .eq('id', clienteId)
    .single()

  if (!cliente) return 0

  const cnpjCliente = cliente.cnpj ? (cliente.cnpj as string).replace(/\D/g, '') : null

  // Busca todas as movimentações órfãs não canceladas com dados da NF-e
  const { data: movs } = await supabase
    .from('movimentacoes')
    .select('id, tipo_movimentacao, cancelada, arquivos_nfe(cnpj_emitente, cnpj_destinatario, nome_emitente, peso_liquido_ton)')
    .is('cliente_id', null)

  if (!movs || movs.length === 0) return 0

  let count = 0
  const fatorPallet: number | null = cliente.regra_fator_pallet ?? null

  for (const mov of movs) {
    if (mov.cancelada) continue
    const arq = mov.arquivos_nfe as any
    if (!arq) continue

    const cnpjEmitente: string = arq.cnpj_emitente || ''
    const cnpjDestinatario: string = arq.cnpj_destinatario || ''

    // Verifica se algum dos CNPJs da NF-e pertence ao cliente
    const matchCnpj = cnpjCliente && (cnpjEmitente === cnpjCliente || cnpjDestinatario === cnpjCliente)
    // Fallback: busca via índice clientes_cnpj (cobre CNPJs registrados manualmente)
    let matchPorIndice = false
    if (!matchCnpj && (cnpjEmitente || cnpjDestinatario)) {
      const cnpjsNFe = [cnpjEmitente, cnpjDestinatario].filter(Boolean)
      const { data: idx } = await supabase
        .from('clientes_cnpj')
        .select('cliente_id')
        .eq('cliente_id', clienteId)
        .in('cnpj', cnpjsNFe)
        .limit(1)
        .maybeSingle()
      matchPorIndice = !!idx
    }

    if (!matchCnpj && !matchPorIndice) continue

    const pesoTon: number | null = arq.peso_liquido_ton ?? null
    const update: Record<string, unknown> = { cliente_id: clienteId }
    if (cliente.valor_pallet != null) update.valor_pallet = cliente.valor_pallet
    if (cliente.aliquota_imposto != null) update.percentual_imposto = cliente.aliquota_imposto
    if (fatorPallet && pesoTon) {
      const palletsCalc = calcularPallets(pesoTon, fatorPallet)
      if (mov.tipo_movimentacao === 'entrada') update.pallets_entrada = palletsCalc
      else update.pallets_saida = palletsCalc
    }

    const { error } = await supabase.from('movimentacoes').update(update).eq('id', mov.id)
    if (error) continue

    // Registra apenas o CNPJ emitente no índice — destinatário pode ser o próprio
    // armazém (XPS) e aparecer em NF-es de vários clientes, causando colisão
    if (cnpjEmitente) {
      await supabase.from('clientes_cnpj').upsert(
        { cliente_id: clienteId, cnpj: cnpjEmitente, tipo: 'emitente' },
        { onConflict: 'cliente_id,cnpj' }
      )
    }

    count++
  }

  return count
}

/**
 * Reidentifica movimentações órfãs pelo email_remetente do cliente.
 * Útil quando email_remetente é definido/alterado após a importação.
 */
export async function reidentificarOrfasPorEmail(clienteId: string): Promise<number> {
  const supabase = getServerClient()

  const { data: cliente } = await supabase
    .from('clientes')
    .select('email_remetente, valor_pallet, aliquota_imposto, regra_fator_pallet')
    .eq('id', clienteId)
    .single()

  if (!cliente?.email_remetente) return 0

  const emailRem = (cliente.email_remetente as string).toLowerCase()
  const dominio = emailRem.includes('@') ? emailRem.split('@')[1] : emailRem

  // Busca movimentações órfãs cujo email importado veio desse remetente
  const { data: movs } = await supabase
    .from('movimentacoes')
    .select(`
      id, tipo_movimentacao,
      arquivos_nfe(id, peso_liquido_ton,
        emails_importados(remetente)
      )
    `)
    .is('cliente_id', null)
    .not('arquivo_nfe_id', 'is', null)

  if (!movs || movs.length === 0) return 0

  let count = 0
  const fatorPallet: number | null = cliente.regra_fator_pallet ?? null

  for (const mov of movs) {
    const arq = mov.arquivos_nfe as any
    const emailMov: string = (arq?.emails_importados?.remetente || '').toLowerCase()
    if (!emailMov) continue

    const match = emailMov.includes(emailRem) || emailMov.includes(dominio) || emailRem.includes(emailMov.split('@')[1] || '')
    if (!match) continue

    const pesoTon: number | null = arq?.peso_liquido_ton ?? null
    const update: Record<string, unknown> = { cliente_id: clienteId }
    if (cliente.valor_pallet != null) update.valor_pallet = cliente.valor_pallet
    if (cliente.aliquota_imposto != null) update.percentual_imposto = cliente.aliquota_imposto
    if (fatorPallet && pesoTon) {
      const palletsCalc = calcularPallets(pesoTon, fatorPallet)
      if (mov.tipo_movimentacao === 'entrada') update.pallets_entrada = palletsCalc
      else update.pallets_saida = palletsCalc
    }

    const { error } = await supabase.from('movimentacoes').update(update).eq('id', mov.id)
    if (!error) count++
  }

  return count
}

// ─────────────────────────────────────────────
// SALDOS MENSAIS
// ─────────────────────────────────────────────

export async function listarSaldosMensais(clienteId: string) {
  const supabase = getServerClient()
  const { data, error } = await supabase
    .from('saldos_mensais')
    .select('*')
    .eq('cliente_id', clienteId)
    .order('competencia', { ascending: false })
  if (error) throw error
  return data ?? []
}

export async function upsertSaldoMensal(clienteId: string, competencia: string, volumeInicial: number) {
  const supabase = getServerClient()
  const { data, error } = await supabase
    .from('saldos_mensais')
    .upsert({ cliente_id: clienteId, competencia, volume_inicial: volumeInicial }, { onConflict: 'cliente_id,competencia' })
    .select()
    .single()
  if (error) throw error
  return data
}

export async function atualizarManuseio(movimentacaoId: string, valorManuseio: number) {
  const supabase = getServerClient()
  const { data, error } = await supabase
    .from('movimentacoes')
    .update({ valor_manuseio: valorManuseio })
    .eq('id', movimentacaoId)
    .select()
    .single()
  if (error) throw error
  return data
}

export async function vincularClienteMovimentacao(id: string, clienteId: string) {
  const supabase = getServerClient()

  // Carrega a movimentação + arquivo_nfe para enriquecimento
  const { data: mov, error: fetchErr } = await supabase
    .from('movimentacoes')
    .select('*, arquivos_nfe(cnpj_emitente, cnpj_destinatario, peso_liquido_ton)')
    .eq('id', id)
    .single()
  if (fetchErr || !mov) throw fetchErr || new Error('Movimentação não encontrada')

  // Carrega configuração de precificação do cliente
  const { data: cliente } = await supabase
    .from('clientes')
    .select('valor_pallet, aliquota_imposto, regra_fator_pallet')
    .eq('id', clienteId)
    .single()

  const arq = mov.arquivos_nfe as any
  const pesoTon: number | null = arq?.peso_liquido_ton ?? null
  const fatorPallet: number | null = cliente?.regra_fator_pallet ?? null

  const update: Record<string, unknown> = { cliente_id: clienteId }
  if (cliente?.valor_pallet != null) update.valor_pallet = cliente.valor_pallet
  if (cliente?.aliquota_imposto != null) update.percentual_imposto = cliente.aliquota_imposto

  if (fatorPallet && pesoTon) {
    const palletsCalc = calcularPallets(pesoTon, fatorPallet)
    if (mov.tipo_movimentacao === 'entrada') {
      update.pallets_entrada = palletsCalc
    } else {
      update.pallets_saida = palletsCalc
    }
  }

  // Registra CNPJs no índice para identificação automática em NFs futuras
  const cnpjEmitente: string = arq?.cnpj_emitente || ''
  const cnpjDestinatario: string = arq?.cnpj_destinatario || ''
  if (cnpjEmitente) {
    await supabase.from('clientes_cnpj').upsert(
      { cliente_id: clienteId, cnpj: cnpjEmitente, tipo: 'emitente' },
      { onConflict: 'cliente_id,cnpj' }
    )
  }
  if (cnpjDestinatario) {
    await supabase.from('clientes_cnpj').upsert(
      { cliente_id: clienteId, cnpj: cnpjDestinatario, tipo: 'destinatario' },
      { onConflict: 'cliente_id,cnpj' }
    )
  }

  const { data, error } = await supabase
    .from('movimentacoes')
    .update(update)
    .eq('id', id)
    .select()
    .single()
  if (error) throw error
  return data
}

export async function corrigirTipoMovimentacao(id: string, novoTipo: 'entrada' | 'saida') {
  const supabase = getServerClient()

  const { data: mov, error: fetchErr } = await supabase
    .from('movimentacoes')
    .select('*, arquivos_nfe(nome_emitente, nome_destinatario)')
    .eq('id', id)
    .single()

  if (fetchErr || !mov) throw fetchErr || new Error('Movimentação não encontrada')
  if (mov.tipo_movimentacao === novoTipo) return mov

  const arq = mov.arquivos_nfe as { nome_emitente: string | null; nome_destinatario: string | null } | null
  let update: Record<string, unknown>

  if (novoTipo === 'entrada') {
    update = {
      tipo_movimentacao: 'entrada',
      data_entrada: mov.data_saida,
      qtd_entrada_ton: mov.qtd_saida_ton,
      pallets_entrada: mov.pallets_saida,
      data_saida: null,
      qtd_saida_ton: null,
      pallets_saida: null,
      fornecedor: arq?.nome_emitente || null,
      cliente_destino: null,
    }
  } else {
    update = {
      tipo_movimentacao: 'saida',
      data_saida: mov.data_entrada,
      qtd_saida_ton: mov.qtd_entrada_ton,
      pallets_saida: mov.pallets_entrada,
      data_entrada: null,
      qtd_entrada_ton: null,
      pallets_entrada: null,
      cliente_destino: arq?.nome_destinatario || null,
      fornecedor: null,
    }
  }

  const { data, error } = await supabase
    .from('movimentacoes')
    .update(update)
    .eq('id', id)
    .select()
    .single()

  if (error) throw error
  return data
}

export async function excluirMovimentacao(id: string) {
  // Soft-delete: marca cancelada = true, mantém no histórico
  const supabase = getServerClient()
  const { error } = await supabase
    .from('movimentacoes')
    .update({ cancelada: true })
    .eq('id', id)
  if (error) throw error
}

export async function atualizarMovimentacaoCompleta(id: string, dados: Record<string, unknown>) {
  const supabase = getServerClient()
  const { data, error } = await supabase
    .from('movimentacoes')
    .update(dados)
    .eq('id', id)
    .select('*, arquivos_nfe(nome_arquivo, nome_emitente, nome_destinatario, cnpj_emitente, cnpj_destinatario)')
    .single()
  if (error) throw error
  return data
}

export async function criarMovimentacaoManual(dados: {
  cliente_id: string
  tipo_movimentacao: 'entrada' | 'saida'
  numero_nfe?: string | null
  fornecedor?: string | null
  cliente_destino?: string | null
  data_entrada?: string | null
  data_saida?: string | null
  qtd_entrada_ton?: number | null
  qtd_saida_ton?: number | null
  pallets_entrada?: number | null
  pallets_saida?: number | null
  valor_manuseio?: number | null
}) {
  const supabase = getServerClient()
  const { data, error } = await supabase
    .from('movimentacoes')
    .insert({ ...dados, categoria_movimentacao: 'pa' })
    .select('*, arquivos_nfe(nome_arquivo, nome_emitente, nome_destinatario, cnpj_emitente, cnpj_destinatario)')
    .single()
  if (error) throw error
  return data
}

export async function listarCobrancasAdicionais(clienteId: string, competencia: string) {
  const supabase = getServerClient()
  const { data, error } = await supabase
    .from('cobrancas_adicionais')
    .select('*')
    .eq('cliente_id', clienteId)
    .eq('competencia', competencia)
    .order('created_at', { ascending: true })
  if (error) throw error
  return data ?? []
}

export async function criarCobrancaAdicional(clienteId: string, competencia: string, descricao: string, valor: number) {
  const supabase = getServerClient()
  const { data, error } = await supabase
    .from('cobrancas_adicionais')
    .insert({ cliente_id: clienteId, competencia, descricao, valor })
    .select()
    .single()
  if (error) throw error
  return data
}

export async function excluirCobrancaAdicional(id: string) {
  const supabase = getServerClient()
  const { error } = await supabase
    .from('cobrancas_adicionais')
    .delete()
    .eq('id', id)
  if (error) throw error
}

// ─────────────────────────────────────────────
// PRODUTOS POR CLIENTE
// ─────────────────────────────────────────────

export async function listarProdutosCliente(clienteId: string) {
  const supabase = getServerClient()
  const { data, error } = await supabase
    .from('cliente_produtos')
    .select('*')
    .eq('cliente_id', clienteId)
    .eq('ativo', true)
    .order('ordem', { ascending: true })
  if (error) throw error
  return data ?? []
}

export async function criarProduto(clienteId: string, dados: {
  nome: string
  codigo_ncm?: string | null
  palavras_chave?: string | null
  valor_pallet: number
  aliquota_imposto: number
  regra_fator_pallet: number
  categoria?: string
}) {
  const supabase = getServerClient()
  const { data, error } = await supabase
    .from('cliente_produtos')
    .insert({ ...dados, cliente_id: clienteId })
    .select()
    .single()
  if (error) throw error
  return data
}

export async function atualizarProduto(id: string, dados: {
  nome?: string
  codigo_ncm?: string | null
  palavras_chave?: string | null
  valor_pallet?: number
  aliquota_imposto?: number
  regra_fator_pallet?: number
  categoria?: string
}) {
  const supabase = getServerClient()
  const { data, error } = await supabase
    .from('cliente_produtos')
    .update({ ...dados, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select()
    .single()
  if (error) throw error
  return data
}

export async function deletarProduto(id: string) {
  const supabase = getServerClient()
  const { error } = await supabase
    .from('cliente_produtos')
    .update({ ativo: false })
    .eq('id', id)
  if (error) throw error
}

export async function listarMessageIdsImportados(limite = 500): Promise<Set<string>> {
  const supabase = getServerClient()
  const { data } = await supabase
    .from('arquivos_nfe')
    .select('emails_importados(message_id)')
    .order('created_at', { ascending: false })
    .limit(limite)

  type EmailJoin = { message_id?: string } | { message_id?: string }[] | null | undefined
  const extrairMessageId = (join: EmailJoin): string | undefined => {
    if (Array.isArray(join)) return join[0]?.message_id
    return join?.message_id
  }

  return new Set(
    (data ?? [])
      .map((d: { emails_importados?: EmailJoin }) => extrairMessageId(d.emails_importados))
      .filter((messageId): messageId is string => Boolean(messageId))
  )
}

/**
 * Remove todas as movimentações e arquivos NF-e de um cliente específico.
 * Arquivos NF-e só são deletados se não houver outras movimentações vinculadas
 * (ex: NF-e compartilhada entre clientes).
 * Emails importados NÃO são deletados — pertencem ao histórico geral.
 */
export async function limparDadosCliente(
  clienteId: string
): Promise<{ movimentacoes: number; arquivos: number }> {
  const supabase = getServerClient()

  // 1. Coleta IDs dos arquivos vinculados às movimentações desse cliente
  const { data: movs } = await supabase
    .from('movimentacoes')
    .select('arquivo_nfe_id')
    .eq('cliente_id', clienteId)
    .not('arquivo_nfe_id', 'is', null)

  const arquivoIds = [
    ...new Set(
      (movs ?? [])
        .map((m: any) => m.arquivo_nfe_id as string)
        .filter(Boolean)
    ),
  ]

  // 2. Deleta todas as movimentações do cliente
  const { count: movCount, error: movErr } = await supabase
    .from('movimentacoes')
    .delete({ count: 'exact' })
    .eq('cliente_id', clienteId)

  if (movErr) throw new Error(`Erro ao deletar movimentações: ${movErr.message}`)

  // 3. Para cada arquivo, verifica se ainda há outras movimentações vinculadas;
  //    se não houver, deleta o registro do arquivo
  let arqCount = 0
  for (const arqId of arquivoIds) {
    const { count: restantes } = await supabase
      .from('movimentacoes')
      .select('id', { count: 'exact', head: true })
      .eq('arquivo_nfe_id', arqId)

    if ((restantes ?? 0) === 0) {
      const { error: arqErr } = await supabase
        .from('arquivos_nfe')
        .delete()
        .eq('id', arqId)
      if (!arqErr) arqCount++
    }
  }

  return { movimentacoes: movCount ?? 0, arquivos: arqCount }
}

export async function contarEmailsPorStatus() {
  const supabase = getServerClient()
  const { data, error } = await supabase
    .from('emails_importados')
    .select('status_processamento')

  if (error) throw error

  const contagem = { total: 0, processado: 0, pendente: 0, erro: 0 }
  for (const row of data ?? []) {
    contagem.total++
    const s = row.status_processamento as keyof typeof contagem
    if (s in contagem) contagem[s]++
  }
  return contagem
}

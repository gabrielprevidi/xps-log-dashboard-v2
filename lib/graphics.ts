/**
 * Avery Graphics — controle em CAIXAS por SKU (cobrança por palet).
 * Regra de palets em lib/graphics-saldo.ts.
 *
 * Só se aplica à AVERY DENNISON DO BRASIL (a Smartrac não tem Graphics).
 *
 * Identificação: uma nota é Graphics quando TODOS os itens têm código de SKU
 * do Graphics (AAA999-FG9). Verificado nas 613 notas da Avery Dennison: o
 * padrão separa limpo — matéria-prima usa AAS…/PRO…/etc. e nenhuma nota mistura
 * os dois. O texto "GRAPHICS" das informações adicionais não é confiável
 * (faltava em 3 notas de entrada e nunca aparece nas saídas).
 *
 * Unidades: entrada vem em EA (caixas) ou em M2; saída vem em M2. Uma caixa é
 * um rolo, então caixas = m² ÷ (largura × comprimento do rolo), com as
 * dimensões lidas da descrição ("W1270/L50", "1.37 X 50M") ou do cadastro do
 * SKU. Sem dimensão, a nota não é convertida e segue como Avery comum.
 */
import type { DadosNFe, ItemNFe } from './nfe-parser'
import { classificarOperacaoV2 } from './nfe-classificacao'

export const CNPJ_AVERY_DENNISON = '43999630000124'
export const UNIDADES_POR_PALET_PADRAO = 30

const CODIGO_GRAPHICS = /^[A-Z]{3}\d{3}-FG\d$/

export function ehClienteAveryDennison(cnpj: string | null | undefined): boolean {
  return String(cnpj ?? '').replace(/\D/g, '') === CNPJ_AVERY_DENNISON
}

export function ehCodigoGraphics(codigo: string | null | undefined): boolean {
  return CODIGO_GRAPHICS.test((codigo ?? '').trim())
}

/** True se a nota tem itens e todos são SKUs do Graphics. */
export function ehNotaGraphics(nfe: Pick<DadosNFe, 'itens'> | null | undefined): boolean {
  const itens = nfe?.itens ?? []
  return itens.length > 0 && itens.every(i => ehCodigoGraphics(i.codigo))
}

// ── dimensões do rolo ────────────────────────────────────────────────────
export interface Dims { larguraMm: number | null; comprimentoM: number | null }

/** Lê largura/comprimento da descrição do item (formatos de entrada e de saída). */
export function dimsDaDescricao(descricao: string | null | undefined): Dims {
  const s = descricao ?? ''
  // "…/W1270/L50/3IN PA" (entrada). Descrição de PDF vem truncada em 80 caracteres:
  // se o "L" termina colado no fim do texto, o comprimento pode estar cortado ("L5" de "L50").
  let m = s.match(/W(\d{3,4})\s*\/\s*L(\d{1,3})/i)
  if (m) {
    const truncado = s.length >= 78 && (m.index! + m[0].length) >= s.length
    return { larguraMm: +m[1], comprimentoM: truncado ? null : +m[2] }
  }
  // "1.37 X 50M" (saída; "50M" vem colado a "COD SPEC")
  m = s.match(/(\d)[.,](\d{2})\s*X\s*(\d{1,3})\s*M/i)
  if (m) return { larguraMm: +m[1] * 1000 + +m[2] * 10, comprimentoM: +m[3] }
  // "PERM -1.27COD SPEC": só a largura, o comprimento vem do cadastro do SKU
  m = s.match(/-\s*(\d)[.,](\d{2})(?!\d)/)
  if (m) return { larguraMm: +m[1] * 1000 + +m[2] * 10, comprimentoM: null }
  return { larguraMm: null, comprimentoM: null }
}

const r4 = (v: number) => Math.round(v * 1e4) / 1e4

export interface ConversaoItem { caixas?: number; dims: Dims; erro?: string }

/** Converte a quantidade de um item em caixas. O cadastro do SKU tem prioridade sobre a descrição. */
export function caixasDoItem(it: Pick<ItemNFe, 'unidade' | 'quantidade' | 'descricao' | 'codigo'>, dimsSku?: Dims | null): ConversaoItem {
  const desc = dimsDaDescricao(it.descricao)
  const dims: Dims = {
    larguraMm: dimsSku?.larguraMm ?? desc.larguraMm,
    comprimentoM: dimsSku?.comprimentoM ?? desc.comprimentoM,
  }
  const u = (it.unidade ?? '').trim().toUpperCase()
  if (u === 'EA') return { caixas: r4(it.quantidade), dims }
  if (u === 'M2') {
    if (!dims.larguraMm || !dims.comprimentoM) return { dims, erro: `${it.codigo}: dimensão do rolo desconhecida` }
    return { caixas: r4(it.quantidade / ((dims.larguraMm / 1000) * dims.comprimentoM)), dims }
  }
  return { dims, erro: `${it.codigo}: unidade ${u || '?'} não convertível em caixas` }
}

/**
 * Direção da nota para o Graphics. A natureza "ABSENT" (Avery → XPS) é
 * sempre entrada — todas as já gravadas assim —, mas o classificador
 * genérico a trataria como saída.
 */
export function tipoGraphics(natureza: string): { tipo: 'entrada' | 'saida' | null; motivo?: string } {
  if (natureza.trim().toUpperCase() === 'ABSENT') return { tipo: 'entrada' }
  return classificarOperacaoV2(natureza, 'avery')
}

/** Dimensões conhecidas por código de SKU (cadastro + notas já lidas). */
export type DimsPorSku = Map<string, Dims>

/** Acrescenta ao mapa as dimensões completas encontradas nas descrições dos itens. */
export function aprenderDims(mapa: DimsPorSku, itens: Array<Pick<ItemNFe, 'codigo' | 'descricao'>>): void {
  for (const it of itens) {
    if (!ehCodigoGraphics(it.codigo)) continue
    const d = dimsDaDescricao(it.descricao)
    const atual = mapa.get(it.codigo) ?? { larguraMm: null, comprimentoM: null }
    mapa.set(it.codigo, {
      larguraMm: atual.larguraMm ?? d.larguraMm,
      comprimentoM: atual.comprimentoM ?? d.comprimentoM,
    })
  }
}

/**
 * Grava (ou regrava) os itens de uma nota Graphics em graphics_movimentacoes,
 * criando os SKUs que faltam e completando as dimensões que ainda não têm.
 * Tudo ou nada: se algum item não puder ser convertido em caixas, nada é
 * gravado e `erro` explica — quem chama mantém a nota no fluxo comum.
 * Idempotente por arquivo_nfe_id.
 */
export async function gravarGraphics(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  p: {
    clienteId: string
    arquivoNfeId: string
    nfe: Pick<DadosNFe, 'itens' | 'numero_nfe'>
    tipo: 'entrada' | 'saida'
    data: string
    /** Palets declarados na NF-e (campo ESPÉCIE) — gravado só na 1ª linha da nota. */
    paletsDeclarados?: number | null
    /** Dimensões já aprendidas fora do banco (ex.: varredura de várias notas no backfill). */
    dimsExtras?: DimsPorSku
  },
): Promise<{ gravados: number; erro?: string }> {
  const codigos = [...new Set(p.nfe.itens.map(i => i.codigo.trim()))]
  const { data: existentes } = await supabase
    .from('graphics_sku').select('id, codigo, largura_mm, comprimento_m')
    .eq('cliente_id', p.clienteId).in('codigo', codigos)
  const porCodigo = new Map<string, { id: string; largura_mm: number | null; comprimento_m: number | null }>(
    (existentes ?? []).map((s: { codigo: string }) => [s.codigo, s as never]),
  )

  // converte tudo antes de gravar qualquer coisa
  const somaPorSku = new Map<string, { caixas: number; descricao: string; dims: Dims }>()
  for (const it of p.nfe.itens) {
    const codigo = it.codigo.trim()
    const ex = porCodigo.get(codigo)
    const extra = p.dimsExtras?.get(codigo)
    const dimsSku: Dims = {
      larguraMm: ex?.largura_mm ?? extra?.larguraMm ?? null,
      comprimentoM: ex?.comprimento_m != null ? Number(ex.comprimento_m) : (extra?.comprimentoM ?? null),
    }
    const c = caixasDoItem(it, dimsSku)
    if (c.erro || c.caixas == null) return { gravados: 0, erro: c.erro ?? 'item sem quantidade' }
    if (c.caixas <= 0) continue
    const atual = somaPorSku.get(codigo)
    if (atual) atual.caixas = r4(atual.caixas + c.caixas)
    else somaPorSku.set(codigo, { caixas: c.caixas, descricao: (it.descricao ?? '').trim(), dims: c.dims })
  }
  if (somaPorSku.size === 0) return { gravados: 0, erro: 'nenhum item com quantidade' }

  const skuIds = new Map<string, string>()
  for (const [codigo, v] of somaPorSku) {
    const ex = porCodigo.get(codigo)
    if (ex) {
      skuIds.set(codigo, ex.id)
      // completa dimensão que o cadastro ainda não tinha
      const upd: Record<string, number> = {}
      if (ex.largura_mm == null && v.dims.larguraMm) upd.largura_mm = v.dims.larguraMm
      if (ex.comprimento_m == null && v.dims.comprimentoM) upd.comprimento_m = v.dims.comprimentoM
      if (Object.keys(upd).length) await supabase.from('graphics_sku').update(upd).eq('id', ex.id)
      continue
    }
    const { data: novo, error } = await supabase
      .from('graphics_sku')
      .insert({
        cliente_id: p.clienteId, codigo, descricao: v.descricao,
        unidades_por_palet: UNIDADES_POR_PALET_PADRAO,
        largura_mm: v.dims.larguraMm, comprimento_m: v.dims.comprimentoM,
      })
      .select('id').single()
    if (error || !novo) return { gravados: 0, erro: `SKU ${codigo}: ${error?.message}` }
    skuIds.set(codigo, novo.id)
  }

  await supabase.from('graphics_movimentacoes').delete().eq('arquivo_nfe_id', p.arquivoNfeId)
  const linhas = [...somaPorSku].map(([codigo, v], i) => ({
    palets_declarados: i === 0 ? (p.paletsDeclarados ?? null) : null,
    sku_id: skuIds.get(codigo),
    arquivo_nfe_id: p.arquivoNfeId,
    numero_nfe: p.nfe.numero_nfe ?? null,
    tipo: p.tipo,
    data_mov: p.data,
    qtd_unidades: v.caixas,
  }))
  const { error } = await supabase.from('graphics_movimentacoes').insert(linhas)
  if (error) return { gravados: 0, erro: error.message }
  return { gravados: linhas.length }
}

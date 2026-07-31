/**
 * Pipeline de ingestão da V2 — decide ANTES de gravar.
 *
 * O problema da V1: `persistirEmail` insere `emails_importados` e `arquivos_nfe`
 * e só então tenta identificar o cliente. Quando não identifica, as linhas ficam
 * no banco sem servir para nada — hoje são 1.633 emails e 2.208 arquivos para
 * 1.572 movimentações.
 *
 * A solução aqui é uma pré-filtragem: cada anexo passa pelos mesmos testes que
 * a persistência faria (dedup → cliente → operação) ANTES de qualquer INSERT.
 * Só os aprovados são entregues a `persistirEmail`, que é reaproveitada
 * inteira — inclusive toda a lógica de cálculo por cliente (fedrigoni com
 * tabela progressiva, tecnia, avery por volume, padrão multi-produto), que
 * não vale a pena reescrever e arriscar divergir.
 *
 * Se nenhum anexo do email for aprovado, `persistirEmail` nem é chamada: zero
 * linhas escritas, exatamente o comportamento pedido.
 */
import {
  persistirEmail, identificarCliente,
  arquivoJaProcessado, nfeJaImportada, emailJaImportado,
} from './supabase-service'
import { getServerClient } from './supabase'
import { classificarOperacaoV2 } from './nfe-classificacao'
import type { EmailProcessado, AnexoXML } from './anexos'

export interface MotivoDescarte {
  arquivo: string
  motivo: string
  categoria: string
}

/** Decisão detalhada por anexo — usada pelo diagnóstico. */
export interface DecisaoAnexo {
  arquivo: string
  numero_nfe: string | null
  natureza: string | null
  emitente: string | null
  cliente: string | null
  modo: string | null
  tipo: 'entrada' | 'saida' | null
  peso_ton: number | null
  volumes: number | null
  pallets: number | null
  decisao: 'GRAVA' | 'DESCARTA'
  motivo?: string
  categoria?: string
}

export interface OpcoesPrefiltro {
  /**
   * Ignora a deduplicação. Só para diagnóstico: enquanto a V1 estiver ativa,
   * ela processa as mesmas notas primeiro e a V2 as descarta como duplicadas —
   * o que impede validar a classificação dos clientes cujo caminho a V1 vence.
   * NUNCA usar na rotina real: geraria movimentação duplicada.
   */
  ignorarDedup?: boolean
}

export interface ResultadoEmail {
  aceito: boolean
  anexos_aceitos: number
  movimentacoes_salvas: number
  duplicados: number
  descartes: MotivoDescarte[]
  erros: string[]
}

/** Cache dos clientes por execução — evita reconsultar a cada anexo. */
type Cliente = { id: string; nome: string; nome_fantasia: string | null; modo_calculo: string | null }
let cacheClientes: Map<string, Cliente> | null = null

async function clientesPorId(): Promise<Map<string, Cliente>> {
  if (cacheClientes) return cacheClientes
  const supabase = getServerClient()
  const { data } = await supabase
    .from('clientes')
    .select('id, nome, nome_fantasia, modo_calculo')
  cacheClientes = new Map((data ?? []).map((c: Cliente) => [c.id, c]))
  return cacheClientes
}

export function limparCacheClientes() { cacheClientes = null }

/**
 * Decide, sem gravar nada, quais anexos do email devem ser persistidos.
 */
export async function prefiltrar(
  email: EmailProcessado,
  opcoes: OpcoesPrefiltro = {},
): Promise<{ aceitos: AnexoXML[]; descartes: MotivoDescarte[]; duplicados: number; decisoes: DecisaoAnexo[] }> {
  const aceitos: AnexoXML[] = []
  const descartes: MotivoDescarte[] = []
  const decisoes: DecisaoAnexo[] = []
  let duplicados = 0
  const clientes = await clientesPorId()

  for (const anexo of email.anexos_xml) {
    const nfe = anexo.dados_nfe
    const base = {
      arquivo: anexo.nome_arquivo,
      numero_nfe: nfe?.numero_nfe ?? null,
      natureza: nfe?.natureza_operacao ?? null,
      emitente: nfe?.nome_emitente ?? null,
      peso_ton: nfe?.peso_liquido_total ? +(nfe.peso_liquido_total / 1000).toFixed(4) : null,
      volumes: nfe?.quantidade_especie ?? null,
      pallets: anexo.pallets_calculados,
    }
    const registrar = (d: Partial<DecisaoAnexo> & Pick<DecisaoAnexo, 'decisao'>) =>
      decisoes.push({ ...base, cliente: null, modo: null, tipo: null, ...d })

    // 1. Deduplicação — mesma checagem que a persistência faria
    if (!opcoes.ignorarDedup && await arquivoJaProcessado(anexo.hash)) {
      duplicados++
      descartes.push({ arquivo: anexo.nome_arquivo, motivo: 'arquivo já processado', categoria: 'duplicado' })
      registrar({ decisao: 'DESCARTA', motivo: 'arquivo já processado', categoria: 'duplicado' })
      continue
    }
    if (!opcoes.ignorarDedup && nfe?.chave_nfe && await nfeJaImportada(nfe.chave_nfe)) {
      duplicados++
      descartes.push({ arquivo: anexo.nome_arquivo, motivo: `NF-e ${nfe.numero_nfe ?? ''} já importada`, categoria: 'duplicado' })
      registrar({ decisao: 'DESCARTA', motivo: 'NF-e já importada', categoria: 'duplicado' })
      continue
    }

    // 2. Cliente cadastrado
    const clienteId = await identificarCliente(
      nfe?.cnpj_emitente ?? '',
      nfe?.cnpj_destinatario ?? '',
      email.remetente,
      email.remetente_nome,
      nfe?.nome_emitente ?? '',
      email.assunto,
      email.cnpjs_corpo ?? [],
    )
    if (!clienteId) {
      descartes.push({ arquivo: anexo.nome_arquivo, motivo: 'cliente não identificado', categoria: 'sem_cliente' })
      registrar({ decisao: 'DESCARTA', motivo: 'cliente não identificado', categoria: 'sem_cliente' })
      continue
    }

    const cliente = clientes.get(clienteId)
    const modo = cliente?.modo_calculo ?? 'padrao'
    const nomeCliente = (cliente?.nome_fantasia || cliente?.nome) ?? null

    // 3. Fedrigoni só conta PDF — o XML nem chega a ser inserido, então não
    //    "reserva" a chave de acesso (bug que a V1 contorna deletando depois).
    if (modo === 'fedrigoni' && anexo.nome_arquivo.toLowerCase().endsWith('.xml')) {
      descartes.push({ arquivo: anexo.nome_arquivo, motivo: 'Fedrigoni usa apenas PDF', categoria: 'fedrigoni_xml' })
      registrar({ decisao: 'DESCARTA', cliente: nomeCliente, modo, motivo: 'Fedrigoni usa apenas PDF', categoria: 'fedrigoni_xml' })
      continue
    }

    // 4. Operação precisa ser entrada ou saída
    const { tipo, motivo } = classificarOperacaoV2(
      nfe?.natureza_operacao ?? '', modo, nfe?.codigo_operacao_danfe,
    )
    if (!tipo) {
      descartes.push({ arquivo: anexo.nome_arquivo, motivo: motivo ?? 'operação não contabilizada', categoria: 'operacao_informativa' })
      registrar({ decisao: 'DESCARTA', cliente: nomeCliente, modo, motivo: motivo ?? 'operação não contabilizada', categoria: 'operacao_informativa' })
      continue
    }

    registrar({ decisao: 'GRAVA', cliente: nomeCliente, modo, tipo })
    aceitos.push(anexo)
  }

  return { aceitos, descartes, duplicados, decisoes }
}

/**
 * Marca como 'v2' tudo que acabou de ser gravado para este email.
 * Feito depois da persistência para não precisar alterar `persistirEmail`,
 * que é compartilhada com o caminho da V1.
 */
async function marcarOrigemV2(emailId: string): Promise<void> {
  const supabase = getServerClient()
  await supabase.from('emails_importados').update({ origem: 'v2' }).eq('id', emailId)

  const { data: arquivos } = await supabase
    .from('arquivos_nfe').select('id').eq('email_id', emailId)
  const ids = (arquivos ?? []).map((a: { id: string }) => a.id)
  if (ids.length === 0) return

  await supabase.from('arquivos_nfe').update({ origem: 'v2' }).in('id', ids)
  await supabase.from('movimentacoes').update({ origem: 'v2' }).in('arquivo_nfe_id', ids)
}

export async function processarEmailV2(email: EmailProcessado): Promise<ResultadoEmail> {
  const vazio: ResultadoEmail = {
    aceito: false, anexos_aceitos: 0, movimentacoes_salvas: 0,
    duplicados: 0, descartes: [], erros: [],
  }

  if (await emailJaImportado(email.message_id)) {
    return { ...vazio, duplicados: 1, descartes: [{ arquivo: '(email)', motivo: 'email já importado', categoria: 'duplicado' }] }
  }

  const { aceitos, descartes, duplicados } = await prefiltrar(email)

  // Nada aprovado → nenhuma linha é escrita. Este é o ponto central da V2.
  if (aceitos.length === 0) {
    return { ...vazio, duplicados, descartes }
  }

  const resultado = await persistirEmail({ ...email, anexos_xml: aceitos })

  if (resultado.email_id) {
    try {
      await marcarOrigemV2(resultado.email_id)
    } catch (err) {
      // Não é fatal: os dados estão corretos, só ficam rotulados como 'v1'.
      // Registrado para poder corrigir depois.
      resultado.erros.push(`Falha ao marcar origem v2 do email ${resultado.email_id}: ${String(err)}`)
    }
  }

  return {
    aceito: true,
    anexos_aceitos: aceitos.length,
    movimentacoes_salvas: resultado.movimentacoes_salvas,
    duplicados: duplicados + resultado.duplicados,
    descartes,
    erros: resultado.erros,
  }
}

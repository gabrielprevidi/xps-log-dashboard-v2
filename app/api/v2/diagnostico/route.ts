/**
 * Diagnóstico da V2 — MODO SIMULAÇÃO, NÃO GRAVA NADA.
 *
 * Lê os emails de verdade pelo IMAP, roda o pipeline de decisão completo
 * (reconhecer anexo → identificar cliente → classificar operação) e devolve o
 * que *faria*. Nenhum INSERT, nenhuma alteração na caixa de email.
 *
 * Serve para:
 *   • validar a conexão IMAP a partir da Vercel (bloqueio de IP de datacenter)
 *   • conferir a identificação de cliente antes de gravar qualquer coisa
 *   • levantar quais naturezas de operação realmente aparecem, para decidir
 *     a lista de "informativas" do modo padrão
 *
 * Uso:
 *   curl -X POST https://<host>/api/v2/diagnostico \
 *        -H "Authorization: Bearer $CRON_SECRET" \
 *        -H "Content-Type: application/json" \
 *        -d '{"limite": 40}'
 */
import { NextRequest, NextResponse } from 'next/server'
import { lerEmailsNFeImap } from '@/lib/imap-service'
import { identificarCliente } from '@/lib/supabase-service'
import { getServerClient } from '@/lib/supabase'
import { tipoOperacaoPorNatureza, classificarOperacaoFedrigoni } from '@/lib/nfe-classificacao'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

function autorizado(request: NextRequest): boolean {
  const esperado = process.env.CRON_SECRET
  if (!esperado) return false
  const header = request.headers.get('authorization') ?? ''
  return header === `Bearer ${esperado}`
}

export async function POST(request: NextRequest) {
  if (!autorizado(request)) {
    return NextResponse.json({ error: 'Não autorizado' }, { status: 401 })
  }

  const body = await request.json().catch(() => ({}))
  const limite: number = body.limite ?? 30
  const t0 = Date.now()

  try {
    const supabase = getServerClient()

    // Marcas d'água atuais (uma linha por pasta; 'imap' é a linha semente)
    const { data: estados } = await supabase
      .from('sync_estado')
      .select('id, pasta, ultimo_uid, uid_validity, data_corte')

    const marcas: Record<string, { ultimo_uid: number; uid_validity: number }> = {}
    let dataCorte = '2026-07-30'
    for (const e of estados ?? []) {
      if (e.data_corte) dataCorte = e.data_corte
      if (e.id !== 'imap') {
        marcas[e.id] = { ultimo_uid: e.ultimo_uid ?? 0, uid_validity: e.uid_validity ?? 0 }
      }
    }
    // Permite alargar o período só para levantamento (não altera nada no banco).
    if (typeof body.data_corte === 'string') dataCorte = body.data_corte
    // Ignora as marcas d'água quando se quer varrer um período inteiro de novo.
    const marcasUsadas = body.ignorar_marcas ? {} : marcas

    const leitura = await lerEmailsNFeImap({ dryRun: true, limite, marcas: marcasUsadas, dataCorte })

    // Cadastro de clientes, para resolver nome e modo de cálculo
    const { data: clientes } = await supabase
      .from('clientes')
      .select('id, nome, nome_fantasia, modo_calculo')
    const porId = new Map((clientes ?? []).map(c => [c.id, c]))

    const decisoes: object[] = []
    const naturezas: Record<string, { vezes: number; clientes: string[]; classificacao: string }> = {}
    let gravaria = 0
    let descartaria = 0

    for (const email of leitura.emails) {
      for (const anexo of email.anexos_xml) {
        const nfe = anexo.dados_nfe

        const clienteId = await identificarCliente(
          nfe?.cnpj_emitente ?? '',
          nfe?.cnpj_destinatario ?? '',
          email.remetente,
          email.remetente_nome,
          nfe?.nome_emitente ?? '',
          email.assunto,
          email.cnpjs_corpo ?? [],
        )

        const cliente = clienteId ? porId.get(clienteId) : null
        const modo = (cliente?.modo_calculo as string) ?? 'padrao'
        const natureza = nfe?.natureza_operacao ?? ''

        // Classificação conforme o modo do cliente
        let tipo: 'entrada' | 'saida' | null = null
        if (modo === 'fedrigoni') {
          tipo = classificarOperacaoFedrigoni(natureza, nfe?.codigo_operacao_danfe)
        } else {
          // Modo padrão hoje NUNCA devolve null — tudo que não é entrada vira
          // saída. É exatamente a lacuna que este diagnóstico ajuda a fechar.
          tipo = tipoOperacaoPorNatureza(natureza)
        }

        let decisao = 'GRAVARIA'
        let motivo = ''
        if (!clienteId) {
          decisao = 'DESCARTARIA'; motivo = 'cliente não identificado'
        } else if (!tipo) {
          decisao = 'DESCARTARIA'; motivo = `operação informativa (${natureza || 'sem natureza'})`
        } else if (modo === 'fedrigoni' && !anexo.nome_arquivo.toLowerCase().endsWith('.pdf')) {
          decisao = 'DESCARTARIA'; motivo = 'Fedrigoni usa apenas PDF'
        }
        decisao === 'GRAVARIA' ? gravaria++ : descartaria++

        // Levantamento de naturezas — a saída mais útil deste diagnóstico
        if (natureza) {
          const chave = `${modo} :: ${natureza}`
          naturezas[chave] ??= { vezes: 0, clientes: [], classificacao: tipo ?? 'NÃO CONTABILIZA' }
          naturezas[chave].vezes++
          const nomeCliente = (cliente?.nome_fantasia || cliente?.nome || '?') as string
          if (!naturezas[chave].clientes.includes(nomeCliente)) {
            naturezas[chave].clientes.push(nomeCliente)
          }
        }

        decisoes.push({
          pasta: email.pasta,
          uid: email.uid,
          data: email.data_recebimento?.slice(0, 10),
          remetente: email.remetente,
          arquivo: anexo.nome_arquivo,
          numero_nfe: nfe?.numero_nfe ?? null,
          chave_nfe: nfe?.chave_nfe ? nfe.chave_nfe.slice(-8) : null,
          emitente: nfe?.nome_emitente ?? null,
          natureza_operacao: natureza || null,
          peso_ton: nfe?.peso_liquido_total ? +(nfe.peso_liquido_total / 1000).toFixed(4) : null,
          volumes: nfe?.quantidade_especie ?? null,
          pallets: anexo.pallets_calculados,
          cliente: cliente ? (cliente.nome_fantasia || cliente.nome) : null,
          modo_calculo: cliente ? modo : null,
          tipo_operacao: tipo,
          decisao,
          motivo: motivo || undefined,
        })
      }
    }

    return NextResponse.json({
      modo: 'SIMULAÇÃO — nada foi gravado no banco nem alterado na caixa',
      duracao_ms: Date.now() - t0,
      data_corte: dataCorte,
      pastas_varridas: leitura.pastas_varridas,
      mensagens_examinadas: leitura.mensagens_examinadas,
      emails_com_nfe: leitura.emails.length,
      anexos_analisados: gravaria + descartaria,
      gravaria,
      descartaria,
      naturezas_encontradas: naturezas,
      decisoes,
      emails_sem_nfe: leitura.ignorados,
    })
  } catch (error: unknown) {
    const err = error as Error
    console.error('Diagnóstico V2 falhou:', err)
    return NextResponse.json(
      { error: 'Falha no diagnóstico', detalhe: err?.message ?? String(error), duracao_ms: Date.now() - t0 },
      { status: 500 },
    )
  }
}

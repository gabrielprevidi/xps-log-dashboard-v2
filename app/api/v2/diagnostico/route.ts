/**
 * Diagnóstico da V2 — MODO SIMULAÇÃO, NÃO GRAVA NADA.
 *
 * Usa exatamente o mesmo `prefiltrar()` da rotina real, para não haver
 * divergência entre o que o diagnóstico mostra e o que a rotina faz. (A primeira
 * versão duplicava a lógica de decisão e ficou desatualizada em dois dias.)
 *
 * Uso:
 *   curl -X POST .../api/v2/diagnostico \
 *        -H "Authorization: Bearer $CRON_SECRET" -H 'Content-Type: application/json' \
 *        -d '{"limite":25,"data_corte":"2026-07-20","ignorar_marcas":true,"ignorar_dedup":true}'
 *
 * `ignorar_dedup` existe para um problema específico: enquanto a V1 estiver
 * ativa, ela processa as mesmas notas primeiro e a V2 as descarta como
 * duplicadas. Sem ignorar a deduplicação, não há como validar a classificação
 * dos clientes cujo caminho a V1 vence — hoje Tecnia, Servir e Alphalum.
 */
import { NextRequest, NextResponse } from 'next/server'
import { lerEmailsNFeImap } from '@/lib/imap-service'
import { prefiltrar, limparCacheClientes, type DecisaoAnexo } from '@/lib/ingestao-v2'
import { getServerClient } from '@/lib/supabase'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

function autorizado(request: NextRequest): boolean {
  const esperado = process.env.CRON_SECRET
  if (!esperado) return false
  return (request.headers.get('authorization') ?? '') === `Bearer ${esperado}`
}

export async function POST(request: NextRequest) {
  if (!autorizado(request)) {
    return NextResponse.json({ error: 'Não autorizado' }, { status: 401 })
  }

  const body = await request.json().catch(() => ({}))
  const limite: number = body.limite ?? 25
  const orcamentoMs: number = body.orcamento_ms ?? 40_000
  const ignorarDedup: boolean = body.ignorar_dedup === true
  const filtroCliente: string | null = body.cliente ?? null
  const t0 = Date.now()

  try {
    limparCacheClientes()
    const supabase = getServerClient()

    const { data: estados } = await supabase
      .from('sync_estado').select('id, ultimo_uid, uid_validity, data_corte')

    const marcas: Record<string, { ultimo_uid: number; uid_validity: number }> = {}
    let dataCorte = '2026-07-30'
    for (const e of estados ?? []) {
      if (e.data_corte) dataCorte = e.data_corte
      if (e.id !== 'imap') marcas[e.id] = { ultimo_uid: e.ultimo_uid ?? 0, uid_validity: e.uid_validity ?? 0 }
    }
    if (typeof body.data_corte === 'string') dataCorte = body.data_corte
    const marcasUsadas = body.ignorar_marcas ? {} : marcas

    const leitura = await lerEmailsNFeImap({
      dryRun: true, limite, marcas: marcasUsadas, dataCorte, orcamentoMs,
    })

    const decisoes: Array<DecisaoAnexo & { pasta?: string; uid?: number; data?: string }> = []
    const porCliente: Record<string, { grava: number; descarta: number; motivos: Record<string, number> }> = {}

    for (const email of leitura.emails) {
      const r = await prefiltrar(email, { ignorarDedup })
      for (const d of r.decisoes) {
        if (filtroCliente && !(d.cliente ?? '').toLowerCase().includes(filtroCliente.toLowerCase())) continue
        decisoes.push({ ...d, pasta: email.pasta, uid: email.uid, data: email.data_recebimento?.slice(0, 10) })

        const chave = d.cliente ?? '(sem cliente)'
        porCliente[chave] ??= { grava: 0, descarta: 0, motivos: {} }
        if (d.decisao === 'GRAVA') porCliente[chave].grava++
        else {
          porCliente[chave].descarta++
          const cat = d.categoria ?? 'outro'
          porCliente[chave].motivos[cat] = (porCliente[chave].motivos[cat] ?? 0) + 1
        }
      }
    }

    return NextResponse.json({
      modo: 'SIMULAÇÃO — nada gravado, nada alterado na caixa',
      dedup: ignorarDedup ? 'IGNORADA (só diagnóstico)' : 'aplicada',
      duracao_ms: Date.now() - t0,
      data_corte: dataCorte,
      pastas_varridas: leitura.pastas_varridas,
      mensagens_examinadas: leitura.mensagens_examinadas,
      interrompida_por_tempo: leitura.interrompida_por_tempo,
      resumo_por_cliente: porCliente,
      decisoes,
    })
  } catch (error: unknown) {
    const err = error as Error
    console.error('Diagnóstico V2 falhou:', err)
    return NextResponse.json(
      { error: 'Falha no diagnóstico', detalhe: err?.message ?? String(error) },
      { status: 500 },
    )
  }
}

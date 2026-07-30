/**
 * Rotina automática da V2 — chamada a cada 15 minutos pelo agendador externo.
 *
 *   curl -X POST https://xps-log-dashboard-v2.vercel.app/api/cron/sync \
 *        -H "Authorization: Bearer $CRON_SECRET"
 *
 * Sequência de cada rodada:
 *   1. trava (uma execução por vez)
 *   2. lê as marcas d'água por pasta
 *   3. varre o IMAP em readOnly, no máximo SYNC_LOTE_MAX mensagens
 *   4. pré-filtra e grava só o que tem cliente cadastrado E é entrada/saída
 *   5. arquiva os processados (auditoria, 30 dias)
 *   6. avança as marcas d'água
 *   7. limpa a pasta de auditoria
 *   8. fecha a execução em sync_execucoes
 *
 * `{"dry_run": true}` executa 1 a 4 sem gravar nada — usar antes da primeira
 * rodada real.
 */
import { NextRequest, NextResponse } from 'next/server'
import {
  lerEmailsNFeImap, arquivarProcessados, limparProcessadosAntigos,
} from '@/lib/imap-service'
import { processarEmailV2, limparCacheClientes } from '@/lib/ingestao-v2'
import { getServerClient } from '@/lib/supabase'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/** Rodada considerada travada depois disto — a próxima assume. */
const LOCK_TIMEOUT_MIN = 20

function autorizado(request: NextRequest): boolean {
  const esperado = process.env.CRON_SECRET
  if (!esperado) return false
  const h = request.headers.get('authorization') ?? ''
  return h === `Bearer ${esperado}`
}

export async function POST(request: NextRequest) {
  if (!autorizado(request)) {
    return NextResponse.json({ error: 'Não autorizado' }, { status: 401 })
  }

  const body = await request.json().catch(() => ({}))
  const dryRun: boolean = body.dry_run === true
  const limite: number = body.limite ?? Number(process.env.SYNC_LOTE_MAX || 20)
  const t0 = Date.now()
  const supabase = getServerClient()
  limparCacheClientes()

  // ── 1. Trava ──────────────────────────────────────────────────────────
  // Libera rodadas presas antes de tentar a própria (índice único em
  // status='rodando' garante que só uma exista).
  const limiteTravada = new Date(Date.now() - LOCK_TIMEOUT_MIN * 60_000).toISOString()
  await supabase.from('sync_execucoes')
    .update({ status: 'erro', erro: `Rodada sem desfecho por mais de ${LOCK_TIMEOUT_MIN} min`, finalizado_em: new Date().toISOString() })
    .eq('status', 'rodando').lt('iniciado_em', limiteTravada)

  let execucaoId: string | null = null
  if (!dryRun) {
    const { data, error } = await supabase.from('sync_execucoes')
      .insert({ status: 'rodando', gatilho: body.gatilho ?? 'cron' })
      .select('id').single()
    if (error || !data) {
      return NextResponse.json(
        { pulado: true, motivo: 'Já existe uma rodada em andamento', detalhe: error?.message },
        { status: 409 },
      )
    }
    execucaoId = data.id
  }

  const motivos: Record<string, number> = {}
  let emailsAceitos = 0, emailsDescartados = 0, nfesSalvas = 0, duplicados = 0
  const erros: string[] = []
  const avisos: string[] = []
  const detalhes: object[] = []

  try {
    // ── 2. Marcas d'água ────────────────────────────────────────────────
    const { data: estadosBanco } = await supabase
      .from('sync_estado').select('id, ultimo_uid, uid_validity, data_corte')

    const marcas: Record<string, { ultimo_uid: number; uid_validity: number }> = {}
    let dataCorte = '2026-07-30'
    for (const e of estadosBanco ?? []) {
      if (e.data_corte) dataCorte = e.data_corte
      if (e.id !== 'imap') marcas[e.id] = { ultimo_uid: e.ultimo_uid ?? 0, uid_validity: e.uid_validity ?? 0 }
    }

    // ── 3. Leitura (readOnly — a caixa não é alterada) ──────────────────
    // Orçamento de tempo: o agendador gratuito corta em 30s e a Vercel em 60s.
    // 18s de varredura deixam folga para gravar, arquivar e fechar a execução.
    const orcamentoTotal = Number(body.orcamento_ms ?? process.env.SYNC_ORCAMENTO_MS ?? 22_000)
    // A varredura fica com metade; a outra metade é para gravar.
    const tScan = Date.now()
    const leitura = await lerEmailsNFeImap({
      dryRun, limite, marcas, dataCorte, orcamentoMs: Math.round(orcamentoTotal * 0.45),
    })
    const msVarredura = Date.now() - tScan
    const temposEmail: Array<{ uid?: number; anexos: number; ms: number }> = []

    // ── 4. Decisão e gravação ───────────────────────────────────────────
    // Emails ainda não gravados quando o tempo acaba: a marca d'água da pasta
    // não pode passar deles, senão seriam pulados para sempre.
    const pendentes = new Map<string, number>()   // pasta → menor uid não gravado
    const marcarPendente = (pasta?: string, uid?: number) => {
      if (!pasta || !uid) return
      const atual = pendentes.get(pasta)
      if (atual === undefined || uid < atual) pendentes.set(pasta, uid)
    }

    const arquivar: Array<{ pasta: string; uid: number }> = []
    let interrompidaNaGravacao = false

    // Ordem crescente de UID dentro de cada pasta — a marca d'água depende disso.
    const fila = [...leitura.emails].sort((a, b) =>
      (a.pasta ?? '').localeCompare(b.pasta ?? '') || (a.uid ?? 0) - (b.uid ?? 0))

    for (const email of fila) {
      // Esgotou o tempo: o que sobrou entra na próxima rodada.
      if (!dryRun && Date.now() - t0 > orcamentoTotal) {
        interrompidaNaGravacao = true
        marcarPendente(email.pasta, email.uid)
        continue
      }
      if (dryRun) {
        const { prefiltrar } = await import('@/lib/ingestao-v2')
        const { aceitos, descartes } = await prefiltrar(email)
        aceitos.length > 0 ? emailsAceitos++ : emailsDescartados++
        for (const d of descartes) motivos[d.categoria] = (motivos[d.categoria] ?? 0) + 1
        detalhes.push({ pasta: email.pasta, uid: email.uid, assunto: email.assunto.slice(0, 60), aceitos: aceitos.length, descartes: descartes.map(d => d.motivo) })
        continue
      }

      const tEmail = Date.now()
      const r = await processarEmailV2(email)
      temposEmail.push({ uid: email.uid, anexos: email.anexos_xml.length, ms: Date.now() - tEmail })
      if (r.aceito) {
        emailsAceitos++
        nfesSalvas += r.movimentacoes_salvas
        if (email.pasta && email.uid) arquivar.push({ pasta: email.pasta, uid: email.uid })
      } else {
        emailsDescartados++
      }
      duplicados += r.duplicados
      erros.push(...r.erros)
      for (const d of r.descartes) motivos[d.categoria] = (motivos[d.categoria] ?? 0) + 1
    }

    // Emails cujos anexos nem foram reconhecidos como NF-e
    for (const ig of leitura.ignorados) {
      emailsDescartados++
      motivos['anexo_nao_nfe'] = (motivos['anexo_nao_nfe'] ?? 0) + 1
    }

    if (dryRun) {
      return NextResponse.json({
        modo: 'SIMULAÇÃO — nada gravado, nada alterado na caixa',
        duracao_ms: Date.now() - t0,
        pastas_varridas: leitura.pastas_varridas,
        mensagens_examinadas: leitura.mensagens_examinadas,
        interrompida_por_tempo: leitura.interrompida_por_tempo,
        emails_aceitos: emailsAceitos,
        emails_descartados: emailsDescartados,
        motivos_descarte: motivos,
        detalhes,
      })
    }

    // ── 5. Auditoria (não crítica) ──────────────────────────────────────
    if (arquivar.length > 0) {
      const arq = await arquivarProcessados(arquivar)
      avisos.push(...arq.avisos)
    }

    // ── 6. Marcas d'água — só depois de gravar, e nunca além do primeiro
    //       email que ficou sem gravar ─────────────────────────────────
    for (const est of leitura.estados) {
      const primeiroPendente = pendentes.get(est.pasta)
      const ultimoSeguro = primeiroPendente !== undefined
        ? Math.min(est.ultimo_uid, primeiroPendente - 1)
        : est.ultimo_uid
      // ultimo_uid = 0 é válido: pasta que nunca teve mensagem. Descartar esse
      // valor fazia a pasta ser reaberta a cada rodada, para sempre.
      if (ultimoSeguro < 0) continue

      const { error } = await supabase.from('sync_estado').upsert({
        id: est.pasta,
        pasta: est.pasta,
        uid_validity: est.uid_validity,
        ultimo_uid: ultimoSeguro,
        data_corte: dataCorte,
        atualizado_em: new Date().toISOString(),
      }, { onConflict: 'id' })
      if (error) erros.push(`Marca d'água de "${est.pasta}": ${error.message}`)
    }

    // ── 7. Retenção — UMA VEZ POR DIA ───────────────────────────────────
    // O agendador gratuito corta a conexão em 30s, então cada rodada precisa
    // ser curta. A limpeza abre uma conexão IMAP própria e não tem urgência
    // nenhuma: roda na primeira execução depois das 6h (UTC).
    const agora = new Date()
    const janelaDeLimpeza = agora.getUTCHours() === 6 && agora.getUTCMinutes() < 15
    const limpeza = janelaDeLimpeza || body.limpar === true
      ? await limparProcessadosAntigos()
      : { apagados: 0, aviso: undefined as string | undefined }
    if (limpeza.aviso) avisos.push(limpeza.aviso)

    if (janelaDeLimpeza) {
      // Histórico de execuções: 90 dias
      await supabase.from('sync_execucoes').delete()
        .lt('iniciado_em', new Date(Date.now() - 90 * 864e5).toISOString())
    }

    // ── 8. Fecha ────────────────────────────────────────────────────────
    const duracao = Date.now() - t0
    await supabase.from('sync_execucoes').update({
      status: 'ok',
      finalizado_em: new Date().toISOString(),
      emails_lidos: leitura.mensagens_examinadas,
      emails_aceitos: emailsAceitos,
      emails_descartados: emailsDescartados,
      nfes_salvas: nfesSalvas,
      duplicados,
      motivos_descarte: motivos,
      duracao_ms: duracao,
      erro: erros.length ? erros.slice(0, 20).join(' | ') : null,
    }).eq('id', execucaoId)

    return NextResponse.json({
      ok: true,
      duracao_ms: duracao,
      pastas_varridas: leitura.pastas_varridas,
      mensagens_examinadas: leitura.mensagens_examinadas,
      emails_aceitos: emailsAceitos,
      emails_descartados: emailsDescartados,
      nfes_salvas: nfesSalvas,
      duplicados,
      motivos_descarte: motivos,
      interrompida_por_tempo: leitura.interrompida_por_tempo || interrompidaNaGravacao,
      ms_varredura: msVarredura,
      ms_gravacao_por_email: temposEmail.sort((a, b) => b.ms - a.ms).slice(0, 6),
      arquivados: arquivar.length,
      apagados_da_auditoria: limpeza.apagados,
      avisos,
      erros,
    })
  } catch (error: unknown) {
    const err = error as Error
    console.error('Rotina V2 falhou:', err)
    if (execucaoId) {
      await supabase.from('sync_execucoes').update({
        status: 'erro',
        finalizado_em: new Date().toISOString(),
        erro: err?.message ?? String(error),
        duracao_ms: Date.now() - t0,
      }).eq('id', execucaoId)
    }
    return NextResponse.json(
      { error: 'Falha na sincronização', detalhe: err?.message ?? String(error) },
      { status: 500 },
    )
  }
}

/** Situação da última rodada — usado pelo dashboard para se atualizar. */
export async function GET() {
  const supabase = getServerClient()
  const { data } = await supabase
    .from('sync_execucoes')
    .select('iniciado_em, finalizado_em, status, emails_lidos, emails_aceitos, emails_descartados, nfes_salvas, duracao_ms')
    .order('iniciado_em', { ascending: false })
    .limit(10)
  return NextResponse.json({ execucoes: data ?? [] })
}

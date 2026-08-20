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
import { arquivoJaProcessado, limparCacheIdentificacao } from '@/lib/supabase-service'
import { getServerClient } from '@/lib/supabase'
import { getSessaoAdmin } from '@/lib/admin-auth'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/** Rodada considerada travada depois disto — a próxima assume. */
const LOCK_TIMEOUT_MIN = 20

/**
 * Rodadas seguidas sem avançar a marca d'água, havendo fila, que caracterizam
 * sincronização travada. Três = 45 minutos parados — cedo o bastante para agir,
 * tarde o bastante para não alarmar por uma mensagem pesada isolada.
 */
const RODADAS_PARA_ALERTA = 3

/**
 * Fila acima disto vira notificação: há notas esperando que a rodada de 15 em
 * 15 minutos não vai alcançar tão cedo. Diferente do alerta de travamento —
 * aqui a rotina funciona, só não dá conta do volume (ou vinha de um timeout,
 * que mata a rodada sem processar nada).
 */
const FILA_PARA_ALERTA = Number(process.env.FILA_PARA_ALERTA || 40)

function autorizado(request: NextRequest): boolean {
  const esperado = process.env.CRON_SECRET
  if (!esperado) return false
  const h = request.headers.get('authorization') ?? ''
  return h === `Bearer ${esperado}`
}

export async function POST(request: NextRequest) {
  // Token do agendador OU sessão de admin — a segunda é o que permite o botão
  // "Sincronizar agora" no dashboard, para quando uma rodada falha e não se
  // quer esperar os 15 minutos seguintes.
  const viaToken = autorizado(request)
  if (!viaToken && !(await getSessaoAdmin())) {
    return NextResponse.json({ error: 'Não autorizado' }, { status: 401 })
  }

  const body = await request.json().catch(() => ({}))
  const dryRun: boolean = body.dry_run === true
  const limite: number = body.limite ?? Number(process.env.SYNC_LOTE_MAX || 20)
  const t0 = Date.now()
  const supabase = getServerClient()
  limparCacheClientes()
  limparCacheIdentificacao()

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
      .insert({ status: 'rodando', gatilho: body.gatilho ?? (viaToken ? 'cron' : 'manual') })
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
      dryRun, limite, marcas, dataCorte,
      orcamentoMs: Math.round(orcamentoTotal * 0.45),
      // Permite retomar email-lote sem reparsear o que já foi gravado.
      jaProcessado: arquivoJaProcessado,
    })
    const msVarredura = Date.now() - tScan

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
    // Garantia de progresso, igual à da varredura: a rodada só pode adiar um
    // email por falta de tempo se JÁ tiver processado outro. Sem isto, uma
    // varredura que estoura o orçamento sozinha (um email com 24 anexos leva
    // ~50s) faz a gravação adiar TODOS, a marca d'água não avança, e a rodada
    // seguinte repete tudo — travou 825 mensagens por dois dias em 04/08/2026.
    let processadasNestaRodada = 0

    // Ordem crescente de UID dentro de cada pasta — a marca d'água depende disso.
    const fila = [...leitura.emails].sort((a, b) =>
      (a.pasta ?? '').localeCompare(b.pasta ?? '') || (a.uid ?? 0) - (b.uid ?? 0))

    for (const email of fila) {
      // Esgotou o tempo: o que sobrou entra na próxima rodada — desde que algo
      // já tenha sido processado, senão a fila trava (ver acima).
      if (!dryRun && processadasNestaRodada > 0 && Date.now() - t0 > orcamentoTotal) {
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

      const r = await processarEmailV2(email)
      processadasNestaRodada++
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
      // Agrupar tudo como "anexo_nao_nfe" escondia o caso grave: mensagem
      // PULADA por estourar o teto de tempo, que pode conter NF-e de verdade.
      motivos[ig.categoria] = (motivos[ig.categoria] ?? 0) + 1
    }
    // Mensagem pulada nunca é rotina: vai para os erros, que aparecem no log
    // da execução e na tela.
    for (const ig of leitura.ignorados.filter(i => i.categoria === 'mensagem_pulada')) {
      erros.push(`PULADA ${ig.pasta} uid ${ig.uid}: ${ig.assunto.slice(0, 50)}`)
    }
    // Email-lote não processado por inteiro: precisa de conferência humana.
    for (const ig of leitura.ignorados.filter(i => i.categoria === 'lote_nao_processado')) {
      erros.push(`EMAIL-LOTE ${ig.pasta} uid ${ig.uid} "${ig.assunto.slice(0, 40)}": ${ig.motivo}`)
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

    // ── 8. Saúde: a marca d'água mexeu? ─────────────────────────────────
    // Sem isto, uma rotina presa numa mensagem retorna "ok" indefinidamente —
    // foi o que escondeu 825 emails parados por dois dias em 04/08/2026.
    const avancou = leitura.estados.some(est => {
      const antes = marcas[est.pasta]?.ultimo_uid ?? 0
      return est.ultimo_uid > antes
    })
    if (!avancou && leitura.fila_restante > 0) {
      await alertarSeTravada(supabase, leitura.fila_restante)
    }
    if (leitura.fila_restante > FILA_PARA_ALERTA) {
      await alertarFilaAcumulada(supabase, leitura.fila_restante)
    } else if (avancou || leitura.fila_restante === 0) {
      // Condição resolvida: baixa os alertas em aberto. Sem isto, um episódio
      // já superado deixaria o sino aceso para sempre — e alerta que não some
      // sozinho é alerta que as pessoas aprendem a ignorar.
      await supabase.from('notificacoes')
        .update({ lida: true })
        .in('tipo', ['sync_travada', 'fila_acumulada'])
        .eq('lida', false)
    }

    // ── 9. Fecha ────────────────────────────────────────────────────────
    const duracao = Date.now() - t0
    await supabase.from('sync_execucoes').update({
      status: 'ok',
      avancou,
      fila_restante: leitura.fila_restante,
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
      avancou,
      fila_restante: leitura.fila_restante,
      ms_varredura: msVarredura,
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

/**
 * Cria uma notificação quando a sincronização não avança há várias rodadas
 * seguidas havendo fila. Só uma notificação por episódio: enquanto houver uma
 * não lida do mesmo tipo, não insere outra — senão viraria uma a cada 15 min.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function alertarSeTravada(supabase: any, filaRestante: number): Promise<void> {
  const { data: recentes } = await supabase
    .from('sync_execucoes')
    .select('avancou, fila_restante')
    .eq('status', 'ok')
    .order('iniciado_em', { ascending: false })
    .limit(RODADAS_PARA_ALERTA)

  const paradas = (recentes ?? []).filter(
    (e: { avancou: boolean | null; fila_restante: number | null }) =>
      e.avancou === false && (e.fila_restante ?? 0) > 0,
  )
  if (paradas.length < RODADAS_PARA_ALERTA) return

  const { data: jaAvisado } = await supabase
    .from('notificacoes')
    .select('id')
    .eq('tipo', 'sync_travada').eq('lida', false)
    .limit(1)
  if (jaAvisado && jaAvisado.length > 0) return

  await supabase.from('notificacoes').insert({
    tipo: 'sync_travada',
    mensagem:
      `Sincronização travada: ${RODADAS_PARA_ALERTA} rodadas seguidas sem avançar, ` +
      `com ${filaRestante} email(s) na fila. Provável mensagem que a rotina não ` +
      `consegue processar — ver o histórico no topo do dashboard.`,
  })
}

/**
 * Avisa que há notas na fila esperando sincronização.
 *
 * Dispara quando a fila passa do limiar — o que acontece por volume ou depois
 * de rodadas mortas por timeout, que não processam nada e deixam tudo
 * acumulado. Uma notificação por episódio: enquanto houver uma não lida do
 * mesmo tipo, não insere outra.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function alertarFilaAcumulada(supabase: any, filaRestante: number): Promise<void> {
  const { data: jaAvisado } = await supabase
    .from('notificacoes')
    .select('id').eq('tipo', 'fila_acumulada').eq('lida', false).limit(1)
  if (jaAvisado && jaAvisado.length > 0) return

  await supabase.from('notificacoes').insert({
    tipo: 'fila_acumulada',
    mensagem:
      `${filaRestante} email(s) aguardando leitura. A sincronização automática ` +
      `está processando, mas o acúmulo passou de ${FILA_PARA_ALERTA}. ` +
      `Use "Sincronizar fila" na página de NF-es para esvaziar de uma vez.`,
  })
}

/**
 * Situação das últimas rodadas — usado pelo dashboard para se atualizar.
 *
 * Exige sessão de admin (o navegador manda o cookie) ou o token do agendador.
 * Sem isso, qualquer um leria a operação da empresa: volume de notas, horários,
 * motivos de descarte.
 */
export async function GET(request: NextRequest) {
  const comToken = autorizado(request)
  if (!comToken && !(await getSessaoAdmin())) {
    return NextResponse.json({ error: 'Não autorizado' }, { status: 401 })
  }

  const supabase = getServerClient()
  const { data } = await supabase
    .from('sync_execucoes')
    .select('iniciado_em, finalizado_em, status, gatilho, emails_lidos, emails_aceitos, emails_descartados, nfes_salvas, duracao_ms, avancou, fila_restante')
    .order('iniciado_em', { ascending: false })
    .limit(20)

  const execucoes = data ?? []

  /**
   * Intervalo real entre execuções, medido em vez de configurado.
   *
   * O rótulo era fixo em "15 min" e continuou dizendo isso depois de o
   * agendador passar para 5 — número escrito à mão sempre acaba mentindo,
   * porque a configuração vive fora daqui, no cron-job.org. A mediana dos
   * intervalos recentes é imune a rodadas manuais no meio.
   */
  const doCron = execucoes
    .filter((e: { gatilho?: string }) => e.gatilho === 'cron')
    .map((e: { iniciado_em: string }) => new Date(e.iniciado_em).getTime())
    .sort((a: number, b: number) => b - a)
  const gaps: number[] = []
  for (let i = 1; i < doCron.length; i++) {
    const min = Math.round((doCron[i - 1] - doCron[i]) / 60_000)
    if (min > 0) gaps.push(min)
  }
  gaps.sort((a, b) => a - b)
  const intervaloMin = gaps.length ? gaps[Math.floor(gaps.length / 2)] : null
  const ok = execucoes.filter((e: { status: string }) => e.status === 'ok')
  const paradas = ok.slice(0, RODADAS_PARA_ALERTA).filter(
    (e: { avancou: boolean | null; fila_restante: number | null }) =>
      e.avancou === false && (e.fila_restante ?? 0) > 0,
  )

  return NextResponse.json({
    execucoes: execucoes.slice(0, 10),
    intervalo_min: intervaloMin,
    saude: {
      travada: paradas.length >= RODADAS_PARA_ALERTA,
      rodadas_sem_avanco: paradas.length,
      fila_restante: ok[0]?.fila_restante ?? 0,
      ultima_com_erro: execucoes[0]?.status === 'erro',
    },
  })
}

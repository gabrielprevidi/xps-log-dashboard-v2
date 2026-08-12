'use client'

/**
 * Status da sincronização automática da V2.
 *
 * Substitui o botão "Sincronizar" da V1: em vez de o operador disparar e
 * esperar, a rotina roda de 15 em 15 minutos e esta faixa mostra o que
 * aconteceu. Quando entram notas novas, chama `onNovasNotas()` — que é o mesmo
 * recarregamento que o clique fazia antes.
 *
 * Por que polling e não Supabase Realtime: as tabelas `sync_execucoes` e
 * `movimentacoes` estão com RLS, e o Realtime respeita RLS. O navegador usa a
 * chave anônima e não receberia evento nenhum. Liberar a leitura para o papel
 * anônimo exporia a operação da empresa. O polling passa pela rota de API, que
 * roda no servidor com a chave de serviço e exige sessão de admin.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { RefreshCw, CheckCircle2, AlertTriangle, Clock, Inbox, Play, Square } from 'lucide-react'

const INTERVALO_MS = 30_000

interface Execucao {
  iniciado_em: string
  finalizado_em: string | null
  status: 'rodando' | 'ok' | 'erro'
  emails_lidos: number
  emails_aceitos: number
  emails_descartados: number
  nfes_salvas: number
  duracao_ms: number | null
  avancou: boolean | null
  fila_restante: number | null
}

/**
 * "Rodou e não tinha nada" e "rodou e não conseguiu avançar" produzem os mesmos
 * contadores. A diferença está aqui — e é o que faltava quando a rotina ficou
 * dois dias presa numa mensagem, retornando ok em todas as execuções.
 */
interface Saude {
  travada: boolean
  rodadas_sem_avanco: number
  fila_restante: number
  ultima_com_erro: boolean
}

function haQuantoTempo(iso: string): string {
  const seg = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000))
  if (seg < 60) return 'agora há pouco'
  const min = Math.floor(seg / 60)
  if (min < 60) return `há ${min} min`
  const h = Math.floor(min / 60)
  if (h < 24) return `há ${h}h${min % 60 ? ` ${min % 60}min` : ''}`
  return `há ${Math.floor(h / 24)} dia(s)`
}

export default function SyncStatus({ onNovasNotas }: { onNovasNotas?: () => void }) {
  const [execucoes, setExecucoes] = useState<Execucao[] | null>(null)
  const [saude, setSaude] = useState<Saude | null>(null)
  const [erroRede, setErroRede] = useState(false)
  const [sincronizando, setSincronizando] = useState(false)
  const [resultadoManual, setResultadoManual] = useState<string | null>(null)
  const [progresso, setProgresso] = useState<{
    rodadas: number; examinadas: number; notas: number; fila: number | null
  } | null>(null)
  /** Sinal de cancelamento — ref para o laço enxergar a mudança na hora. */
  const cancelarRef = useRef(false)
  const [expandido, setExpandido] = useState(false)
  // Total de notas já visto — a comparação detecta o que entrou desde a última
  // consulta. Ref (não estado) para não reexecutar o efeito a cada mudança.
  const totalNotasRef = useRef<number | null>(null)

  const consultar = useCallback(async () => {
    try {
      const res = await fetch('/api/cron/sync', { cache: 'no-store' })
      if (!res.ok) { setErroRede(true); return }
      const dados = await res.json()
      const lista: Execucao[] = dados.execucoes ?? []
      setExecucoes(lista)
      setSaude(dados.saude ?? null)
      setErroRede(false)

      const total = lista.reduce((s, e) => s + (e.nfes_salvas ?? 0), 0)
      if (totalNotasRef.current !== null && total > totalNotasRef.current) {
        onNovasNotas?.()
      }
      totalNotasRef.current = total
    } catch {
      setErroRede(true)
    }
  }, [onNovasNotas])

  /**
   * Esvazia a fila: encadeia rodadas até não sobrar email por examinar.
   *
   * Cada chamada é uma rodada normal e limitada — o encadeamento acontece aqui,
   * no navegador, porque uma função da Vercel tem 60 segundos e a fila pode ter
   * centenas de mensagens. Assim nenhum email fica para trás mesmo quando o
   * agendador não deu conta (falhou, foi desativado, ou o volume superou a
   * vazão de uma rodada a cada 15 minutos).
   *
   * Para sozinho quando: a fila zera, o usuário cancela, ou duas rodadas
   * seguidas não avançam (sinal de mensagem problemática — insistir só gastaria
   * tempo, e o alerta de travamento já cobre esse caso).
   */
  const drenarFila = useCallback(async () => {
    cancelarRef.current = false
    setSincronizando(true)
    setResultadoManual(null)
    setProgresso({ rodadas: 0, examinadas: 0, notas: 0, fila: null })

    const MAX_RODADAS = 300          // teto de segurança
    const MAX_SEM_AVANCO = 2
    let rodadas = 0, examinadas = 0, notas = 0, semAvanco = 0
    let fila: number | null = null
    let motivoParada = 'fila zerada'

    try {
      while (rodadas < MAX_RODADAS) {
        if (cancelarRef.current) { motivoParada = 'cancelado'; break }

        const res = await fetch('/api/cron/sync', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ gatilho: 'manual' }),
        })

        // 409 = o agendador está no meio de uma rodada. Espera e tenta de novo.
        if (res.status === 409) {
          await new Promise(r => setTimeout(r, 4000))
          continue
        }
        if (!res.ok) {
          const d = await res.json().catch(() => ({}))
          motivoParada = `erro: ${d.detalhe ?? d.error ?? res.status}`
          break
        }

        const d = await res.json()
        rodadas++
        examinadas += d.mensagens_examinadas ?? 0
        notas += d.nfes_salvas ?? 0
        fila = d.fila_restante ?? null
        setProgresso({ rodadas, examinadas, notas, fila })
        if (d.nfes_salvas > 0) onNovasNotas?.()

        if (fila === 0) { motivoParada = 'fila zerada'; break }
        if (d.avancou === false) {
          if (++semAvanco >= MAX_SEM_AVANCO) { motivoParada = 'a fila parou de avançar'; break }
        } else semAvanco = 0
      }
      if (rodadas >= MAX_RODADAS) motivoParada = `teto de ${MAX_RODADAS} rodadas`
    } catch (e) {
      motivoParada = `erro: ${e instanceof Error ? e.message : String(e)}`
    } finally {
      setResultadoManual(
        `${rodadas} rodada(s) · ${examinadas} email(s) examinado(s) · ${notas} nota(s) gravada(s)` +
        (fila !== null ? ` · ${fila === 0 ? 'fila zerada' : `${fila} ainda na fila`}` : '') +
        ` — ${motivoParada}`,
      )
      setProgresso(null)
      setSincronizando(false)
      await consultar()
    }
  }, [consultar, onNovasNotas])

  useEffect(() => {
    consultar()
    const t = setInterval(consultar, INTERVALO_MS)
    // Consulta ao voltar para a aba: quem ficou horas fora vê o estado atual
    // sem esperar o próximo ciclo.
    const aoVoltar = () => { if (document.visibilityState === 'visible') consultar() }
    document.addEventListener('visibilitychange', aoVoltar)
    return () => { clearInterval(t); document.removeEventListener('visibilitychange', aoVoltar) }
  }, [consultar])

  const ultima = execucoes?.[0]
  const rodando = ultima?.status === 'rodando'
  const notas24h = (execucoes ?? [])
    .filter(e => Date.now() - new Date(e.iniciado_em).getTime() < 864e5)
    .reduce((s, e) => s + (e.nfes_salvas ?? 0), 0)

  return (
    <div className="bg-white rounded-2xl border border-gray-100 p-5">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3 min-w-0">
          <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${
            saude?.travada ? 'bg-red-600' : erroRede ? 'bg-amber-500' : rodando ? 'bg-blue-600' : 'bg-[#0d1b2e]'}`}>
            {rodando
              ? <RefreshCw className="w-5 h-5 text-white animate-spin" />
              : (erroRede || saude?.travada)
                ? <AlertTriangle className="w-5 h-5 text-white" />
                : <CheckCircle2 className="w-5 h-5 text-white" />}
          </div>
          <div className="min-w-0">
            <h2 className="font-semibold text-[#0d1b2e] flex items-center gap-2">
              Sincronização automática
              <span className="text-[10px] font-medium uppercase tracking-wide px-1.5 py-0.5 rounded bg-gray-100 text-gray-500">
                a cada 15 min
              </span>
            </h2>
            <p className="text-xs text-gray-400 truncate">
              armazenagem@xpslog.com.br · IMAP
              {ultima && <> · última verificação {haQuantoTempo(ultima.iniciado_em)}</>}
              {!!saude?.fila_restante && <> · {saude.fila_restante} na fila</>}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-5">
          <div className="text-right">
            <div className="text-lg font-semibold text-[#0d1b2e] leading-none">{notas24h}</div>
            <div className="text-[11px] text-gray-400 mt-1">notas em 24h</div>
          </div>
          {sincronizando ? (
            <button
              onClick={() => { cancelarRef.current = true }}
              title="Interrompe após a rodada atual terminar"
              className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg border border-red-200
                         text-red-700 hover:bg-red-50 transition"
            >
              <Square className="w-3.5 h-3.5" /> parar
            </button>
          ) : (
            <button
              onClick={drenarFila}
              disabled={rodando}
              title="Processa todos os emails da fila, encadeando rodadas até esvaziar"
              className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg border border-gray-200
                         text-[#0d1b2e] hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition"
            >
              <Play className="w-3.5 h-3.5" /> Sincronizar fila
            </button>
          )}
          {execucoes && execucoes.length > 0 && (
            <button
              onClick={() => setExpandido(v => !v)}
              className="text-xs text-gray-500 hover:text-[#0d1b2e] underline underline-offset-2"
            >
              {expandido ? 'ocultar' : 'histórico'}
            </button>
          )}
        </div>
      </div>

      {/* Fila acumulada: a rotina funciona, mas há notas esperando. Distinto do
          travamento — aqui a ação é clicar em "Sincronizar fila". */}
      {!saude?.travada && !sincronizando && (saude?.fila_restante ?? 0) > 0 && (
        <div className="mt-3 rounded-xl bg-amber-50 border border-amber-200 p-3">
          <p className="text-xs text-amber-800 font-medium flex items-center gap-1.5">
            <Inbox className="w-3.5 h-3.5 shrink-0" />
            {saude!.fila_restante} email(s) na fila aguardando leitura.
          </p>
          <p className="text-[11px] text-amber-700/80 mt-1.5">
            A sincronização automática vai processá-los aos poucos. Para esvaziar
            agora — por exemplo depois de uma rodada que falhou por tempo esgotado —
            clique em <strong>Sincronizar fila</strong> acima.
          </p>
        </div>
      )}

      {saude?.travada && (
        <div className="mt-3 rounded-xl bg-red-50 border border-red-200 p-3">
          <p className="text-xs text-red-700 font-medium flex items-center gap-1.5">
            <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
            Sincronização travada — {saude.rodadas_sem_avanco} rodadas seguidas sem avançar,
            com {saude.fila_restante} email(s) esperando.
          </p>
          <p className="text-[11px] text-red-600/80 mt-1.5">
            As execuções continuam terminando &quot;ok&quot;, mas nenhum email novo está sendo
            lido. Normalmente é uma mensagem que a rotina não consegue processar.
            Abra o histórico abaixo e veja se a coluna de emails lidos está parada.
          </p>
        </div>
      )}

      {progresso && (
        <div className="mt-3 rounded-xl bg-blue-50 border border-blue-200 p-3">
          <p className="text-xs text-blue-800 font-medium flex items-center gap-1.5">
            <RefreshCw className="w-3.5 h-3.5 shrink-0 animate-spin" />
            Esvaziando a fila — rodada {progresso.rodadas} · {progresso.examinadas} email(s)
            examinado(s) · {progresso.notas} nota(s) gravada(s)
            {progresso.fila !== null && <> · {progresso.fila} restante(s)</>}
          </p>
          <p className="text-[11px] text-blue-700/70 mt-1.5">
            Pode deixar rodando; o agendador continua funcionando em paralelo. Fechar
            esta página interrompe o encadeamento, mas nada do que já foi gravado se perde.
          </p>
        </div>
      )}

      {resultadoManual && (
        <p className="mt-3 text-xs text-gray-600 bg-gray-50 border border-gray-100 rounded-lg px-3 py-2">
          {resultadoManual}
        </p>
      )}

      {erroRede && (
        <p className="mt-3 text-xs text-amber-600 flex items-center gap-1.5">
          <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
          Não foi possível consultar o status. A rotina continua rodando no servidor —
          isto afeta apenas esta tela.
        </p>
      )}

      {ultima?.status === 'erro' && (
        <p className="mt-3 text-xs text-red-600 flex items-center gap-1.5">
          <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
          A última rodada terminou com erro. Verifique o histórico.
        </p>
      )}

      {execucoes !== null && execucoes.length === 0 && (
        <p className="mt-3 text-xs text-gray-400 flex items-center gap-1.5">
          <Clock className="w-3.5 h-3.5 shrink-0" />
          Nenhuma execução registrada ainda. A primeira acontece em até 15 minutos.
        </p>
      )}

      {expandido && execucoes && (
        <div className="mt-4 border-t border-gray-100 pt-3">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-gray-400 text-left">
                <th className="font-medium pb-2">Quando</th>
                <th className="font-medium pb-2 text-right">Lidos</th>
                <th className="font-medium pb-2 text-right">Aceitos</th>
                <th className="font-medium pb-2 text-right">Notas</th>
                <th className="font-medium pb-2 text-right">Fila</th>
                <th className="font-medium pb-2 text-right">Tempo</th>
              </tr>
            </thead>
            <tbody>
              {execucoes.map((e, i) => (
                <tr key={i} className="border-t border-gray-50 text-gray-600">
                  <td className="py-1.5">
                    {new Date(e.iniciado_em).toLocaleString('pt-BR', {
                      day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
                    })}
                    {e.status === 'erro' && <span className="ml-1.5 text-red-500">erro</span>}
                  </td>
                  <td className="py-1.5 text-right tabular-nums">{e.emails_lidos}</td>
                  <td className="py-1.5 text-right tabular-nums">{e.emails_aceitos}</td>
                  <td className={`py-1.5 text-right tabular-nums ${e.nfes_salvas > 0 ? 'font-semibold text-[#0d1b2e]' : ''}`}>
                    {e.nfes_salvas}
                  </td>
                  <td className={`py-1.5 text-right tabular-nums ${
                    e.avancou === false && (e.fila_restante ?? 0) > 0 ? 'text-red-600 font-medium' : 'text-gray-400'}`}>
                    {e.fila_restante ?? '—'}
                    {e.avancou === false && (e.fila_restante ?? 0) > 0 && ' ⚠'}
                  </td>
                  <td className="py-1.5 text-right tabular-nums text-gray-400">
                    {e.duracao_ms ? `${(e.duracao_ms / 1000).toFixed(1)}s` : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-3 text-[11px] text-gray-400 flex items-start gap-1.5">
            <Inbox className="w-3.5 h-3.5 shrink-0 mt-px" />
            &quot;Lidos&quot; conta todo email examinado; &quot;aceitos&quot; são os que tinham NF-e de
            cliente cadastrado, com operação de entrada ou saída. O restante é
            descartado sem gravar nada no banco. &quot;Fila&quot; são os emails ainda não
            examinados — marcado em vermelho quando a rodada não conseguiu avançar.
          </p>
        </div>
      )}
    </div>
  )
}

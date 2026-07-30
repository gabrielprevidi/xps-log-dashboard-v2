'use client'

import { useEffect, useState, useCallback } from 'react'
import Link from 'next/link'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from 'recharts'
import {
  Package, ArrowDownToLine, ArrowUpFromLine, TrendingUp,
  Plus, ChevronRight, Loader2, Mail, Sparkles, AlertCircle,
} from 'lucide-react'
import { formatarMoeda } from '@/lib/calculations'

// ─── types ───────────────────────────────────────────────────────────────────

interface ClienteResumo {
  id: string
  nome: string
  nome_fantasia: string
  cnpj: string
  valor_pallet: number
  aliquota_imposto: number
  totalEntradas: number
  totalSaidas: number
  totalNfes: number
}

interface MesData {
  mes: string
  entradas: number
  saidas: number
}

interface ClienteAnalytics {
  clienteId: string
  nome: string
  valor_pallet: number
  aliquota_imposto: number
  meses: MesData[]
}

interface ContagemEmails {
  total: number
  processado: number
  pendente: number
  erro: number
}

// ─── helpers ─────────────────────────────────────────────────────────────────

const NOMES_MESES: Record<string, string> = {
  '01': 'Jan', '02': 'Fev', '03': 'Mar', '04': 'Abr', '05': 'Mai', '06': 'Jun',
  '07': 'Jul', '08': 'Ago', '09': 'Set', '10': 'Out', '11': 'Nov', '12': 'Dez',
}

function mesLabel(anoMes: string) {
  return `${NOMES_MESES[anoMes.slice(5, 7)] ?? anoMes.slice(5, 7)}/${anoMes.slice(2, 4)}`
}

function mesAtualStr() {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
}

const CHART_COLORS = ['#0d1b2e', '#2563eb', '#059669', '#d97706', '#7c3aed', '#db2777']

const CustomTooltip = ({ active, payload, label }: any) => {
  if (!active || !payload?.length) return null
  return (
    <div className="bg-[#0d1b2e] text-white rounded-xl px-4 py-3 shadow-xl text-xs">
      <p className="font-semibold mb-1">{label}</p>
      {payload.map((entry: any) => (
        <div key={entry.dataKey} className="flex items-center gap-2 mt-0.5">
          <span style={{ color: entry.fill }} className="font-bold">■</span>
          <span className="text-gray-300">{entry.name}:</span>
          <span className="font-bold">{entry.value}</span>
        </div>
      ))}
    </div>
  )
}

// ─── component ───────────────────────────────────────────────────────────────

export default function HomePage() {
  const [clientes, setClientes] = useState<ClienteResumo[]>([])
  const [analytics, setAnalytics] = useState<ClienteAnalytics[]>([])
  const [contagemEmails, setContagemEmails] = useState<ContagemEmails>({ total: 0, processado: 0, pendente: 0, erro: 0 })
  const [loading, setLoading] = useState(true)

  // filtros do gráfico
  const [clienteFiltro, setClienteFiltro] = useState<string>('todos')
  const [periodoFiltro, setPeriodoFiltro] = useState<string>('6')

  // insights IA
  const [insights, setInsights] = useState<string | null>(null)
  const [loadingInsights, setLoadingInsights] = useState(false)
  const [erroInsights, setErroInsights] = useState<string | null>(null)

  const carregar = useCallback(async () => {
    setLoading(true)
    try {
      const [cls, dash, anal] = await Promise.all([
        fetch('/api/clientes').then(r => r.json()),
        fetch('/api/dashboard').then(r => r.json()),
        fetch('/api/analytics').then(r => r.json()),
      ])
      setClientes(Array.isArray(cls) ? cls : [])
      setContagemEmails(dash.contagemEmails || { total: 0, processado: 0, pendente: 0, erro: 0 })
      setAnalytics(Array.isArray(anal) ? anal : [])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { carregar() }, [carregar])

  // ── KPIs consolidados ──
  const totalEntradas = clientes.reduce((s, c) => s + c.totalEntradas, 0)
  const totalSaidas = clientes.reduce((s, c) => s + c.totalSaidas, 0)
  const totalSaldo = totalEntradas - totalSaidas
  const totalNfes = clientes.reduce((s, c) => s + c.totalNfes, 0)

  // ── dados do gráfico ──
  const todosMeses = Array.from(new Set(
    analytics.flatMap(c => c.meses.map(m => m.mes))
  )).sort()

  const mesesParaGrafico = (() => {
    if (periodoFiltro === 'all') return todosMeses
    const n = parseInt(periodoFiltro)
    return todosMeses.slice(-n)
  })()

  const analyticsFiltered = clienteFiltro === 'todos'
    ? analytics
    : analytics.filter(c => c.clienteId === clienteFiltro)

  const chartData = mesesParaGrafico.map(mes => {
    const ponto: Record<string, string | number> = { mes: mesLabel(mes) }
    for (const c of analyticsFiltered) {
      const d = c.meses.find(m => m.mes === mes)
      ponto[`${c.nome} Ent.`] = d?.entradas ?? 0
      ponto[`${c.nome} Saí.`] = d?.saidas ?? 0
    }
    return ponto
  })

  // ── maiores ganhos (último mês com dados) ──
  const mesReferencia = mesAtualStr()
  const rankingGanhos = analytics
    .map(c => {
      const mesData = c.meses.find(m => m.mes === mesReferencia) ?? c.meses[c.meses.length - 1]
      const ppPico = mesData?.entradas ?? 0
      const receita = ppPico * c.valor_pallet * (1 + c.aliquota_imposto / 100)
      return { nome: c.nome, clienteId: c.clienteId, receita, ppPico, mes: mesData?.mes ?? '—' }
    })
    .sort((a, b) => b.receita - a.receita)

  const receitaTotal = rankingGanhos.reduce((s, r) => s + r.receita, 0)

  // ── gerar insights ──
  async function gerarInsights() {
    setLoadingInsights(true)
    setErroInsights(null)
    setInsights(null)
    try {
      const res = await fetch('/api/insights', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ analytics, mesFiltro: mesReferencia }),
      })
      const data = await res.json()
      if (data.error) throw new Error(data.error)
      setInsights(data.sugestoes)
    } catch (e: unknown) {
      setErroInsights(e instanceof Error ? e.message : String(e))
    } finally {
      setLoadingInsights(false)
    }
  }

  // ── render ──
  return (
    <main className="max-w-[1400px] mx-auto px-6 py-8 flex flex-col gap-6">

      {/* KPIs */}
      <div className="bg-white rounded-2xl border border-gray-100 p-6">
        <div className="flex items-center justify-between mb-5">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-gray-50 border border-gray-100 flex items-center justify-center">
              <Package className="w-4 h-4 text-gray-500" />
            </div>
            <h1 className="text-2xl font-bold text-[#0d1b2e]">Armazenagem XPS LOG</h1>
          </div>
          <span className="text-sm text-gray-400 capitalize">
            {new Date().toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })}
          </span>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-8 text-gray-400">
            <Loader2 className="w-5 h-5 animate-spin mr-2" /> Carregando...
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <div className="bg-gray-50 rounded-2xl p-4 text-center">
              <ArrowDownToLine className="w-5 h-5 text-blue-500 mx-auto mb-2" />
              <p className="text-2xl font-bold text-[#0d1b2e]">{totalEntradas}</p>
              <p className="text-xs text-gray-400 mt-1">Pallets entrados (total)</p>
            </div>
            <div className="bg-gray-50 rounded-2xl p-4 text-center">
              <ArrowUpFromLine className="w-5 h-5 text-orange-500 mx-auto mb-2" />
              <p className="text-2xl font-bold text-[#0d1b2e]">{totalSaidas}</p>
              <p className="text-xs text-gray-400 mt-1">Pallets saídos (total)</p>
            </div>
            <div className="bg-emerald-50 rounded-2xl p-4 text-center">
              <Package className="w-5 h-5 text-emerald-500 mx-auto mb-2" />
              <p className="text-2xl font-bold text-emerald-700">{totalSaldo}</p>
              <p className="text-xs text-emerald-600 mt-1">Saldo em estoque</p>
            </div>
            <div className="bg-blue-50 rounded-2xl p-4 text-center">
              <TrendingUp className="w-5 h-5 text-blue-500 mx-auto mb-2" />
              <p className="text-2xl font-bold text-blue-700">{totalNfes}</p>
              <p className="text-xs text-blue-500 mt-1">NF-es registradas</p>
            </div>
          </div>
        )}
      </div>

      {/* Gráfico + Maiores Ganhos */}
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-6">

        {/* Gráfico de movimentação mensal */}
        <div className="bg-white rounded-2xl border border-gray-100 p-6">
          <div className="flex flex-wrap items-center justify-between gap-3 mb-5">
            <h2 className="font-semibold text-[#0d1b2e]">Movimentação Mensal (pallets)</h2>
            <div className="flex items-center gap-2">
              {/* Filtro cliente */}
              <select
                value={clienteFiltro}
                onChange={e => setClienteFiltro(e.target.value)}
                className="border border-gray-200 rounded-xl px-3 py-1.5 text-xs font-medium text-[#0d1b2e] focus:outline-none focus:ring-2 focus:ring-[#0d1b2e]/10 bg-white"
              >
                <option value="todos">Todos os clientes</option>
                {analytics.map(c => (
                  <option key={c.clienteId} value={c.clienteId}>{c.nome}</option>
                ))}
              </select>
              {/* Filtro período */}
              <select
                value={periodoFiltro}
                onChange={e => setPeriodoFiltro(e.target.value)}
                className="border border-gray-200 rounded-xl px-3 py-1.5 text-xs font-medium text-[#0d1b2e] focus:outline-none focus:ring-2 focus:ring-[#0d1b2e]/10 bg-white"
              >
                <option value="3">Últimos 3 meses</option>
                <option value="6">Últimos 6 meses</option>
                <option value="12">Últimos 12 meses</option>
                <option value="all">Todos</option>
              </select>
            </div>
          </div>

          {loading ? (
            <div className="flex items-center justify-center h-52 text-gray-400">
              <Loader2 className="w-5 h-5 animate-spin mr-2" /> Carregando dados...
            </div>
          ) : chartData.length === 0 ? (
            <div className="flex items-center justify-center h-52 text-gray-400 text-sm">
              Nenhum dado disponível para o período selecionado.
            </div>
          ) : (
            <div className="h-56">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData} margin={{ top: 4, right: 0, left: -20, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" vertical={false} />
                  <XAxis dataKey="mes" tick={{ fontSize: 11, fill: '#9ca3af' }} tickLine={false} axisLine={false} />
                  <YAxis tick={{ fontSize: 11, fill: '#9ca3af' }} tickLine={false} axisLine={false} />
                  <Tooltip content={<CustomTooltip />} />
                  <Legend wrapperStyle={{ fontSize: 11, paddingTop: 8 }} />
                  {analyticsFiltered.flatMap((c, ci) => [
                    <Bar key={`${c.clienteId}-ent`} dataKey={`${c.nome} Ent.`} fill={CHART_COLORS[ci * 2 % CHART_COLORS.length]} radius={[4, 4, 0, 0]} maxBarSize={32} />,
                    <Bar key={`${c.clienteId}-sai`} dataKey={`${c.nome} Saí.`} fill={CHART_COLORS[(ci * 2 + 1) % CHART_COLORS.length]} radius={[4, 4, 0, 0]} maxBarSize={32} />,
                  ])}
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>

        {/* Maiores ganhos */}
        <div className="bg-white rounded-2xl border border-gray-100 p-5 flex flex-col">
          <h3 className="font-semibold text-[#0d1b2e] mb-1">Maiores Ganhos</h3>
          <p className="text-xs text-gray-400 mb-4">Receita estimada de armazenagem</p>

          {loading ? (
            <div className="flex items-center justify-center flex-1 text-gray-400">
              <Loader2 className="w-4 h-4 animate-spin mr-2" /> Carregando...
            </div>
          ) : rankingGanhos.length === 0 ? (
            <p className="text-sm text-gray-400 text-center py-6">Sem dados de receita.</p>
          ) : (
            <div className="flex flex-col gap-3 flex-1">
              {rankingGanhos.map((r, i) => {
                const pct = receitaTotal > 0 ? (r.receita / receitaTotal) * 100 : 0
                return (
                  <Link
                    key={r.clienteId}
                    href={`/clientes/${r.clienteId}`}
                    className="group hover:bg-gray-50 rounded-xl p-2 -mx-2 transition-colors"
                  >
                    <div className="flex items-center justify-between mb-1.5">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-bold text-gray-400 w-4">{i + 1}º</span>
                        <span className="text-sm font-semibold text-[#0d1b2e]">{r.nome}</span>
                      </div>
                      <span className="text-sm font-bold text-emerald-700">{formatarMoeda(r.receita)}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="flex-1 bg-gray-100 rounded-full h-1.5">
                        <div
                          className="bg-[#0d1b2e] h-1.5 rounded-full transition-all"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                      <span className="text-xs text-gray-400">{pct.toFixed(0)}%</span>
                    </div>
                  </Link>
                )
              })}
              <div className="mt-auto pt-3 border-t border-gray-100">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-gray-400">Total estimado</span>
                  <span className="text-base font-bold text-[#0d1b2e]">{formatarMoeda(receitaTotal)}</span>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Sugestões IA + clientes */}
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_380px] gap-6">

        {/* Sugestões com IA */}
        <div className="bg-gradient-to-br from-[#0d1b2e] to-[#1a3a5c] rounded-2xl p-6 text-white flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl bg-white/10 flex items-center justify-center">
                <Sparkles className="w-5 h-5 text-blue-300" />
              </div>
              <div>
                <h3 className="font-semibold text-lg">Sugestões com IA</h3>
                <p className="text-xs text-blue-300">Análise inteligente dos seus dados</p>
              </div>
            </div>
            <button
              onClick={gerarInsights}
              disabled={loadingInsights || loading}
              className="flex items-center gap-2 bg-white text-[#0d1b2e] text-sm font-semibold px-4 py-2 rounded-xl hover:bg-blue-50 disabled:opacity-60 transition-colors shrink-0"
            >
              {loadingInsights
                ? <><Loader2 className="w-4 h-4 animate-spin" /> Analisando...</>
                : <><Sparkles className="w-4 h-4" /> {insights ? 'Atualizar' : 'Gerar sugestões'}</>
              }
            </button>
          </div>

          {erroInsights && (
            <div className="bg-red-900/30 border border-red-500/30 rounded-xl p-4 flex items-start gap-3">
              <AlertCircle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
              <div>
                <p className="text-sm text-red-300 font-medium">Erro ao gerar sugestões</p>
                <p className="text-xs text-red-400 mt-1">{erroInsights}</p>
              </div>
            </div>
          )}

          {!insights && !erroInsights && !loadingInsights && (
            <div className="flex-1 flex flex-col items-center justify-center py-8 text-center">
              <Sparkles className="w-10 h-10 text-blue-300/40 mb-3" />
              <p className="text-blue-200 text-sm">
                Clique em &ldquo;Gerar sugestões&rdquo; para obter análise estratégica<br />
                com base nos dados reais dos seus clientes.
              </p>
            </div>
          )}

          {loadingInsights && (
            <div className="flex-1 flex flex-col items-center justify-center py-8 text-center">
              <Loader2 className="w-8 h-8 text-blue-300 animate-spin mb-3" />
              <p className="text-blue-200 text-sm">Analisando dados e gerando recomendações...</p>
            </div>
          )}

          {insights && (
            <div className="bg-white/5 rounded-xl p-4 text-sm text-blue-100 leading-relaxed whitespace-pre-wrap">
              {insights}
            </div>
          )}
        </div>

        {/* Coluna direita */}
        <div className="flex flex-col gap-4">

          {/* Clientes */}
          <div className="bg-white rounded-2xl border border-gray-100 p-5">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold text-[#0d1b2e]">Clientes</h3>
              <Link href="/clientes" className="text-xs text-gray-400 hover:text-gray-700 font-medium">Ver todos →</Link>
            </div>

            {loading ? (
              <div className="flex items-center justify-center py-6 text-gray-400">
                <Loader2 className="w-4 h-4 animate-spin mr-2" /> Carregando...
              </div>
            ) : clientes.length === 0 ? (
              <div className="text-center py-4 text-gray-400">
                <Package className="w-7 h-7 mx-auto mb-2 opacity-40" />
                <p className="text-sm">Nenhum cliente.</p>
              </div>
            ) : (
              <div className="flex flex-col divide-y divide-gray-50">
                {clientes.map(cliente => (
                  <Link
                    key={cliente.id}
                    href={`/clientes/${cliente.id}`}
                    className="py-3 first:pt-0 last:pb-0 flex items-center justify-between hover:bg-gray-50/50 -mx-2 px-2 rounded-xl transition-colors"
                  >
                    <div className="flex items-center gap-3">
                      <div className="w-9 h-9 rounded-xl bg-[#0d1b2e] flex items-center justify-center text-white text-xs font-bold shrink-0">
                        {(cliente.nome_fantasia || cliente.nome).slice(0, 2).toUpperCase()}
                      </div>
                      <div>
                        <p className="font-semibold text-sm text-[#0d1b2e]">{cliente.nome_fantasia || cliente.nome}</p>
                        <p className="text-xs text-gray-400">
                          {cliente.totalNfes} NF-es · saldo {cliente.totalEntradas - cliente.totalSaidas} pallets
                        </p>
                      </div>
                    </div>
                    <ChevronRight className="w-4 h-4 text-gray-300 shrink-0" />
                  </Link>
                ))}
              </div>
            )}
          </div>

          {/* Emails */}
          <div className="bg-white rounded-2xl border border-gray-100 p-5">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <Mail className="w-4 h-4 text-gray-400" />
                <h3 className="font-semibold text-[#0d1b2e]">Emails processados</h3>
              </div>
              <Link href="/nfes" className="text-xs text-gray-400 hover:text-gray-700">Ver →</Link>
            </div>
            <div className="grid grid-cols-3 gap-2">
              <div className="bg-gray-50 rounded-xl p-3 text-center">
                <p className="text-xl font-bold text-[#0d1b2e]">{contagemEmails.total}</p>
                <p className="text-xs text-gray-400 mt-0.5">Total</p>
              </div>
              <div className="bg-emerald-50 rounded-xl p-3 text-center">
                <p className="text-xl font-bold text-emerald-700">{contagemEmails.processado}</p>
                <p className="text-xs text-emerald-600 mt-0.5">Processados</p>
              </div>
              <div className={`rounded-xl p-3 text-center ${contagemEmails.erro > 0 ? 'bg-red-50' : 'bg-gray-50'}`}>
                <p className={`text-xl font-bold ${contagemEmails.erro > 0 ? 'text-red-700' : 'text-gray-400'}`}>{contagemEmails.erro}</p>
                <p className={`text-xs mt-0.5 ${contagemEmails.erro > 0 ? 'text-red-500' : 'text-gray-400'}`}>Erros</p>
              </div>
            </div>
          </div>

          {/* CTA novo cliente */}
          <div className="bg-gradient-to-br from-[#0d1b2e] to-[#1a3a5c] rounded-2xl p-4 text-white">
            <p className="font-semibold mb-1">Novo cliente</p>
            <p className="text-xs text-blue-200 mb-3">Cadastre e comece a rastrear a armazenagem</p>
            <Link
              href="/configuracoes"
              className="inline-flex items-center gap-2 bg-white text-[#0d1b2e] text-xs font-semibold px-3 py-2 rounded-xl hover:bg-gray-50 transition-colors"
            >
              Cadastrar <Plus className="w-3 h-3" />
            </Link>
          </div>
        </div>
      </div>
    </main>
  )
}

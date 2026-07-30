'use client'

import { useEffect, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import {
  Package, ArrowDownToLine, ArrowUpFromLine, TrendingUp,
  LogOut, ChevronLeft, ChevronRight, FileText, CheckCircle,
  Clock, Loader2, Scissors,
} from 'lucide-react'
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, Cell,
  ResponsiveContainer,
} from 'recharts'
import { formatarMoeda } from '@/lib/calculations'
import {
  calcularMesCliente, mesesComDadosAsc, anoMesDe, fatorDe, contraparteDe,
  type MovCalc,
} from '@/lib/cliente-calculos'

interface ClienteInfo {
  id: string
  nome: string
  nome_fantasia: string
  cnpj: string
  valor_pallet: number
  aliquota_imposto: number
  regra_fator_pallet: number
  cobrar_manuseio?: boolean
  cobrar_separacao_sacaria?: boolean
  modo_calculo?: string | null
}

interface SaldoMensal {
  competencia: string
  volume_inicial: number
  valor_pallet: number | null
  percentual_imposto: number | null
}

interface Fechamento {
  id: string
  competencia: string
  status: 'aberto' | 'fechado' | 'aprovado' | 'nf_emitida'
  arquivo_cobranca_url: string | null
  arquivo_cobranca_nome: string | null
  aprovado_em: string | null
}

interface CobrancaAdicional {
  id: string
  descricao: string
  valor: number
}

function mesLabel(anoMesStr: string) {
  const [ano, mes] = anoMesStr.split('-')
  const nomes = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez']
  return `${nomes[+mes - 1]} ${ano}`
}

function fmtData(data: string | null) {
  return data ? new Date(data + 'T12:00:00').toLocaleDateString('pt-BR') : '—'
}

function gerarGrafico(vol: number, movsContab: MovCalc[], anoMesStr: string) {
  const [ano, mes] = anoMesStr.split('-').map(Number)
  const ultimo = new Date(ano, mes, 0).getDate()
  const porDia: Record<number, number> = {}
  for (const m of movsContab) {
    const d = parseInt((m.data_entrada || m.data_saida || '').slice(8, 10))
    if (!d) continue
    const delta = m.tipo_movimentacao === 'entrada' ? (m.pallets_entrada || 0) : -(m.pallets_saida || 0)
    porDia[d] = (porDia[d] || 0) + delta
  }
  let saldo = vol
  return Array.from({ length: ultimo }, (_, i) => {
    saldo = Math.max(0, saldo + (porDia[i + 1] || 0))
    return { dia: String(i + 1).padStart(2, '0'), saldo }
  })
}

export default function PortalPage() {
  const router = useRouter()
  const [cliente, setCliente] = useState<ClienteInfo | null>(null)
  const [usuario, setUsuario] = useState('')
  const [movs, setMovs] = useState<MovCalc[]>([])
  const [saldos, setSaldos] = useState<SaldoMensal[]>([])
  const [fechamentos, setFechamentos] = useState<Fechamento[]>([])
  const [cobrancas, setCobrancas] = useState<CobrancaAdicional[]>([])
  const [produtos, setProdutos] = useState<{ id: string }[]>([])
  const [loading, setLoading] = useState(true)
  const [aprovando, setAprovando] = useState<string | null>(null)

  const [mesAtual, setMesAtual] = useState(() => {
    const now = new Date()
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
  })

  const carregarDados = useCallback(async () => {
    setLoading(true)
    try {
      const meRes = await fetch('/api/portal/me')
      if (!meRes.ok) { router.push('/portal/login'); return }
      const meData = await meRes.json()
      setCliente(meData.cliente)
      setUsuario(meData.usuario)

      const [clienteRes, saldosRes, fechamentosRes, produtosRes] = await Promise.all([
        fetch(`/api/clientes/${meData.cliente.id}`),
        fetch(`/api/clientes/${meData.cliente.id}/saldos`),
        fetch(`/api/fechamento?cliente_id=${meData.cliente.id}`),
        fetch(`/api/clientes/${meData.cliente.id}/produtos`),
      ])

      const clienteData = await clienteRes.json()
      setMovs(clienteData.movimentacoes || [])
      if (clienteData.cliente) setCliente(clienteData.cliente)

      const saldosData = await saldosRes.json()
      setSaldos(Array.isArray(saldosData) ? saldosData : [])

      const fechData = await fechamentosRes.json()
      setFechamentos(Array.isArray(fechData) ? fechData : [])

      const produtosData = await produtosRes.json()
      setProdutos(Array.isArray(produtosData) ? produtosData : [])
    } catch {
      router.push('/portal/login')
    } finally {
      setLoading(false)
    }
  }, [router])

  useEffect(() => { carregarDados() }, [carregarDados])

  // Cobranças adicionais do mês selecionado
  const carregarCobrancas = useCallback(async () => {
    if (!cliente) return
    try {
      const res = await fetch(`/api/clientes/${cliente.id}/cobrancas?competencia=${mesAtual}`)
      if (res.ok) {
        const data = await res.json()
        setCobrancas(Array.isArray(data) ? data : [])
      }
    } catch { /* ignore */ }
  }, [cliente, mesAtual])

  useEffect(() => { carregarCobrancas() }, [carregarCobrancas])

  async function logout() {
    await fetch('/api/portal/logout', { method: 'POST' })
    router.push('/portal/login')
  }

  async function aprovar(fechamento: Fechamento) {
    const mesNome = mesLabel(anoMesDe(fechamento.competencia))
    if (!confirm(`Confirmar aprovação da cobrança de ${mesNome}? Após aprovação os dados do mês não poderão ser alterados.`)) return
    setAprovando(fechamento.id)
    try {
      const res = await fetch(`/api/fechamento/${fechamento.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ acao: 'aprovar' }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      await carregarDados()
    } catch (e: any) {
      alert('Erro ao aprovar: ' + e.message)
    } finally {
      setAprovando(null)
    }
  }

  // ── derived ──
  const mesesAsc = mesesComDadosAsc(movs)
  const mesesComDados = Array.from(new Set([...mesesAsc, mesAtual])).sort().reverse()

  const calc = cliente
    ? calcularMesCliente({ mes: mesAtual, todasMovs: movs, saldos, cobrancas, cliente, mesesAsc })
    : null

  const temCategorias = produtos.length > 0
  const dadosGrafico = calc ? gerarGrafico(calc.volumeInicial, calc.movsContab, mesAtual) : []
  const picoValor = dadosGrafico.reduce((mx, d) => (d.saldo > mx ? d.saldo : mx), 0)

  const fechamentosVisiveis = fechamentos.filter(f => f.status !== 'aberto')
  const fechamentoMes = fechamentosVisiveis.find(f => f.competencia.slice(0, 7) === mesAtual)
  const mesNFEmitida = fechamentoMes?.status === 'nf_emitida'
  const mesAprovadoCliente = fechamentoMes?.status === 'aprovado'
  const mesAprovado = mesAprovadoCliente || mesNFEmitida
  const mesFechado = fechamentoMes?.status === 'fechado' || mesAprovado
  const pendentesAprovacao = fechamentosVisiveis.filter(f => f.status === 'fechado')

  if (loading || !cliente || !calc) {
    return (
      <div className="min-h-screen flex items-center justify-center text-gray-400">
        <Loader2 className="w-6 h-6 animate-spin mr-2" /> Carregando...
      </div>
    )
  }

  const nomeCliente = cliente.nome_fantasia || cliente.nome || usuario
  const movsDoMesTodas = calc.movsTodasMes

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-[#0d1b2e] text-white px-6 py-4">
        <div className="max-w-[1200px] mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-white/10 flex items-center justify-center text-xs font-bold">
              {nomeCliente.slice(0, 2).toUpperCase()}
            </div>
            <div>
              <p className="font-semibold text-sm">{nomeCliente}</p>
              <p className="text-xs text-blue-300">{usuario}</p>
            </div>
          </div>
          <div className="flex items-center gap-4">
            {pendentesAprovacao.length > 0 && (
              <span className="text-xs bg-amber-500 text-white px-2.5 py-1 rounded-full font-semibold animate-pulse">
                {pendentesAprovacao.length} cobrança{pendentesAprovacao.length > 1 ? 's' : ''} pendente{pendentesAprovacao.length > 1 ? 's' : ''}
              </span>
            )}
            <button onClick={logout} className="flex items-center gap-1.5 text-xs text-blue-300 hover:text-white transition-colors">
              <LogOut className="w-4 h-4" /> Sair
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-[1200px] mx-auto px-6 py-8">

        {/* NFs disponíveis para download */}
        {fechamentosVisiveis.filter(f => f.status === 'nf_emitida' && f.arquivo_cobranca_url).map(f => (
          <div key={f.id} className="mb-4 bg-emerald-50 border border-emerald-200 rounded-2xl p-5 flex items-center justify-between flex-wrap gap-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-emerald-100 flex items-center justify-center">
                <FileText className="w-5 h-5 text-emerald-600" />
              </div>
              <div>
                <p className="font-semibold text-emerald-800">NF de {mesLabel(anoMesDe(f.competencia))} disponível</p>
                <p className="text-xs text-emerald-600">{f.arquivo_cobranca_nome || 'Nota fiscal emitida'}</p>
              </div>
            </div>
            <a href={f.arquivo_cobranca_url!} target="_blank" rel="noopener noreferrer"
              className="flex items-center gap-1.5 text-xs px-4 py-2 rounded-xl bg-emerald-600 text-white hover:bg-emerald-700 transition-colors font-semibold">
              <FileText className="w-3.5 h-3.5" /> Baixar NF
            </a>
          </div>
        ))}

        {/* Cobranças pendentes de aprovação */}
        {pendentesAprovacao.length > 0 && (
          <div className="mb-6 space-y-3">
            {pendentesAprovacao.map(f => (
              <div key={f.id} className="bg-amber-50 border border-amber-200 rounded-2xl p-5 flex items-center justify-between flex-wrap gap-4">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-amber-100 flex items-center justify-center">
                    <FileText className="w-5 h-5 text-amber-600" />
                  </div>
                  <div>
                    <p className="font-semibold text-amber-800">Cobrança de {mesLabel(anoMesDe(f.competencia))} aguarda aprovação</p>
                    <p className="text-xs text-amber-600">{f.arquivo_cobranca_nome || 'Confira os valores abaixo antes de aprovar'}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {f.arquivo_cobranca_url && (
                    <a href={f.arquivo_cobranca_url} target="_blank" rel="noopener noreferrer"
                      className="flex items-center gap-1.5 text-xs px-3 py-2 rounded-xl border border-amber-300 text-amber-700 hover:bg-amber-100 transition-colors">
                      <FileText className="w-3.5 h-3.5" /> Ver NF
                    </a>
                  )}
                  <button onClick={() => aprovar(f)} disabled={aprovando === f.id}
                    className="flex items-center gap-1.5 text-xs px-4 py-2 rounded-xl bg-amber-600 text-white hover:bg-amber-700 disabled:opacity-50 transition-colors font-semibold">
                    <CheckCircle className="w-3.5 h-3.5" />
                    {aprovando === f.id ? 'Aprovando...' : 'Aprovar cobrança'}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Seletor de mês */}
        <div className="flex items-center gap-3 mb-6">
          <button
            onClick={() => { const idx = mesesComDados.indexOf(mesAtual); if (idx < mesesComDados.length - 1) setMesAtual(mesesComDados[idx + 1]) }}
            className="w-8 h-8 rounded-lg border border-gray-200 flex items-center justify-center text-gray-400 hover:bg-gray-50 disabled:opacity-30 bg-white"
            disabled={mesesComDados.indexOf(mesAtual) === mesesComDados.length - 1}
          ><ChevronLeft className="w-4 h-4" /></button>
          <select value={mesAtual} onChange={e => setMesAtual(e.target.value)}
            className="border border-gray-200 rounded-xl px-4 py-2 text-sm font-semibold text-[#0d1b2e] bg-white focus:outline-none">
            {mesesComDados.map(m => <option key={m} value={m}>{mesLabel(m)}</option>)}
          </select>
          <button
            onClick={() => { const idx = mesesComDados.indexOf(mesAtual); if (idx > 0) setMesAtual(mesesComDados[idx - 1]) }}
            className="w-8 h-8 rounded-lg border border-gray-200 flex items-center justify-center text-gray-400 hover:bg-gray-50 disabled:opacity-30 bg-white"
            disabled={mesesComDados.indexOf(mesAtual) === 0}
          ><ChevronRight className="w-4 h-4" /></button>

          {mesNFEmitida && (
            <span className="flex items-center gap-1.5 text-xs text-emerald-600 bg-emerald-50 border border-emerald-200 px-3 py-1.5 rounded-full">
              <CheckCircle className="w-3.5 h-3.5" /> NF emitida — mês encerrado
            </span>
          )}
          {mesAprovadoCliente && !mesNFEmitida && (
            <span className="flex items-center gap-1.5 text-xs text-blue-600 bg-blue-50 border border-blue-200 px-3 py-1.5 rounded-full">
              <Clock className="w-3.5 h-3.5" /> Aprovado — aguardando NF
            </span>
          )}
          {mesFechado && !mesAprovado && (
            <span className="flex items-center gap-1.5 text-xs text-amber-600 bg-amber-50 border border-amber-200 px-3 py-1.5 rounded-full">
              <Clock className="w-3.5 h-3.5" /> Aguardando sua aprovação
            </span>
          )}
        </div>

        {/* KPIs */}
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-4 mb-6">
          <div className="bg-white rounded-2xl border border-gray-100 p-4">
            <div className="flex items-center gap-2 mb-2"><Package className="w-4 h-4 text-gray-400" /><span className="text-xs text-gray-400 uppercase tracking-wider">Est. Inicial</span></div>
            <p className="text-3xl font-bold text-[#0d1b2e]">{calc.volumeInicial}</p>
            <p className="text-xs text-gray-400 mt-1">pallets</p>
          </div>
          <div className="bg-white rounded-2xl border border-gray-100 p-4">
            <div className="flex items-center gap-2 mb-2"><ArrowDownToLine className="w-4 h-4 text-blue-500" /><span className="text-xs text-gray-400 uppercase tracking-wider">Entradas</span></div>
            <p className="text-3xl font-bold text-[#0d1b2e]">{calc.totalEntradas}</p>
            <p className="text-xs text-gray-400 mt-1">pallets</p>
          </div>
          <div className="bg-white rounded-2xl border border-gray-100 p-4">
            <div className="flex items-center gap-2 mb-2"><ArrowUpFromLine className="w-4 h-4 text-orange-500" /><span className="text-xs text-gray-400 uppercase tracking-wider">Saídas</span></div>
            <p className="text-3xl font-bold text-[#0d1b2e]">{calc.totalSaidas}</p>
            <p className="text-xs text-gray-400 mt-1">pallets</p>
          </div>
          <div className="bg-white rounded-2xl border border-gray-100 p-4">
            <div className="flex items-center gap-2 mb-2"><TrendingUp className="w-4 h-4 text-emerald-500" /><span className="text-xs text-gray-400 uppercase tracking-wider">Saldo Final</span></div>
            <p className="text-3xl font-bold text-[#0d1b2e]">{calc.saldoFinal}</p>
            <p className="text-xs text-gray-400 mt-1">pallets</p>
          </div>
          <div className="bg-[#0d1b2e] rounded-2xl p-4">
            <div className="flex items-center gap-2 mb-2"><TrendingUp className="w-4 h-4 text-blue-300" /><span className="text-xs text-blue-300 uppercase tracking-wider">PP Pico</span></div>
            <p className="text-3xl font-bold text-white">{calc.ppPico}</p>
            <p className="text-xs text-blue-300 mt-1">base cobrança</p>
          </div>
        </div>

        {/* Armazenagem */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-6">
          <div className="bg-white rounded-2xl border border-gray-100 p-5">
            <p className="text-xs text-gray-400 uppercase tracking-wider mb-2">Armazenagem s/ imposto</p>
            <p className="text-3xl font-bold text-[#0d1b2e]">{formatarMoeda(calc.armazBase)}</p>
            <p className="text-xs text-gray-400 mt-1">{calc.ppPico} pallets × {formatarMoeda(calc.valorPallet)}</p>
          </div>
          <div className="bg-emerald-50 rounded-2xl border border-emerald-100 p-5">
            <p className="text-xs text-emerald-600 uppercase tracking-wider mb-2">Armazenagem c/ imposto ({calc.aliquota}%)</p>
            <p className="text-3xl font-bold text-emerald-700">{formatarMoeda(calc.armazTotal)}</p>
            <p className="text-xs text-emerald-600 mt-1">+{formatarMoeda(calc.armazTotal - calc.armazBase)} em impostos</p>
          </div>
        </div>

        {/* Gráfico */}
        <div className="bg-white rounded-2xl border border-gray-100 p-6 mb-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold text-[#0d1b2e]">Evolução do Estoque — {mesLabel(mesAtual)}</h2>
            <span className="text-xs text-gray-500">Pico: <strong className="text-[#0d1b2e]">{picoValor} pallets</strong></span>
          </div>
          {dadosGrafico.length > 0 ? (
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={dadosGrafico} barCategoryGap="20%">
                <XAxis dataKey="dia" tick={{ fontSize: 11, fill: '#9ca3af' }} axisLine={false} tickLine={false} interval={2} />
                <YAxis tick={{ fontSize: 11, fill: '#9ca3af' }} axisLine={false} tickLine={false} width={36} />
                <Tooltip formatter={(v) => [`${v} pallets`, 'Saldo']} labelFormatter={l => `Dia ${l}`} contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #e5e7eb' }} />
                <Bar dataKey="saldo" radius={[3, 3, 0, 0]}>
                  {dadosGrafico.map((entry, i) => (
                    <Cell key={i} fill={entry.saldo === picoValor && picoValor > 0 ? '#0d1b2e' : '#bfdbfe'} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <p className="text-sm text-gray-400 text-center py-8">Sem movimentações.</p>
          )}
        </div>

        {/* Movimentações */}
        <div className="bg-white rounded-2xl border border-gray-100 p-6 mb-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold text-[#0d1b2e]">Movimentações — {mesLabel(mesAtual)}</h2>
            <span className="text-xs text-gray-400">{calc.movsContab.length} mov.</span>
          </div>
          {calc.movsContab.length === 0 ? (
            <p className="text-sm text-gray-400 text-center py-8">Nenhuma movimentação neste mês.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 text-gray-500 text-xs uppercase tracking-wider">
                    <th className="px-4 py-3 text-left">Data</th>
                    <th className="px-4 py-3 text-left">NF-e</th>
                    <th className="px-4 py-3 text-left">Tipo</th>
                    <th className="px-4 py-3 text-left">Fornecedor / Destino</th>
                    {temCategorias && <th className="px-4 py-3 text-left">Produto</th>}
                    <th className="px-4 py-3 text-right">Toneladas</th>
                    {cliente.cobrar_separacao_sacaria && <th className="px-4 py-3 text-right">Fator</th>}
                    <th className="px-4 py-3 text-right">Pallets</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {calc.movsContab.map((mov: MovCalc) => {
                    const ton = mov.qtd_entrada_ton ?? mov.qtd_saida_ton ?? 0
                    const pallets = mov.pallets_entrada || mov.pallets_saida || 0
                    return (
                      <tr key={mov.id} className="hover:bg-gray-50">
                        <td className="px-4 py-3 text-gray-600">{fmtData(mov.data_entrada || mov.data_saida)}</td>
                        <td className="px-4 py-3 font-mono text-xs text-gray-600">{mov.numero_nfe || '—'}</td>
                        <td className="px-4 py-3">
                          <span className={`text-xs font-semibold px-2 py-1 rounded-full ${mov.tipo_movimentacao === 'entrada' ? 'bg-blue-50 text-blue-700' : 'bg-orange-50 text-orange-700'}`}>
                            {mov.tipo_movimentacao === 'entrada' ? 'Entrada' : 'Saída'}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-xs text-gray-500 max-w-[200px] truncate">{contraparteDe(mov)}</td>
                        {temCategorias && (
                          <td className="px-4 py-3">
                            {mov.produto_nome
                              ? <span className="text-xs bg-indigo-50 text-indigo-700 border border-indigo-100 px-2 py-0.5 rounded-full font-medium">{mov.produto_nome}</span>
                              : <span className="text-xs text-gray-300">—</span>}
                          </td>
                        )}
                        <td className="px-4 py-3 text-right text-gray-600">{Number(ton).toFixed(3)} t</td>
                        {cliente.cobrar_separacao_sacaria && (
                          <td className="px-4 py-3 text-right text-gray-500">{fatorDe(mov, cliente)}</td>
                        )}
                        <td className="px-4 py-3 text-right font-bold text-[#0d1b2e]">{pallets}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Separação por unidade de sacaria */}
        {cliente.cobrar_separacao_sacaria && (calc.movsSeparacao.length > 0 || calc.excessos.length > 0) && (
          <div className="bg-white rounded-2xl border border-gray-100 p-6 mb-6">
            <div className="flex items-center justify-between mb-1">
              <h2 className="font-semibold text-[#0d1b2e] flex items-center gap-2">
                <Scissors className="w-4 h-4 text-amber-500" /> Separação por Unidade de Sacaria — {mesLabel(mesAtual)}
              </h2>
              <div className="text-right">
                <p className="text-xs text-gray-400">Total separação</p>
                <p className="text-xl font-bold text-amber-700">{formatarMoeda(calc.totalSeparacao)}</p>
              </div>
            </div>
            <p className="text-xs text-gray-400 mb-4">Itens &lt; fator são cobrados por unidade (R$ 4,50/un · volume = ton × 1000 ÷ 25)</p>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-amber-50 text-amber-700 text-xs uppercase tracking-wider">
                    <th className="px-4 py-3 text-left">Data</th>
                    <th className="px-4 py-3 text-left">NF-e</th>
                    <th className="px-4 py-3 text-left">Destino</th>
                    <th className="px-4 py-3 text-right">Toneladas</th>
                    <th className="px-4 py-3 text-right">Fator</th>
                    <th className="px-4 py-3 text-right">Volume (un)</th>
                    <th className="px-4 py-3 text-right">Total</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {calc.movsSeparacao.map((mov: MovCalc) => {
                    const ton = mov.qtd_entrada_ton ?? mov.qtd_saida_ton ?? 0
                    const volume = Math.round((ton * 1000) / 25 * 100) / 100
                    return (
                      <tr key={mov.id} className="hover:bg-gray-50">
                        <td className="px-4 py-3 text-gray-600">{fmtData(mov.data_entrada || mov.data_saida)}</td>
                        <td className="px-4 py-3 font-mono text-xs text-gray-600">{mov.numero_nfe || '—'}</td>
                        <td className="px-4 py-3 text-xs text-gray-500 max-w-[180px] truncate">{contraparteDe(mov)}</td>
                        <td className="px-4 py-3 text-right text-gray-600">{Number(ton).toFixed(3)} t</td>
                        <td className="px-4 py-3 text-right text-gray-500">{fatorDe(mov, cliente)}</td>
                        <td className="px-4 py-3 text-right font-bold text-amber-700">{volume.toFixed(2)}</td>
                        <td className="px-4 py-3 text-right font-semibold text-[#0d1b2e]">{formatarMoeda(volume * 4.5)}</td>
                      </tr>
                    )
                  })}
                  {calc.excessos.map(exc => {
                    const volume = Math.round(exc.excessoTon * 1000 / 25 * 100) / 100
                    return (
                      <tr key={exc.movId} className="hover:bg-gray-50">
                        <td className="px-4 py-3 text-gray-600">{fmtData(exc.data)}</td>
                        <td className="px-4 py-3 font-mono text-xs text-gray-500">{exc.nfe || '—'} <span className="text-amber-500">(excedente)</span></td>
                        <td className="px-4 py-3 text-xs text-gray-500 max-w-[180px] truncate">{exc.contraparte}</td>
                        <td className="px-4 py-3 text-right text-gray-600">{exc.excessoTon.toFixed(3)} t</td>
                        <td className="px-4 py-3 text-right text-gray-500">{exc.fator}</td>
                        <td className="px-4 py-3 text-right font-bold text-amber-700">{volume.toFixed(2)}</td>
                        <td className="px-4 py-3 text-right font-semibold text-[#0d1b2e]">{formatarMoeda(volume * 4.5)}</td>
                      </tr>
                    )
                  })}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 border-gray-200 bg-amber-50/50">
                    <td colSpan={6} className="px-4 py-3 text-right text-sm font-semibold text-gray-600">Total</td>
                    <td className="px-4 py-3 text-right font-bold text-amber-700 text-base">{formatarMoeda(calc.totalSeparacao)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
        )}

        {/* Cobrança de manuseio */}
        {(cliente.cobrar_manuseio ?? true) && calc.movsContab.length > 0 && (
          <div className="bg-white rounded-2xl border border-gray-100 p-6 mb-6">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h2 className="font-semibold text-[#0d1b2e]">Cobrança de Manuseio — {mesLabel(mesAtual)}</h2>
                <p className="text-xs text-gray-400 mt-0.5">Valor cobrado por pallet movimentado</p>
              </div>
              <div className="text-right">
                <p className="text-xs text-gray-400">Total manuseio</p>
                <p className="text-xl font-bold text-emerald-700">{formatarMoeda(calc.totalManuseio)}</p>
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 text-gray-500 text-xs uppercase tracking-wider">
                    <th className="px-4 py-3 text-left">Data</th>
                    <th className="px-4 py-3 text-left">NF-e</th>
                    <th className="px-4 py-3 text-left">Fornecedor / Destino</th>
                    <th className="px-4 py-3 text-right">Pallets</th>
                    <th className="px-4 py-3 text-right">R$/pallet</th>
                    <th className="px-4 py-3 text-right">Total</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {calc.movsContab.map((mov: MovCalc) => {
                    const pallets = mov.pallets_entrada || mov.pallets_saida || 0
                    const vm = Number(mov.valor_manuseio ?? 4.5)
                    return (
                      <tr key={mov.id} className="hover:bg-gray-50">
                        <td className="px-4 py-3 text-gray-600">{fmtData(mov.data_entrada || mov.data_saida)}</td>
                        <td className="px-4 py-3 font-mono text-xs text-gray-600">{mov.numero_nfe || '—'}</td>
                        <td className="px-4 py-3 text-xs text-gray-500 max-w-[200px] truncate">{contraparteDe(mov)}</td>
                        <td className="px-4 py-3 text-right font-bold text-[#0d1b2e]">{pallets}</td>
                        <td className="px-4 py-3 text-right text-gray-600">{formatarMoeda(vm)}</td>
                        <td className="px-4 py-3 text-right font-semibold text-[#0d1b2e]">{formatarMoeda(pallets * vm)}</td>
                      </tr>
                    )
                  })}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 border-gray-200 bg-gray-50">
                    <td colSpan={3} className="px-4 py-3 text-sm font-semibold text-gray-600">Total</td>
                    <td className="px-4 py-3 text-right font-bold text-[#0d1b2e]">{calc.movsContab.reduce((s: number, m: MovCalc) => s + (m.pallets_entrada || m.pallets_saida || 0), 0)} pallets</td>
                    <td className="px-4 py-3" />
                    <td className="px-4 py-3 text-right font-bold text-emerald-700 text-base">{formatarMoeda(calc.totalManuseio)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
        )}

        {/* Cobranças adicionais */}
        {cobrancas.length > 0 && (
          <div className="bg-white rounded-2xl border border-gray-100 p-6 mb-6">
            <h2 className="font-semibold text-[#0d1b2e] mb-4">Cobranças Adicionais — {mesLabel(mesAtual)}</h2>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 text-gray-500 text-xs uppercase tracking-wider">
                    <th className="px-4 py-3 text-left">Descrição</th>
                    <th className="px-4 py-3 text-right">Valor</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {cobrancas.map(c => (
                    <tr key={c.id} className="hover:bg-gray-50">
                      <td className="px-4 py-3 text-gray-700">{c.descricao}</td>
                      <td className="px-4 py-3 text-right font-semibold text-[#0d1b2e]">{formatarMoeda(c.valor)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 border-gray-200 bg-gray-50">
                    <td className="px-4 py-3 text-sm font-semibold text-gray-600">Total</td>
                    <td className="px-4 py-3 text-right font-bold text-[#0d1b2e]">{formatarMoeda(calc.totalCobrancas)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
        )}

        {/* Total Geral de adicionais */}
        {calc.totalGeral > 0 && (
          <div className="bg-[#0d1b2e] rounded-2xl p-6 mb-6 flex items-center justify-between flex-wrap gap-3">
            <div>
              <p className="text-blue-300 text-xs uppercase tracking-wider">Total de cobranças adicionais ({mesLabel(mesAtual)})</p>
              <p className="text-xs text-blue-300/70 mt-1">
                {[
                  calc.manuseioEfetivo > 0 && 'manuseio',
                  calc.totalSeparacao > 0 && 'separação',
                  calc.totalCobrancas > 0 && 'adicionais',
                ].filter(Boolean).join(' + ')}
              </p>
            </div>
            <p className="text-3xl font-bold text-white">{formatarMoeda(calc.totalGeral)}</p>
          </div>
        )}

        {/* Movimentações canceladas (informativo) */}
        {movsDoMesTodas.some((m: MovCalc) => m.cancelada) && (
          <div className="bg-white rounded-2xl border border-gray-100 p-6 mb-6">
            <h2 className="font-semibold text-gray-500 mb-3 text-sm">Movimentações canceladas neste mês</h2>
            <div className="space-y-1">
              {movsDoMesTodas.filter((m: MovCalc) => m.cancelada).map((m: MovCalc) => (
                <div key={m.id} className="flex items-center gap-3 text-xs text-gray-400 line-through">
                  <span>{fmtData(m.data_entrada || m.data_saida)}</span>
                  <span className="font-mono">{m.numero_nfe || '—'}</span>
                  <span>{m.tipo_movimentacao === 'entrada' ? 'Entrada' : 'Saída'}</span>
                  <span className="truncate max-w-[200px]">{contraparteDe(m)}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Histórico de cobranças */}
        {fechamentosVisiveis.filter(f => f.status === 'nf_emitida').length > 0 && (
          <div className="bg-white rounded-2xl border border-gray-100 p-6">
            <h2 className="font-semibold text-[#0d1b2e] mb-4">Histórico de Cobranças</h2>
            <div className="space-y-2">
              {fechamentosVisiveis.filter(f => f.status === 'nf_emitida').map(f => (
                <div key={f.id} className="flex items-center justify-between py-2 px-3 bg-gray-50 rounded-xl">
                  <div className="flex items-center gap-2">
                    <CheckCircle className="w-4 h-4 text-emerald-500" />
                    <span className="text-sm font-medium text-gray-700">{mesLabel(anoMesDe(f.competencia))}</span>
                    <span className="text-xs text-gray-400">Aprovado em {f.aprovado_em ? new Date(f.aprovado_em).toLocaleDateString('pt-BR') : '—'}</span>
                  </div>
                  {f.arquivo_cobranca_url && (
                    <a href={f.arquivo_cobranca_url} target="_blank" rel="noopener noreferrer"
                      className="flex items-center gap-1 text-xs text-blue-600 hover:underline">
                      <FileText className="w-3.5 h-3.5" /> {f.arquivo_cobranca_nome || 'Ver NF'}
                    </a>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </main>
    </div>
  )
}

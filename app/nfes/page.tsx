'use client'

import { Mail, CheckCircle, XCircle, Clock, ArrowLeftRight, UserPlus, Trash2 } from 'lucide-react'
import StatusBadge from '@/components/dashboard/StatusBadge'
import KPICard from '@/components/dashboard/KPICard'
import EmailSyncPanel from '@/components/dashboard/EmailSyncPanel'
import { useEffect, useState } from 'react'

interface EmailImportado {
  id: string
  message_id: string
  assunto: string
  remetente: string
  data_recebimento: string
  status_processamento: string
  erro_processamento: string | null
}

interface Movimentacao {
  id: string
  tipo_movimentacao: string
  categoria_movimentacao: string
  fornecedor: string | null
  cliente_destino: string | null
  numero_nfe: string | null
  data_entrada: string | null
  data_saida: string | null
  qtd_entrada_ton: number | null
  qtd_saida_ton: number | null
  pallets_entrada: number | null
  pallets_saida: number | null
  cancelada: boolean | null
  produto_nome: string | null
  produto_id: string | null
  clientes: { id: string; nome_fantasia: string } | null
  arquivos_nfe: { nome_arquivo: string; nome_emitente: string | null; nome_destinatario: string | null } | null
}

interface ClienteProduto {
  id: string
  nome: string
  categoria: string
}

interface Cliente {
  id: string
  nome_fantasia: string
  nome: string
}

interface DadosDashboard {
  emails: EmailImportado[]
  movimentacoes: Movimentacao[]
  contagemEmails: { total: number; processado: number; pendente: number; erro: number }
}

export default function NFesPage() {
  const [dados, setDados] = useState<DadosDashboard | null>(null)
  const [clientes, setClientes] = useState<Cliente[]>([])
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState<string | null>(null)
  const [filtroMes, setFiltroMes] = useState('')
  const [filtroCliente, setFiltroCliente] = useState('')
  const [corrigindo, setCorrigindo] = useState<string | null>(null)
  const [atribuindo, setAtribuindo] = useState<string | null>(null)
  const [excluindo, setExcluindo] = useState<string | null>(null)
  const [clienteSelecionado, setClienteSelecionado] = useState<Record<string, string>>({})
  const [editandoCliente, setEditandoCliente] = useState<string | null>(null)
  const [produtosPorCliente, setProdutosPorCliente] = useState<Record<string, ClienteProduto[]>>({})
  const [produtoSelecionado, setProdutoSelecionado] = useState<Record<string, string>>({})

  async function carregarDados() {
    setCarregando(true)
    setErro(null)
    try {
      const [resDash, resClientes] = await Promise.all([
        fetch('/api/dashboard'),
        fetch('/api/clientes'),
      ])
      if (!resDash.ok) throw new Error(`HTTP ${resDash.status}`)
      const json = await resDash.json()
      if (json.error) throw new Error(json.error)
      setDados(json)

      if (resClientes.ok) {
        const cli = await resClientes.json()
        setClientes(Array.isArray(cli) ? cli : cli.clientes ?? [])
      }
    } catch (e: any) {
      setErro(e.message)
    } finally {
      setCarregando(false)
    }
  }

  useEffect(() => {
    carregarDados()
  }, [])

  async function corrigirTipo(mov: Movimentacao) {
    const novoTipo = mov.tipo_movimentacao === 'entrada' ? 'saida' : 'entrada'
    const label = novoTipo === 'entrada' ? 'Entrada' : 'Saída'
    if (!confirm(`Corrigir esta NF-e para "${label}"?`)) return
    setCorrigindo(mov.id)
    try {
      const res = await fetch(`/api/movimentacoes/${mov.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tipo_movimentacao: novoTipo }),
      })
      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.error || `HTTP ${res.status}`)
      }
      await carregarDados()
    } catch (e: any) {
      alert(`Erro ao corrigir: ${e.message}`)
    } finally {
      setCorrigindo(null)
    }
  }

  async function excluirNFe(mov: Movimentacao) {
    const label = mov.numero_nfe ? `NF-e ${mov.numero_nfe}` : 'esta NF-e'
    if (!confirm(`Marcar ${label} como excluída? A linha ficará riscada no histórico mas não será apagada.`)) return
    setExcluindo(mov.id)
    try {
      const res = await fetch(`/api/movimentacoes/${mov.id}`, { method: 'DELETE' })
      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.error || `HTTP ${res.status}`)
      }
      // Marca como cancelada localmente (soft delete — linha fica no histórico com strikethrough)
      setDados(prev => prev ? {
        ...prev,
        movimentacoes: prev.movimentacoes.map(m =>
          m.id === mov.id ? { ...m, cancelada: true } : m
        ),
      } : null)
    } catch (e: any) {
      alert(`Erro ao excluir: ${e.message}`)
    } finally {
      setExcluindo(null)
    }
  }

  async function carregarProdutos(clienteId: string) {
    if (produtosPorCliente[clienteId]) return
    const res = await fetch(`/api/clientes/${clienteId}/produtos`)
    const data = await res.json()
    setProdutosPorCliente(prev => ({ ...prev, [clienteId]: Array.isArray(data) ? data : [] }))
  }

  async function atribuirCliente(movId: string) {
    const clienteId = clienteSelecionado[movId]
    if (!clienteId) return
    setAtribuindo(movId)
    try {
      const res = await fetch(`/api/movimentacoes/${movId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cliente_id: clienteId }),
      })
      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.error || `HTTP ${res.status}`)
      }
      setEditandoCliente(null)
      await carregarDados()
    } catch (e: any) {
      alert(`Erro ao atribuir cliente: ${e.message}`)
    } finally {
      setAtribuindo(null)
    }
  }

  async function salvarProduto(movId: string, clienteId: string) {
    const prodId = produtoSelecionado[movId]
    const produtos = produtosPorCliente[clienteId] ?? []
    const prod = produtos.find(p => p.id === prodId)
    setAtribuindo(movId)
    try {
      const res = await fetch(`/api/movimentacoes/${movId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ produto_id: prodId || null, produto_nome: prod?.nome || null }),
      })
      if (!res.ok) throw new Error((await res.json()).error)
      setDados(prev => prev ? {
        ...prev,
        movimentacoes: prev.movimentacoes.map(m =>
          m.id === movId ? { ...m, produto_id: prodId || null, produto_nome: prod?.nome || null } : m
        ),
      } : null)
    } catch (e: any) {
      alert(`Erro: ${e.message}`)
    } finally {
      setAtribuindo(null)
    }
  }

  const contagem = dados?.contagemEmails ?? { total: 0, processado: 0, pendente: 0, erro: 0 }

  const mesesDisponiveis = Array.from(
    new Set(
      (dados?.movimentacoes ?? []).map(m => {
        const d = m.data_entrada || m.data_saida || ''
        return d.slice(0, 7)
      }).filter(Boolean)
    )
  ).sort().reverse()

  const clientesDisponiveis = Array.from(
    new Map(
      (dados?.movimentacoes ?? [])
        .filter(m => m.clientes)
        .map(m => [m.clientes!.id, m.clientes!])
    ).values()
  ).sort((a, b) => a.nome_fantasia.localeCompare(b.nome_fantasia))

  const movsFiltradas = (dados?.movimentacoes ?? []).filter(m => {
    if (filtroMes) {
      const d = m.data_entrada || m.data_saida || ''
      if (!d.startsWith(filtroMes)) return false
    }
    if (filtroCliente) {
      if (!m.clientes || m.clientes.id !== filtroCliente) return false
    }
    return true
  })

  const semCliente = movsFiltradas.filter(m => !m.clientes && !m.cancelada).length

  return (
    <main className="max-w-[1400px] mx-auto px-6 py-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-[#0d1b2e]">NFes & Emails</h1>
        <p className="text-sm text-gray-400 mt-1">
          Sincronize o email xps.ai@exsa.srv.br e acompanhe as notas fiscais processadas
        </p>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
        <KPICard label="Total Emails" value={String(contagem.total)} subvalue="recebidos" icon={Mail} />
        <KPICard label="Processados" value={String(contagem.processado)} subvalue="com sucesso" icon={CheckCircle} />
        <KPICard label="Pendentes" value={String(contagem.pendente)} subvalue="aguardando" icon={Clock} />
        <KPICard label="Com Erro" value={String(contagem.erro)} subvalue="falhou" icon={XCircle} variant={contagem.erro > 0 ? 'highlight' : 'default'} />
      </div>

      {/* Painel de sincronização */}
      <div className="mb-6">
        <EmailSyncPanel onSyncComplete={carregarDados} />
      </div>

      {erro && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 mb-6 text-sm text-red-700">
          Erro ao carregar dados: {erro}
        </div>
      )}

      {/* Histórico de emails */}
      <div className="bg-white rounded-2xl border border-gray-100 p-6 mb-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-semibold text-[#0d1b2e]">Histórico de Emails</h2>
          {carregando && <span className="text-xs text-gray-400 animate-pulse">Carregando...</span>}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 text-gray-500 text-xs uppercase tracking-wider">
                <th className="px-4 py-3 text-left">Data</th>
                <th className="px-4 py-3 text-left">Remetente</th>
                <th className="px-4 py-3 text-left">Assunto</th>
                <th className="px-4 py-3 text-left">Status</th>
                <th className="px-4 py-3 text-left">Erro</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {dados?.emails.length === 0 && !carregando ? (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-gray-400 text-sm">
                    Nenhum email importado ainda. Clique em &quot;Sincronizar agora&quot; acima.
                  </td>
                </tr>
              ) : (
                dados?.emails.map((email) => (
                  <tr key={email.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 text-gray-600 whitespace-nowrap">
                      {new Date(email.data_recebimento).toLocaleString('pt-BR', {
                        day: '2-digit', month: '2-digit', year: '2-digit',
                        hour: '2-digit', minute: '2-digit',
                      })}
                    </td>
                    <td className="px-4 py-3 text-gray-600 text-xs">{email.remetente}</td>
                    <td className="px-4 py-3 text-gray-700 max-w-[280px] truncate">{email.assunto}</td>
                    <td className="px-4 py-3">
                      <StatusBadge status={email.status_processamento as any} />
                    </td>
                    <td className="px-4 py-3 text-xs text-red-500">
                      {email.erro_processamento || '—'}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* NFes / movimentações */}
      <div className="bg-white rounded-2xl border border-gray-100 p-6">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
          <div className="flex items-center gap-3">
            <h2 className="font-semibold text-[#0d1b2e]">NFes Processadas</h2>
            {semCliente > 0 && (
              <span className="text-xs bg-amber-50 text-amber-700 border border-amber-200 px-2 py-0.5 rounded-full">
                {semCliente} sem cliente
              </span>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {/* Filtro por cliente */}
            <select
              value={filtroCliente}
              onChange={e => setFiltroCliente(e.target.value)}
              className="text-xs border border-gray-200 rounded-lg px-3 py-1.5 text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="">Todos os clientes</option>
              {clientesDisponiveis.map(c => (
                <option key={c.id} value={c.id}>{c.nome_fantasia}</option>
              ))}
            </select>
            {/* Filtro por mês */}
            <select
              value={filtroMes}
              onChange={e => setFiltroMes(e.target.value)}
              className="text-xs border border-gray-200 rounded-lg px-3 py-1.5 text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="">Todos os meses</option>
              {mesesDisponiveis.map(mes => (
                <option key={mes} value={mes}>
                  {new Date(mes + '-01T12:00:00').toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 text-gray-500 text-xs uppercase tracking-wider">
                <th className="px-4 py-3 text-left">Data</th>
                <th className="px-4 py-3 text-left">Número NFe</th>
                <th className="px-4 py-3 text-left">Tipo</th>
                <th className="px-4 py-3 text-left">Cliente</th>
                <th className="px-4 py-3 text-left">Categoria</th>
                <th className="px-4 py-3 text-left">Fornecedor / Destino</th>
                <th className="px-4 py-3 text-right">Pallets</th>
                <th className="px-4 py-3 text-center">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {movsFiltradas.length === 0 && !carregando ? (
                <tr>
                  <td colSpan={9} className="px-4 py-8 text-center text-gray-400 text-sm">
                    Nenhuma NFe encontrada.
                  </td>
                </tr>
              ) : (
                movsFiltradas.map((mov) => {
                  const cancelada = mov.cancelada === true
                  return (
                    <tr
                      key={mov.id}
                      className={`${cancelada ? 'opacity-50 bg-red-50/30' : !mov.clientes ? 'bg-amber-50/40' : ''} hover:bg-gray-50`}
                    >
                      <td className={`px-4 py-3 text-gray-600 whitespace-nowrap ${cancelada ? 'line-through' : ''}`}>
                        {new Date(
                          ((mov.data_entrada || mov.data_saida || '') + 'T12:00:00')
                        ).toLocaleDateString('pt-BR')}
                      </td>
                      <td className={`px-4 py-3 font-mono text-xs text-gray-600 ${cancelada ? 'line-through' : ''}`}>
                        {mov.numero_nfe || '—'}
                      </td>
                      <td className="px-4 py-3">
                        <span className={`text-xs font-semibold px-2 py-1 rounded-full ${cancelada ? 'bg-gray-100 text-gray-400' :
                          mov.tipo_movimentacao === 'entrada' ? 'bg-blue-50 text-blue-700' : 'bg-orange-50 text-orange-700'
                        }`}>
                          {cancelada ? 'Cancelada' : mov.tipo_movimentacao === 'entrada' ? 'Entrada' : 'Saída'}
                        </span>
                      </td>
                      {/* Célula Cliente — permite troca em qualquer linha */}
                      <td className={`px-4 py-3 text-xs text-gray-600 ${cancelada ? 'line-through' : ''}`}>
                        {cancelada ? (
                          <span className="text-gray-400">—</span>
                        ) : editandoCliente === mov.id ? (
                          <div className="flex items-center gap-1">
                            <select
                              value={clienteSelecionado[mov.id] || mov.clientes?.id || ''}
                              onChange={e => setClienteSelecionado(prev => ({ ...prev, [mov.id]: e.target.value }))}
                              className="text-xs border border-blue-300 rounded-md px-1.5 py-1 bg-white text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-400 max-w-[130px]"
                              autoFocus
                            >
                              <option value="">Sem cliente</option>
                              {clientes.map(c => (
                                <option key={c.id} value={c.id}>{c.nome_fantasia || c.nome}</option>
                              ))}
                            </select>
                            <button onClick={() => atribuirCliente(mov.id)} disabled={atribuindo === mov.id}
                              className="p-1 rounded text-blue-600 hover:bg-blue-50 disabled:opacity-40">
                              <UserPlus size={13} />
                            </button>
                            <button onClick={() => setEditandoCliente(null)}
                              className="p-1 rounded text-gray-400 hover:bg-gray-100 text-xs">✕</button>
                          </div>
                        ) : (
                          <div className="flex items-center gap-1 group">
                            <span className={`font-medium ${!mov.clientes ? 'text-amber-600' : ''}`}>
                              {mov.clientes?.nome_fantasia ?? '⚠ sem cliente'}
                            </span>
                            <button
                              onClick={() => { setEditandoCliente(mov.id); setClienteSelecionado(prev => ({ ...prev, [mov.id]: mov.clientes?.id || '' })) }}
                              className="opacity-0 group-hover:opacity-100 p-0.5 rounded text-gray-400 hover:text-blue-600 transition-opacity"
                              title="Trocar cliente"
                            >
                              <UserPlus size={12} />
                            </button>
                          </div>
                        )}
                      </td>

                      {/* Célula Categoria */}
                      <td className="px-4 py-3 text-xs">
                        {cancelada ? <span className="text-gray-300">—</span> : mov.clientes ? (
                          <div className="flex items-center gap-1 group">
                            {mov.produto_nome ? (
                              <span className="bg-indigo-50 text-indigo-700 border border-indigo-100 px-2 py-0.5 rounded-full font-medium">
                                {mov.produto_nome}
                              </span>
                            ) : (
                              <select
                                value={produtoSelecionado[mov.id] ?? ''}
                                onChange={async e => {
                                  setProdutoSelecionado(prev => ({ ...prev, [mov.id]: e.target.value }))
                                  if (!produtosPorCliente[mov.clientes!.id]) await carregarProdutos(mov.clientes!.id)
                                }}
                                onFocus={() => carregarProdutos(mov.clientes!.id)}
                                className="text-xs border border-gray-200 rounded px-1.5 py-1 text-gray-600 focus:outline-none focus:ring-1 focus:ring-indigo-400 max-w-[140px]"
                              >
                                <option value="">Sem categoria</option>
                                {(produtosPorCliente[mov.clientes.id] ?? []).map(p => (
                                  <option key={p.id} value={p.id}>{p.nome}</option>
                                ))}
                              </select>
                            )}
                            {!mov.produto_nome && produtoSelecionado[mov.id] && (
                              <button onClick={() => salvarProduto(mov.id, mov.clientes!.id)}
                                className="text-xs text-indigo-600 hover:bg-indigo-50 px-1.5 py-0.5 rounded border border-indigo-200">
                                ✓
                              </button>
                            )}
                            {mov.produto_nome && (
                              <button
                                onClick={() => { setProdutoSelecionado(prev => ({ ...prev, [mov.id]: '' })); salvarProduto(mov.id, mov.clientes!.id) }}
                                className="opacity-0 group-hover:opacity-100 text-xs text-gray-400 hover:text-red-500 px-1"
                                title="Remover categoria"
                              >✕</button>
                            )}
                          </div>
                        ) : <span className="text-gray-300">—</span>}
                      </td>

                      <td className={`px-4 py-3 text-xs text-gray-500 max-w-[180px] truncate ${cancelada ? 'line-through' : ''}`}>
                        {mov.fornecedor || mov.cliente_destino || mov.arquivos_nfe?.nome_emitente || '—'}
                      </td>
                      <td className={`px-4 py-3 text-right font-bold text-[#0d1b2e] ${cancelada ? 'line-through text-gray-400' : ''}`}>
                        {mov.pallets_entrada || mov.pallets_saida || 0}
                      </td>
                      <td className="px-4 py-3 text-center">
                        {cancelada ? (
                          <span className="text-xs text-red-400 italic">excluída</span>
                        ) : (
                          <div className="flex items-center justify-center gap-1">
                            <button
                              onClick={() => corrigirTipo(mov)}
                              disabled={corrigindo === mov.id}
                              title={`Corrigir para ${mov.tipo_movimentacao === 'entrada' ? 'Saída' : 'Entrada'}`}
                              className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-lg border border-gray-200 text-gray-500 hover:border-blue-400 hover:text-blue-600 disabled:opacity-40 transition-colors"
                            >
                              <ArrowLeftRight size={12} />
                              {corrigindo === mov.id ? '...' : mov.tipo_movimentacao === 'entrada' ? '→ Saída' : '→ Entrada'}
                            </button>
                            <button
                              onClick={() => excluirNFe(mov)}
                              disabled={excluindo === mov.id}
                              title="Excluir NF-e"
                              className="inline-flex items-center p-1.5 rounded-lg border border-gray-200 text-gray-400 hover:border-red-400 hover:text-red-600 disabled:opacity-40 transition-colors"
                            >
                              <Trash2 size={12} />
                            </button>
                          </div>
                        )}
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </main>
  )
}

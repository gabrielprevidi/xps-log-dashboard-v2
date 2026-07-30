'use client'

import { useEffect, useState, useCallback } from 'react'
import { Save, Plus, Loader2, X, Check, KeyRound, Trash2, Eye, EyeOff, Package, RefreshCw, RotateCcw, AlertCircle, CheckCircle2 } from 'lucide-react'

interface SyncResultado {
  emails_lidos: number
  nfes_salvas: number
  duplicados: number
  erros: string[]
  detalhes?: Array<{ assunto: string; remetente: string; nfes: Array<{ arquivo: string; pallets: number | null; nfe: { numero: string; emitente: string } | null }> }>
}

interface Cliente {
  id: string
  nome: string
  nome_fantasia: string
  cnpj: string
  valor_pallet: number
  aliquota_imposto: number
  regra_fator_pallet: number
  email_remetente: string | null
  portal_usuario: string | null
  ativo: boolean
  cobrar_manuseio: boolean
}

interface PortalForm {
  usuario: string
  senha: string
  confirm: string
}

interface Form {
  nome_fantasia: string
  nome: string
  cnpj: string
  valor_pallet: string
  aliquota_imposto: string
  regra_fator_pallet: string
  email_remetente: string
  cobrar_manuseio: boolean
}

interface ProdutoForm {
  nome: string
  codigo_ncm: string
  palavras_chave: string
  valor_pallet: string
  aliquota_imposto: string
  regra_fator_pallet: string
  categoria: string
}

interface ClienteProduto {
  id: string
  cliente_id: string
  nome: string
  codigo_ncm: string | null
  palavras_chave: string | null
  valor_pallet: number
  aliquota_imposto: number
  regra_fator_pallet: number
  categoria: string
}

const CATEGORIAS_PRODUTO = [
  { value: 'pa', label: 'Produto Acabado' },
  { value: 'lintec_casting', label: 'Lintec / Casting' },
  { value: 'semi_acabado', label: 'Semi-Acabado' },
  { value: 'mp', label: 'Matéria-Prima' },
  { value: 'embalagem', label: 'Embalagem' },
  { value: 'outro', label: 'Outro' },
]

const formVazio: Form = {
  nome_fantasia: '',
  nome: '',
  cnpj: '',
  valor_pallet: '38',
  aliquota_imposto: '2',
  regra_fator_pallet: '1.2',
  email_remetente: '',
  cobrar_manuseio: true,
}

const prodVazio: ProdutoForm = {
  nome: '',
  codigo_ncm: '',
  palavras_chave: '',
  valor_pallet: '38',
  aliquota_imposto: '2',
  regra_fator_pallet: '1.2',
  categoria: 'pa',
}

export default function ConfiguracoesPage() {
  const [clientes, setClientes] = useState<Cliente[]>([])
  const [loading, setLoading] = useState(true)

  // edição inline por cliente
  const [editando, setEditando] = useState<Record<string, Form>>({})
  const [salvando, setSalvando] = useState<Record<string, boolean>>({})
  const [salvou, setSalvou] = useState<Record<string, boolean>>({})

  // portal credentials
  const [portalEdit, setPortalEdit] = useState<Record<string, PortalForm>>({})
  const [salvandoPortal, setSalvandoPortal] = useState<Record<string, boolean>>({})
  const [mostrarSenha, setMostrarSenha] = useState<Record<string, boolean>>({})

  // novo cliente
  const [novoCliente, setNovoCliente] = useState(false)
  const [formNovo, setFormNovo] = useState<Form>(formVazio)
  const [criando, setCriando] = useState(false)
  // produtos do novo cliente (pré-criação)
  const [novosProdutos, setNovosProdutos] = useState<ProdutoForm[]>([])

  // produtos por cliente (carregados ao editar)
  const [clienteProdutos, setClienteProdutos] = useState<Record<string, ClienteProduto[]>>({})
  // form de novo produto por cliente (no modo edição)
  const [adicionandoProdCliente, setAdicionandoProdCliente] = useState<string | null>(null)
  const [novoProdFormEd, setNovoProdFormEd] = useState<ProdutoForm>(prodVazio)
  const [salvandoNovoProd, setSalvandoNovoProd] = useState(false)
  // form de edição por produto existente
  const [editProdutoForm, setEditProdutoForm] = useState<Record<string, ProdutoForm>>({})
  const [salvandoProd, setSalvandoProd] = useState<Record<string, boolean>>({})

  // sincronização
  const [sincronizando, setSincronizando] = useState(false)
  const [limpandoSync, setLimpandoSync] = useState(false)
  const [syncResultado, setSyncResultado] = useState<SyncResultado | null>(null)
  const [syncErro, setSyncErro] = useState<string | null>(null)

  async function parseResposta(res: Response): Promise<unknown> {
    const text = await res.text()
    try {
      return JSON.parse(text)
    } catch {
      throw new Error(`Erro do servidor (${res.status}): ${text.slice(0, 300)}`)
    }
  }

  async function chamarSync(diasAtras = 30, limite = 15): Promise<SyncResultado> {
    const res = await fetch('/api/email/sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dias_atras: diasAtras, limite }),
    })
    const data = await parseResposta(res) as SyncResultado & { detalhe?: string; error?: string }
    if (!res.ok) throw new Error(data.detalhe || data.error || `HTTP ${res.status}`)
    return data
  }

  async function sincronizarEmails() {
    setSincronizando(true)
    setSyncResultado(null)
    setSyncErro(null)
    try {
      // Rodadas de 15 emails até não ter mais novos (max 4 rodadas = 60 emails)
      let acumulado: SyncResultado = { emails_lidos: 0, nfes_salvas: 0, duplicados: 0, erros: [] }
      for (let rodada = 0; rodada < 4; rodada++) {
        const data = await chamarSync(30, 15)
        acumulado = {
          emails_lidos: acumulado.emails_lidos + data.emails_lidos,
          nfes_salvas: acumulado.nfes_salvas + data.nfes_salvas,
          duplicados: acumulado.duplicados + data.duplicados,
          erros: [...acumulado.erros, ...data.erros],
          detalhes: [...(acumulado.detalhes ?? []), ...(data.detalhes ?? [])],
        }
        setSyncResultado({ ...acumulado })
        if (data.emails_lidos === 0) break
      }
    } catch (e: unknown) {
      setSyncErro(e instanceof Error ? e.message : String(e))
    } finally {
      setSincronizando(false)
    }
  }

  async function limparDados() {
    if (!confirm('Apaga todas as NF-es e movimentações originadas de email. Movimentações manuais serão preservadas. Confirmar?')) return
    setLimpandoSync(true)
    setSyncResultado(null)
    setSyncErro(null)
    try {
      const resetRes = await fetch('/api/admin/reset-sync', { method: 'POST' })
      const resetData = await parseResposta(resetRes) as { ok?: boolean; erros?: string[]; contagens?: Record<string, number> }
      if (!resetRes.ok || !resetData.ok) throw new Error(resetData.erros?.join(', ') || `Erro ao limpar dados (HTTP ${resetRes.status})`)
      setSyncErro(null)
      setSyncResultado({ emails_lidos: 0, nfes_salvas: 0, duplicados: resetData.contagens?.movimentacoes ?? 0, erros: ['Dados limpos. Clique em "Sincronizar emails" para reimportar.'] })
    } catch (e: unknown) {
      setSyncErro(e instanceof Error ? e.message : String(e))
    } finally {
      setLimpandoSync(false)
    }
  }

  const carregar = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/clientes')
      const data = await res.json()
      setClientes(Array.isArray(data) ? data : [])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { carregar() }, [carregar])

  async function carregarProdutos(clienteId: string) {
    const res = await fetch(`/api/clientes/${clienteId}/produtos`)
    const data = await res.json()
    setClienteProdutos(prev => ({ ...prev, [clienteId]: Array.isArray(data) ? data : [] }))
  }

  function iniciarEdicao(c: Cliente) {
    setEditando(prev => ({
      ...prev,
      [c.id]: {
        nome_fantasia: c.nome_fantasia,
        nome: c.nome,
        cnpj: c.cnpj,
        valor_pallet: String(c.valor_pallet),
        aliquota_imposto: String(c.aliquota_imposto),
        regra_fator_pallet: String(c.regra_fator_pallet),
        email_remetente: c.email_remetente || '',
        cobrar_manuseio: c.cobrar_manuseio ?? true,
      },
    }))
    carregarProdutos(c.id)
  }

  function cancelarEdicao(id: string) {
    setEditando(prev => { const n = { ...prev }; delete n[id]; return n })
    if (adicionandoProdCliente === id) setAdicionandoProdCliente(null)
  }

  async function salvarCliente(id: string) {
    const form = editando[id]
    if (!form) return
    setSalvando(prev => ({ ...prev, [id]: true }))
    try {
      const res = await fetch(`/api/clientes/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          nome_fantasia: form.nome_fantasia,
          nome: form.nome,
          cnpj: form.cnpj,
          valor_pallet: parseFloat(form.valor_pallet),
          aliquota_imposto: parseFloat(form.aliquota_imposto),
          regra_fator_pallet: parseFloat(form.regra_fator_pallet),
          email_remetente: form.email_remetente || null,
          cobrar_manuseio: form.cobrar_manuseio,
        }),
      })
      const data = await res.json()
      if (data.error) throw new Error(data.error)
      setClientes(prev => prev.map(c => c.id === id ? { ...c, ...data } : c))
      cancelarEdicao(id)
      setSalvou(prev => ({ ...prev, [id]: true }))
      setTimeout(() => setSalvou(prev => { const n = { ...prev }; delete n[id]; return n }), 2000)
    } catch (e: unknown) {
      alert('Erro ao salvar: ' + (e instanceof Error ? e.message : String(e)))
    } finally {
      setSalvando(prev => ({ ...prev, [id]: false }))
    }
  }

  async function salvarPortal(clienteId: string) {
    const form = portalEdit[clienteId]
    if (!form) return
    if (form.senha !== form.confirm) { alert('As senhas não coincidem.'); return }
    setSalvandoPortal(prev => ({ ...prev, [clienteId]: true }))
    try {
      const res = await fetch(`/api/clientes/${clienteId}/portal`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ usuario: form.usuario, senha: form.senha }),
      })
      const data = await res.json()
      if (data.error) throw new Error(data.error)
      setClientes(prev => prev.map(c => c.id === clienteId ? { ...c, portal_usuario: data.portal_usuario } : c))
      setPortalEdit(prev => { const n = { ...prev }; delete n[clienteId]; return n })
    } catch (e: unknown) {
      alert('Erro: ' + (e instanceof Error ? e.message : String(e)))
    } finally {
      setSalvandoPortal(prev => ({ ...prev, [clienteId]: false }))
    }
  }

  async function removerPortal(clienteId: string) {
    if (!confirm('Remover acesso ao portal deste cliente?')) return
    try {
      const res = await fetch(`/api/clientes/${clienteId}/portal`, { method: 'DELETE' })
      const data = await res.json()
      if (data.error) throw new Error(data.error)
      setClientes(prev => prev.map(c => c.id === clienteId ? { ...c, portal_usuario: null } : c))
    } catch (e: unknown) {
      alert('Erro: ' + (e instanceof Error ? e.message : String(e)))
    }
  }

  async function criarCliente() {
    if (!formNovo.nome_fantasia && !formNovo.nome) {
      alert('Informe ao menos o nome ou nome fantasia.')
      return
    }
    setCriando(true)
    try {
      const res = await fetch('/api/clientes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          nome_fantasia: formNovo.nome_fantasia,
          nome: formNovo.nome,
          cnpj: formNovo.cnpj,
          valor_pallet: parseFloat(formNovo.valor_pallet),
          aliquota_imposto: parseFloat(formNovo.aliquota_imposto),
          regra_fator_pallet: parseFloat(formNovo.regra_fator_pallet),
          email_remetente: formNovo.email_remetente || null,
        }),
      })
      const data = await res.json()
      if (data.error) throw new Error(data.error)

      // Criar produtos cadastrados no modal
      for (const prod of novosProdutos) {
        if (!prod.nome) continue
        await fetch(`/api/clientes/${data.id}/produtos`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            nome: prod.nome,
            codigo_ncm: prod.codigo_ncm || null,
            palavras_chave: prod.palavras_chave || null,
            valor_pallet: parseFloat(prod.valor_pallet),
            aliquota_imposto: parseFloat(prod.aliquota_imposto),
            regra_fator_pallet: parseFloat(prod.regra_fator_pallet),
          }),
        })
      }

      setClientes(prev => [...prev, data])
      setNovoCliente(false)
      setFormNovo(formVazio)
      setNovosProdutos([])
    } catch (e: unknown) {
      alert('Erro ao criar cliente: ' + (e instanceof Error ? e.message : String(e)))
    } finally {
      setCriando(false)
    }
  }

  async function adicionarProduto(clienteId: string) {
    if (!novoProdFormEd.nome) { alert('Informe o nome da categoria.'); return }
    setSalvandoNovoProd(true)
    try {
      const res = await fetch(`/api/clientes/${clienteId}/produtos`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          nome: novoProdFormEd.nome,
          codigo_ncm: novoProdFormEd.codigo_ncm || null,
          palavras_chave: novoProdFormEd.palavras_chave || null,
          valor_pallet: parseFloat(novoProdFormEd.valor_pallet),
          aliquota_imposto: parseFloat(novoProdFormEd.aliquota_imposto),
          regra_fator_pallet: parseFloat(novoProdFormEd.regra_fator_pallet),
          categoria: novoProdFormEd.categoria || 'pa',
        }),
      })
      const data = await res.json()
      if (data.error) throw new Error(data.error)
      setClienteProdutos(prev => ({ ...prev, [clienteId]: [...(prev[clienteId] ?? []), data] }))
      setAdicionandoProdCliente(null)
      setNovoProdFormEd(prodVazio)
    } catch (e: unknown) {
      alert('Erro ao adicionar categoria: ' + (e instanceof Error ? e.message : String(e)))
    } finally {
      setSalvandoNovoProd(false)
    }
  }

  function iniciarEditarProduto(prod: ClienteProduto) {
    setEditProdutoForm(prev => ({
      ...prev,
      [prod.id]: {
        nome: prod.nome,
        codigo_ncm: prod.codigo_ncm || '',
        palavras_chave: prod.palavras_chave || '',
        valor_pallet: String(prod.valor_pallet),
        aliquota_imposto: String(prod.aliquota_imposto),
        regra_fator_pallet: String(prod.regra_fator_pallet),
        categoria: prod.categoria || 'pa',
      },
    }))
  }

  async function salvarProduto(clienteId: string, prodId: string) {
    const form = editProdutoForm[prodId]
    if (!form) return
    setSalvandoProd(prev => ({ ...prev, [prodId]: true }))
    try {
      const res = await fetch(`/api/clientes/${clienteId}/produtos/${prodId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          nome: form.nome,
          codigo_ncm: form.codigo_ncm || null,
          palavras_chave: form.palavras_chave || null,
          valor_pallet: parseFloat(form.valor_pallet),
          aliquota_imposto: parseFloat(form.aliquota_imposto),
          regra_fator_pallet: parseFloat(form.regra_fator_pallet),
          categoria: form.categoria || 'pa',
        }),
      })
      const data = await res.json()
      if (data.error) throw new Error(data.error)
      setClienteProdutos(prev => ({
        ...prev,
        [clienteId]: (prev[clienteId] ?? []).map(p => p.id === prodId ? data : p),
      }))
      setEditProdutoForm(prev => { const n = { ...prev }; delete n[prodId]; return n })
    } catch (e: unknown) {
      alert('Erro ao salvar categoria: ' + (e instanceof Error ? e.message : String(e)))
    } finally {
      setSalvandoProd(prev => ({ ...prev, [prodId]: false }))
    }
  }

  async function deletarProduto(clienteId: string, prodId: string) {
    if (!confirm('Excluir esta categoria?')) return
    try {
      const res = await fetch(`/api/clientes/${clienteId}/produtos/${prodId}`, { method: 'DELETE' })
      const data = await res.json()
      if (data.error) throw new Error(data.error)
      setClienteProdutos(prev => ({
        ...prev,
        [clienteId]: (prev[clienteId] ?? []).filter(p => p.id !== prodId),
      }))
    } catch (e: unknown) {
      alert('Erro ao excluir categoria: ' + (e instanceof Error ? e.message : String(e)))
    }
  }

  return (
    <main className="max-w-[1100px] mx-auto px-6 py-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-[#0d1b2e]">Configurações</h1>
        <p className="text-sm text-gray-400 mt-1">Gerenciar clientes e parâmetros comerciais</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_300px] gap-6">

        {/* Clientes */}
        <div className="flex flex-col gap-4">
          <div className="bg-white rounded-2xl border border-gray-100 p-6">
            <div className="flex items-center justify-between mb-5">
              <h2 className="font-semibold text-[#0d1b2e]">Clientes Cadastrados</h2>
              <button
                onClick={() => { setNovoCliente(true); setFormNovo(formVazio); setNovosProdutos([]) }}
                className="inline-flex items-center gap-2 bg-[#0d1b2e] text-white text-sm font-semibold px-4 py-2 rounded-xl hover:bg-[#1a3a5c] transition-colors"
              >
                <Plus className="w-4 h-4" /> Novo cliente
              </button>
            </div>

            {loading ? (
              <div className="flex items-center justify-center py-10 text-gray-400">
                <Loader2 className="w-5 h-5 animate-spin mr-2" /> Carregando...
              </div>
            ) : clientes.length === 0 ? (
              <p className="text-sm text-gray-400 text-center py-8">Nenhum cliente cadastrado.</p>
            ) : (
              <div className="flex flex-col gap-4">
                {clientes.map(cliente => {
                  const form = editando[cliente.id]
                  const isSalvando = salvando[cliente.id]
                  const isSalvou = salvou[cliente.id]
                  const produtos = clienteProdutos[cliente.id] ?? []

                  return (
                    <div key={cliente.id} className="border border-gray-100 rounded-2xl p-4">
                      <div className="flex items-center justify-between mb-3">
                        <div className="flex items-center gap-3">
                          <div className="w-10 h-10 rounded-xl bg-[#0d1b2e] flex items-center justify-center text-white font-bold shrink-0">
                            {(cliente.nome_fantasia || cliente.nome).slice(0, 2).toUpperCase()}
                          </div>
                          <div>
                            <p className="font-semibold text-[#0d1b2e]">{cliente.nome_fantasia || cliente.nome}</p>
                            <p className="text-xs text-gray-400">{cliente.cnpj || 'Sem CNPJ'}</p>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          {isSalvou && (
                            <span className="flex items-center gap-1 text-emerald-600 text-xs font-medium">
                              <Check className="w-3 h-3" /> Salvo
                            </span>
                          )}
                          {form ? (
                            <>
                              <button
                                onClick={() => cancelarEdicao(cliente.id)}
                                className="text-xs text-gray-500 hover:text-gray-700 px-3 py-1.5 rounded-lg border border-gray-200 hover:bg-gray-50"
                              >
                                Cancelar
                              </button>
                              <button
                                onClick={() => salvarCliente(cliente.id)}
                                disabled={isSalvando}
                                className="flex items-center gap-1.5 text-xs bg-[#0d1b2e] text-white px-3 py-1.5 rounded-lg hover:bg-[#1a3a5c] disabled:opacity-60"
                              >
                                {isSalvando ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />}
                                Salvar
                              </button>
                            </>
                          ) : (
                            <button
                              onClick={() => iniciarEdicao(cliente)}
                              className="text-xs text-gray-500 hover:text-gray-700 px-3 py-1.5 rounded-lg border border-gray-200 hover:bg-gray-50"
                            >
                              Editar
                            </button>
                          )}
                        </div>
                      </div>

                      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                        {form ? (
                          <>
                            <div>
                              <label className="text-xs text-gray-400 block mb-1">Nome fantasia</label>
                              <input
                                value={form.nome_fantasia}
                                onChange={e => setEditando(prev => ({ ...prev, [cliente.id]: { ...prev[cliente.id], nome_fantasia: e.target.value } }))}
                                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm text-[#0d1b2e] focus:outline-none focus:ring-2 focus:ring-[#0d1b2e]/10"
                              />
                            </div>
                            <div>
                              <label className="text-xs text-gray-400 block mb-1">Valor/pallet (R$)</label>
                              <input
                                type="number"
                                step="0.01"
                                value={form.valor_pallet}
                                onChange={e => setEditando(prev => ({ ...prev, [cliente.id]: { ...prev[cliente.id], valor_pallet: e.target.value } }))}
                                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm text-[#0d1b2e] focus:outline-none focus:ring-2 focus:ring-[#0d1b2e]/10"
                              />
                            </div>
                            <div>
                              <label className="text-xs text-gray-400 block mb-1">Imposto (%)</label>
                              <input
                                type="number"
                                step="0.01"
                                value={form.aliquota_imposto}
                                onChange={e => setEditando(prev => ({ ...prev, [cliente.id]: { ...prev[cliente.id], aliquota_imposto: e.target.value } }))}
                                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm text-[#0d1b2e] focus:outline-none focus:ring-2 focus:ring-[#0d1b2e]/10"
                              />
                            </div>
                            <div>
                              <label className="text-xs text-gray-400 block mb-1">Fator pallet (ton)</label>
                              <input
                                type="number"
                                step="0.1"
                                value={form.regra_fator_pallet}
                                onChange={e => setEditando(prev => ({ ...prev, [cliente.id]: { ...prev[cliente.id], regra_fator_pallet: e.target.value } }))}
                                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm text-[#0d1b2e] focus:outline-none focus:ring-2 focus:ring-[#0d1b2e]/10"
                              />
                            </div>
                            <div>
                              <label className="text-xs text-gray-400 block mb-1">CNPJ</label>
                              <input
                                value={form.cnpj}
                                onChange={e => setEditando(prev => ({ ...prev, [cliente.id]: { ...prev[cliente.id], cnpj: e.target.value } }))}
                                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm text-[#0d1b2e] focus:outline-none focus:ring-2 focus:ring-[#0d1b2e]/10"
                              />
                            </div>
                            <div className="sm:col-span-2">
                              <label className="text-xs text-gray-400 block mb-1">Email/domínio do remetente</label>
                              <input
                                type="text"
                                placeholder="empresa.com ou joao@empresa.com"
                                value={form.email_remetente}
                                onChange={e => setEditando(prev => ({ ...prev, [cliente.id]: { ...prev[cliente.id], email_remetente: e.target.value } }))}
                                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm text-[#0d1b2e] focus:outline-none focus:ring-2 focus:ring-[#0d1b2e]/10"
                              />
                              <p className="text-xs text-gray-400 mt-1">Usado para identificar o cliente quando o CNPJ não constar na NF-e.</p>
                            </div>
                            <div className="sm:col-span-3 flex items-center gap-3 pt-1">
                              <button
                                type="button"
                                onClick={() => setEditando(prev => ({ ...prev, [cliente.id]: { ...prev[cliente.id], cobrar_manuseio: !prev[cliente.id].cobrar_manuseio } }))}
                                className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors ${form.cobrar_manuseio ? 'bg-[#0d1b2e]' : 'bg-gray-200'}`}
                              >
                                <span className={`pointer-events-none inline-block h-4 w-4 rounded-full bg-white shadow-sm transition-transform ${form.cobrar_manuseio ? 'translate-x-4' : 'translate-x-0'}`} />
                              </button>
                              <span className="text-xs text-gray-600">Cobrar manuseio para este cliente</span>
                            </div>
                          </>
                        ) : (
                          <>
                            <div className="bg-gray-50 rounded-lg p-3">
                              <p className="text-xs text-gray-400">Valor/pallet</p>
                              <p className="font-semibold text-[#0d1b2e] mt-0.5">
                                R$ {Number(cliente.valor_pallet).toFixed(2)}
                              </p>
                            </div>
                            <div className="bg-gray-50 rounded-lg p-3">
                              <p className="text-xs text-gray-400">Imposto</p>
                              <p className="font-semibold text-[#0d1b2e] mt-0.5">{cliente.aliquota_imposto}%</p>
                            </div>
                            <div className="bg-gray-50 rounded-lg p-3">
                              <p className="text-xs text-gray-400">Fator pallet</p>
                              <p className="font-semibold text-[#0d1b2e] mt-0.5">1/{cliente.regra_fator_pallet} ton</p>
                            </div>
                            {cliente.email_remetente && (
                              <div className="bg-gray-50 rounded-lg p-3 sm:col-span-3">
                                <p className="text-xs text-gray-400">Email/domínio remetente</p>
                                <p className="font-semibold text-[#0d1b2e] mt-0.5 font-mono text-xs">{cliente.email_remetente}</p>
                              </div>
                            )}
                          </>
                        )}
                      </div>

                      {/* Seção de produtos (visível no modo edição) */}
                      {form && (
                        <div className="mt-4 pt-4 border-t border-gray-100">
                          <div className="flex items-center justify-between mb-3">
                            <div className="flex items-center gap-2">
                              <Package className="w-3.5 h-3.5 text-gray-400" />
                              <span className="text-xs font-medium text-gray-600">Categorias de Produto</span>
                              <span className="text-xs text-gray-400">— NCM ou palavras-chave para identificação automática na NF-e</span>
                            </div>
                            {adicionandoProdCliente !== cliente.id && (
                              <button
                                onClick={() => { setAdicionandoProdCliente(cliente.id); setNovoProdFormEd(prodVazio) }}
                                className="flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-lg border border-blue-200 text-blue-600 hover:bg-blue-50 transition-colors"
                              >
                                <Plus size={11} /> Adicionar categoria
                              </button>
                            )}
                          </div>

                          {produtos.length > 0 && (
                            <div className="flex flex-col gap-2 mb-3">
                              {/* Cabeçalho */}
                              <div className="grid grid-cols-[1fr_100px_1fr_90px_70px_60px_70px_auto] gap-2 px-2">
                                <span className="text-xs text-gray-400">Nome</span>
                                <span className="text-xs text-gray-400">NCM</span>
                                <span className="text-xs text-gray-400">Palavras-chave</span>
                                <span className="text-xs text-gray-400">Categoria</span>
                                <span className="text-xs text-gray-400">R$/pallet</span>
                                <span className="text-xs text-gray-400">Imp.%</span>
                                <span className="text-xs text-gray-400">Fator</span>
                                <span />
                              </div>

                              {produtos.map(prod => {
                                const ef = editProdutoForm[prod.id]
                                return (
                                  <div key={prod.id} className="bg-gray-50 rounded-lg px-2 py-2">
                                    {ef ? (
                                      <div className="flex flex-col gap-2">
                                        <div className="grid grid-cols-[1fr_100px_1fr_90px_70px_60px_70px] gap-2">
                                          <input
                                            value={ef.nome}
                                            onChange={e => setEditProdutoForm(p => ({ ...p, [prod.id]: { ...p[prod.id], nome: e.target.value } }))}
                                            placeholder="Nome"
                                            className="border border-gray-200 rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-[#0d1b2e]/20"
                                          />
                                          <input
                                            value={ef.codigo_ncm}
                                            onChange={e => setEditProdutoForm(p => ({ ...p, [prod.id]: { ...p[prod.id], codigo_ncm: e.target.value } }))}
                                            placeholder="NCM"
                                            className="border border-gray-200 rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-[#0d1b2e]/20"
                                          />
                                          <input
                                            value={ef.palavras_chave}
                                            onChange={e => setEditProdutoForm(p => ({ ...p, [prod.id]: { ...p[prod.id], palavras_chave: e.target.value } }))}
                                            placeholder="soja, farelo de soja"
                                            className="border border-gray-200 rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-[#0d1b2e]/20"
                                          />
                                          <select
                                            value={ef.categoria}
                                            onChange={e => setEditProdutoForm(p => ({ ...p, [prod.id]: { ...p[prod.id], categoria: e.target.value } }))}
                                            className="border border-gray-200 rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-[#0d1b2e]/20"
                                          >
                                            {CATEGORIAS_PRODUTO.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
                                          </select>
                                          <input
                                            type="number" step="0.01"
                                            value={ef.valor_pallet}
                                            onChange={e => setEditProdutoForm(p => ({ ...p, [prod.id]: { ...p[prod.id], valor_pallet: e.target.value } }))}
                                            className="border border-gray-200 rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-[#0d1b2e]/20"
                                          />
                                          <input
                                            type="number" step="0.01"
                                            value={ef.aliquota_imposto}
                                            onChange={e => setEditProdutoForm(p => ({ ...p, [prod.id]: { ...p[prod.id], aliquota_imposto: e.target.value } }))}
                                            className="border border-gray-200 rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-[#0d1b2e]/20"
                                          />
                                          <input
                                            type="number" step="0.1"
                                            value={ef.regra_fator_pallet}
                                            onChange={e => setEditProdutoForm(p => ({ ...p, [prod.id]: { ...p[prod.id], regra_fator_pallet: e.target.value } }))}
                                            className="border border-gray-200 rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-[#0d1b2e]/20"
                                          />
                                        </div>
                                        <div className="flex justify-end gap-2">
                                          <button
                                            onClick={() => setEditProdutoForm(p => { const n = { ...p }; delete n[prod.id]; return n })}
                                            className="text-xs text-gray-500 px-2.5 py-1 rounded border border-gray-200 hover:bg-white"
                                          >
                                            Cancelar
                                          </button>
                                          <button
                                            onClick={() => salvarProduto(cliente.id, prod.id)}
                                            disabled={salvandoProd[prod.id]}
                                            className="flex items-center gap-1 text-xs bg-[#0d1b2e] text-white px-2.5 py-1 rounded hover:bg-[#1a3a5c] disabled:opacity-60"
                                          >
                                            {salvandoProd[prod.id] ? <Loader2 size={10} className="animate-spin" /> : <Save size={10} />}
                                            Salvar
                                          </button>
                                        </div>
                                      </div>
                                    ) : (
                                      <div className="grid grid-cols-[1fr_100px_1fr_90px_70px_60px_70px_auto] gap-2 items-center">
                                        <span className="text-xs font-medium text-[#0d1b2e] truncate">{prod.nome}</span>
                                        <span className="text-xs text-gray-500 font-mono truncate">{prod.codigo_ncm || '—'}</span>
                                        <span className="text-xs text-gray-500 truncate">{prod.palavras_chave || '—'}</span>
                                        <span className="text-xs text-indigo-600 font-medium truncate">{CATEGORIAS_PRODUTO.find(c => c.value === prod.categoria)?.label || prod.categoria}</span>
                                        <span className="text-xs text-gray-700">R$ {Number(prod.valor_pallet).toFixed(2)}</span>
                                        <span className="text-xs text-gray-700">{prod.aliquota_imposto}%</span>
                                        <span className="text-xs text-gray-700">1/{prod.regra_fator_pallet}t</span>
                                        <div className="flex items-center gap-1">
                                          <button
                                            onClick={() => iniciarEditarProduto(prod)}
                                            className="text-xs text-gray-500 px-2 py-1 rounded border border-gray-200 hover:bg-white hover:text-gray-700"
                                          >
                                            Editar
                                          </button>
                                          <button
                                            onClick={() => deletarProduto(cliente.id, prod.id)}
                                            className="p-1 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded transition-colors"
                                          >
                                            <Trash2 size={12} />
                                          </button>
                                        </div>
                                      </div>
                                    )}
                                  </div>
                                )
                              })}
                            </div>
                          )}

                          {/* Form de adicionar produto */}
                          {adicionandoProdCliente === cliente.id && (
                            <div className="bg-blue-50 border border-blue-100 rounded-lg p-3 flex flex-col gap-2">
                              <p className="text-xs font-medium text-blue-700 mb-1">Nova categoria de produto</p>
                              <div className="grid grid-cols-[1fr_110px] gap-2">
                                <div>
                                  <label className="text-xs text-gray-500 block mb-1">Nome *</label>
                                  <input
                                    value={novoProdFormEd.nome}
                                    onChange={e => setNovoProdFormEd(f => ({ ...f, nome: e.target.value }))}
                                    placeholder="Ex: Soja em grão"
                                    className="w-full border border-gray-200 rounded px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-blue-300"
                                  />
                                </div>
                                <div>
                                  <label className="text-xs text-gray-500 block mb-1">NCM</label>
                                  <input
                                    value={novoProdFormEd.codigo_ncm}
                                    onChange={e => setNovoProdFormEd(f => ({ ...f, codigo_ncm: e.target.value }))}
                                    placeholder="1201.10.00"
                                    className="w-full border border-gray-200 rounded px-2 py-1.5 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-blue-300"
                                  />
                                </div>
                              </div>
                              <div>
                                <label className="text-xs text-gray-500 block mb-1">Categoria</label>
                                <select
                                  value={novoProdFormEd.categoria}
                                  onChange={e => setNovoProdFormEd(f => ({ ...f, categoria: e.target.value }))}
                                  className="w-full border border-gray-200 rounded px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-blue-300"
                                >
                                  {CATEGORIAS_PRODUTO.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
                                </select>
                              </div>
                              <div>
                                <label className="text-xs text-gray-500 block mb-1">Palavras-chave para identificação (separadas por vírgula)</label>
                                <input
                                  value={novoProdFormEd.palavras_chave}
                                  onChange={e => setNovoProdFormEd(f => ({ ...f, palavras_chave: e.target.value }))}
                                  placeholder="Ex: soja, farelo de soja, grão de soja"
                                  className="w-full border border-gray-200 rounded px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-blue-300"
                                />
                              </div>
                              <div className="grid grid-cols-3 gap-2">
                                <div>
                                  <label className="text-xs text-gray-500 block mb-1">Valor/pallet (R$)</label>
                                  <input
                                    type="number" step="0.01"
                                    value={novoProdFormEd.valor_pallet}
                                    onChange={e => setNovoProdFormEd(f => ({ ...f, valor_pallet: e.target.value }))}
                                    className="w-full border border-gray-200 rounded px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-blue-300"
                                  />
                                </div>
                                <div>
                                  <label className="text-xs text-gray-500 block mb-1">Imposto (%)</label>
                                  <input
                                    type="number" step="0.01"
                                    value={novoProdFormEd.aliquota_imposto}
                                    onChange={e => setNovoProdFormEd(f => ({ ...f, aliquota_imposto: e.target.value }))}
                                    className="w-full border border-gray-200 rounded px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-blue-300"
                                  />
                                </div>
                                <div>
                                  <label className="text-xs text-gray-500 block mb-1">Fator pallet</label>
                                  <input
                                    type="number" step="0.1"
                                    value={novoProdFormEd.regra_fator_pallet}
                                    onChange={e => setNovoProdFormEd(f => ({ ...f, regra_fator_pallet: e.target.value }))}
                                    className="w-full border border-gray-200 rounded px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-blue-300"
                                  />
                                </div>
                              </div>
                              <div className="flex justify-end gap-2 mt-1">
                                <button
                                  onClick={() => setAdicionandoProdCliente(null)}
                                  className="text-xs px-3 py-1.5 rounded-lg border border-gray-200 text-gray-500 hover:bg-white"
                                >
                                  Cancelar
                                </button>
                                <button
                                  onClick={() => adicionarProduto(cliente.id)}
                                  disabled={salvandoNovoProd}
                                  className="flex items-center gap-1.5 text-xs bg-blue-600 text-white px-3 py-1.5 rounded-lg hover:bg-blue-700 disabled:opacity-60"
                                >
                                  {salvandoNovoProd ? <Loader2 size={11} className="animate-spin" /> : <Plus size={11} />}
                                  Salvar categoria
                                </button>
                              </div>
                            </div>
                          )}

                          {produtos.length === 0 && adicionandoProdCliente !== cliente.id && (
                            <p className="text-xs text-gray-400 italic">Nenhuma categoria cadastrada. Os valores padrão do cliente serão usados em todas as NF-es.</p>
                          )}
                        </div>
                      )}

                      {/* Portal do cliente */}
                      <div className="mt-3 pt-3 border-t border-gray-100">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <KeyRound className="w-3.5 h-3.5 text-gray-400" />
                            <span className="text-xs font-medium text-gray-500">Acesso ao Portal</span>
                            {cliente.portal_usuario ? (
                              <span className="text-xs bg-emerald-50 text-emerald-700 border border-emerald-200 px-2 py-0.5 rounded-full font-mono">
                                {cliente.portal_usuario}
                              </span>
                            ) : (
                              <span className="text-xs text-gray-400">Sem acesso configurado</span>
                            )}
                          </div>
                          <div className="flex items-center gap-1">
                            {cliente.portal_usuario && (
                              <button
                                onClick={() => removerPortal(cliente.id)}
                                title="Remover acesso"
                                className="p-1 rounded-md text-gray-400 hover:text-red-500 hover:bg-red-50 transition-colors"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            )}
                            <button
                              onClick={() => setPortalEdit(prev =>
                                prev[cliente.id]
                                  ? (({ [cliente.id]: _, ...rest }) => rest)(prev)
                                  : { ...prev, [cliente.id]: { usuario: cliente.portal_usuario || '', senha: '', confirm: '' } }
                              )}
                              className="text-xs px-2.5 py-1 rounded-lg border border-gray-200 text-gray-500 hover:bg-gray-50 transition-colors"
                            >
                              {portalEdit[cliente.id] ? 'Cancelar' : cliente.portal_usuario ? 'Alterar' : 'Definir acesso'}
                            </button>
                          </div>
                        </div>

                        {portalEdit[cliente.id] && (
                          <div className="mt-3 grid grid-cols-1 sm:grid-cols-3 gap-3">
                            <div>
                              <label className="text-xs text-gray-400 block mb-1">Usuário</label>
                              <input
                                value={portalEdit[cliente.id].usuario}
                                onChange={e => setPortalEdit(prev => ({ ...prev, [cliente.id]: { ...prev[cliente.id], usuario: e.target.value } }))}
                                placeholder="ex: empresa.abc"
                                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-[#0d1b2e]/10"
                              />
                            </div>
                            <div>
                              <label className="text-xs text-gray-400 block mb-1">Senha</label>
                              <div className="relative">
                                <input
                                  type={mostrarSenha[cliente.id] ? 'text' : 'password'}
                                  value={portalEdit[cliente.id].senha}
                                  onChange={e => setPortalEdit(prev => ({ ...prev, [cliente.id]: { ...prev[cliente.id], senha: e.target.value } }))}
                                  placeholder="mín. 6 caracteres"
                                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm pr-8 focus:outline-none focus:ring-2 focus:ring-[#0d1b2e]/10"
                                />
                                <button
                                  type="button"
                                  onClick={() => setMostrarSenha(prev => ({ ...prev, [cliente.id]: !prev[cliente.id] }))}
                                  className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                                >
                                  {mostrarSenha[cliente.id] ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                                </button>
                              </div>
                            </div>
                            <div>
                              <label className="text-xs text-gray-400 block mb-1">Confirmar senha</label>
                              <input
                                type="password"
                                value={portalEdit[cliente.id].confirm}
                                onChange={e => setPortalEdit(prev => ({ ...prev, [cliente.id]: { ...prev[cliente.id], confirm: e.target.value } }))}
                                placeholder="repita a senha"
                                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0d1b2e]/10"
                              />
                            </div>
                            <div className="sm:col-span-3 flex justify-end">
                              <button
                                onClick={() => salvarPortal(cliente.id)}
                                disabled={salvandoPortal[cliente.id] || !portalEdit[cliente.id].usuario || !portalEdit[cliente.id].senha}
                                className="flex items-center gap-1.5 text-xs bg-[#0d1b2e] text-white px-3 py-1.5 rounded-lg hover:bg-[#1a3a5c] disabled:opacity-50 transition-colors"
                              >
                                {salvandoPortal[cliente.id] ? <Loader2 className="w-3 h-3 animate-spin" /> : <KeyRound className="w-3 h-3" />}
                                Salvar acesso
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </div>

        {/* Coluna direita: fórmulas */}
        <div className="flex flex-col gap-4">
          <div className="bg-[#0d1b2e] rounded-2xl p-5 text-white">
            <h2 className="font-semibold text-blue-200 text-sm uppercase tracking-wider mb-4">Fórmulas do Sistema</h2>
            <div className="flex flex-col gap-3 text-sm">
              <div>
                <p className="text-blue-300 text-xs mb-1">Conversão ton → pallets</p>
                <p className="font-mono bg-white/10 rounded-lg px-3 py-2">ceil(ton / fator)</p>
              </div>
              <div>
                <p className="text-blue-300 text-xs mb-1">Saldo final do mês</p>
                <p className="font-mono bg-white/10 rounded-lg px-3 py-2">inicial + entradas − saídas</p>
              </div>
              <div>
                <p className="text-blue-300 text-xs mb-1">PP Pico</p>
                <p className="font-mono bg-white/10 rounded-lg px-3 py-2">max(saldo simulado no mês)</p>
              </div>
              <div>
                <p className="text-blue-300 text-xs mb-1">Armazenagem s/ imposto</p>
                <p className="font-mono bg-white/10 rounded-lg px-3 py-2">pp_pico × valor_pallet</p>
              </div>
              <div>
                <p className="text-blue-300 text-xs mb-1">Armazenagem c/ imposto</p>
                <p className="font-mono bg-white/10 rounded-lg px-3 py-2">base × (1 + aliquota%)</p>
              </div>
              <div>
                <p className="text-blue-300 text-xs mb-1">Manuseio</p>
                <p className="font-mono bg-white/10 rounded-lg px-3 py-2">pallets_mov × valor_manuseio</p>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-2xl border border-gray-100 p-5">
            <h3 className="font-semibold text-[#0d1b2e] text-sm mb-3">Propagação de Estoque</h3>
            <p className="text-xs text-gray-500 leading-relaxed">
              O estoque inicial de cada mês é definido manualmente na página do cliente.
              Se não informado, o sistema calcula automaticamente com base no saldo final do mês anterior:
            </p>
            <p className="font-mono text-xs bg-gray-50 rounded-lg px-3 py-2 mt-2 text-[#0d1b2e]">
              vol_inicial(N) = vol_inicial(N-1) + entradas(N-1) − saídas(N-1)
            </p>
          </div>

          {/* Painel de sincronização */}
          <div className="bg-white rounded-2xl border border-gray-100 p-5">
            <h3 className="font-semibold text-[#0d1b2e] text-sm mb-1">Sincronização de Emails</h3>
            <p className="text-xs text-gray-400 mb-4">Busca NF-es nos últimos 30 dias na caixa xps.ai@exsa.srv.br</p>

            <div className="flex flex-col gap-2">
              <button
                onClick={sincronizarEmails}
                disabled={sincronizando || limpandoSync}
                className="flex items-center justify-center gap-2 w-full bg-[#0d1b2e] text-white text-sm font-semibold px-4 py-2.5 rounded-xl hover:bg-[#1a3a5c] disabled:opacity-60 transition-colors"
              >
                {sincronizando ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
                {sincronizando ? 'Sincronizando...' : 'Sincronizar emails'}
              </button>

              <button
                onClick={limparDados}
                disabled={sincronizando || limpandoSync}
                className="flex items-center justify-center gap-2 w-full bg-red-50 text-red-700 border border-red-200 text-sm font-semibold px-4 py-2.5 rounded-xl hover:bg-red-100 disabled:opacity-60 transition-colors"
              >
                {limpandoSync ? <Loader2 className="w-4 h-4 animate-spin" /> : <RotateCcw className="w-4 h-4" />}
                {limpandoSync ? 'Limpando...' : 'Limpar dados'}
              </button>
            </div>

            {syncErro && (
              <div className="mt-3 flex items-start gap-2 bg-red-50 border border-red-200 rounded-xl p-3">
                <AlertCircle className="w-4 h-4 text-red-500 shrink-0 mt-0.5" />
                <p className="text-xs text-red-700">{syncErro}</p>
              </div>
            )}

            {syncResultado && !syncErro && (
              <div className="mt-3 bg-emerald-50 border border-emerald-200 rounded-xl p-3">
                <div className="flex items-center gap-2 mb-2">
                  <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                  <p className="text-xs font-semibold text-emerald-800">Sincronização concluída</p>
                </div>
                <div className="grid grid-cols-3 gap-2 mb-2">
                  <div className="bg-white rounded-lg p-2 text-center">
                    <p className="text-lg font-bold text-[#0d1b2e]">{syncResultado.emails_lidos}</p>
                    <p className="text-xs text-gray-400">emails</p>
                  </div>
                  <div className="bg-white rounded-lg p-2 text-center">
                    <p className="text-lg font-bold text-emerald-700">{syncResultado.nfes_salvas}</p>
                    <p className="text-xs text-gray-400">NF-es novas</p>
                  </div>
                  <div className="bg-white rounded-lg p-2 text-center">
                    <p className="text-lg font-bold text-gray-500">{syncResultado.duplicados}</p>
                    <p className="text-xs text-gray-400">duplicadas</p>
                  </div>
                </div>
                {syncResultado.erros?.length > 0 && (
                  <div className="mt-2">
                    <p className="text-xs font-medium text-red-700 mb-1">Erros ({syncResultado.erros.length}):</p>
                    {syncResultado.erros.map((e, i) => (
                      <p key={i} className="text-xs text-red-600 font-mono truncate">{e}</p>
                    ))}
                  </div>
                )}
                {syncResultado.detalhes && syncResultado.detalhes.length > 0 && (
                  <div className="mt-2 border-t border-emerald-200 pt-2">
                    <p className="text-xs font-medium text-emerald-800 mb-1">Emails processados:</p>
                    {syncResultado.detalhes.map((d, i) => (
                      <div key={i} className="text-xs text-emerald-700 mb-1">
                        <span className="font-medium">{d.assunto || d.remetente}</span>
                        {d.nfes.map((n, j) => (
                          <span key={j} className="ml-2 text-emerald-600">
                            {n.nfe ? `NF ${n.nfe.numero}` : n.arquivo} {n.pallets != null ? `(${n.pallets}p)` : ''}
                          </span>
                        ))}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Modal novo cliente */}
      {novoCliente && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg mx-auto p-6 overflow-y-auto max-h-[90vh]">
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-lg font-bold text-[#0d1b2e]">Novo Cliente</h2>
              <button onClick={() => setNovoCliente(false)} className="text-gray-400 hover:text-gray-700">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="flex flex-col gap-3">
              <div>
                <label className="text-xs text-gray-500 mb-1 block">Nome fantasia *</label>
                <input
                  value={formNovo.nome_fantasia}
                  onChange={e => setFormNovo(f => ({ ...f, nome_fantasia: e.target.value }))}
                  placeholder="Ex: Alpha Lum"
                  className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0d1b2e]/10"
                />
              </div>
              <div>
                <label className="text-xs text-gray-500 mb-1 block">Razão social</label>
                <input
                  value={formNovo.nome}
                  onChange={e => setFormNovo(f => ({ ...f, nome: e.target.value }))}
                  placeholder="Ex: Alpha Lum Indústria e Comércio Ltda"
                  className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0d1b2e]/10"
                />
              </div>
              <div>
                <label className="text-xs text-gray-500 mb-1 block">CNPJ</label>
                <input
                  value={formNovo.cnpj}
                  onChange={e => setFormNovo(f => ({ ...f, cnpj: e.target.value }))}
                  placeholder="00.000.000/0000-00"
                  className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0d1b2e]/10"
                />
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="text-xs text-gray-500 mb-1 block">Valor/pallet (R$)</label>
                  <input
                    type="number"
                    step="0.01"
                    value={formNovo.valor_pallet}
                    onChange={e => setFormNovo(f => ({ ...f, valor_pallet: e.target.value }))}
                    className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0d1b2e]/10"
                  />
                </div>
                <div>
                  <label className="text-xs text-gray-500 mb-1 block">Imposto (%)</label>
                  <input
                    type="number"
                    step="0.01"
                    value={formNovo.aliquota_imposto}
                    onChange={e => setFormNovo(f => ({ ...f, aliquota_imposto: e.target.value }))}
                    className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0d1b2e]/10"
                  />
                </div>
                <div>
                  <label className="text-xs text-gray-500 mb-1 block">Fator pallet</label>
                  <input
                    type="number"
                    step="0.1"
                    value={formNovo.regra_fator_pallet}
                    onChange={e => setFormNovo(f => ({ ...f, regra_fator_pallet: e.target.value }))}
                    className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0d1b2e]/10"
                  />
                </div>
                <div className="col-span-3">
                  <label className="text-xs text-gray-500 font-medium block mb-1">Email/domínio do remetente</label>
                  <input
                    type="text"
                    placeholder="empresa.com ou joao@empresa.com"
                    value={formNovo.email_remetente}
                    onChange={e => setFormNovo(f => ({ ...f, email_remetente: e.target.value }))}
                    className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0d1b2e]/10"
                  />
                  <p className="text-xs text-gray-400 mt-1">Fallback para identificar o cliente quando o CNPJ não for encontrado na NF-e.</p>
                </div>
              </div>

              {/* Produtos do novo cliente */}
              <div className="border-t border-gray-100 pt-3 mt-1">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <Package className="w-3.5 h-3.5 text-gray-400" />
                    <label className="text-xs font-medium text-gray-600">Categorias de Produto (opcional)</label>
                  </div>
                  <button
                    onClick={() => setNovosProdutos(p => [...p, { ...prodVazio, valor_pallet: formNovo.valor_pallet, aliquota_imposto: formNovo.aliquota_imposto, regra_fator_pallet: formNovo.regra_fator_pallet }])}
                    className="flex items-center gap-1 text-xs px-2.5 py-1 rounded-lg border border-blue-200 text-blue-600 hover:bg-blue-50 transition-colors"
                  >
                    <Plus size={11} /> Adicionar
                  </button>
                </div>
                {novosProdutos.length === 0 && (
                  <p className="text-xs text-gray-400 italic">Sem categorias — o sistema usará os valores padrão acima para todas as NF-es.</p>
                )}
                {novosProdutos.map((prod, idx) => (
                  <div key={idx} className="bg-gray-50 rounded-xl p-3 flex flex-col gap-2 mb-2">
                    <div className="grid grid-cols-[1fr_110px] gap-2">
                      <div>
                        <label className="text-xs text-gray-500 block mb-1">Nome *</label>
                        <input
                          value={prod.nome}
                          onChange={e => setNovosProdutos(p => p.map((x, i) => i === idx ? { ...x, nome: e.target.value } : x))}
                          placeholder="Ex: Soja em grão"
                          className="w-full border border-gray-200 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-[#0d1b2e]/20"
                        />
                      </div>
                      <div>
                        <label className="text-xs text-gray-500 block mb-1">NCM</label>
                        <input
                          value={prod.codigo_ncm}
                          onChange={e => setNovosProdutos(p => p.map((x, i) => i === idx ? { ...x, codigo_ncm: e.target.value } : x))}
                          placeholder="1201.10.00"
                          className="w-full border border-gray-200 rounded-lg px-2 py-1.5 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-[#0d1b2e]/20"
                        />
                      </div>
                    </div>
                    <div>
                      <label className="text-xs text-gray-500 block mb-1">Palavras-chave (separadas por vírgula)</label>
                      <input
                        value={prod.palavras_chave}
                        onChange={e => setNovosProdutos(p => p.map((x, i) => i === idx ? { ...x, palavras_chave: e.target.value } : x))}
                        placeholder="Ex: soja, farelo de soja"
                        className="w-full border border-gray-200 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-[#0d1b2e]/20"
                      />
                    </div>
                    <div className="grid grid-cols-3 gap-2">
                      <div>
                        <label className="text-xs text-gray-500 block mb-1">R$/pallet</label>
                        <input
                          type="number" step="0.01"
                          value={prod.valor_pallet}
                          onChange={e => setNovosProdutos(p => p.map((x, i) => i === idx ? { ...x, valor_pallet: e.target.value } : x))}
                          className="w-full border border-gray-200 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-[#0d1b2e]/20"
                        />
                      </div>
                      <div>
                        <label className="text-xs text-gray-500 block mb-1">Imposto %</label>
                        <input
                          type="number" step="0.01"
                          value={prod.aliquota_imposto}
                          onChange={e => setNovosProdutos(p => p.map((x, i) => i === idx ? { ...x, aliquota_imposto: e.target.value } : x))}
                          className="w-full border border-gray-200 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-[#0d1b2e]/20"
                        />
                      </div>
                      <div>
                        <label className="text-xs text-gray-500 block mb-1">Fator pallet</label>
                        <input
                          type="number" step="0.1"
                          value={prod.regra_fator_pallet}
                          onChange={e => setNovosProdutos(p => p.map((x, i) => i === idx ? { ...x, regra_fator_pallet: e.target.value } : x))}
                          className="w-full border border-gray-200 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-[#0d1b2e]/20"
                        />
                      </div>
                    </div>
                    <button
                      onClick={() => setNovosProdutos(p => p.filter((_, i) => i !== idx))}
                      className="self-end flex items-center gap-1 text-xs text-red-500 hover:text-red-700"
                    >
                      <Trash2 size={11} /> Remover
                    </button>
                  </div>
                ))}
              </div>
            </div>
            <div className="flex justify-end gap-2 mt-6">
              <button
                onClick={() => setNovoCliente(false)}
                className="px-4 py-2 rounded-xl border border-gray-200 text-sm text-gray-600 hover:bg-gray-50"
              >
                Cancelar
              </button>
              <button
                onClick={criarCliente}
                disabled={criando}
                className="flex items-center gap-2 px-4 py-2 rounded-xl bg-[#0d1b2e] text-white text-sm font-semibold hover:bg-[#1a3a5c] disabled:opacity-60"
              >
                {criando ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                Criar cliente
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  )
}

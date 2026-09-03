'use client'

import { useEffect, useState, useCallback } from 'react'
import Link from 'next/link'
import { ArrowLeft, Plus, Loader2, UserCog, Trash2, KeyRound, Ban, CheckCircle2 } from 'lucide-react'

interface Usuario {
  id: string
  nome: string
  email: string
  ativo: boolean
  created_at: string
}

const FORM_VAZIO = { nome: '', email: '', senha: '' }

export default function UsuariosPage() {
  const [usuarios, setUsuarios] = useState<Usuario[]>([])
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState<string | null>(null)
  const [novo, setNovo] = useState(false)
  const [form, setForm] = useState(FORM_VAZIO)
  const [salvando, setSalvando] = useState(false)
  const [editandoId, setEditandoId] = useState<string | null>(null)
  const [editForm, setEditForm] = useState({ nome: '', email: '', senha: '' })
  const [processandoId, setProcessandoId] = useState<string | null>(null)

  const carregar = useCallback(async () => {
    setCarregando(true)
    try {
      const res = await fetch('/api/admin/usuarios')
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Falha ao carregar usuários')
      setUsuarios(data)
    } catch (e: any) {
      setErro(e.message)
    } finally {
      setCarregando(false)
    }
  }, [])

  useEffect(() => { carregar() }, [carregar])

  async function criar() {
    if (!form.nome.trim() || !form.email.trim() || !form.senha) return
    setSalvando(true)
    setErro(null)
    try {
      const res = await fetch('/api/admin/usuarios', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Falha ao criar usuário')
      setUsuarios(prev => [...prev, data].sort((a, b) => a.nome.localeCompare(b.nome)))
      setForm(FORM_VAZIO)
      setNovo(false)
    } catch (e: any) {
      setErro(e.message)
    } finally {
      setSalvando(false)
    }
  }

  async function salvarEdicao(id: string) {
    setProcessandoId(id)
    setErro(null)
    try {
      const body: Record<string, unknown> = { nome: editForm.nome, email: editForm.email }
      if (editForm.senha) body.senha = editForm.senha
      const res = await fetch(`/api/admin/usuarios/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Falha ao salvar')
      setUsuarios(prev => prev.map(u => u.id === id ? data : u))
      setEditandoId(null)
    } catch (e: any) {
      setErro(e.message)
    } finally {
      setProcessandoId(null)
    }
  }

  async function alternarAtivo(u: Usuario) {
    setProcessandoId(u.id)
    setErro(null)
    try {
      const res = await fetch(`/api/admin/usuarios/${u.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ativo: !u.ativo }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Falha ao alterar')
      setUsuarios(prev => prev.map(x => x.id === u.id ? data : x))
    } catch (e: any) {
      setErro(e.message)
    } finally {
      setProcessandoId(null)
    }
  }

  async function excluir(id: string) {
    if (!confirm('Excluir este usuário definitivamente? Os logs já registrados permanecem.')) return
    setProcessandoId(id)
    setErro(null)
    try {
      const res = await fetch(`/api/admin/usuarios/${id}`, { method: 'DELETE' })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Falha ao excluir')
      setUsuarios(prev => prev.filter(u => u.id !== id))
    } catch (e: any) {
      setErro(e.message)
    } finally {
      setProcessandoId(null)
    }
  }

  return (
    <div className="max-w-4xl mx-auto px-6 py-8">
      <Link href="/configuracoes" className="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-800 mb-4">
        <ArrowLeft size={14} /> Configurações
      </Link>

      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-[#0d1b2e] flex items-center gap-2"><UserCog size={20} /> Usuários</h1>
          <p className="text-sm text-gray-400 mt-0.5">Contas com acesso administrativo ao dashboard. Toda alteração feita por um usuário fica registrada em <Link href="/configuracoes/logs" className="underline">Logs</Link>.</p>
        </div>
        <button
          onClick={() => { setNovo(v => !v); setForm(FORM_VAZIO) }}
          className="flex items-center gap-1.5 text-sm px-3 py-2 rounded-lg bg-[#0d1b2e] text-white hover:bg-[#1a2d47] transition-colors"
        >
          <Plus size={14} /> Novo usuário
        </button>
      </div>

      {erro && (
        <div className="bg-red-50 border border-red-100 rounded-xl px-4 py-2.5 text-sm text-red-600 mb-4">{erro}</div>
      )}

      {novo && (
        <div className="bg-white rounded-2xl border border-gray-100 p-5 mb-4">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-3">
            <input placeholder="Nome" value={form.nome} onChange={e => setForm(f => ({ ...f, nome: e.target.value }))}
              className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0d1b2e]/10" />
            <input placeholder="E-mail" type="email" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
              className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0d1b2e]/10" />
            <input placeholder="Senha (mín. 6 caracteres)" type="password" value={form.senha} onChange={e => setForm(f => ({ ...f, senha: e.target.value }))}
              className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0d1b2e]/10" />
          </div>
          <div className="flex items-center gap-2">
            <button onClick={criar} disabled={salvando} className="flex items-center gap-1.5 text-sm px-3 py-2 rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50">
              {salvando ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />} Criar
            </button>
            <button onClick={() => setNovo(false)} className="text-sm px-3 py-2 rounded-lg text-gray-500 hover:bg-gray-50">Cancelar</button>
          </div>
        </div>
      )}

      <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
        {carregando ? (
          <p className="text-sm text-gray-400 text-center py-10">Carregando...</p>
        ) : usuarios.length === 0 ? (
          <p className="text-sm text-gray-400 text-center py-10">Nenhum usuário cadastrado.</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 text-xs text-gray-400 uppercase tracking-wide">
                <th className="px-4 py-3 text-left">Nome</th>
                <th className="px-4 py-3 text-left">E-mail</th>
                <th className="px-4 py-3 text-left">Status</th>
                <th className="px-4 py-3 text-right">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {usuarios.map(u => (
                editandoId === u.id ? (
                  <tr key={u.id} className="bg-blue-50/30">
                    <td className="px-4 py-2.5">
                      <input value={editForm.nome} onChange={e => setEditForm(f => ({ ...f, nome: e.target.value }))}
                        className="w-full border border-gray-200 rounded-lg px-2 py-1.5 text-sm" />
                    </td>
                    <td className="px-4 py-2.5">
                      <input value={editForm.email} onChange={e => setEditForm(f => ({ ...f, email: e.target.value }))}
                        className="w-full border border-gray-200 rounded-lg px-2 py-1.5 text-sm" />
                    </td>
                    <td className="px-4 py-2.5">
                      <input placeholder="Nova senha (opcional)" type="password" value={editForm.senha} onChange={e => setEditForm(f => ({ ...f, senha: e.target.value }))}
                        className="w-full border border-gray-200 rounded-lg px-2 py-1.5 text-sm" />
                    </td>
                    <td className="px-4 py-2.5 text-right whitespace-nowrap">
                      <button onClick={() => salvarEdicao(u.id)} disabled={processandoId === u.id} className="text-xs px-2.5 py-1.5 rounded-lg bg-blue-600 text-white hover:bg-blue-700 mr-1.5 disabled:opacity-50">Salvar</button>
                      <button onClick={() => setEditandoId(null)} className="text-xs px-2.5 py-1.5 rounded-lg text-gray-500 hover:bg-gray-100">Cancelar</button>
                    </td>
                  </tr>
                ) : (
                  <tr key={u.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 font-medium text-[#0d1b2e]">{u.nome}</td>
                    <td className="px-4 py-3 text-gray-500">{u.email}</td>
                    <td className="px-4 py-3">
                      <span className={`text-xs font-semibold px-2 py-1 rounded-full ${u.ativo ? 'bg-emerald-50 text-emerald-700' : 'bg-gray-100 text-gray-400'}`}>
                        {u.ativo ? 'Ativo' : 'Desativado'}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right whitespace-nowrap">
                      <button
                        onClick={() => { setEditandoId(u.id); setEditForm({ nome: u.nome, email: u.email, senha: '' }) }}
                        title="Editar" className="p-1.5 rounded-lg text-gray-400 hover:text-blue-600 hover:bg-blue-50 mr-1"
                      >
                        <KeyRound size={14} />
                      </button>
                      <button
                        onClick={() => alternarAtivo(u)} disabled={processandoId === u.id}
                        title={u.ativo ? 'Desativar' : 'Reativar'}
                        className={`p-1.5 rounded-lg mr-1 ${u.ativo ? 'text-gray-400 hover:text-orange-600 hover:bg-orange-50' : 'text-gray-400 hover:text-emerald-600 hover:bg-emerald-50'}`}
                      >
                        {u.ativo ? <Ban size={14} /> : <CheckCircle2 size={14} />}
                      </button>
                      <button
                        onClick={() => excluir(u.id)} disabled={processandoId === u.id}
                        title="Excluir" className="p-1.5 rounded-lg text-gray-400 hover:text-red-600 hover:bg-red-50"
                      >
                        <Trash2 size={14} />
                      </button>
                    </td>
                  </tr>
                )
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}

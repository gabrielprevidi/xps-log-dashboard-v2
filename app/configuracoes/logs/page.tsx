'use client'

import { useEffect, useState, useCallback } from 'react'
import Link from 'next/link'
import { ArrowLeft, ScrollText, ChevronLeft, ChevronRight } from 'lucide-react'

interface LogAuditoria {
  id: string
  usuario_nome: string | null
  acao: string
  entidade: string
  entidade_id: string | null
  detalhes: Record<string, unknown> | null
  criado_em: string
}

const ACAO_LABEL: Record<string, string> = {
  criar: 'Criou',
  editar: 'Editou',
  excluir: 'Excluiu',
  verificar: 'Conferiu',
  login: 'Entrou',
}

const ACAO_COR: Record<string, string> = {
  criar: 'bg-emerald-50 text-emerald-700',
  editar: 'bg-blue-50 text-blue-700',
  excluir: 'bg-red-50 text-red-700',
  verificar: 'bg-indigo-50 text-indigo-700',
  login: 'bg-gray-100 text-gray-500',
}

const LIMITE = 30

export default function LogsPage() {
  const [logs, setLogs] = useState<LogAuditoria[]>([])
  const [total, setTotal] = useState(0)
  const [pagina, setPagina] = useState(0)
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState<string | null>(null)
  const [filtroEntidade, setFiltroEntidade] = useState('')

  const carregar = useCallback(async () => {
    setCarregando(true)
    try {
      const params = new URLSearchParams({ limite: String(LIMITE), offset: String(pagina * LIMITE) })
      if (filtroEntidade) params.set('entidade', filtroEntidade)
      const res = await fetch(`/api/admin/logs?${params}`)
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Falha ao carregar logs')
      setLogs(data.logs)
      setTotal(data.total)
    } catch (e: any) {
      setErro(e.message)
    } finally {
      setCarregando(false)
    }
  }, [pagina, filtroEntidade])

  useEffect(() => { carregar() }, [carregar])

  const entidades = ['cliente', 'movimentacao', 'nfe_manual', 'usuario', 'cliente_dados']
  const totalPaginas = Math.max(1, Math.ceil(total / LIMITE))

  return (
    <div className="max-w-5xl mx-auto px-6 py-8">
      <Link href="/configuracoes" className="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-800 mb-4">
        <ArrowLeft size={14} /> Configurações
      </Link>

      <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold text-[#0d1b2e] flex items-center gap-2"><ScrollText size={20} /> Logs de auditoria</h1>
          <p className="text-sm text-gray-400 mt-0.5">Quem fez cada alteração no sistema.</p>
        </div>
        <select
          value={filtroEntidade}
          onChange={e => { setFiltroEntidade(e.target.value); setPagina(0) }}
          className="border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-600 focus:outline-none focus:ring-2 focus:ring-[#0d1b2e]/10"
        >
          <option value="">Todas as entidades</option>
          {entidades.map(e => <option key={e} value={e}>{e}</option>)}
        </select>
      </div>

      {erro && (
        <div className="bg-red-50 border border-red-100 rounded-xl px-4 py-2.5 text-sm text-red-600 mb-4">{erro}</div>
      )}

      <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
        {carregando ? (
          <p className="text-sm text-gray-400 text-center py-10">Carregando...</p>
        ) : logs.length === 0 ? (
          <p className="text-sm text-gray-400 text-center py-10">Nenhum log encontrado.</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 text-xs text-gray-400 uppercase tracking-wide">
                <th className="px-4 py-3 text-left">Quando</th>
                <th className="px-4 py-3 text-left">Usuário</th>
                <th className="px-4 py-3 text-left">Ação</th>
                <th className="px-4 py-3 text-left">Entidade</th>
                <th className="px-4 py-3 text-left">Detalhes</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {logs.map(log => (
                <tr key={log.id} className="hover:bg-gray-50 align-top">
                  <td className="px-4 py-3 text-gray-500 whitespace-nowrap">
                    {new Date(log.criado_em).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' })}
                  </td>
                  <td className="px-4 py-3 font-medium text-[#0d1b2e]">{log.usuario_nome || '—'}</td>
                  <td className="px-4 py-3">
                    <span className={`text-xs font-semibold px-2 py-1 rounded-full ${ACAO_COR[log.acao] || 'bg-gray-100 text-gray-500'}`}>
                      {ACAO_LABEL[log.acao] || log.acao}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-gray-500">
                    {log.entidade}{log.entidade_id ? <span className="text-gray-300"> · {log.entidade_id.slice(0, 8)}</span> : null}
                  </td>
                  <td className="px-4 py-3 text-xs text-gray-400 max-w-xs truncate font-mono">
                    {log.detalhes ? JSON.stringify(log.detalhes) : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {total > LIMITE && (
        <div className="flex items-center justify-between mt-4 text-sm text-gray-500">
          <span>{total} registro{total !== 1 ? 's' : ''} — página {pagina + 1} de {totalPaginas}</span>
          <div className="flex items-center gap-2">
            <button onClick={() => setPagina(p => Math.max(0, p - 1))} disabled={pagina === 0}
              className="p-1.5 rounded-lg border border-gray-200 disabled:opacity-40 hover:bg-gray-50">
              <ChevronLeft size={14} />
            </button>
            <button onClick={() => setPagina(p => Math.min(totalPaginas - 1, p + 1))} disabled={pagina >= totalPaginas - 1}
              className="p-1.5 rounded-lg border border-gray-200 disabled:opacity-40 hover:bg-gray-50">
              <ChevronRight size={14} />
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

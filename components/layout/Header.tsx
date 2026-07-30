'use client'

import Image from 'next/image'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Bell, Search, Settings, CheckCircle, X, LogOut } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useEffect, useState, useRef } from 'react'

interface Notificacao {
  id: string
  tipo: string
  mensagem: string
  lida: boolean
  criado_em: string
  competencia: string | null
  cliente_id: string | null
  clientes: { nome_fantasia: string; nome: string } | null
}

const navLinks = [
  { href: '/', label: 'Início' },
  { href: '/clientes', label: 'Clientes' },
  { href: '/nfes', label: 'NFes' },
  { href: '/configuracoes', label: 'Configurações' },
]

export default function Header() {
  const pathname = usePathname()
  if (pathname.startsWith('/portal')) return null
  const [notificacoes, setNotificacoes] = useState<Notificacao[]>([])
  const [aberto, setAberto] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  const naoLidas = notificacoes.filter(n => !n.lida).length
  const [menuAberto, setMenuAberto] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  async function handleLogout() {
    await fetch('/api/admin/logout', { method: 'POST' })
    window.location.href = '/login'
  }

  useEffect(() => {
    function handleClickFora(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuAberto(false)
      }
    }
    document.addEventListener('mousedown', handleClickFora)
    return () => document.removeEventListener('mousedown', handleClickFora)
  }, [])

  async function carregarNotificacoes() {
    try {
      const res = await fetch('/api/notificacoes')
      if (res.ok) {
        const data = await res.json()
        setNotificacoes(Array.isArray(data) ? data : [])
      }
    } catch { /* silently ignore */ }
  }

  async function marcarTodasLidas() {
    await fetch('/api/notificacoes', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ todas: true }),
    })
    setNotificacoes(prev => prev.map(n => ({ ...n, lida: true })))
  }

  async function marcarLida(id: string) {
    await fetch('/api/notificacoes', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    })
    setNotificacoes(prev => prev.map(n => n.id === id ? { ...n, lida: true } : n))
  }

  useEffect(() => {
    carregarNotificacoes()
    // Poll a cada 30s
    const interval = setInterval(carregarNotificacoes, 30_000)
    return () => clearInterval(interval)
  }, [])

  // Fecha ao clicar fora
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setAberto(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  return (
    <header className="bg-white border-b border-gray-100 sticky top-0 z-50">
      <div className="max-w-[1400px] mx-auto px-6 h-16 flex items-center justify-between gap-6">
        {/* Logo */}
        <Link href="/" className="flex items-center gap-2 shrink-0">
          <Image src="/ICO_XpsLog.png" alt="XPS Log" width={40} height={40} className="rounded-lg" />
          <span className="font-bold text-[#0d1b2e] text-lg tracking-wide hidden sm:block">XPS LOG</span>
        </Link>

        {/* Nav */}
        <nav className="hidden md:flex items-center gap-1">
          {navLinks.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className={cn(
                'px-4 py-2 rounded-lg text-sm font-medium transition-colors',
                pathname === link.href
                  ? 'text-[#0d1b2e] font-semibold border-b-2 border-[#0d1b2e] rounded-none'
                  : 'text-gray-500 hover:text-gray-800'
              )}
            >
              {link.label}
            </Link>
          ))}
        </nav>

        {/* Right side */}
        <div className="flex items-center gap-3">
          {/* Search */}
          <div className="relative hidden lg:block">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 w-4 h-4" />
            <input
              type="text"
              placeholder="Buscar NFe, cliente, fornecedor..."
              className="pl-9 pr-4 py-2 bg-gray-50 border border-gray-200 rounded-xl text-sm text-gray-600 w-72 focus:outline-none focus:ring-2 focus:ring-[#0d1b2e]/10 focus:border-[#0d1b2e]/30"
            />
          </div>

          {/* Settings icon */}
          <Link
            href="/configuracoes"
            className="w-9 h-9 flex items-center justify-center rounded-full bg-gray-50 border border-gray-200 text-gray-500 hover:text-gray-800 hover:bg-gray-100 transition-colors"
          >
            <Settings className="w-4 h-4" />
          </Link>

          {/* Notifications */}
          <div className="relative" ref={ref}>
            <button
              onClick={() => setAberto(v => !v)}
              className="relative w-9 h-9 flex items-center justify-center rounded-full bg-gray-50 border border-gray-200 text-gray-500 hover:text-gray-800 hover:bg-gray-100 transition-colors"
            >
              <Bell className="w-4 h-4" />
              {naoLidas > 0 && (
                <span className="absolute -top-0.5 -right-0.5 w-4 h-4 bg-red-500 rounded-full text-white text-[10px] font-bold flex items-center justify-center">
                  {naoLidas > 9 ? '9+' : naoLidas}
                </span>
              )}
            </button>

            {aberto && (
              <div className="absolute right-0 top-11 w-80 bg-white rounded-2xl border border-gray-100 shadow-xl overflow-hidden z-50">
                <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
                  <span className="font-semibold text-sm text-[#0d1b2e]">Notificações</span>
                  <div className="flex items-center gap-2">
                    {naoLidas > 0 && (
                      <button onClick={marcarTodasLidas} className="text-xs text-blue-600 hover:underline">
                        Marcar todas lidas
                      </button>
                    )}
                    <button onClick={() => setAberto(false)} className="text-gray-400 hover:text-gray-600">
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                </div>

                <div className="max-h-80 overflow-y-auto divide-y divide-gray-50">
                  {notificacoes.length === 0 ? (
                    <p className="text-sm text-gray-400 text-center py-8">Nenhuma notificação</p>
                  ) : (
                    notificacoes.map(n => (
                      <div
                        key={n.id}
                        className={`px-4 py-3 flex items-start gap-3 hover:bg-gray-50 transition-colors ${!n.lida ? 'bg-blue-50/40' : ''}`}
                      >
                        <div className={`mt-0.5 w-7 h-7 rounded-full flex items-center justify-center shrink-0 ${!n.lida ? 'bg-emerald-100' : 'bg-gray-100'}`}>
                          <CheckCircle className={`w-4 h-4 ${!n.lida ? 'text-emerald-600' : 'text-gray-400'}`} />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className={`text-xs leading-relaxed ${!n.lida ? 'text-gray-800 font-medium' : 'text-gray-500'}`}>
                            {n.mensagem}
                          </p>
                          <p className="text-[11px] text-gray-400 mt-0.5">
                            {new Date(n.criado_em).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
                          </p>
                        </div>
                        {!n.lida && (
                          <button onClick={() => marcarLida(n.id)} className="text-gray-300 hover:text-gray-500 shrink-0 mt-0.5">
                            <X className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    ))
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Avatar + menu */}
          <div className="relative" ref={menuRef}>
            <button
              onClick={() => setMenuAberto(v => !v)}
              className="w-9 h-9 rounded-full bg-[#0d1b2e] flex items-center justify-center text-white text-sm font-bold hover:bg-[#1a2d47] transition-colors"
            >
              XP
            </button>
            {menuAberto && (
              <div className="absolute right-0 top-11 w-44 bg-white rounded-xl border border-gray-100 shadow-xl overflow-hidden z-50">
                <button
                  onClick={handleLogout}
                  className="w-full flex items-center gap-2.5 px-4 py-3 text-sm text-red-600 hover:bg-red-50 transition-colors"
                >
                  <LogOut className="w-4 h-4" />
                  Sair
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </header>
  )
}

'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Plus, Package, ArrowDownToLine, ArrowUpFromLine, ChevronRight, Loader2 } from 'lucide-react'
import { formatarMoeda } from '@/lib/calculations'

interface ClienteResumo {
  id: string
  nome: string
  nome_fantasia: string
  cnpj: string
  valor_pallet: number
  aliquota_imposto: number
  regra_fator_pallet: number
  totalEntradas: number
  totalSaidas: number
  totalNfes: number
}

export default function ClientesPage() {
  const [clientes, setClientes] = useState<ClienteResumo[]>([])
  const [loading, setLoading] = useState(true)
  const [erro, setErro] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/clientes')
      .then(r => r.json())
      .then(data => {
        if (data.error) throw new Error(data.error)
        setClientes(data)
      })
      .catch(e => setErro(e.message))
      .finally(() => setLoading(false))
  }, [])

  return (
    <main className="max-w-[1400px] mx-auto px-6 py-8">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-[#0d1b2e]">Clientes</h1>
          <p className="text-sm text-gray-400 mt-1">Gerencie os clientes de armazenagem</p>
        </div>
        <Link
          href="/configuracoes"
          className="inline-flex items-center gap-2 bg-[#0d1b2e] text-white text-sm font-semibold px-4 py-2.5 rounded-xl hover:bg-[#1a3a5c] transition-colors"
        >
          <Plus className="w-4 h-4" />
          Novo cliente
        </Link>
      </div>

      {loading && (
        <div className="flex items-center justify-center py-20 text-gray-400">
          <Loader2 className="w-6 h-6 animate-spin mr-2" />
          Carregando clientes...
        </div>
      )}

      {erro && (
        <div className="bg-red-50 text-red-700 rounded-xl p-4 text-sm">{erro}</div>
      )}

      {!loading && !erro && clientes.length === 0 && (
        <div className="text-center py-20 text-gray-400">
          <Package className="w-10 h-10 mx-auto mb-3 opacity-40" />
          <p className="text-sm">Nenhum cliente cadastrado ainda.</p>
          <p className="text-xs mt-1">Vá em Configurações para adicionar clientes.</p>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {clientes.map((cliente) => {
          const saldoPallets = cliente.totalEntradas - cliente.totalSaidas
          const armazBase = saldoPallets * cliente.valor_pallet
          const armazTotal = armazBase * (1 + cliente.aliquota_imposto / 100)

          return (
            <Link
              key={cliente.id}
              href={`/clientes/${cliente.id}`}
              className="bg-white rounded-2xl border border-gray-100 p-5 hover:shadow-md hover:border-gray-200 transition-all group"
            >
              <div className="flex items-start justify-between mb-4">
                <div className="flex items-center gap-3">
                  <div className="w-12 h-12 rounded-xl bg-[#0d1b2e] flex items-center justify-center text-white font-bold text-lg">
                    {(cliente.nome_fantasia || cliente.nome).slice(0, 2).toUpperCase()}
                  </div>
                  <div>
                    <h3 className="font-bold text-[#0d1b2e]">{cliente.nome_fantasia || cliente.nome}</h3>
                    <p className="text-xs text-gray-400">{cliente.cnpj}</p>
                  </div>
                </div>
                <span className="text-xs bg-blue-50 text-blue-700 px-2 py-1 rounded-full font-medium">
                  {cliente.totalNfes} NF{cliente.totalNfes !== 1 ? 'es' : 'e'}
                </span>
              </div>

              <div className="grid grid-cols-3 gap-3 mb-4">
                <div className="bg-blue-50 rounded-xl p-3 text-center">
                  <ArrowDownToLine className="w-3 h-3 text-blue-500 mx-auto mb-1" />
                  <p className="text-xs text-gray-400 mb-0.5">Entradas</p>
                  <p className="font-bold text-[#0d1b2e]">{cliente.totalEntradas}</p>
                  <p className="text-xs text-gray-400">pallets</p>
                </div>
                <div className="bg-orange-50 rounded-xl p-3 text-center">
                  <ArrowUpFromLine className="w-3 h-3 text-orange-500 mx-auto mb-1" />
                  <p className="text-xs text-gray-400 mb-0.5">Saídas</p>
                  <p className="font-bold text-[#0d1b2e]">{cliente.totalSaidas}</p>
                  <p className="text-xs text-gray-400">pallets</p>
                </div>
                <div className="bg-emerald-50 rounded-xl p-3 text-center">
                  <Package className="w-3 h-3 text-emerald-500 mx-auto mb-1" />
                  <p className="text-xs text-emerald-600 mb-0.5">Saldo</p>
                  <p className="font-bold text-emerald-700">{saldoPallets}</p>
                  <p className="text-xs text-emerald-600">pallets</p>
                </div>
              </div>

              <div className="flex items-center justify-between text-xs text-gray-400">
                <span>R$ {cliente.valor_pallet}/pallet · {cliente.aliquota_imposto}% imposto</span>
                <span className="flex items-center gap-1 text-[#0d1b2e] font-medium group-hover:gap-2 transition-all">
                  Ver detalhes <ChevronRight className="w-3 h-3" />
                </span>
              </div>
            </Link>
          )
        })}
      </div>
    </main>
  )
}

'use client'

import { SaldoDiario } from '@/types'
import { format } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import { cn } from '@/lib/utils'

interface DailyTableProps {
  dados: SaldoDiario[]
  ppPico: number
}

export default function DailyTable({ dados, ppPico }: DailyTableProps) {
  const totalEntradas = dados.reduce((s, d) => s + d.entrada_pa + d.entrada_mp, 0)
  const totalSaidas = dados.reduce((s, d) => s + d.saida_pa + d.saida_mp, 0)

  return (
    <div className="overflow-x-auto rounded-xl border border-gray-100">
      <table className="w-full text-sm">
        <thead>
          <tr className="bg-gray-50 text-gray-500 text-xs uppercase tracking-wider">
            <th className="px-4 py-3 text-left font-medium">Data</th>
            <th className="px-4 py-3 text-right font-medium">Inicial</th>
            <th className="px-4 py-3 text-right font-medium text-blue-600">Ent. PA</th>
            <th className="px-4 py-3 text-right font-medium text-red-500">Saí. PA</th>
            <th className="px-4 py-3 text-right font-medium text-blue-400">Ent. MP</th>
            <th className="px-4 py-3 text-right font-medium text-red-400">Saí. MP</th>
            <th className="px-4 py-3 text-right font-medium text-[#0d1b2e]">Saldo</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-50">
          {dados.filter(d => d.entrada_pa > 0 || d.saida_pa > 0 || d.entrada_mp > 0 || d.saida_mp > 0).map((dia) => (
            <tr
              key={dia.data}
              className={cn(
                'hover:bg-gray-50 transition-colors',
                dia.saldo === ppPico && 'bg-red-50/60'
              )}
            >
              <td className="px-4 py-3 font-medium text-gray-700">
                {format(new Date(dia.data + 'T12:00:00'), "dd 'de' MMM", { locale: ptBR })}
                {dia.saldo === ppPico && (
                  <span className="ml-2 text-[10px] bg-red-100 text-red-700 px-1.5 py-0.5 rounded font-semibold">
                    PICO
                  </span>
                )}
              </td>
              <td className="px-4 py-3 text-right text-gray-600">{dia.inicial}</td>
              <td className="px-4 py-3 text-right">
                {dia.entrada_pa > 0 ? (
                  <span className="text-blue-700 font-medium">+{dia.entrada_pa}</span>
                ) : (
                  <span className="text-gray-300">—</span>
                )}
              </td>
              <td className="px-4 py-3 text-right">
                {dia.saida_pa > 0 ? (
                  <span className="text-red-600 font-medium">-{dia.saida_pa}</span>
                ) : (
                  <span className="text-gray-300">—</span>
                )}
              </td>
              <td className="px-4 py-3 text-right">
                {dia.entrada_mp > 0 ? (
                  <span className="text-blue-500 font-medium">+{dia.entrada_mp}</span>
                ) : (
                  <span className="text-gray-300">—</span>
                )}
              </td>
              <td className="px-4 py-3 text-right">
                {dia.saida_mp > 0 ? (
                  <span className="text-red-400 font-medium">-{dia.saida_mp}</span>
                ) : (
                  <span className="text-gray-300">—</span>
                )}
              </td>
              <td className="px-4 py-3 text-right font-bold text-[#0d1b2e]">{dia.saldo}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="bg-gray-50 font-semibold text-gray-700 border-t-2 border-gray-200">
            <td className="px-4 py-3">Totais</td>
            <td className="px-4 py-3 text-right text-gray-400">—</td>
            <td className="px-4 py-3 text-right text-blue-700">
              +{dados.reduce((s, d) => s + d.entrada_pa, 0)}
            </td>
            <td className="px-4 py-3 text-right text-red-600">
              -{dados.reduce((s, d) => s + d.saida_pa, 0)}
            </td>
            <td className="px-4 py-3 text-right text-blue-500">
              +{dados.reduce((s, d) => s + d.entrada_mp, 0)}
            </td>
            <td className="px-4 py-3 text-right text-red-400">
              -{dados.reduce((s, d) => s + d.saida_mp, 0)}
            </td>
            <td className="px-4 py-3 text-right text-[#0d1b2e]">
              PP Pico: {ppPico}
            </td>
          </tr>
        </tfoot>
      </table>
    </div>
  )
}

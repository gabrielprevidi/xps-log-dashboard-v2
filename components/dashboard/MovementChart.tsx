'use client'

import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
} from 'recharts'
import { SaldoDiario } from '@/types'
import { format } from 'date-fns'
import { ptBR } from 'date-fns/locale'

interface MovementChartProps {
  dados: SaldoDiario[]
  ppPico: number
}

const CustomTooltip = ({ active, payload, label }: any) => {
  if (active && payload && payload.length) {
    return (
      <div className="bg-[#0d1b2e] text-white rounded-xl px-4 py-3 shadow-xl text-sm">
        <p className="font-semibold mb-2">{label}</p>
        {payload.map((entry: any) => (
          <div key={entry.dataKey} className="flex items-center gap-2">
            <span className="text-gray-300">{entry.name}:</span>
            <span className="font-bold">{entry.value} pallets</span>
          </div>
        ))}
      </div>
    )
  }
  return null
}

export default function MovementChart({ dados, ppPico }: MovementChartProps) {
  const chartData = dados.map((d) => ({
    dia: format(new Date(d.data + 'T12:00:00'), 'dd/MM', { locale: ptBR }),
    saldo: d.saldo,
    entradas: d.entrada_pa + d.entrada_mp,
    saidas: d.saida_pa + d.saida_mp,
  }))

  return (
    <div className="w-full h-52">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={chartData} margin={{ top: 10, right: 0, left: -20, bottom: 0 }}>
          <defs>
            <linearGradient id="saldoGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#0d1b2e" stopOpacity={0.15} />
              <stop offset="95%" stopColor="#0d1b2e" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" vertical={false} />
          <XAxis
            dataKey="dia"
            tick={{ fontSize: 11, fill: '#9ca3af' }}
            tickLine={false}
            axisLine={false}
            interval={4}
          />
          <YAxis
            tick={{ fontSize: 11, fill: '#9ca3af' }}
            tickLine={false}
            axisLine={false}
          />
          <Tooltip content={<CustomTooltip />} />
          <ReferenceLine
            y={ppPico}
            stroke="#ef4444"
            strokeDasharray="4 4"
            label={{ value: `Pico: ${ppPico}`, fill: '#ef4444', fontSize: 11, position: 'right' }}
          />
          <Area
            type="monotone"
            dataKey="saldo"
            name="Saldo"
            stroke="#0d1b2e"
            strokeWidth={2}
            fill="url(#saldoGrad)"
            dot={{ fill: '#0d1b2e', r: 3, strokeWidth: 0 }}
            activeDot={{ r: 5, fill: '#0d1b2e' }}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  )
}

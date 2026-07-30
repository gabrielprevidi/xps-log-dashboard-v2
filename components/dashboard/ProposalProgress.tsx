'use client'

interface Stat {
  label: string
  value: number
  color?: string
}

interface ProposalProgressProps {
  title: string
  stats: Stat[]
  date?: string
}

function MiniBar({ value, max, color = '#ef4444' }: { value: number; max: number; color?: string }) {
  const bars = 12
  const filled = Math.round((value / max) * bars)
  return (
    <div className="flex gap-0.5 items-end h-10">
      {Array.from({ length: bars }).map((_, i) => (
        <div
          key={i}
          className="w-1.5 rounded-sm"
          style={{
            height: `${Math.max(20, ((i < filled ? 1 : 0.3) * 100))}%`,
            backgroundColor: i < filled ? color : '#e5e7eb',
          }}
        />
      ))}
    </div>
  )
}

export default function ProposalProgress({ title, stats, date }: ProposalProgressProps) {
  const max = Math.max(...stats.map((s) => s.value))

  return (
    <div className="bg-white rounded-2xl border border-gray-100 p-5">
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-semibold text-[#0d1b2e]">{title}</h3>
        {date && (
          <span className="text-xs text-gray-400 bg-gray-50 border border-gray-100 px-3 py-1 rounded-lg">
            {date}
          </span>
        )}
      </div>

      <div className="flex items-end gap-6">
        {stats.map((stat, i) => (
          <div key={stat.label} className="flex flex-col gap-2">
            <span className="text-xs text-gray-400">{stat.label}</span>
            <span className="text-2xl font-bold text-[#0d1b2e]">{stat.value}</span>
            <MiniBar value={stat.value} max={max} color={stat.color} />
          </div>
        ))}
      </div>
    </div>
  )
}

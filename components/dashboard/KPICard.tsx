import { cn } from '@/lib/utils'
import { LucideIcon } from 'lucide-react'

interface KPICardProps {
  label: string
  value: string
  subvalue?: string
  icon?: LucideIcon
  trend?: { value: string; positive: boolean }
  variant?: 'default' | 'highlight'
  className?: string
}

export default function KPICard({
  label,
  value,
  subvalue,
  icon: Icon,
  trend,
  variant = 'default',
  className,
}: KPICardProps) {
  return (
    <div
      className={cn(
        'rounded-2xl p-5 flex flex-col gap-3',
        variant === 'highlight'
          ? 'bg-[#0d1b2e] text-white'
          : 'bg-white border border-gray-100',
        className
      )}
    >
      <div className="flex items-center justify-between">
        <span
          className={cn(
            'text-xs font-medium uppercase tracking-wider',
            variant === 'highlight' ? 'text-blue-200' : 'text-gray-400'
          )}
        >
          {label}
        </span>
        {Icon && (
          <div
            className={cn(
              'w-8 h-8 rounded-lg flex items-center justify-center',
              variant === 'highlight' ? 'bg-white/10' : 'bg-gray-50'
            )}
          >
            <Icon
              className={cn('w-4 h-4', variant === 'highlight' ? 'text-blue-200' : 'text-gray-400')}
            />
          </div>
        )}
      </div>

      <div>
        <p
          className={cn(
            'text-2xl font-bold leading-none',
            variant === 'highlight' ? 'text-white' : 'text-[#0d1b2e]'
          )}
        >
          {value}
        </p>
        {subvalue && (
          <p
            className={cn(
              'text-xs mt-1',
              variant === 'highlight' ? 'text-blue-200' : 'text-gray-400'
            )}
          >
            {subvalue}
          </p>
        )}
      </div>

      {trend && (
        <div className="flex items-center gap-1">
          <span
            className={cn(
              'text-xs font-semibold px-1.5 py-0.5 rounded',
              trend.positive
                ? 'text-emerald-700 bg-emerald-50'
                : 'text-red-700 bg-red-50'
            )}
          >
            {trend.positive ? '+' : ''}{trend.value}
          </span>
          <span
            className={cn(
              'text-xs',
              variant === 'highlight' ? 'text-blue-200' : 'text-gray-400'
            )}
          >
            vs mês anterior
          </span>
        </div>
      )}
    </div>
  )
}

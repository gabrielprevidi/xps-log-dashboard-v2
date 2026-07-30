import { cn } from '@/lib/utils'

type Status = 'processado' | 'pendente' | 'erro' | 'duplicado' | 'pago' | 'nao_pago'

const configs: Record<Status, { label: string; className: string }> = {
  processado: { label: 'Processado', className: 'bg-emerald-50 text-emerald-700' },
  pendente: { label: 'Pendente', className: 'bg-amber-50 text-amber-700' },
  erro: { label: 'Erro', className: 'bg-red-50 text-red-700' },
  duplicado: { label: 'Duplicado', className: 'bg-gray-100 text-gray-500' },
  pago: { label: 'Pago', className: 'bg-[#0d1b2e] text-white' },
  nao_pago: { label: 'Não Pago', className: 'bg-gray-100 text-gray-600' },
}

export default function StatusBadge({ status }: { status: Status }) {
  const config = configs[status]
  return (
    <span className={cn('text-xs font-semibold px-2.5 py-1 rounded-full', config.className)}>
      {config.label}
    </span>
  )
}

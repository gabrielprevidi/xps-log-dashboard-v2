import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const dynamic = 'force-dynamic'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function getServerClient(): ReturnType<typeof createClient<any, any, any>> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  return createClient(url, key) as any
}

export async function GET() {
  const supabase = getServerClient()

  const [{ data: clientes }, { data: movsRaw }] = await Promise.all([
    supabase.from('clientes').select('id, nome_fantasia, nome, valor_pallet, aliquota_imposto').eq('ativo', true),
    supabase.from('movimentacoes').select('cliente_id, tipo_movimentacao, pallets_entrada, pallets_saida, data_entrada, data_saida, cancelada'),
  ])

  // Filter cancelled rows in JS to be resilient before the DB migration is applied
  const movs = (movsRaw ?? []).filter((m: any) => !m.cancelada)

  // Aggregate movimentacoes by clienteId → mes
  const byClientMonth: Record<string, Record<string, { entradas: number; saidas: number }>> = {}

  for (const mov of movs) {
    const cid = mov.cliente_id
    if (!cid) continue
    const dataStr: string = mov.data_entrada || mov.data_saida
    if (!dataStr) continue
    const mes = dataStr.slice(0, 7)

    if (!byClientMonth[cid]) byClientMonth[cid] = {}
    if (!byClientMonth[cid][mes]) byClientMonth[cid][mes] = { entradas: 0, saidas: 0 }
    byClientMonth[cid][mes].entradas += mov.pallets_entrada || 0
    byClientMonth[cid][mes].saidas += mov.pallets_saida || 0
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const resultado = (clientes ?? []).map((c: any) => ({
    clienteId: c.id,
    nome: c.nome_fantasia || c.nome,
    valor_pallet: c.valor_pallet ?? 0,
    aliquota_imposto: c.aliquota_imposto ?? 0,
    meses: Object.entries(byClientMonth[c.id] ?? {})
      .map(([mes, dados]) => ({ mes, entradas: dados.entradas, saidas: dados.saidas }))
      .sort((a, b) => a.mes.localeCompare(b.mes)),
  }))

  return NextResponse.json(resultado)
}

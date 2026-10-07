import { NextRequest, NextResponse } from 'next/server'
import { getServerClient } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

/**
 * Avery Graphics — SKUs e movimentações em caixas do cliente.
 * O cálculo de saldo e palets é feito por `lib/graphics-saldo.ts`.
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const supabase = getServerClient()

    const { data: skus, error: skuErr } = await supabase
      .from('graphics_sku')
      .select('id, codigo, descricao, unidades_por_palet')
      .eq('cliente_id', id)
      .eq('ativo', true)
    if (skuErr) throw skuErr

    const ids = (skus ?? []).map((s: { id: string }) => s.id)
    const movs: unknown[] = []
    for (let i = 0; i < ids.length; i += 100) {
      for (let o = 0; ; o += 1000) {
        const { data, error } = await supabase
          .from('graphics_movimentacoes')
          .select('id, sku_id, arquivo_nfe_id, numero_nfe, tipo, data_mov, qtd_unidades, palets_declarados, inventario')
          .in('sku_id', ids.slice(i, i + 100))
          .order('data_mov', { ascending: true })
          .range(o, o + 999)
        if (error) throw error
        movs.push(...(data ?? []))
        if (!data || data.length < 1000) break
      }
    }

    return NextResponse.json({ skus: skus ?? [], movimentacoes: movs })
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || String(error) }, { status: 500 })
  }
}

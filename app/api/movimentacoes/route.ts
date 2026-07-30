import { NextRequest, NextResponse } from 'next/server'
import { criarMovimentacaoManual } from '@/lib/supabase-service'

export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    if (!body.cliente_id || !body.tipo_movimentacao) {
      return NextResponse.json({ error: 'cliente_id e tipo_movimentacao obrigatórios' }, { status: 400 })
    }
    const mov = await criarMovimentacaoManual(body)
    return NextResponse.json(mov)
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || String(error) }, { status: 500 })
  }
}

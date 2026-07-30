import { NextRequest, NextResponse } from 'next/server'
import { getServerClient } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

// GET /api/fechamento?cliente_id=xxx
export async function GET(request: NextRequest) {
  const clienteId = request.nextUrl.searchParams.get('cliente_id')
  if (!clienteId) return NextResponse.json({ error: 'cliente_id obrigatório' }, { status: 400 })

  const supabase = getServerClient()
  const { data, error } = await supabase
    .from('fechamento_mensal')
    .select('*')
    .eq('cliente_id', clienteId)
    .order('competencia', { ascending: false })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

// POST /api/fechamento — admin fecha o mês (sem NF, aguarda aprovação do cliente)
// Body JSON: { cliente_id, competencia }
export async function POST(request: NextRequest) {
  try {
    const { cliente_id, competencia } = await request.json()

    if (!cliente_id || !competencia) {
      return NextResponse.json({ error: 'cliente_id e competencia obrigatórios' }, { status: 400 })
    }

    const supabase = getServerClient()
    const competenciaDate = `${competencia}-01`

    const { data, error } = await supabase
      .from('fechamento_mensal')
      .upsert(
        { cliente_id, competencia: competenciaDate, status: 'fechado' },
        { onConflict: 'cliente_id,competencia' }
      )
      .select()
      .single()

    if (error) throw new Error(error.message)
    return NextResponse.json(data)
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}

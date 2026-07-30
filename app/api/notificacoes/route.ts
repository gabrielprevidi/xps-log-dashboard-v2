import { NextRequest, NextResponse } from 'next/server'
import { getServerClient } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

// GET — lista notificações não lidas
export async function GET() {
  const supabase = getServerClient()
  const { data, error } = await supabase
    .from('notificacoes')
    .select('*, clientes(nome_fantasia, nome)')
    .order('criado_em', { ascending: false })
    .limit(50)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

// PATCH — marca uma ou todas como lidas
// Body: { id?: string, todas?: true }
export async function PATCH(request: NextRequest) {
  try {
    const body = await request.json()
    const supabase = getServerClient()

    let query = supabase.from('notificacoes').update({ lida: true })
    if (body.id) {
      query = query.eq('id', body.id) as any
    } else if (body.todas) {
      query = query.eq('lida', false) as any
    }

    const { error } = await query
    if (error) throw new Error(error.message)
    return NextResponse.json({ ok: true })
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}

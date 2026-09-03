import { NextRequest, NextResponse } from 'next/server'
import { listarLogsAuditoria } from '@/lib/supabase-service'
import { getUsuarioAtual } from '@/lib/admin-auth'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const usuario = await getUsuarioAtual()
  if (!usuario) return NextResponse.json({ error: 'Não autorizado' }, { status: 401 })
  try {
    const url = new URL(request.url)
    const entidade = url.searchParams.get('entidade') || undefined
    const usuario_id = url.searchParams.get('usuario_id') || undefined
    const de = url.searchParams.get('de') || undefined
    const ate = url.searchParams.get('ate') || undefined
    const limite = Number(url.searchParams.get('limite') || 50)
    const offset = Number(url.searchParams.get('offset') || 0)

    const resultado = await listarLogsAuditoria({ entidade, usuario_id, de, ate, limite, offset })
    return NextResponse.json(resultado)
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || String(error) }, { status: 500 })
  }
}

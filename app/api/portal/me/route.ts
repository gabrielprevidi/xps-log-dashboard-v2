import { NextResponse } from 'next/server'
import { getSessaoPortal } from '@/lib/portal-auth'
import { getServerClient } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

export async function GET() {
  const sessao = await getSessaoPortal()
  if (!sessao) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })

  const supabase = getServerClient()
  const { data: cliente } = await supabase
    .from('clientes')
    .select('id, nome, nome_fantasia, cnpj')
    .eq('id', sessao.clienteId)
    .single()

  return NextResponse.json({ cliente, usuario: sessao.usuario })
}

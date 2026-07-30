import { NextRequest, NextResponse } from 'next/server'
import bcrypt from 'bcryptjs'
import { criarSessao, COOKIE_NAME } from '@/lib/portal-auth'
import { getServerClient } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
  try {
    const { usuario, senha } = await request.json()
    if (!usuario || !senha) {
      return NextResponse.json({ error: 'Usuário e senha obrigatórios' }, { status: 400 })
    }

    const supabase = getServerClient()
    const { data: cliente, error } = await supabase
      .from('clientes')
      .select('id, nome_fantasia, nome, portal_usuario, portal_senha_hash')
      .eq('portal_usuario', usuario)
      .single()

    if (error || !cliente || !cliente.portal_senha_hash) {
      return NextResponse.json({ error: 'Usuário ou senha inválidos' }, { status: 401 })
    }

    const senhaCorreta = await bcrypt.compare(senha, cliente.portal_senha_hash)
    if (!senhaCorreta) {
      return NextResponse.json({ error: 'Usuário ou senha inválidos' }, { status: 401 })
    }

    const token = await criarSessao({ clienteId: cliente.id, usuario: cliente.portal_usuario })

    const response = NextResponse.json({
      ok: true,
      clienteId: cliente.id,
      nome: cliente.nome_fantasia || cliente.nome,
    })

    response.cookies.set(COOKIE_NAME, token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 60 * 60 * 24 * 7, // 7 dias
      path: '/',
    })

    return response
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}

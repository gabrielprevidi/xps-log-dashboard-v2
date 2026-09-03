import { NextRequest, NextResponse } from 'next/server'
import bcrypt from 'bcryptjs'
import { criarSessaoAdmin, ADMIN_COOKIE_NAME } from '@/lib/admin-auth'
import { getServerClient } from '@/lib/supabase'
import { registrarLog } from '@/lib/supabase-service'

export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
  try {
    const { email, senha } = await request.json()
    if (!email || !senha) {
      return NextResponse.json({ error: 'E-mail e senha obrigatórios' }, { status: 400 })
    }

    const supabase = getServerClient()
    const { data: usuario, error } = await supabase
      .from('usuarios_admin')
      .select('id, nome, email, senha_hash, ativo')
      .ilike('email', email.trim())
      .maybeSingle()

    if (error || !usuario || !usuario.ativo) {
      return NextResponse.json({ error: 'E-mail ou senha inválidos' }, { status: 401 })
    }

    const senhaCorreta = await bcrypt.compare(senha, usuario.senha_hash)
    if (!senhaCorreta) {
      return NextResponse.json({ error: 'E-mail ou senha inválidos' }, { status: 401 })
    }

    const sessao = { id: usuario.id, nome: usuario.nome, email: usuario.email }
    const token = await criarSessaoAdmin(sessao)

    const response = NextResponse.json({ ok: true, nome: usuario.nome })
    response.cookies.set(ADMIN_COOKIE_NAME, token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 60 * 60 * 8, // 8 horas
      path: '/',
    })

    await registrarLog(sessao, 'login', 'usuario', usuario.id)

    return response
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}

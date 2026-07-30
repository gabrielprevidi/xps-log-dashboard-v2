import { NextRequest, NextResponse } from 'next/server'
import { criarSessaoAdmin, ADMIN_COOKIE_NAME } from '@/lib/admin-auth'

export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
  try {
    const { senha } = await request.json()
    if (!senha) {
      return NextResponse.json({ error: 'Senha obrigatória' }, { status: 400 })
    }

    const adminPassword = process.env.ADMIN_PASSWORD
    if (!adminPassword) {
      return NextResponse.json({ error: 'Configuração incompleta no servidor' }, { status: 500 })
    }

    if (senha !== adminPassword) {
      return NextResponse.json({ error: 'Senha incorreta' }, { status: 401 })
    }

    const token = await criarSessaoAdmin()

    const response = NextResponse.json({ ok: true })
    response.cookies.set(ADMIN_COOKIE_NAME, token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 60 * 60 * 8, // 8 horas
      path: '/',
    })

    return response
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}

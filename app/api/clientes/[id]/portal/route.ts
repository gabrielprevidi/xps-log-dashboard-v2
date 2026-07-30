import { NextRequest, NextResponse } from 'next/server'
import bcrypt from 'bcryptjs'
import { getServerClient } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

// PUT — define ou atualiza credenciais do portal do cliente
// Body: { usuario: string, senha: string }
export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const { usuario, senha } = await request.json()

    if (!usuario || !senha) {
      return NextResponse.json({ error: 'Usuário e senha obrigatórios' }, { status: 400 })
    }

    if (senha.length < 6) {
      return NextResponse.json({ error: 'Senha deve ter ao menos 6 caracteres' }, { status: 400 })
    }

    const senhaHash = await bcrypt.hash(senha, 10)
    const supabase = getServerClient()

    const { data, error } = await supabase
      .from('clientes')
      .update({ portal_usuario: usuario, portal_senha_hash: senhaHash })
      .eq('id', id)
      .select('id, portal_usuario')
      .single()

    if (error) {
      if (error.code === '23505') {
        return NextResponse.json({ error: 'Este usuário já está em uso por outro cliente' }, { status: 409 })
      }
      throw new Error(error.message)
    }

    return NextResponse.json({ ok: true, portal_usuario: data.portal_usuario })
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}

// DELETE — remove credenciais do portal
export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const supabase = getServerClient()

    const { error } = await supabase
      .from('clientes')
      .update({ portal_usuario: null, portal_senha_hash: null })
      .eq('id', id)

    if (error) throw new Error(error.message)
    return NextResponse.json({ ok: true })
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}

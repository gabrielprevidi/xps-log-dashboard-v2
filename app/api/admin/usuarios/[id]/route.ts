import { NextRequest, NextResponse } from 'next/server'
import { atualizarUsuarioAdmin, excluirUsuarioAdmin } from '@/lib/supabase-service'
import { getUsuarioAtual } from '@/lib/admin-auth'

export const dynamic = 'force-dynamic'

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const usuario = await getUsuarioAtual()
  if (!usuario) return NextResponse.json({ error: 'Não autorizado' }, { status: 401 })
  try {
    const { id } = await params
    const body = await request.json()
    if (id === usuario.id && body.ativo === false) {
      return NextResponse.json({ error: 'Você não pode desativar a própria conta' }, { status: 400 })
    }
    if (body.senha && String(body.senha).length < 6) {
      return NextResponse.json({ error: 'Senha precisa ter ao menos 6 caracteres' }, { status: 400 })
    }
    const atualizado = await atualizarUsuarioAdmin(id, body, usuario)
    return NextResponse.json(atualizado)
  } catch (error: any) {
    const msg = error?.code === '23505' ? 'Já existe um usuário com este e-mail' : (error?.message || String(error))
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const usuario = await getUsuarioAtual()
  if (!usuario) return NextResponse.json({ error: 'Não autorizado' }, { status: 401 })
  try {
    const { id } = await params
    if (id === usuario.id) {
      return NextResponse.json({ error: 'Você não pode excluir a própria conta' }, { status: 400 })
    }
    await excluirUsuarioAdmin(id, usuario)
    return NextResponse.json({ ok: true })
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || String(error) }, { status: 500 })
  }
}

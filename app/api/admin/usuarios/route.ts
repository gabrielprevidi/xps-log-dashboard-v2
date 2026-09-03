import { NextRequest, NextResponse } from 'next/server'
import { listarUsuariosAdmin, criarUsuarioAdmin } from '@/lib/supabase-service'
import { getUsuarioAtual } from '@/lib/admin-auth'

export const dynamic = 'force-dynamic'

export async function GET() {
  const usuario = await getUsuarioAtual()
  if (!usuario) return NextResponse.json({ error: 'Não autorizado' }, { status: 401 })
  try {
    const usuarios = await listarUsuariosAdmin()
    return NextResponse.json(usuarios)
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || String(error) }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  const usuario = await getUsuarioAtual()
  if (!usuario) return NextResponse.json({ error: 'Não autorizado' }, { status: 401 })
  try {
    const body = await request.json()
    if (!body.nome || !body.email || !body.senha) {
      return NextResponse.json({ error: 'nome, email e senha obrigatórios' }, { status: 400 })
    }
    if (String(body.senha).length < 6) {
      return NextResponse.json({ error: 'Senha precisa ter ao menos 6 caracteres' }, { status: 400 })
    }
    const novo = await criarUsuarioAdmin(body, usuario)
    return NextResponse.json(novo, { status: 201 })
  } catch (error: any) {
    const msg = error?.code === '23505' ? 'Já existe um usuário com este e-mail' : (error?.message || String(error))
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

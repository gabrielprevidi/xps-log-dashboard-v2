import { NextRequest, NextResponse } from 'next/server'
import { buscarClientePorId, atualizarCliente, reidentificarMovimentacoesOrfas, reidentificarOrfasPorEmail } from '@/lib/supabase-service'
import { getUsuarioAtual } from '@/lib/admin-auth'

export const dynamic = 'force-dynamic'

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const data = await buscarClientePorId(id)
    return NextResponse.json(data)
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || String(error) }, { status: 500 })
  }
}

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const body = await request.json()
    const usuario = await getUsuarioAtual()
    const cliente = await atualizarCliente(id, body, usuario ?? undefined)
    // Re-identifica NFs órfãs quando CNPJ ou email_remetente mudam
    if (body.cnpj) await reidentificarMovimentacoesOrfas(id)
    if (body.email_remetente) await reidentificarOrfasPorEmail(id)
    return NextResponse.json(cliente)
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || String(error) }, { status: 500 })
  }
}

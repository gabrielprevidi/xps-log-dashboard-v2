import { NextRequest, NextResponse } from 'next/server'
import { listarClientesComResumo, criarCliente, reidentificarMovimentacoesOrfas } from '@/lib/supabase-service'
import { getUsuarioAtual } from '@/lib/admin-auth'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const clientes = await listarClientesComResumo()
    return NextResponse.json(clientes)
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || String(error) }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const usuario = await getUsuarioAtual()
    const cliente = await criarCliente(body, usuario ?? undefined)
    // Após criar, vincula automaticamente NFs órfãs que pertençam a este cliente
    const movimentacoesVinculadas = await reidentificarMovimentacoesOrfas(cliente.id)
    return NextResponse.json({ ...cliente, movimentacoes_vinculadas: movimentacoesVinculadas }, { status: 201 })
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || String(error) }, { status: 500 })
  }
}

import { NextRequest, NextResponse } from 'next/server'
import {
  atualizarManuseio,
  corrigirTipoMovimentacao,
  vincularClienteMovimentacao,
  excluirMovimentacao,
  atualizarMovimentacaoCompleta,
  marcarVerificacaoMovimentacao,
} from '@/lib/supabase-service'
import { getUsuarioAtual } from '@/lib/admin-auth'

export const dynamic = 'force-dynamic'

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const body = await request.json()
    const keys = Object.keys(body)
    const usuario = (await getUsuarioAtual()) ?? undefined

    // Corrigir tipo (apenas tipo_movimentacao)
    if (keys.length === 1 && body.tipo_movimentacao) {
      const mov = await corrigirTipoMovimentacao(id, body.tipo_movimentacao, usuario)
      return NextResponse.json(mov)
    }

    // Vincular cliente
    if (keys.length === 1 && body.cliente_id) {
      const mov = await vincularClienteMovimentacao(id, body.cliente_id, usuario)
      return NextResponse.json(mov)
    }

    // Atualizar manuseio
    if (keys.length === 1 && 'valor_manuseio' in body) {
      const mov = await atualizarManuseio(id, body.valor_manuseio, usuario)
      return NextResponse.json(mov)
    }

    // Marcar/desmarcar conferência manual
    if (keys.length === 1 && 'verificado' in body) {
      const mov = await marcarVerificacaoMovimentacao(id, !!body.verificado, usuario)
      return NextResponse.json(mov)
    }

    // Atualização completa (ajuste manual admin)
    const mov = await atualizarMovimentacaoCompleta(id, body, usuario)
    return NextResponse.json(mov)
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || String(error) }, { status: 500 })
  }
}

export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const usuario = (await getUsuarioAtual()) ?? undefined
    await excluirMovimentacao(id, usuario)
    return NextResponse.json({ ok: true })
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || String(error) }, { status: 500 })
  }
}

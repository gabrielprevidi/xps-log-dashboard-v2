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
import { getServerClient } from '@/lib/supabase'
import { assertMesesAbertos, competenciaDe, respostaErro } from '@/lib/fechamento-guard'

export const dynamic = 'force-dynamic'

/**
 * Impede alterar uma movimentação que pertence a um mês fechado — e também
 * movê-la para dentro de um mês fechado (novas datas / novo cliente).
 */
async function assertMovimentacaoEditavel(id: string, novos?: Record<string, any>) {
  const supabase = getServerClient()
  const { data: mov } = await supabase
    .from('movimentacoes')
    .select('cliente_id, data_entrada, data_saida')
    .eq('id', id)
    .maybeSingle()

  if (!mov) return

  await assertMesesAbertos(mov.cliente_id, [
    competenciaDe(mov.data_entrada),
    competenciaDe(mov.data_saida),
  ])

  if (novos) {
    const clienteDestino = novos.cliente_id || mov.cliente_id
    await assertMesesAbertos(clienteDestino, [
      competenciaDe(novos.data_entrada),
      competenciaDe(novos.data_saida),
      // troca de cliente mantendo as datas atuais
      novos.cliente_id ? competenciaDe(mov.data_entrada) : null,
      novos.cliente_id ? competenciaDe(mov.data_saida) : null,
    ])
  }
}

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const body = await request.json()
    const keys = Object.keys(body)
    const usuario = (await getUsuarioAtual()) ?? undefined

    await assertMovimentacaoEditavel(id, body)

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
    const { error: msg, status } = respostaErro(error)
    return NextResponse.json({ error: msg }, { status })
  }
}

export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const usuario = (await getUsuarioAtual()) ?? undefined
    await assertMovimentacaoEditavel(id)
    await excluirMovimentacao(id, usuario)
    return NextResponse.json({ ok: true })
  } catch (error: any) {
    const { error: msg, status } = respostaErro(error)
    return NextResponse.json({ error: msg }, { status })
  }
}

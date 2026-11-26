import { NextRequest, NextResponse } from 'next/server'
import { criarMovimentacaoManual } from '@/lib/supabase-service'
import { getUsuarioAtual } from '@/lib/admin-auth'
import { assertDatasAbertas, respostaErro } from '@/lib/fechamento-guard'

export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    if (!body.cliente_id || !body.tipo_movimentacao) {
      return NextResponse.json({ error: 'cliente_id e tipo_movimentacao obrigatórios' }, { status: 400 })
    }
    await assertDatasAbertas(body.cliente_id, [body.data_entrada, body.data_saida])
    const usuario = await getUsuarioAtual()
    const mov = await criarMovimentacaoManual(body, usuario ?? undefined)
    return NextResponse.json(mov)
  } catch (error: any) {
    const { error: msg, status } = respostaErro(error)
    return NextResponse.json({ error: msg }, { status })
  }
}

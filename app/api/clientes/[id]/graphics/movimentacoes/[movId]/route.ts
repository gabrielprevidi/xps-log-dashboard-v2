import { NextRequest, NextResponse } from 'next/server'
import { marcarVerificacaoGraphics } from '@/lib/supabase-service'
import { getUsuarioAtual } from '@/lib/admin-auth'
import { getServerClient } from '@/lib/supabase'
import { assertDatasAbertas, respostaErro } from '@/lib/fechamento-guard'

export const dynamic = 'force-dynamic'

/** Marca/desmarca a conferência de um lançamento do Graphics. Body: { verificado: boolean } */
export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string; movId: string }> }) {
  try {
    const { id, movId } = await params
    const body = await request.json()
    if (typeof body?.verificado !== 'boolean') {
      return NextResponse.json({ error: 'informe verificado (true/false)' }, { status: 400 })
    }

    // O lançamento precisa ser deste cliente; mês fechado não aceita alteração
    const supabase = getServerClient()
    const { data: mov } = await supabase
      .from('graphics_movimentacoes')
      .select('id, data_mov, graphics_sku!inner(cliente_id)')
      .eq('id', movId)
      .eq('graphics_sku.cliente_id', id)
      .maybeSingle()
    if (!mov) return NextResponse.json({ error: 'lançamento do Graphics não encontrado' }, { status: 404 })
    await assertDatasAbertas(id, [mov.data_mov])

    const usuario = (await getUsuarioAtual()) ?? undefined
    const r = await marcarVerificacaoGraphics(movId, body.verificado, usuario)
    return NextResponse.json(r)
  } catch (error: unknown) {
    const m = (error as { message?: string })?.message ?? ''
    if (/verificado/.test(m) && /column|coluna/i.test(m)) {
      return NextResponse.json({ error: 'Conferência do Graphics ainda não ativada no banco (falta a migration 033).' }, { status: 409 })
    }
    const { error: msg, status } = respostaErro(error)
    return NextResponse.json({ error: msg }, { status })
  }
}

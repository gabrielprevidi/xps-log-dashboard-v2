import { NextRequest, NextResponse } from 'next/server'
import { limparDadosCliente } from '@/lib/supabase-service'

export const dynamic = 'force-dynamic'

/**
 * DELETE /api/clientes/[id]/limpar
 * Remove todas as movimentações e arquivos NF-e do cliente.
 * Requer header X-Confirm: limpar para evitar chamadas acidentais.
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    // Proteção extra: exige header de confirmação explícita
    const confirmHeader = request.headers.get('X-Confirm')
    if (confirmHeader !== 'limpar') {
      return NextResponse.json(
        { error: 'Confirmação necessária. Envie o header X-Confirm: limpar' },
        { status: 400 }
      )
    }

    const { id } = await params
    const resultado = await limparDadosCliente(id)

    return NextResponse.json({
      success: true,
      movimentacoes_removidas: resultado.movimentacoes,
      arquivos_removidos: resultado.arquivos,
    })
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || String(error) },
      { status: 500 }
    )
  }
}

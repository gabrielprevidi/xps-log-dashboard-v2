import { NextRequest, NextResponse } from 'next/server'
import { buscarClientePorId, listarSaldosMensais } from '@/lib/supabase-service'
import { getServerClient } from '@/lib/supabase'
import { gerarPlanilhaCliente } from '@/lib/cliente-export'

export const dynamic = 'force-dynamic'

/**
 * GET /api/clientes/[id]/export
 * Gera e retorna uma planilha Excel (.xlsx) com todas as informações do
 * cliente, separadas por mês (aba Resumo + uma aba por mês).
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params

    const { cliente, movimentacoes } = await buscarClientePorId(id)
    if (!cliente) {
      return NextResponse.json({ error: 'Cliente não encontrado' }, { status: 404 })
    }

    const saldos = await listarSaldosMensais(id)

    const supabase = getServerClient()
    const [{ data: cobrancas }, { data: fechamentos }] = await Promise.all([
      supabase
        .from('cobrancas_adicionais')
        .select('competencia, descricao, valor')
        .eq('cliente_id', id),
      supabase
        .from('fechamento_mensal')
        .select('competencia, status')
        .eq('cliente_id', id),
    ])

    const buffer = await gerarPlanilhaCliente(
      cliente,
      movimentacoes ?? [],
      (saldos ?? []) as any,
      (cobrancas ?? []) as any,
      (fechamentos ?? []) as any,
    )

    const nomeCli = (cliente.nome_fantasia || cliente.nome || 'cliente')
      .normalize('NFD').replace(/[̀-ͯ]/g, '')
      .replace(/[^a-zA-Z0-9]+/g, '_').replace(/^_+|_+$/g, '')
    const hoje = new Date().toISOString().slice(0, 10)
    const fileName = `XPSLOG_${nomeCli}_${hoje}.xlsx`

    return new NextResponse(buffer as any, {
      status: 200,
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="${fileName}"`,
        'Cache-Control': 'no-store',
      },
    })
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || String(error) }, { status: 500 })
  }
}

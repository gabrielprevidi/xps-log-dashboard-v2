import { NextRequest, NextResponse } from 'next/server'
import { listarSaldosMensais, upsertSaldoMensal } from '@/lib/supabase-service'
import { assertMesAberto, competenciaDe, respostaErro } from '@/lib/fechamento-guard'

export const dynamic = 'force-dynamic'

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const saldos = await listarSaldosMensais(id)
    return NextResponse.json(saldos)
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || String(error) }, { status: 500 })
  }
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const { competencia, volume_inicial } = await request.json()
    await assertMesAberto(id, competenciaDe(competencia))
    const saldo = await upsertSaldoMensal(id, competencia, volume_inicial)
    return NextResponse.json(saldo)
  } catch (error: any) {
    const { error: msg, status } = respostaErro(error)
    return NextResponse.json({ error: msg }, { status })
  }
}

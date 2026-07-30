import { NextRequest, NextResponse } from 'next/server'
import { listarCobrancasAdicionais, criarCobrancaAdicional, excluirCobrancaAdicional } from '@/lib/supabase-service'

export const dynamic = 'force-dynamic'

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const competencia = new URL(_req.url).searchParams.get('competencia') || ''
    const data = await listarCobrancasAdicionais(id, competencia)
    return NextResponse.json(data)
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || String(error) }, { status: 500 })
  }
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const body = await request.json()
    const { competencia, descricao, valor } = body
    if (!competencia || !descricao || valor == null) {
      return NextResponse.json({ error: 'competencia, descricao e valor obrigatórios' }, { status: 400 })
    }
    const data = await criarCobrancaAdicional(id, competencia, descricao, parseFloat(valor))
    return NextResponse.json(data)
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || String(error) }, { status: 500 })
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const cobrancaId = new URL(request.url).searchParams.get('cobranca_id')
    if (!cobrancaId) return NextResponse.json({ error: 'cobranca_id obrigatório' }, { status: 400 })
    await excluirCobrancaAdicional(cobrancaId)
    return NextResponse.json({ ok: true })
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || String(error) }, { status: 500 })
  }
}

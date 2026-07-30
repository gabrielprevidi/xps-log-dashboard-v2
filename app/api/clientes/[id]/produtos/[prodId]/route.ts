import { NextRequest, NextResponse } from 'next/server'
import { atualizarProduto, deletarProduto } from '@/lib/supabase-service'

export const dynamic = 'force-dynamic'

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string; prodId: string }> }) {
  try {
    const { prodId } = await params
    const body = await request.json()
    const { nome, codigo_ncm, palavras_chave, valor_pallet, aliquota_imposto, regra_fator_pallet, categoria } = body
    const data = await atualizarProduto(prodId, {
      nome,
      codigo_ncm: codigo_ncm || null,
      palavras_chave: palavras_chave || null,
      valor_pallet: valor_pallet != null ? parseFloat(valor_pallet) : undefined,
      aliquota_imposto: aliquota_imposto != null ? parseFloat(aliquota_imposto) : undefined,
      regra_fator_pallet: regra_fator_pallet != null ? parseFloat(regra_fator_pallet) : undefined,
      categoria: categoria || undefined,
    })
    return NextResponse.json(data)
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || String(error) }, { status: 500 })
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string; prodId: string }> }) {
  try {
    const { prodId } = await params
    await deletarProduto(prodId)
    return NextResponse.json({ ok: true })
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || String(error) }, { status: 500 })
  }
}

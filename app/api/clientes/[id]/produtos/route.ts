import { NextRequest, NextResponse } from 'next/server'
import { listarProdutosCliente, criarProduto } from '@/lib/supabase-service'

export const dynamic = 'force-dynamic'

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const data = await listarProdutosCliente(id)
    return NextResponse.json(data)
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || String(error) }, { status: 500 })
  }
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const body = await request.json()
    const { nome, codigo_ncm, palavras_chave, valor_pallet, aliquota_imposto, regra_fator_pallet, categoria } = body
    if (!nome || valor_pallet == null || aliquota_imposto == null || regra_fator_pallet == null) {
      return NextResponse.json({ error: 'nome, valor_pallet, aliquota_imposto e regra_fator_pallet são obrigatórios' }, { status: 400 })
    }
    const data = await criarProduto(id, {
      nome,
      codigo_ncm: codigo_ncm || null,
      palavras_chave: palavras_chave || null,
      valor_pallet: parseFloat(valor_pallet),
      aliquota_imposto: parseFloat(aliquota_imposto),
      regra_fator_pallet: parseFloat(regra_fator_pallet),
      categoria: categoria || 'pa',
    })
    return NextResponse.json(data, { status: 201 })
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || String(error) }, { status: 500 })
  }
}

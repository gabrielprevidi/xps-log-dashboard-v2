import { NextRequest, NextResponse } from 'next/server'
import { parseNFePDF } from '@/lib/nfe-pdf-parser'
import { parseNFe } from '@/lib/nfe-parser'

export const dynamic = 'force-dynamic'

/**
 * POST /api/diagnostico/nfe-parser
 * Aceita um PDF ou XML de NF-e e retorna o texto extraído + itens detectados.
 * Usado para diagnosticar por que o parser não está separando produtos.
 */
export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData()
    const arquivo = formData.get('arquivo') as File | null
    if (!arquivo) {
      return NextResponse.json({ error: 'Envie um arquivo PDF ou XML no campo "arquivo"' }, { status: 400 })
    }

    const buffer = Buffer.from(await arquivo.arrayBuffer())
    const nomeLower = arquivo.name.toLowerCase()
    const ehXML = nomeLower.endsWith('.xml')

    if (ehXML) {
      const xml = buffer.toString('utf-8')
      const dados = await parseNFe(xml)
      return NextResponse.json({
        tipo: 'xml',
        numero_nfe: dados?.numero_nfe,
        itens: dados?.itens ?? [],
        total_itens: dados?.itens?.length ?? 0,
        peso_liquido_total_kg: dados?.peso_liquido_total,
        peso_liquido_total_ton: (dados?.peso_liquido_total ?? 0) / 1000,
      })
    }

    // PDF
    const dados = await parseNFePDF(buffer)
    const texto = (dados as any)?.texto_pdf ?? ''

    return NextResponse.json({
      tipo: 'pdf',
      numero_nfe: dados?.numero_nfe,
      chave_nfe: dados?.chave_nfe,
      peso_liquido_total_kg: dados?.peso_liquido_total,
      peso_liquido_total_ton: (dados?.peso_liquido_total ?? 0) / 1000,
      itens_extraidos: dados?.itens ?? [],
      total_itens: dados?.itens?.length ?? 0,
      // Texto bruto para diagnóstico (primeiros 3000 chars)
      texto_pdf_preview: texto.slice(0, 3000),
      // Linhas que contêm dígitos (ajuda a ver o layout da tabela)
      linhas_com_numeros: texto
        .split('\n')
        .map((l: string, i: number) => ({ linha: i + 1, texto: l }))
        .filter((l: { linha: number; texto: string }) => /\d/.test(l.texto) && l.texto.trim().length > 5)
        .slice(0, 60),
    })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}

import { NextRequest, NextResponse } from 'next/server'
import { getServerClient } from '@/lib/supabase'
import { getUsuarioAtual } from '@/lib/admin-auth'
import { processarArquivoAnexo } from '@/lib/anexos'
import type { AnexoXML } from '@/lib/anexos'
import { persistirAnexo, registrarLog } from '@/lib/supabase-service'
import type { ResultadoPersistencia } from '@/lib/supabase-service'

export const dynamic = 'force-dynamic'

/**
 * POST /api/clientes/[id]/nfes
 * Upload manual de uma NF-e (PDF) diretamente no cliente, fora do fluxo de
 * e-mail. Reaproveita o mesmo pipeline de extração e regras de negócio
 * (Fedrigoni/Tecnia/Avery/espécie) usado para os PDFs recebidos por e-mail —
 * só troca a origem do arquivo e força o cliente (não tenta identificar por
 * CNPJ/remetente).
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const usuario = await getUsuarioAtual()
  if (!usuario) return NextResponse.json({ error: 'Não autorizado' }, { status: 401 })

  try {
    const { id: clienteId } = await params
    const formData = await request.formData()
    const arquivo = formData.get('arquivo') as File | null
    if (!arquivo) return NextResponse.json({ error: 'Arquivo obrigatório' }, { status: 400 })
    if (!arquivo.name.toLowerCase().endsWith('.pdf')) {
      return NextResponse.json({ error: 'Apenas arquivos PDF são aceitos' }, { status: 400 })
    }

    const bytes = await arquivo.arrayBuffer()
    const buffer = Buffer.from(bytes)

    const anexos: AnexoXML[] = []
    await processarArquivoAnexo(arquivo.name, arquivo.type || 'application/pdf', buffer, anexos)

    if (anexos.length === 0) {
      return NextResponse.json({ error: 'Não foi possível reconhecer uma NF-e neste PDF.' }, { status: 422 })
    }

    const supabase = getServerClient()
    const resultado: ResultadoPersistencia = { email_id: null, anexos_salvos: 0, movimentacoes_salvas: 0, duplicados: 0, erros: [] }

    let ultimoArquivoId: string | null = null
    let ultimaMovimentacaoId: string | null = null
    let dadosNfe: AnexoXML['dados_nfe'] = null

    for (const anexo of anexos) {
      const res = await persistirAnexo(supabase, null, anexo, resultado, '', '', '', [], {
        clienteIdForcado: clienteId,
        uploadManual: true,
        enviadoPor: usuario.id,
      })
      if (res.arquivoId) {
        ultimoArquivoId = res.arquivoId
        dadosNfe = anexo.dados_nfe
      }
      if (res.movimentacaoId) ultimaMovimentacaoId = res.movimentacaoId
    }

    if (resultado.duplicados > 0 && !ultimoArquivoId) {
      return NextResponse.json({ error: 'Esta NF-e já havia sido importada anteriormente.' }, { status: 409 })
    }

    // Sobe o PDF original para o storage e grava a URL, só quando algo foi de fato persistido
    let arquivoUrl: string | null = null
    if (ultimoArquivoId) {
      const caminho = `clientes/${clienteId}/${ultimoArquivoId}-${arquivo.name}`
      const { error: uploadError } = await supabase.storage
        .from('notas-fiscais')
        .upload(caminho, buffer, { contentType: arquivo.type || 'application/pdf', upsert: true })

      if (!uploadError) {
        const { data: urlData } = supabase.storage.from('notas-fiscais').getPublicUrl(caminho)
        arquivoUrl = urlData.publicUrl
        await supabase.from('arquivos_nfe').update({ arquivo_url: arquivoUrl }).eq('id', ultimoArquivoId)
      }
    }

    await registrarLog(usuario, 'criar', 'nfe_manual', ultimoArquivoId, {
      cliente_id: clienteId,
      nome_arquivo: arquivo.name,
      numero_nfe: dadosNfe?.numero_nfe ?? null,
    })

    return NextResponse.json({
      movimentacaoId: ultimaMovimentacaoId,
      arquivoId: ultimoArquivoId,
      arquivoUrl,
      dados_nfe: dadosNfe,
      avisos: resultado.erros,
    })
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || String(error) }, { status: 500 })
  }
}

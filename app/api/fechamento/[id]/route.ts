import { NextRequest, NextResponse } from 'next/server'
import { getServerClient } from '@/lib/supabase'
import { getSessaoAdmin } from '@/lib/admin-auth'

export const dynamic = 'force-dynamic'

const MASTER_PASSWORD = process.env.FECHAMENTO_SENHA_MASTER || 'ATENCAO@2026'

// PATCH /api/fechamento/[id] — admin anexa (ou substitui) a NF de cobrança do mês fechado
// Body: FormData com campo "arquivo" (File)
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const adminOk = await getSessaoAdmin()
    if (!adminOk) return NextResponse.json({ error: 'Não autorizado' }, { status: 401 })

    const { id } = await params
    const supabase = getServerClient()

    const { data: fechamento, error: fetchError } = await supabase
      .from('fechamento_mensal')
      .select('*')
      .eq('id', id)
      .single()

    if (fetchError || !fechamento) {
      return NextResponse.json({ error: 'Fechamento não encontrado' }, { status: 404 })
    }

    if (fechamento.status === 'aberto') {
      return NextResponse.json({ error: 'Feche o mês antes de anexar a NF de cobrança' }, { status: 400 })
    }

    const formData = await request.formData()
    const arquivo = formData.get('arquivo') as File | null

    if (!arquivo) {
      return NextResponse.json({ error: 'Arquivo NF obrigatório' }, { status: 400 })
    }

    const bytes = await arquivo.arrayBuffer()
    const buffer = Buffer.from(bytes)
    const clienteId = fechamento.cliente_id
    const competencia = (fechamento.competencia as string).slice(0, 7)
    const nomeArquivo = `fechamento/${clienteId}/${competencia}/${arquivo.name}`

    const { error: uploadError } = await supabase.storage
      .from('cobrancas')
      .upload(nomeArquivo, buffer, { contentType: arquivo.type, upsert: true })

    if (uploadError) throw new Error(`Erro no upload: ${uploadError.message}`)

    const { data: urlData } = supabase.storage.from('cobrancas').getPublicUrl(nomeArquivo)

    const { data: updated, error: updateError } = await supabase
      .from('fechamento_mensal')
      .update({
        status: 'nf_emitida',
        arquivo_cobranca_url: urlData.publicUrl,
        arquivo_cobranca_nome: arquivo.name,
        nf_anexada_em: new Date().toISOString(),
      })
      .eq('id', id)
      .select()
      .single()

    if (updateError) throw new Error(updateError.message)

    return NextResponse.json(updated)
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}

// DELETE /api/fechamento/[id] — admin reabre o mês (remove o bloqueio), exige senha master
// A NF já anexada é preservada e continua disponível para download.
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const body = await request.json()

    const adminOk = await getSessaoAdmin()
    if (!adminOk) return NextResponse.json({ error: 'Não autorizado' }, { status: 401 })

    if (body.senha_master !== MASTER_PASSWORD) {
      return NextResponse.json({ error: 'Senha master incorreta' }, { status: 403 })
    }

    const supabase = getServerClient()
    const { data: updated, error } = await supabase
      .from('fechamento_mensal')
      .update({
        status: 'aberto',
        fechado_em: null,
        fechado_por: null,
      })
      .eq('id', id)
      .select()
      .single()

    if (error) throw new Error(error.message)
    return NextResponse.json(updated)
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}

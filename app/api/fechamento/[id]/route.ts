import { NextRequest, NextResponse } from 'next/server'
import { getServerClient } from '@/lib/supabase'
import { getSessaoPortal } from '@/lib/portal-auth'
import { getSessaoAdmin } from '@/lib/admin-auth'

export const dynamic = 'force-dynamic'

// PATCH /api/fechamento/[id] — admin anexa NF após aprovação do cliente (aprovado → nf_emitida)
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

    if (fechamento.status !== 'aprovado') {
      return NextResponse.json({ error: 'Somente fechamentos aprovados pelo cliente podem receber NF' }, { status: 400 })
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
      })
      .eq('id', id)
      .select()
      .single()

    if (updateError) throw new Error(updateError.message)

    // Notifica o cliente via tabela de notificações
    const mesNome = new Date(`${competencia}-15`).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })
    await supabase.from('notificacoes').insert({
      tipo: 'nf_emitida',
      cliente_id: clienteId,
      competencia,
      mensagem: `NF de ${mesNome} emitida e disponível para download`,
    })

    return NextResponse.json(updated)
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}

// DELETE /api/fechamento/[id] — admin reabre mês (qualquer status → aberto), exige senha master
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const body = await request.json()

    const adminOk = await getSessaoAdmin()
    if (!adminOk) return NextResponse.json({ error: 'Não autorizado' }, { status: 401 })

    const MASTER_PASSWORD = 'ATENCAO@2026'
    if (body.senha_master !== MASTER_PASSWORD) {
      return NextResponse.json({ error: 'Senha master incorreta' }, { status: 403 })
    }

    const supabase = getServerClient()
    const { data: updated, error } = await supabase
      .from('fechamento_mensal')
      .update({
        status: 'aberto',
        arquivo_cobranca_url: null,
        arquivo_cobranca_nome: null,
        aprovado_em: null,
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

// PUT /api/fechamento/[id] — cliente aprova (fechado → aprovado)
export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const body = await request.json()

    if (body.acao !== 'aprovar') {
      return NextResponse.json({ error: 'Ação inválida' }, { status: 400 })
    }

    const sessao = await getSessaoPortal()
    if (!sessao) return NextResponse.json({ error: 'Não autorizado' }, { status: 401 })

    const supabase = getServerClient()

    const { data: fechamento, error: fetchError } = await supabase
      .from('fechamento_mensal')
      .select('*')
      .eq('id', id)
      .eq('cliente_id', sessao.clienteId)
      .single()

    if (fetchError || !fechamento) {
      return NextResponse.json({ error: 'Fechamento não encontrado' }, { status: 404 })
    }

    if (fechamento.status !== 'fechado') {
      return NextResponse.json({ error: 'Somente meses com status "fechado" podem ser aprovados' }, { status: 400 })
    }

    const { data: updated, error: updateError } = await supabase
      .from('fechamento_mensal')
      .update({ status: 'aprovado', aprovado_em: new Date().toISOString() })
      .eq('id', id)
      .select()
      .single()

    if (updateError) throw new Error(updateError.message)

    // Notifica o admin
    const competencia = (fechamento.competencia as string).slice(0, 7)
    const { data: clienteData } = await supabase
      .from('clientes')
      .select('nome_fantasia, nome')
      .eq('id', sessao.clienteId)
      .single()

    const nomeCliente = clienteData?.nome_fantasia || clienteData?.nome || sessao.usuario
    const mesNome = new Date(`${competencia}-15`).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })

    await supabase.from('notificacoes').insert({
      tipo: 'aprovacao_cobranca',
      cliente_id: sessao.clienteId,
      competencia,
      mensagem: `${nomeCliente} aprovou o fechamento de ${mesNome} — aguardando emissão da NF`,
    })

    return NextResponse.json(updated)
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}

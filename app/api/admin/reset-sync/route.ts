import { NextResponse } from 'next/server'
import { getSessaoAdmin } from '@/lib/admin-auth'
import { createClient } from '@supabase/supabase-js'
import { sincronizarCnpjsClientes } from '@/lib/supabase-service'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

function getServerClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return createClient(url, key) as any
}

export async function POST() {
  if (!(await getSessaoAdmin())) {
    return NextResponse.json({ error: 'Não autorizado' }, { status: 401 })
  }

  const supabase = getServerClient()
  const erros: string[] = []
  const contagens: Record<string, number> = {}

  // 1. Movimentações originadas de NF-e (preserva entradas manuais)
  const { data: movs, error: movCountErr } = await supabase
    .from('movimentacoes')
    .select('id', { count: 'exact', head: false })
    .not('arquivo_nfe_id', 'is', null)

  if (movCountErr) {
    erros.push(`Erro ao contar movimentações: ${movCountErr.message}`)
  } else {
    contagens.movimentacoes = movs?.length ?? 0
    const { error: movDelErr } = await supabase
      .from('movimentacoes')
      .delete()
      .not('arquivo_nfe_id', 'is', null)
    if (movDelErr) erros.push(`Erro ao deletar movimentações: ${movDelErr.message}`)
  }

  // 2. Arquivos NF-e
  const { data: arqs, error: arqCountErr } = await supabase
    .from('arquivos_nfe')
    .select('id', { count: 'exact', head: false })

  if (arqCountErr) {
    erros.push(`Erro ao contar arquivos_nfe: ${arqCountErr.message}`)
  } else {
    contagens.arquivos_nfe = arqs?.length ?? 0
    const { error: arqDelErr } = await supabase
      .from('arquivos_nfe')
      .delete()
      .neq('id', '00000000-0000-0000-0000-000000000000') // força delete de todos
    if (arqDelErr) erros.push(`Erro ao deletar arquivos_nfe: ${arqDelErr.message}`)
  }

  // 3. Emails importados
  const { data: emails, error: emailCountErr } = await supabase
    .from('emails_importados')
    .select('id', { count: 'exact', head: false })

  if (emailCountErr) {
    erros.push(`Erro ao contar emails_importados: ${emailCountErr.message}`)
  } else {
    contagens.emails_importados = emails?.length ?? 0
    const { error: emailDelErr } = await supabase
      .from('emails_importados')
      .delete()
      .neq('id', '00000000-0000-0000-0000-000000000000')
    if (emailDelErr) erros.push(`Erro ao deletar emails_importados: ${emailDelErr.message}`)
  }

  if (erros.length > 0) {
    return NextResponse.json({ ok: false, erros, contagens }, { status: 500 })
  }

  // Backfill: garante que todos os CNPJs dos clientes estejam em clientes_cnpj
  const cnpjsSincronizados = await sincronizarCnpjsClientes()

  return NextResponse.json({
    ok: true,
    mensagem: 'Dados de sincronização apagados. Execute a sincronização novamente.',
    contagens,
    cnpjs_sincronizados: cnpjsSincronizados,
  })
}

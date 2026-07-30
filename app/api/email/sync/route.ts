import { NextRequest, NextResponse } from 'next/server'
import { lerEmailsNFe, EmailDiagnostico } from '@/lib/email-service'
import { persistirEmail, listarMessageIdsImportados } from '@/lib/supabase-service'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}))
  const diasAtras: number = body.dias_atras ?? 90
  const limite: number = body.limite ?? 120

  try {
    const idsJaProcessados = await listarMessageIdsImportados()
    const emailsIgnorados: EmailDiagnostico[] = []
    const emails = await lerEmailsNFe(diasAtras, idsJaProcessados, emailsIgnorados, limite)

    let nfes_salvas = 0
    let duplicados = 0
    const erros: string[] = []
    const detalhes: object[] = []

    for (const email of emails) {
      const resultado = await persistirEmail(email)

      nfes_salvas += resultado.movimentacoes_salvas
      duplicados += resultado.duplicados
      erros.push(...resultado.erros)

      detalhes.push({
        message_id: email.message_id,
        assunto: email.assunto,
        remetente: email.remetente,
        data_recebimento: email.data_recebimento,
        email_id_banco: resultado.email_id,
        anexos_processados: email.anexos_xml.length,
        anexos_salvos: resultado.anexos_salvos,
        movimentacoes_salvas: resultado.movimentacoes_salvas,
        duplicados: resultado.duplicados,
        erros: resultado.erros,
        nfes: email.anexos_xml.map((a) => ({
          arquivo: a.nome_arquivo,
          hash: a.hash,
          pallets: a.pallets_calculados,
          nfe: a.dados_nfe
            ? {
                numero: a.dados_nfe.numero_nfe,
                chave: a.dados_nfe.chave_nfe,
                data_emissao: a.dados_nfe.data_emissao,
                emitente: a.dados_nfe.nome_emitente,
                destinatario: a.dados_nfe.nome_destinatario,
                natureza_operacao: a.dados_nfe.natureza_operacao,
                tipo_operacao: a.dados_nfe.tipo_operacao,
                peso_ton: +(a.dados_nfe.peso_liquido_total / 1000).toFixed(4),
              }
            : null,
        })),
      })
    }

    return NextResponse.json({
      emails_lidos: emails.length,
      nfes_salvas,
      duplicados,
      erros,
      detalhes,
      emails_ignorados: emailsIgnorados,
    })
  } catch (error: any) {
    console.error('Erro ao sincronizar emails:', error)
    return NextResponse.json(
      {
        error: 'Falha na sincronização',
        detalhe: error?.message || String(error),
      },
      { status: 500 }
    )
  }
}

export async function GET() {
  return NextResponse.json({
    status: 'ok',
    email: process.env.MS_USER_EMAIL || 'xps.ai@exsa.srv.br',
    assuntos_monitorados: (process.env.EMAIL_ASSUNTOS || 'NFe,Nota Fiscal,NF-e').split(','),
  })
}

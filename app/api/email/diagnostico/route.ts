import { NextResponse } from 'next/server'
import { getGraphClient } from '@/lib/graph-client'

export const dynamic = 'force-dynamic'

/**
 * Endpoint de diagnóstico para verificar a conexão com o Microsoft Graph API.
 * Testa autenticação, permissões e leitura da caixa de email.
 */
export async function GET() {
  const diagnostico: Record<string, unknown> = {
    timestamp: new Date().toISOString(),
    etapas: [],
  }

  const etapas: Array<{ nome: string; status: string; detalhe?: string }> = []

  // 1. Verificar variáveis de ambiente
  const envVars = {
    MS_TENANT_ID: !!process.env.MS_TENANT_ID,
    MS_CLIENT_ID: !!process.env.MS_CLIENT_ID,
    MS_CLIENT_SECRET: !!process.env.MS_CLIENT_SECRET,
    MS_USER_EMAIL: process.env.MS_USER_EMAIL || '(não definido)',
  }
  const todasPresentes = envVars.MS_TENANT_ID && envVars.MS_CLIENT_ID && envVars.MS_CLIENT_SECRET

  etapas.push({
    nome: '1. Variáveis de Ambiente',
    status: todasPresentes ? '✅ OK' : '❌ FALTAM',
    detalhe: JSON.stringify(envVars),
  })

  if (!todasPresentes) {
    diagnostico.etapas = etapas
    diagnostico.resultado = 'FALHA — variáveis de ambiente faltando'
    return NextResponse.json(diagnostico, { status: 500 })
  }

  // 2. Testar autenticação (obter token)
  try {
    const graphClient = getGraphClient()
    etapas.push({
      nome: '2. Criação do Graph Client',
      status: '✅ OK',
    })

    // 3. Testar leitura da caixa de email (1 email apenas)
    const emailUser = process.env.MS_USER_EMAIL || 'xps.ai@exsa.srv.br'

    try {
      const response = await graphClient
        .api(`/users/${emailUser}/messages`)
        .select('id,subject,receivedDateTime,hasAttachments')
        .top(1)
        .orderby('receivedDateTime desc')
        .get()

      const qtdEmails = response.value?.length ?? 0
      const ultimoEmail = response.value?.[0]

      etapas.push({
        nome: '3. Leitura de Emails (Graph API)',
        status: '✅ OK',
        detalhe: qtdEmails > 0
          ? `Último email: "${ultimoEmail.subject}" em ${ultimoEmail.receivedDateTime}, tem anexos: ${ultimoEmail.hasAttachments}`
          : 'Caixa vazia ou sem acesso',
      })

      // 4. Testar se consegue listar anexos (se houver email com anexo)
      if (ultimoEmail?.hasAttachments) {
        try {
          const anexos = await graphClient
            .api(`/users/${emailUser}/messages/${ultimoEmail.id}/attachments`)
            .select('name,contentType,size')
            .get()

          const nomes = (anexos.value || []).map((a: any) => `${a.name} (${a.contentType}, ${a.size}b)`)

          etapas.push({
            nome: '4. Leitura de Anexos',
            status: '✅ OK',
            detalhe: `${nomes.length} anexo(s): ${nomes.join(', ')}`,
          })
        } catch (err: any) {
          etapas.push({
            nome: '4. Leitura de Anexos',
            status: '❌ FALHA',
            detalhe: err.message || String(err),
          })
        }
      } else {
        etapas.push({
          nome: '4. Leitura de Anexos',
          status: '⏭️ Pulado',
          detalhe: 'Último email não tem anexos',
        })
      }

      // 5. Testar filtro com hasAttachments (como o sync real faz)
      try {
        const dataInicio = new Date()
        dataInicio.setDate(dataInicio.getDate() - 7)
        const filtro = `receivedDateTime ge ${dataInicio.toISOString()} and hasAttachments eq true`

        const filtered = await graphClient
          .api(`/users/${emailUser}/messages`)
          .filter(filtro)
          .select('id,subject')
          .top(5)
          .get()

        etapas.push({
          nome: '5. Filtro de Emails com Anexos (7 dias)',
          status: '✅ OK',
          detalhe: `${filtered.value?.length ?? 0} email(s) com anexos nos últimos 7 dias`,
        })
      } catch (err: any) {
        etapas.push({
          nome: '5. Filtro de Emails com Anexos',
          status: '❌ FALHA',
          detalhe: err.message || String(err),
        })
      }
    } catch (err: any) {
      const msg = err.message || String(err)
      const ehExpiracao = msg.includes('AADSTS7000215') || msg.includes('expired') || msg.includes('invalid_client')
      
      etapas.push({
        nome: '3. Leitura de Emails (Graph API)',
        status: '❌ FALHA',
        detalhe: ehExpiracao
          ? `🔑 CLIENT SECRET EXPIRADO OU INVÁLIDO. Gere um novo no Azure Portal → App registrations → Certificates & secrets. Erro: ${msg}`
          : `Erro: ${msg}`,
      })
    }
  } catch (err: any) {
    etapas.push({
      nome: '2. Criação do Graph Client',
      status: '❌ FALHA',
      detalhe: err.message || String(err),
    })
  }

  diagnostico.etapas = etapas
  const temFalha = etapas.some(e => e.status.includes('❌'))
  diagnostico.resultado = temFalha ? 'FALHA — verificar etapas com ❌' : 'TUDO OK'

  return NextResponse.json(diagnostico, { status: temFalha ? 500 : 200 })
}

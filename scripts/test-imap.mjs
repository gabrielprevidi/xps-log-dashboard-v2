/**
 * Teste de conexão IMAP — SOMENTE LEITURA.
 *
 * Abre a caixa em modo readOnly: nada é marcado como lido, movido ou alterado.
 * Serve para validar credenciais, descobrir o caminho real das pastas e o
 * separador de hierarquia do servidor, e ler a marca d'água inicial da INBOX.
 *
 * Uso:
 *   node --env-file=.env.local scripts/test-imap.mjs
 */
import { ImapFlow } from 'imapflow'

const { IMAP_HOST, IMAP_PORT, IMAP_USER, IMAP_PASSWORD } = process.env

if (!IMAP_HOST || !IMAP_USER || !IMAP_PASSWORD) {
  console.error('\n❌ Faltam variáveis no .env.local:')
  console.error('   IMAP_HOST     =', IMAP_HOST || '(vazio)')
  console.error('   IMAP_USER     =', IMAP_USER || '(vazio)')
  console.error('   IMAP_PASSWORD =', IMAP_PASSWORD ? '(preenchida)' : '(VAZIA — preencha)')
  process.exit(1)
}

// Porta e modo de TLS vêm do ambiente (podem ser sobrescritos por argumento):
//   993 → TLS implícito (secure: true)
//   143 → STARTTLS      (secure: false; o imapflow faz o upgrade automaticamente)
const porta = Number(process.argv[2] || IMAP_PORT || 993)
const seguro = process.argv[3]
  ? process.argv[3] === 'true'
  : String(process.env.IMAP_SECURE ?? 'true') === 'true'

const client = new ImapFlow({
  host: IMAP_HOST,
  port: porta,
  secure: seguro,
  auth: { user: IMAP_USER, pass: IMAP_PASSWORD },
  logger: false,
  // Falha rápido se o servidor não responder (ex.: bloqueio de IP)
  socketTimeout: 20000,
  greetingTimeout: 15000,
})

const t0 = Date.now()

try {
  await client.connect()
  console.log(`\n✅ Conectado a ${IMAP_HOST}:${porta} (${seguro ? 'TLS implícito' : 'STARTTLS'}) em ${Date.now() - t0}ms`)
  console.log(`   usuário: ${IMAP_USER}`)
  if (client.serverInfo?.vendor || client.serverInfo?.name) {
    console.log(`   servidor: ${client.serverInfo.name ?? ''} ${client.serverInfo.vendor ?? ''}`.trim())
  }

  console.log('\n── Pastas disponíveis ──')
  let delim = null
  for (const box of await client.list()) {
    delim ??= box.delimiter
    const flags = [...(box.flags ?? [])].join(' ')
    console.log(`   ${JSON.stringify(box.path)}${flags ? '   [' + flags + ']' : ''}`)
  }
  console.log(`\n   separador de hierarquia deste servidor: ${JSON.stringify(delim)}`)

  // INBOX — marca d'água inicial. readOnly garante que nada é marcado como lido.
  const inbox = await client.mailboxOpen('INBOX', { readOnly: true })
  console.log('\n── INBOX (aberta somente leitura) ──')
  console.log(`   mensagens totais : ${inbox.exists}`)
  console.log(`   uidValidity      : ${inbox.uidValidity}`)
  console.log(`   uidNext          : ${inbox.uidNext}   ← marca d'água inicial`)

  // Amostra das 5 mais recentes, só cabeçalho e estrutura (não baixa anexo).
  if (inbox.exists > 0) {
    console.log('\n── 5 mensagens mais recentes (sem baixar anexos) ──')
    const inicio = Math.max(1, inbox.exists - 4)
    for await (const msg of client.fetch(`${inicio}:*`, {
      uid: true, envelope: true, bodyStructure: true,
    })) {
      const anexos = []
      const varrer = (node) => {
        if (!node) return
        if (node.disposition === 'attachment' || node.dispositionParameters?.filename) {
          anexos.push(node.dispositionParameters?.filename ?? node.parameters?.name ?? '(sem nome)')
        }
        for (const filho of node.childNodes ?? []) varrer(filho)
      }
      varrer(msg.bodyStructure)
      const de = msg.envelope?.from?.[0]
      console.log(
        `   UID ${String(msg.uid).padStart(6)} | ${msg.envelope?.date?.toISOString?.().slice(0, 10) ?? '?'}` +
        ` | ${(de?.address ?? '?').slice(0, 32).padEnd(32)} | ${(msg.envelope?.subject ?? '(sem assunto)').slice(0, 40)}`
      )
      if (anexos.length) console.log(`               anexos: ${anexos.join(', ')}`)
    }
  }

  await client.mailboxClose()
  console.log('\n✅ Teste concluído. Nada foi alterado na caixa.')
} catch (err) {
  console.error(`\n❌ Falhou após ${Date.now() - t0}ms`)
  console.error(`   ${err.message}`)
  const m = String(err.message).toLowerCase()
  if (m.includes('auth') || m.includes('login') || m.includes('credential')) {
    console.error('\n   → Usuário ou senha incorretos. Confira IMAP_PASSWORD no .env.local.')
    console.error('     Alguns provedores exigem "senha de aplicativo" separada.')
  } else if (m.includes('timeout') || m.includes('econnrefused') || m.includes('enotfound')) {
    console.error('\n   → Não chegou no servidor. Possíveis causas:')
    console.error('     • host ou porta errados (esperado imap.xpslog.com.br:993)')
    console.error('     • firewall do provedor bloqueando este IP')
    console.error('     • IMAP desabilitado para esta caixa')
  } else if (m.includes('certificate') || m.includes('self signed')) {
    console.error('\n   → Certificado TLS inválido. Confirmar o hostname correto com o provedor.')
  }
  process.exitCode = 1
} finally {
  try { await client.logout() } catch { /* já caiu */ }
}

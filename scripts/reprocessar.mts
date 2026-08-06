/**
 * Reprocessa mensagens específicas, identificadas por pasta e UID.
 *
 * Para quando uma nota não entrou e a marca d'água já passou da mensagem —
 * rebobinar a marca custaria reexaminar centenas de emails. Aqui roda local,
 * sem o limite de 60s da Vercel, e usa o MESMO pipeline da rotina
 * (`processarEmailV2`), então a decisão é idêntica à de produção.
 *
 * A deduplicação continua ativa: rodar duas vezes não duplica nada.
 *
 * Uso:
 *   npx tsx --env-file=.env.local scripts/reprocessar.mts INBOX 176219 176582 176739
 *   npx tsx --env-file=.env.local scripts/reprocessar.mts Sent 23721
 */
import { ImapFlow } from 'imapflow'
import { createHash } from 'crypto'
import { processarArquivoAnexo, extrairCnpjsDoTexto, type AnexoXML, type EmailProcessado } from '../lib/anexos'
import { processarEmailV2, prefiltrar, limparCacheClientes } from '../lib/ingestao-v2'
import { persistirEmail } from '../lib/supabase-service'

const [pasta, ...uidsArg] = process.argv.slice(2)
if (!pasta || uidsArg.length === 0) {
  console.error('uso: reprocessar.mts <pasta> <uid> [uid...]')
  process.exit(1)
}
const uids = uidsArg.map(Number).filter(n => !isNaN(n))
const somenteSimular = process.env.DRY === '1'
/**
 * FORCAR=1 ignora a deduplicação no nível do EMAIL (`emails_importados`).
 *
 * Necessário quando a cópia da INBOX e a da pasta Sent compartilham o mesmo
 * Message-ID: uma delas registra o email, e se as notas se perderem naquela
 * passagem, a outra é barrada como duplicada e as notas nunca entram.
 *
 * A deduplicação por hash de arquivo e por chave de NF-e continua ativa, então
 * forçar NÃO cria movimentação duplicada.
 */
const forcar = process.env.FORCAR === '1'

const EXT = /\.(xml|pdf|zip)$/i

const client = new ImapFlow({
  host: process.env.IMAP_HOST!, port: Number(process.env.IMAP_PORT || 143),
  secure: String(process.env.IMAP_SECURE ?? 'false') === 'true',
  auth: { user: process.env.IMAP_USER!, pass: process.env.IMAP_PASSWORD! },
  logger: false, socketTimeout: 120_000,
})

limparCacheClientes()
await client.connect()
await client.mailboxOpen(pasta, { readOnly: true })   // nunca altera a caixa

console.log(`\n${somenteSimular ? 'SIMULAÇÃO — nada será gravado' : 'REPROCESSANDO'} · pasta "${pasta}" · ${uids.length} mensagem(ns)\n`)

let totalNotas = 0
for (const uid of uids) {
  let msg: import('imapflow').FetchMessageObject | undefined
  for await (const m of client.fetch(String(uid), { uid: true, envelope: true, bodyStructure: true }, { uid: true })) msg = m
  if (!msg) { console.log(`uid ${uid}: ❌ não encontrada`); continue }

  const assunto = msg.envelope?.subject ?? ''
  const de = msg.envelope?.from?.[0]
  console.log(`── uid ${uid} | "${assunto.slice(0, 46)}" | ${de?.address ?? '?'}`)

  // Coleta as partes de interesse
  const partes: Array<{ part: string; nome: string; tipo: string }> = []
  const varrer = (n: unknown): void => {
    const no = n as { part?: string; type?: string; childNodes?: unknown[]
      dispositionParameters?: { filename?: string }; parameters?: { name?: string } }
    if (!no) return
    const nome = no.dispositionParameters?.filename ?? no.parameters?.name
    if (nome && EXT.test(String(nome))) {
      partes.push({ part: no.part || '1', nome: String(nome), tipo: `${no.type ?? ''}`.toLowerCase() })
    }
    for (const f of no.childNodes ?? []) varrer(f)
  }
  varrer(msg.bodyStructure)

  const anexos: AnexoXML[] = []
  for (const p of partes) {
    const { content } = await client.download(String(uid), p.part, { uid: true })
    const pedacos: Buffer[] = []
    for await (const x of content) pedacos.push(Buffer.from(x))
    await processarArquivoAnexo(p.nome, p.tipo, Buffer.concat(pedacos), anexos)
  }
  if (anexos.length === 0) { console.log('   nenhum anexo reconhecido como NF-e\n'); continue }

  // CNPJs do corpo — mesmo fallback de identificação da rotina
  let cnpjs: string[] = []
  const acharTexto = (n: unknown): string | null => {
    const no = n as { part?: string; type?: string; childNodes?: unknown[]; dispositionParameters?: { filename?: string } }
    if (!no) return null
    const t = `${no.type ?? ''}`.toLowerCase()
    if ((t === 'text/plain' || t === 'text/html') && !no.dispositionParameters?.filename) return no.part || '1'
    for (const f of no.childNodes ?? []) { const r = acharTexto(f); if (r) return r }
    return null
  }
  const pTexto = acharTexto(msg.bodyStructure)
  if (pTexto) {
    try {
      const { content } = await client.download(String(uid), pTexto, { uid: true })
      const ch: Buffer[] = []; for await (const x of content) ch.push(Buffer.from(x))
      cnpjs = extrairCnpjsDoTexto(Buffer.concat(ch).toString('utf-8').replace(/<[^>]+>/g, ' ') + ' ' + assunto)
    } catch { /* sem corpo */ }
  }

  const email: EmailProcessado = {
    message_id: msg.envelope?.messageId || `${pasta}:${uid}:${createHash('sha1').update(assunto).digest('hex').slice(0, 8)}`,
    assunto,
    remetente: de?.address ?? '',
    remetente_nome: de?.name ?? '',
    data_recebimento: (msg.envelope?.date ?? new Date()).toISOString(),
    cnpjs_corpo: cnpjs,
    anexos_xml: anexos,
    pasta, uid,
  }

  if (somenteSimular) {
    const { decisoes } = await prefiltrar(email, { ignorarDedup: true })
    for (const d of decisoes) {
      console.log(`   [${d.decisao}] NF ${d.numero_nfe ?? '?'} | ${d.cliente ?? 'sem cliente'} | ${d.tipo ?? '—'} | ${d.pallets ?? '—'} pallets`)
      if (d.motivo) console.log(`             ${d.motivo}`)
    }
    console.log()
    continue
  }

  if (forcar) {
    // Pula só a checagem de email repetido; o resto do funil é o mesmo.
    const { aceitos, descartes } = await prefiltrar(email)
    for (const d of descartes) console.log(`      descarte: ${d.arquivo} — ${d.motivo}`)
    if (aceitos.length === 0) { console.log('   ⚠ nenhum anexo aprovado\n'); continue }
    const res = await persistirEmail({ ...email, anexos_xml: aceitos })
    totalNotas += res.movimentacoes_salvas
    console.log(`   ✅ ${res.movimentacoes_salvas} movimentação(ões) | ${res.duplicados} duplicada(s) [FORÇADO]`)
    for (const e of res.erros) console.log(`      erro: ${e}`)
    console.log()
    continue
  }

  const r = await processarEmailV2(email)
  totalNotas += r.movimentacoes_salvas
  console.log(`   ${r.aceito ? '✅' : '⚠'} ${r.movimentacoes_salvas} movimentação(ões) | ${r.duplicados} duplicada(s)`)
  for (const d of r.descartes) console.log(`      descarte: ${d.arquivo} — ${d.motivo}`)
  for (const e of r.erros) console.log(`      erro: ${e}`)
  console.log()
}

console.log(`total gravado: ${totalNotas} movimentação(ões)\n`)
await client.logout()

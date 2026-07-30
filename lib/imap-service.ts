/**
 * Leitura de NF-e por IMAP — canal da V2.
 *
 * Diferenças de fundo em relação à V1 (Microsoft Graph):
 *   • Varre TODAS as pastas da caixa, exceto as ignoradas. A equipe arquiva
 *     emails manualmente e uma varredura só da INBOX perderia boa parte.
 *   • Nunca modifica a caixa: abre tudo em readOnly, não marca como lido,
 *     não move nem apaga nada.
 *   • Controle de "já examinei" por marca d'água de UID, uma por pasta,
 *     guardada em `sync_estado`.
 *
 * Produz `EmailProcessado[]` — o mesmo formato do caminho do Graph, para que a
 * camada de persistência seja compartilhada.
 */
import { ImapFlow, type FetchMessageObject } from 'imapflow'
import {
  processarArquivoAnexo, extrairCnpjsDoTexto,
  type AnexoXML, type EmailProcessado,
} from './anexos'

const IGNORADAS_PADRAO = 'Trash,Spam,Drafts,Sent,Itens Enviados,Junk,IA - XPS'

/** Extensões que valem a pena baixar. O resto nem sai do servidor. */
const EXTENSOES = /\.(xml|pdf|zip)$/i

export interface OpcoesLeitura {
  /** Não atualiza marca d'água nem toca em nada. Usado pelo diagnóstico. */
  dryRun?: boolean
  /** Teto de mensagens examinadas na execução inteira. */
  limite?: number
  /** Marcas d'água por pasta: { 'INBOX': 175765, ... } */
  marcas?: Record<string, { ultimo_uid: number; uid_validity: number }>
  /** Primeira passagem: busca por data em vez de UID. */
  dataCorte?: string
}

export interface EstadoPasta {
  pasta: string
  uid_validity: number
  ultimo_uid: number
  examinadas: number
}

export interface ResultadoLeitura {
  emails: EmailProcessado[]
  estados: EstadoPasta[]
  pastas_varridas: number
  mensagens_examinadas: number
  ignorados: Array<{ pasta: string; uid: number; assunto: string; motivo: string }>
}

export function criarClienteImap(): ImapFlow {
  const host = process.env.IMAP_HOST
  const user = process.env.IMAP_USER
  const pass = process.env.IMAP_PASSWORD
  if (!host || !user || !pass) {
    throw new Error('IMAP_HOST, IMAP_USER e IMAP_PASSWORD são obrigatórios')
  }
  const port = Number(process.env.IMAP_PORT || 143)
  // 143 → STARTTLS (secure: false; o imapflow faz o upgrade). 993 → TLS direto.
  const secure = String(process.env.IMAP_SECURE ?? 'false') === 'true'

  return new ImapFlow({
    host, port, secure,
    auth: { user, pass },
    logger: false,
    socketTimeout: 60_000,
    greetingTimeout: 15_000,
  })
}

function pastasIgnoradas(): string[] {
  return (process.env.IMAP_PASTAS_IGNORADAS || IGNORADAS_PADRAO)
    .split(',').map(s => s.trim()).filter(Boolean)
}

/** Percorre a árvore MIME e devolve as partes que são anexo de interesse. */
function coletarPartesAnexo(
  no: FetchMessageObject['bodyStructure'] | undefined,
  saida: Array<{ part: string; nome: string; tipo: string; tamanho: number }> = [],
): Array<{ part: string; nome: string; tipo: string; tamanho: number }> {
  if (!no) return saida
  const nome = (no.dispositionParameters?.filename ?? no.parameters?.name ?? '') as string
  const ehAnexo = no.disposition === 'attachment' || !!nome
  if (ehAnexo && nome && EXTENSOES.test(nome)) {
    saida.push({
      part: no.part || '1',
      nome,
      tipo: `${no.type ?? ''}`.toLowerCase(),
      tamanho: no.size ?? 0,
    })
  }
  for (const filho of no.childNodes ?? []) coletarPartesAnexo(filho, saida)
  return saida
}

/** Localiza a primeira parte de texto, para extrair CNPJs do corpo. */
function acharParteTexto(
  no: FetchMessageObject['bodyStructure'] | undefined,
): string | null {
  if (!no) return null
  const tipo = `${no.type ?? ''}`.toLowerCase()
  if ((tipo === 'text/plain' || tipo === 'text/html') && !no.dispositionParameters?.filename) {
    return no.part || '1'
  }
  for (const filho of no.childNodes ?? []) {
    const r = acharParteTexto(filho)
    if (r) return r
  }
  return null
}

async function baixarParte(client: ImapFlow, uid: number, part: string): Promise<Buffer> {
  const { content } = await client.download(String(uid), part, { uid: true })
  const pedacos: Buffer[] = []
  for await (const p of content) pedacos.push(Buffer.from(p))
  return Buffer.concat(pedacos)
}

export async function lerEmailsNFeImap(opcoes: OpcoesLeitura = {}): Promise<ResultadoLeitura> {
  const { dryRun = false, limite = 25, marcas = {}, dataCorte } = opcoes
  const ignoradas = pastasIgnoradas()
  const client = criarClienteImap()

  const resultado: ResultadoLeitura = {
    emails: [], estados: [], pastas_varridas: 0,
    mensagens_examinadas: 0, ignorados: [],
  }

  await client.connect()
  try {
    const todas = await client.list()
    const alvo = todas.filter(b =>
      !b.flags?.has?.('\\Noselect') &&
      !ignoradas.some(ig => b.path === ig || b.path.startsWith(ig + (b.delimiter || '/')))
    )

    for (const box of alvo) {
      if (resultado.mensagens_examinadas >= limite) break

      let mb
      try {
        mb = await client.mailboxOpen(box.path, { readOnly: true })
      } catch {
        continue // pasta inacessível — segue adiante
      }
      resultado.pastas_varridas++

      const marca = marcas[box.path]
      // uidValidity diferente = servidor renumerou; refaz a linha de base em vez
      // de pular mensagens silenciosamente.
      const marcaValida = marca && Number(marca.uid_validity) === Number(mb.uidValidity)

      let uids: number[] = []
      if (marcaValida && marca.ultimo_uid > 0) {
        uids = await client.search({ uid: `${marca.ultimo_uid + 1}:*` }, { uid: true }) || []
        // O range "N:*" sempre devolve ao menos a última mensagem; filtra de fato.
        uids = uids.filter(u => u > marca.ultimo_uid)
      } else if (dataCorte) {
        // Primeira passagem nesta pasta: busca por data. É o que permite
        // recuperar emails que a equipe já arquivou desde o corte.
        uids = await client.search({ since: new Date(dataCorte) }, { uid: true }) || []
      }

      const estado: EstadoPasta = {
        pasta: box.path,
        uid_validity: Number(mb.uidValidity),
        ultimo_uid: marcaValida ? marca.ultimo_uid : 0,
        examinadas: 0,
      }

      for (const uid of uids.sort((a, b) => a - b)) {
        if (resultado.mensagens_examinadas >= limite) break
        resultado.mensagens_examinadas++
        estado.examinadas++
        estado.ultimo_uid = Math.max(estado.ultimo_uid, uid)

        let msg: FetchMessageObject | undefined
        for await (const m of client.fetch(String(uid), { uid: true, envelope: true, bodyStructure: true }, { uid: true })) {
          msg = m
        }
        if (!msg) continue

        const assunto = msg.envelope?.subject ?? ''
        const partes = coletarPartesAnexo(msg.bodyStructure)
        if (partes.length === 0) {
          resultado.ignorados.push({ pasta: box.path, uid, assunto, motivo: 'sem anexo XML/PDF/ZIP' })
          continue
        }

        const anexosXML: AnexoXML[] = []
        for (const p of partes) {
          try {
            const buffer = await baixarParte(client, uid, p.part)
            await processarArquivoAnexo(p.nome, p.tipo, buffer, anexosXML)
          } catch (err) {
            console.error(`Falha ao baixar ${p.nome} (${box.path} uid ${uid}):`, err)
          }
        }

        if (anexosXML.length === 0) {
          resultado.ignorados.push({
            pasta: box.path, uid, assunto,
            motivo: `anexos não reconhecidos como NF-e: ${partes.map(p => p.nome).join(', ')}`,
          })
          continue
        }

        // CNPJs do corpo — fallback de identificação de cliente
        let cnpjs: string[] = []
        const parteTexto = acharParteTexto(msg.bodyStructure)
        if (parteTexto) {
          try {
            const corpo = (await baixarParte(client, uid, parteTexto)).toString('utf-8')
            cnpjs = extrairCnpjsDoTexto(corpo.replace(/<[^>]+>/g, ' ') + ' ' + assunto)
          } catch { /* corpo indisponível — segue sem CNPJ do corpo */ }
        }

        const de = msg.envelope?.from?.[0]
        resultado.emails.push({
          message_id: msg.envelope?.messageId || `${box.path}:${mb.uidValidity}:${uid}`,
          assunto,
          remetente: de?.address ?? '',
          remetente_nome: de?.name ?? '',
          data_recebimento: (msg.envelope?.date ?? new Date()).toISOString(),
          cnpjs_corpo: cnpjs,
          anexos_xml: anexosXML,
          pasta: box.path,
          uid,
        })
      }

      if (estado.examinadas > 0 || !marcaValida) resultado.estados.push(estado)
      await client.mailboxClose()
    }
  } finally {
    try { await client.logout() } catch { /* conexão já caiu */ }
  }

  if (dryRun) resultado.estados = [] // nada a persistir
  return resultado
}

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

/**
 * Teto de tamanho por anexo. O parsing de PDF é o gargalo da rodada: uma única
 * mensagem com anexo grande consumia 30s dos 60s disponíveis na Vercel.
 *
 * Medição de 200 mensagens em 30/07/2026: mediana 38 KB, p90 341 KB, p99 2,8 MB.
 * Dos 146 anexos, 8 passavam de 2 MB — e nenhum era NF-e (fotos de celular,
 * relatório de contêiner de 17 MB, resumo de tributos, página de agendamento).
 *
 * Anexos acima do teto são registrados como ignorados, com o tamanho, para
 * poderem ser tratados à mão. Nada some em silêncio.
 */
const ANEXO_MAX_KB = Number(process.env.ANEXO_MAX_KB || 3072)

export interface OpcoesLeitura {
  /** Não atualiza marca d'água nem toca em nada. Usado pelo diagnóstico. */
  dryRun?: boolean
  /** Teto de mensagens examinadas na execução inteira. */
  limite?: number
  /**
   * Teto de TEMPO para a varredura, em ms. Mais importante que o `limite`:
   * o custo de uma mensagem depende do tamanho do anexo, não da contagem.
   * Medido em 30/07/2026: 10 mensagens levaram de 5,6s a 59,5s conforme o
   * conteúdo. Sem este orçamento, uma rodada pode estourar o limite da Vercel.
   * Ao esgotar, a varredura para e a marca d'água guarda o que foi feito —
   * o resto entra na rodada seguinte.
   */
  orcamentoMs?: number
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
  /** true quando a varredura parou por tempo, não por falta de mensagens. */
  interrompida_por_tempo: boolean
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
  const { dryRun = false, limite = 25, marcas = {}, dataCorte, orcamentoMs = 20_000 } = opcoes
  const inicio = Date.now()
  const semTempo = () => Date.now() - inicio > orcamentoMs
  // Uma mensagem só pode ser abandonada no meio se outra já tiver sido
  // concluída nesta rodada. Sem isso, um email pesado o bastante para estourar
  // o orçamento sozinho seria abandonado para sempre, travando a fila.
  let concluidasNestaRodada = 0
  const ignoradas = pastasIgnoradas()
  const client = criarClienteImap()

  const resultado: ResultadoLeitura = {
    emails: [], estados: [], pastas_varridas: 0,
    mensagens_examinadas: 0, interrompida_por_tempo: false, ignorados: [],
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
      if (semTempo()) { resultado.interrompida_por_tempo = true; break }

      const marca = marcas[box.path]

      // STATUS antes de abrir: custa ~5ms contra ~400ms do mailboxOpen. Pasta
      // sem nada novo desde a última rodada nem chega a ser aberta — sem isto,
      // varrer 28 pastas custava 11,4s a cada 15 minutos, mesmo sem trabalho.
      try {
        const st = await client.status(box.path, { uidNext: true, uidValidity: true })
        const semNovidade = marca
          && Number(marca.uid_validity) === Number(st.uidValidity)
          && Number(st.uidNext) - 1 <= Number(marca.ultimo_uid)
        if (semNovidade) continue
      } catch {
        continue // pasta inacessível — segue adiante
      }

      let mb
      try {
        mb = await client.mailboxOpen(box.path, { readOnly: true })
      } catch {
        continue
      }
      resultado.pastas_varridas++
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

      // Pasta sem nada no período: fixa a linha de base no estado atual, senão
      // a busca por data se repetiria a cada rodada, para sempre.
      if (uids.length === 0 && !marcaValida) {
        estado.ultimo_uid = Math.max(0, Number(mb.uidNext) - 1)
      }

      for (const uid of uids.sort((a, b) => a - b)) {
        if (resultado.mensagens_examinadas >= limite) break
        // Orçamento de tempo: para antes de estourar o limite da Vercel. O que
        // sobrou fica para a próxima rodada, sem perda nem retrabalho.
        if (semTempo()) { resultado.interrompida_por_tempo = true; break }
        resultado.mensagens_examinadas++
        estado.examinadas++

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
        let abortadaNoMeio = false
        const grandes = partes.filter(p => p.tamanho > ANEXO_MAX_KB * 1024)
        for (const g of grandes) {
          resultado.ignorados.push({
            pasta: box.path, uid, assunto,
            motivo: `anexo grande demais para processar automaticamente: ${g.nome} (${Math.round(g.tamanho / 1024)} KB, teto ${ANEXO_MAX_KB} KB)`,
          })
        }
        for (const p of partes.filter(p => p.tamanho <= ANEXO_MAX_KB * 1024)) {
          // Email com muitos anexos (observado: 16 numa mensagem só, 36s de
          // processamento) estourava o orçamento porque a verificação só
          // acontecia entre mensagens. Aqui ele pode ser abandonado no meio —
          // a marca d'água não avança sobre ele e a próxima rodada refaz a
          // mensagem inteira; os anexos já gravados caem na deduplicação.
          if (semTempo() && concluidasNestaRodada > 0) {
            abortadaNoMeio = true
            resultado.interrompida_por_tempo = true
            break
          }
          try {
            const buffer = await baixarParte(client, uid, p.part)
            await processarArquivoAnexo(p.nome, p.tipo, buffer, anexosXML)
          } catch (err) {
            console.error(`Falha ao baixar ${p.nome} (${box.path} uid ${uid}):`, err)
          }
        }

        if (abortadaNoMeio) continue   // sem avançar a marca d'água

        if (anexosXML.length === 0) {
          resultado.ignorados.push({
            pasta: box.path, uid, assunto,
            motivo: `anexos não reconhecidos como NF-e: ${partes.map(p => p.nome).join(', ')}`,
          })
          estado.ultimo_uid = Math.max(estado.ultimo_uid, uid)
          concluidasNestaRodada++
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
        estado.ultimo_uid = Math.max(estado.ultimo_uid, uid)
        concluidasNestaRodada++
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

/**
 * Copia para `IA - XPS/Processados` os emails que geraram movimentação.
 *
 * É PURA AUDITORIA: nada no funcionamento depende desta pasta. Por isso toda
 * falha aqui é registrada como aviso e nunca derruba a sincronização — os dados
 * já estão no banco quando esta função é chamada.
 *
 * A origem é aberta em readOnly. COPY não altera a pasta de origem (escreve só
 * no destino), mas há servidores que recusam COPY a partir de uma seleção
 * readOnly — daí o tratamento tolerante.
 */
export async function arquivarProcessados(
  itens: Array<{ pasta: string; uid: number }>,
): Promise<{ copiados: number; avisos: string[] }> {
  const destino = process.env.IMAP_PASTA_PROCESSADOS || 'IA - XPS/Processados'
  const avisos: string[] = []
  let copiados = 0
  if (itens.length === 0) return { copiados, avisos }

  const porPasta = new Map<string, number[]>()
  for (const i of itens) {
    if (i.pasta === destino) continue // já está lá
    porPasta.set(i.pasta, [...(porPasta.get(i.pasta) ?? []), i.uid])
  }

  const client = criarClienteImap()
  await client.connect()
  try {
    for (const [pasta, uids] of porPasta) {
      try {
        await client.mailboxOpen(pasta, { readOnly: true })
        await client.messageCopy(uids.join(','), destino, { uid: true })
        copiados += uids.length
        await client.mailboxClose()
      } catch (err) {
        avisos.push(`Não foi possível arquivar ${uids.length} de "${pasta}": ${String(err)}`)
      }
    }
  } finally {
    try { await client.logout() } catch { /* já caiu */ }
  }
  return { copiados, avisos }
}

/**
 * Apaga de `IA - XPS/Processados` o que passou da retenção (padrão 30 dias).
 * Única pasta em que a rotina escreve — e é uma pasta criada só para ela.
 */
export async function limparProcessadosAntigos(
  dias = Number(process.env.RETENCAO_PROCESSADOS_DIAS || 30),
): Promise<{ apagados: number; aviso?: string }> {
  const destino = process.env.IMAP_PASTA_PROCESSADOS || 'IA - XPS/Processados'
  const limite = new Date()
  limite.setDate(limite.getDate() - dias)

  const client = criarClienteImap()
  await client.connect()
  try {
    await client.mailboxOpen(destino) // read-write: é a nossa pasta
    const antigos = await client.search({ before: limite }, { uid: true }) || []
    if (antigos.length === 0) return { apagados: 0 }
    await client.messageDelete(antigos.join(','), { uid: true })
    return { apagados: antigos.length }
  } catch (err) {
    return { apagados: 0, aviso: `Falha na limpeza de "${destino}": ${String(err)}` }
  } finally {
    try { await client.logout() } catch { /* já caiu */ }
  }
}

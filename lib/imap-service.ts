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
import { createHash } from 'crypto'
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

/**
 * Teto de tempo para UMA mensagem. Rede de segurança independente do conteúdo.
 *
 * Sem ela, um email com 8 PDFs alfandegários de 4,2 MB consumia ~50s de
 * varredura; somada à gravação, a rodada estourava os 60s da Vercel e a função
 * era morta antes de avançar a marca d'água. A rodada seguinte repetia tudo:
 * 825 mensagens ficaram paradas por dois dias em 04/08/2026.
 *
 * Ao estourar, a mensagem é abandonada, REGISTRADA em `ignorados` e a marca
 * d'água AVANÇA — porque insistir nela bloquearia a fila indefinidamente.
 * Perder uma mensagem visível é melhor que travar todas em silêncio.
 */
const MENSAGEM_MAX_MS = Number(process.env.MENSAGEM_MAX_MS || 25_000)

/**
 * Teto de anexos por mensagem — barreira ANTES de baixar qualquer coisa.
 *
 * O teto de tempo acima só age ENTRE um anexo e o seguinte; uma mensagem com
 * dezenas deles já consumiu o orçamento quando a verificação roda. Um email
 * "Notas Saidas" com 164 anexos matava a função pelo limite de 60s da Vercel a
 * cada rodada, travando a fila inteira atrás dele.
 *
 * A contagem vem do BODYSTRUCTURE, que já temos de graça — nenhum byte precisa
 * ser transferido para decidir. Acima do teto, a mensagem é REGISTRADA e
 * pulada: lotes assim precisam de lançamento manual.
 */
const ANEXOS_MAX_QTD = Number(process.env.ANEXOS_MAX_QTD || 30)

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
  /**
   * Consulta se um anexo já foi processado, pelo hash. Chamada ANTES do parse,
   * que é a parte cara. É o que torna viável retomar um email-lote: ao revisitar
   * a mensagem, os anexos já feitos são descartados por poucos milissegundos em
   * vez de reparseados.
   */
  jaProcessado?: (hash: string) => Promise<boolean>
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
  /**
   * Mensagens ainda não examinadas, somando todas as pastas. Calculado no
   * mesmo STATUS que decide se a pasta precisa ser aberta, então não custa
   * nada a mais. É o que permite distinguir "ocioso" de "travado".
   */
  fila_restante: number
  ignorados: Array<{ pasta: string; uid: number; assunto: string; motivo: string; categoria: string }>
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
  const {
    dryRun = false, limite = 25, marcas = {}, dataCorte,
    orcamentoMs = 20_000, jaProcessado,
  } = opcoes
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
    mensagens_examinadas: 0, interrompida_por_tempo: false,
    fila_restante: 0, ignorados: [],
  }

  await client.connect()
  try {
    const todas = await client.list()
    const alvo = todas.filter(b =>
      !b.flags?.has?.('\\Noselect') &&
      !ignoradas.some(ig => b.path === ig || b.path.startsWith(ig + (b.delimiter || '/')))
    )

    // Passagem de STATUS em TODAS as pastas antes de processar qualquer uma.
    // Custa ~5ms por pasta e dá o tamanho real da fila. Antes, a contagem era
    // feita durante o processamento e parava junto com ele — reportava 465
    // quando o total era 646, escondendo 180 mensagens na pasta Arconvert.
    const pendentesPorPasta = new Map<string, number>()
    for (const box of alvo) {
      try {
        const st = await client.status(box.path, { uidNext: true, uidValidity: true })
        const marca = marcas[box.path]
        const mesmaNumeracao = marca && Number(marca.uid_validity) === Number(st.uidValidity)
        const pend = mesmaNumeracao
          ? Math.max(0, Number(st.uidNext) - 1 - Number(marca.ultimo_uid))
          : Number(st.uidNext) > 1 ? -1 : 0   // -1 = pasta nova, precisa de linha de base
        pendentesPorPasta.set(box.path, pend)
        if (pend > 0) resultado.fila_restante += pend
      } catch { /* pasta inacessível */ }
    }

    for (const box of alvo) {
      if (resultado.mensagens_examinadas >= limite) break
      if (semTempo()) { resultado.interrompida_por_tempo = true; break }

      const marca = marcas[box.path]

      // STATUS antes de abrir: custa ~5ms contra ~400ms do mailboxOpen. Pasta
      // sem nada novo desde a última rodada nem chega a ser aberta — sem isto,
      // varrer 28 pastas custava 11,4s a cada 15 minutos, mesmo sem trabalho.
      // Já sabemos, da passagem de STATUS acima, se esta pasta tem novidade.
      if (pendentesPorPasta.get(box.path) === 0) continue

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
          resultado.ignorados.push({ pasta: box.path, uid, assunto, categoria: 'sem_anexo', motivo: 'sem anexo XML/PDF/ZIP' })
          // A mensagem foi examinada e resolvida: a marca d'água TEM de avançar.
          // Faltava aqui — e este é o caminho mais comum, já que a maioria dos
          // emails não tem anexo. Sem isto a rodada relia as mesmas mensagens
          // indefinidamente: 2681 exames para avançar 299 posições.
          estado.ultimo_uid = Math.max(estado.ultimo_uid, uid)
          concluidasNestaRodada++
          continue
        }

        if (partes.length > ANEXOS_MAX_QTD) {
          resultado.ignorados.push({
            pasta: box.path, uid, assunto, categoria: 'lote_grande_demais',
            motivo: `mensagem com ${partes.length} anexos (teto ${ANEXOS_MAX_QTD}) — PULADA, precisa de lançamento manual`,
          })
          estado.ultimo_uid = Math.max(estado.ultimo_uid, uid)
          concluidasNestaRodada++
          continue
        }

        const anexosXML: AnexoXML[] = []
        const tMensagem = Date.now()
        let abortadaNoMeio = false
        let caraDemais = false
        const grandes = partes.filter(p => p.tamanho > ANEXO_MAX_KB * 1024)
        for (const g of grandes) {
          resultado.ignorados.push({
            pasta: box.path, uid, assunto, categoria: 'anexo_grande',
            motivo: `anexo grande demais para processar automaticamente: ${g.nome} (${Math.round(g.tamanho / 1024)} KB, teto ${ANEXO_MAX_KB} KB)`,
          })
        }
        let novosNestaMensagem = 0
        for (const p of partes.filter(p => p.tamanho <= ANEXO_MAX_KB * 1024)) {
          // Teto de tempo só vale DEPOIS de ao menos um anexo novo ter sido
          // processado. Garante progresso mesmo num email-lote: cada rodada
          // avança alguns anexos e a mensagem termina em algumas passagens.
          if (Date.now() - tMensagem > MENSAGEM_MAX_MS) {
            caraDemais = true
            break
          }
          if (semTempo() && concluidasNestaRodada > 0) {
            abortadaNoMeio = true
            resultado.interrompida_por_tempo = true
            break
          }
          try {
            const buffer = await baixarParte(client, uid, p.part)
            // Dedup pelo hash ANTES do parse: num email-lote revisitado, os
            // anexos já gravados saem daqui em milissegundos.
            if (jaProcessado) {
              const h = createHash('sha256').update(buffer).digest('hex')
              if (await jaProcessado(h)) continue
            }
            novosNestaMensagem++
            await processarArquivoAnexo(p.nome, p.tipo, buffer, anexosXML)
          } catch (err) {
            console.error(`Falha ao baixar ${p.nome} (${box.path} uid ${uid}):`, err)
          }
        }

        // Email-lote que não cabe numa rodada.
        //
        // Tentei retomar entre rodadas: não avançar a marca d'água e continuar
        // na próxima passagem. Não funciona — para saber quais anexos já foram
        // gravados é preciso BAIXÁ-LOS (o hash exige os bytes), e numa mensagem
        // de 161 anexos o download sozinho estoura os 60s da Vercel. A função
        // era morta e a trava ficava presa.
        //
        // Enquanto não houver estado de progresso POR ANEXO, o comportamento
        // correto é: gravar o que deu, AVANÇAR a marca d'água e registrar alto
        // e bom som. Fila parada é pior que mensagem pulada — e pulada com
        // aviso é melhor que pulada em silêncio.
        if (caraDemais) {
          resultado.ignorados.push({
            pasta: box.path, uid, assunto, categoria: 'lote_nao_processado',
            motivo: `EMAIL-LOTE com ${partes.length} anexos não cabe numa rodada: ${anexosXML.length} nota(s) aproveitada(s), o restante PRECISA de lançamento manual`,
          })
        }

        if (abortadaNoMeio) continue   // sem avançar a marca d'água

        if (anexosXML.length === 0) {
          resultado.ignorados.push({
            pasta: box.path, uid, assunto, categoria: 'anexo_nao_nfe',
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

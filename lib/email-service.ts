import { graphClient } from './graph-client'
import { parseNFe, DadosNFe } from './nfe-parser'
import { parseNFePDF, parseNFePDFTodas } from './nfe-pdf-parser'
import { calcularPallets } from './calculations'
import { createHash } from 'crypto'
import { unzipSync } from 'fflate'

const EMAIL_USER = process.env.MS_USER_EMAIL || 'xps.ai@exsa.srv.br'
const ASSUNTOS_MONITORADOS = (process.env.EMAIL_ASSUNTOS || 'NFe,Nota Fiscal,NF-e')
  .split(',')
  .map(s => s.trim())

export interface ResultadoSync {
  emails_lidos: number
  emails_novos: number
  nfes_processadas: number
  nfes_ignoradas: number
  erros: string[]
}

/** Extrai XMLs de NF-e de um buffer ZIP. Retorna array de {nome, conteudo}. */
function extrairXmlsDoZip(buffer: Buffer): Array<{ nome: string; conteudo: Buffer }> {
  try {
    const decompressed = unzipSync(new Uint8Array(buffer))
    const results: Array<{ nome: string; conteudo: Buffer }> = []
    for (const [nome, data] of Object.entries(decompressed)) {
      const nomeLower = nome.toLowerCase()
      if (nomeLower.endsWith('.xml')) {
        results.push({ nome, conteudo: Buffer.from(data) })
      } else if (nomeLower.endsWith('.pdf') && ehNomePdfNFe(nomeLower)) {
        results.push({ nome, conteudo: Buffer.from(data) })
      }
    }
    return results
  } catch {
    return []
  }
}

function ehNomePdfNFe(nomeLower: string): boolean {
  if (ehNomePdfIgnorado(nomeLower)) {
    return false
  }

  return (
    nomeLower.includes('nf-e') ||
    nomeLower.includes('nfs-e') ||
    nomeLower.includes('nfse') ||
    nomeLower.includes('nfce') ||
    nomeLower.includes('nfc-e') ||
    nomeLower.includes(' nfe') ||
    nomeLower.includes('_nfe') ||
    nomeLower.includes('-nfe') ||
    nomeLower.startsWith('nfe') ||
    nomeLower.startsWith('nfs') ||
    nomeLower.includes('danfe') ||
    nomeLower.includes('danfse') ||
    nomeLower.includes('nota fiscal') ||
    nomeLower.includes('nota_fiscal') ||
    nomeLower.includes('notafiscal') ||
    // "NF93150.pdf" ou "NF000091242.pdf" — NF seguido de 5+ dígitos
    /\bnf[\s\-]?\d{5,}/.test(nomeLower) ||
    // Chave de acesso NFe (44 dígitos) no nome do arquivo
    /\d{44}/.test(nomeLower)
  )
}

/**
 * Extrai as partes com nome (anexos) de um e-mail bruto em formato MIME (.eml).
 * Usado para "encaminhar como anexo" do Outlook: o Graph representa o e-mail
 * encaminhado como um itemAttachment sem endpoint próprio de /attachments —
 * a única forma de acessar os PDFs/XMLs dentro dele é baixar o MIME bruto
 * (via /attachments/{id}/$value) e extrair as partes manualmente.
 * Suporta apenas Content-Transfer-Encoding: base64 (cobre PDF/XML/ZIP reais).
 */
function extrairAnexosDoEml(eml: string): Array<{ nome: string; conteudo: Buffer }> {
  const resultados: Array<{ nome: string; conteudo: Buffer }> = []
  const boundaryMatch = eml.match(/boundary="?([^"\r\n;]+)"?/i)
  if (!boundaryMatch) return resultados
  const boundary = boundaryMatch[1]
  const partes = eml.split(new RegExp(`--${boundary.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'g'))
  for (const parte of partes) {
    const isBase64 = /Content-Transfer-Encoding:\s*base64/i.test(parte)
    if (!isBase64) continue
    // Nome: prioriza Content-Disposition filename=, senão Content-Type name=.
    // Headers MIME costumam vir "dobrados" em várias linhas (contیnuação com tab/espaço),
    // ex.: "Content-Disposition: attachment;\n\tfilename=\"...\"" — por isso [\s\S] (não [^\r\n])
    // entre o rótulo e o valor, limitado a 200 chars para não vazar para o corpo do arquivo.
    const nomeMatch =
      parte.match(/Content-Disposition:[\s\S]{0,200}?filename="?([^"\r\n;]+)"?/i) ||
      parte.match(/Content-Type:[\s\S]{0,200}?name="?([^"\r\n;]+)"?/i)
    if (!nomeMatch) continue
    const idx = parte.search(/\r?\n\r?\n/)
    if (idx < 0) continue
    const base64 = parte.slice(idx).replace(/[\r\n]/g, '').trim()
    if (!base64) continue
    try {
      resultados.push({ nome: nomeMatch[1].trim(), conteudo: Buffer.from(base64, 'base64') })
    } catch { /* parte inválida — ignora */ }
  }
  return resultados
}

function ehNomePdfIgnorado(nomeLower: string): boolean {
  return (
    nomeLower.includes('packing list') ||
    nomeLower.includes('packlist') ||
    nomeLower.includes('etiqueta') ||
    nomeLower.includes('etiq') ||
    nomeLower.includes('eituq') ||
    nomeLower.includes('draft') ||
    // "Confirmação de Pedido.pdf" — confirmações de pedido não são NF-e;
    // o parser captura o número do pedido como se fosse número de nota.
    /confirma[çc][aã]o/.test(nomeLower) ||
    /^pl[\s_-]/.test(nomeLower) ||
    /[\s_-]pl[\s_-]/.test(nomeLower) ||
    /[\s_-]et\d*(?:\.|[\s_-])/.test(nomeLower) ||
    // Carta de Correção Eletrônica (CC-e) e Conhecimento de Transporte (CT-e):
    // documentos de correção/transporte, não a NF-e em si. Contêm a mesma chave
    // de acesso da nota original — se processados antes do PDF real, "reservam"
    // a chave e fazem o dedup descartar a NF-e verdadeira (ou, se a NF-e real
    // nunca chegar, ficam como um registro órfão sem natureza/movimentação).
    // Cobre tanto o sufixo ("...-cce.pdf") quanto o prefixo com espaço/underscore/
    // hífen/ponto ("CCe 000094969.pdf", "CCe000095335.pdf", "CTE TRM.pdf").
    /-cce\.pdf$/.test(nomeLower) ||
    /carta de correc/.test(nomeLower) ||
    /^cc-?e[\s_.-]/.test(nomeLower) ||
    /^cte[\s_.-]/.test(nomeLower)
  )
}

export interface EmailProcessado {
  message_id: string
  assunto: string
  remetente: string        // endereço de email: joao@empresa.com
  remetente_nome: string   // nome/assinatura exibida: "João Silva - Empresa XYZ"
  data_recebimento: string
  cnpjs_corpo: string[]    // CNPJs extraídos do corpo do email (sem formatação)
  anexos_xml: AnexoXML[]
}

/** Extrai todos os CNPJs (14 dígitos) de um texto qualquer. */
function extrairCnpjsDoTexto(texto: string): string[] {
  const found = new Set<string>()
  // Formato formatado: 00.000.000/0000-00
  for (const m of texto.matchAll(/\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}/g)) {
    found.add(m[0].replace(/\D/g, ''))
  }
  // 14 dígitos consecutivos
  for (const m of texto.matchAll(/\b(\d{14})\b/g)) {
    found.add(m[1])
  }
  return [...found]
}

export interface AnexoXML {
  nome_arquivo: string
  hash: string
  conteudo: string
  dados_nfe: DadosNFe | null
  pallets_calculados: number | null
}

export interface EmailDiagnostico {
  message_id: string
  assunto: string
  remetente: string
  data_recebimento: string
  motivo_ignorado: string
  anexos: string[]
  anexos_debug?: Array<{ nome: string; contentType: string; ehXML: boolean; ehPDF: boolean; ehZIP: boolean }>
}

/**
 * Lê os emails recentes da caixa xps.ai@exsa.srv.br via Microsoft Graph
 * e extrai NFes em XML, PDF ou ZIP.
 */
export async function lerEmailsNFe(
  diasAtras: number = 7,
  idsJaProcessados?: Set<string>,
  diagnostico?: EmailDiagnostico[],
  limite = 40,
): Promise<EmailProcessado[]> {
  const dataInicio = new Date()
  dataInicio.setDate(dataInicio.getDate() - diasAtras)
  const dataISOStr = dataInicio.toISOString()

  const filtro = `receivedDateTime ge ${dataISOStr} and hasAttachments eq true`

  // Pagina pelos e-mails (100 por página, seguindo o @odata.nextLink) até juntar
  // `limite` mensagens AINDA NÃO processadas, ou esgotar as páginas. Antes, o
  // .top(100) só enxergava os 100 e-mails mais recentes — e-mails antigos com
  // notas nunca eram alcançados quando os recentes já estavam todos processados.
  const MAX_PAGINAS = 30 // varre até ~3000 e-mails por sincronização
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mensagensNovas: any[] = []
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let pagina: any = await graphClient
    .api(`/users/${EMAIL_USER}/messages`)
    .filter(filtro)
    .select('id,subject,from,receivedDateTime,hasAttachments,internetMessageId,body')
    .orderby('receivedDateTime desc')
    .top(100)
    .get()

  let nPag = 0
  while (pagina && nPag < MAX_PAGINAS) {
    for (const msg of pagina.value || []) {
      if (!msg.hasAttachments) continue
      const msgId: string = msg.internetMessageId || msg.id
      if (idsJaProcessados?.has(msgId)) continue
      mensagensNovas.push(msg)
      if (mensagensNovas.length >= limite) break
    }
    const next = pagina['@odata.nextLink']
    if (mensagensNovas.length >= limite || !next) break
    pagina = await graphClient.api(next).get()
    nPag++
  }

  // Busca anexos em paralelo (3 simultâneos — conservador para não estourar rate limit)
  const emails: EmailProcessado[] = []
  const CONCORRENCIA = 3

  /**
   * Processa um único arquivo (nome + bytes) e empurra em anexosXML se for
   * XML/PDF/ZIP de NF-e reconhecido. Compartilhado entre anexos de 1º nível
   * (direto na mensagem) e anexos aninhados (dentro de itemAttachment, ver abaixo).
   */
  async function processarArquivoAnexo(
    nomeArquivo: string,
    contentType: string,
    buffer: Buffer,
    anexosXML: AnexoXML[],
  ): Promise<{ ehXML: boolean; ehPDF: boolean; ehZIP: boolean }> {
    const nomeLower = nomeArquivo.toLowerCase()

    // Arquivos Office (.xlsx, .docx, etc.) têm content-type "openxmlformats" que
    // contém "xml" — devem ser explicitamente excluídos antes das demais verificações.
    const ehOffice = /\.(xlsx|docx|pptx|xls|doc|ppt|odt|ods|odp|csv)$/.test(nomeLower)
    const ehXML = !ehOffice &&
      (nomeLower.endsWith('.xml') || contentType.includes('xml'))
    // PDF: tenta parsear qualquer .pdf — aceita só se conter dados de NF-e válidos
    const ehPDF = !ehOffice && nomeLower.endsWith('.pdf')
    if (ehPDF && ehNomePdfIgnorado(nomeLower)) {
      return { ehXML: false, ehPDF: false, ehZIP: false }
    }
    const ehPDFNomeNFe = ehPDF && ehNomePdfNFe(nomeLower)
    // ZIP: só detecta por extensão — octet-stream é genérico demais e
    // abrange PDFs, o que causaria tentativa de deszip em arquivos válidos.
    const ehZIP = !ehOffice &&
      (nomeLower.endsWith('.zip') || contentType.includes('zip'))

    const flags = { ehXML, ehPDF: ehPDFNomeNFe, ehZIP }
    if (!ehXML && !ehPDF && !ehZIP) return flags

    if (ehZIP) {
      // Extrai XMLs e PDFs do ZIP
      const arquivosNoZip = extrairXmlsDoZip(buffer)
      for (const arqZip of arquivosNoZip) {
        const nomeLowerZip = arqZip.nome.toLowerCase()
        const ehXmlZip = nomeLowerZip.endsWith('.xml')
        const hash = createHash('sha256').update(arqZip.conteudo).digest('hex')
        let dadosNFe: DadosNFe | null = null
        let conteudo = ''
        if (ehXmlZip) {
          conteudo = arqZip.conteudo.toString('utf-8')
          dadosNFe = await parseNFe(conteudo)
        } else {
          dadosNFe = await parseNFePDF(arqZip.conteudo)
          conteudo = `[PDF] ${arqZip.nome}`
        }
        // Descarta PDF sem dados NF-e e sem nome reconhecível como NF-e
        if (!ehXmlZip && (!dadosNFe?.chave_nfe && !dadosNFe?.numero_nfe) && !ehNomePdfNFe(nomeLowerZip)) continue
        let pallets: number | null = null
        if (dadosNFe && dadosNFe.peso_liquido_total > 0) {
          pallets = calcularPallets(dadosNFe.peso_liquido_total / 1000)
        }
        anexosXML.push({ nome_arquivo: arqZip.nome, hash, conteudo, dados_nfe: dadosNFe, pallets_calculados: pallets })
      }
      return flags
    }

    const hash = createHash('sha256').update(buffer).digest('hex')

    // Empurra um anexo de PDF (calcula pallets do peso quando houver)
    const pushPdf = (dn: DadosNFe | null, h: string) => {
      let pallets: number | null = null
      if (dn && dn.peso_liquido_total > 0) pallets = calcularPallets(dn.peso_liquido_total / 1000)
      anexosXML.push({ nome_arquivo: nomeArquivo, hash: h, conteudo: `[PDF] ${nomeArquivo}`, dados_nfe: dn, pallets_calculados: pallets })
    }

    if (ehXML) {
      const conteudoXml = buffer.toString('utf-8')
      const dn = await parseNFe(conteudoXml)
      let pallets: number | null = null
      if (dn && dn.peso_liquido_total > 0) pallets = calcularPallets(dn.peso_liquido_total / 1000)
      anexosXML.push({ nome_arquivo: nomeArquivo, hash, conteudo: conteudoXml, dados_nfe: dn, pallets_calculados: pallets })
      return flags
    }

    // PDF mal rotulado contendo XML (.xml enviado com content-type errado)
    const inicio = buffer.slice(0, 5).toString('utf-8').trimStart()
    if (inicio.startsWith('<?xml') || inicio.startsWith('<nfe') || inicio.startsWith('<NFe')) {
      const dn = await parseNFe(buffer.toString('utf-8'))
      if (!dn?.chave_nfe && !dn?.numero_nfe && !ehNomePdfNFe(nomeLower)) return flags
      pushPdf(dn, hash)
      return flags
    }

    // PDF de verdade — pode conter VÁRIAS NF-es no mesmo arquivo (conglomeradas)
    const todasNfe = await parseNFePDFTodas(buffer)
    const validas = todasNfe.filter(nf => nf.chave_nfe || nf.numero_nfe)
    if (validas.length === 0) {
      // Nenhum dado extraído: aceita só se o nome identifica uma NF-e (vínculo por remetente)
      if (!ehNomePdfNFe(nomeLower)) return flags
      pushPdf(null, hash)
      return flags
    }
    for (const nf of validas) {
      // Hash único por NF quando há mais de uma no mesmo arquivo (evita dedup por hash)
      const hashNf = validas.length > 1 ? `${hash}-${nf.chave_nfe || nf.numero_nfe}` : hash
      pushPdf(nf, hashNf)
    }
    return flags
  }

  async function processarMensagem(msg: any): Promise<void> {
    const msgId: string = msg.internetMessageId || msg.id

    const anexosResp = await graphClient
      .api(`/users/${EMAIL_USER}/messages/${msg.id}/attachments`)
      .get()

    const anexosXML: AnexoXML[] = []
    const nomesAnexos: string[] = []
    const anexosDebug: Array<{ nome: string; contentType: string; ehXML: boolean; ehPDF: boolean; ehZIP: boolean }> = []

    for (const anexo of anexosResp.value || []) {
      const nomeArquivo: string = anexo.name || ''
      const contentType: string = anexo.contentType || ''
      nomesAnexos.push(nomeArquivo)

      // "Encaminhar como anexo" do Outlook: o anexo é um e-mail inteiro (message/rfc822),
      // sem endpoint próprio de /attachments no Graph. Baixa o MIME bruto e extrai os
      // arquivos de dentro (PDF/XML/ZIP), processando cada um como se fosse de 1º nível.
      if (anexo['@odata.type'] === '#microsoft.graph.itemAttachment') {
        anexosDebug.push({ nome: nomeArquivo, contentType: 'itemAttachment', ehXML: false, ehPDF: false, ehZIP: false })
        try {
          const eml: any = await graphClient
            .api(`/users/${EMAIL_USER}/messages/${msg.id}/attachments/${anexo.id}/$value`)
            .get()
          const emlTexto = Buffer.isBuffer(eml) ? eml.toString('utf-8')
            : eml instanceof ArrayBuffer ? Buffer.from(eml).toString('utf-8')
            : String(eml)
          const arquivosAninhados = extrairAnexosDoEml(emlTexto)
          for (const arq of arquivosAninhados) {
            const nomeLowerAninhado = arq.nome.toLowerCase()
            const ctAninhado = nomeLowerAninhado.endsWith('.xml') ? 'text/xml'
              : nomeLowerAninhado.endsWith('.zip') ? 'application/zip' : ''
            const flags = await processarArquivoAnexo(arq.nome, ctAninhado, arq.conteudo, anexosXML)
            anexosDebug.push({ nome: `↳ ${arq.nome}`, contentType: 'aninhado', ...flags })
          }
        } catch (err) {
          console.error(`Erro ao processar item aninhado "${nomeArquivo}" em ${msgId}:`, err)
        }
        continue
      }

      const buffer = Buffer.from(anexo.contentBytes, 'base64')
      const flags = await processarArquivoAnexo(nomeArquivo, contentType, buffer, anexosXML)
      anexosDebug.push({ nome: nomeArquivo, contentType, ...flags })
    }

    if (anexosXML.length === 0) {
      diagnostico?.push({
        message_id: msgId,
        assunto: msg.subject || '',
        remetente: msg.from?.emailAddress?.address || '',
        data_recebimento: msg.receivedDateTime,
        motivo_ignorado: 'Nenhum anexo XML/PDF/ZIP com NF-e reconhecido',
        anexos: nomesAnexos,
        anexos_debug: anexosDebug,
      })
      return
    }

    // Extrai CNPJs do corpo do email (strip de HTML simples)
    const corpoHtml: string = msg.body?.content || ''
    const corpoTexto = corpoHtml.replace(/<[^>]+>/g, ' ')
    const cnpjs_corpo = extrairCnpjsDoTexto(corpoTexto + ' ' + (msg.subject || ''))

    emails.push({
      message_id: msgId,
      assunto: msg.subject || '',
      remetente: msg.from?.emailAddress?.address || '',
      remetente_nome: msg.from?.emailAddress?.name || '',
      data_recebimento: msg.receivedDateTime,
      cnpjs_corpo,
      anexos_xml: anexosXML,
    })
  }

  // Processa em lotes de CONCORRENCIA para não estourar rate limit do Graph
  for (let i = 0; i < mensagensNovas.length; i += CONCORRENCIA) {
    const lote = mensagensNovas.slice(i, i + CONCORRENCIA)
    await Promise.all(lote.map((msg: any) =>
      processarMensagem(msg).catch((err: unknown) => {
        console.error(`Erro ao processar mensagem ${msg.internetMessageId ?? msg.id}:`, err)
      })
    ))
  }

  return emails
}

/**
 * Marca o email como lido no Exchange após processar.
 */
export async function marcarEmailLido(messageId: string): Promise<void> {
  await graphClient
    .api(`/users/${EMAIL_USER}/messages/${messageId}`)
    .patch({ isRead: true })
}

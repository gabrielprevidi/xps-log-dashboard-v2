/**
 * Reconhecimento e parsing de anexos de NF-e — independente do canal.
 *
 * Extraído de `email-service.ts` (que era acoplado ao Microsoft Graph) para ser
 * compartilhado entre:
 *   • V1 — leitura via Graph  (email-service.ts)
 *   • V2 — leitura via IMAP   (imap-service.ts)
 *
 * Nenhuma regra foi alterada na extração: os mesmos arquivos são aceitos e
 * ignorados que na V1.
 */
import { parseNFe, DadosNFe } from './nfe-parser'
import { parseNFePDF, parseNFePDFTodas } from './nfe-pdf-parser'
import { calcularPallets } from './calculations'
import { createHash } from 'crypto'
import { unzipSync } from 'fflate'

export interface AnexoXML {
  nome_arquivo: string
  hash: string
  conteudo: string
  dados_nfe: DadosNFe | null
  pallets_calculados: number | null
}

export interface EmailProcessado {
  message_id: string
  assunto: string
  remetente: string
  remetente_nome: string
  data_recebimento: string
  cnpjs_corpo: string[]
  anexos_xml: AnexoXML[]
  /** V2: pasta IMAP e UID de origem — não existe no caminho do Graph. */
  pasta?: string
  uid?: number
}

/** Documentos que NÃO são a NF-e em si e devem ser ignorados pelo nome. */
export function ehNomePdfIgnorado(nomeLower: string): boolean {
  return (
    nomeLower.includes('packing list') ||
    nomeLower.includes('packlist') ||
    nomeLower.includes('etiqueta') ||
    nomeLower.includes('etiq') ||
    nomeLower.includes('eituq') ||
    nomeLower.includes('draft') ||
    // Manifesto de carga (MDF-e): documento de transporte, não é NF-e. O parser
    // de PDF extrai dele um "número de nota" (na verdade o número do manifesto),
    // o que criaria movimentação fantasma se o remetente casasse com um cliente.
    // Observado em 30/07/2026: "MANIFESTO 126507 XPS.pdf", "MANIFESTO 113449 EXSA.pdf".
    nomeLower.includes('manifesto') ||
    /\bmdf-?e\b/.test(nomeLower) ||
    // "Confirmação de Pedido.pdf" — o parser capturaria o número do pedido
    // como se fosse número de nota.
    /confirma[çc][aã]o/.test(nomeLower) ||
    /^pl[\s_-]/.test(nomeLower) ||
    /[\s_-]pl[\s_-]/.test(nomeLower) ||
    /[\s_-]et\d*(?:\.|[\s_-])/.test(nomeLower) ||
    // CC-e (carta de correção) e CT-e (conhecimento de transporte): carregam a
    // mesma chave de acesso da nota original. Se processados antes do PDF real,
    // "reservam" a chave e fazem o dedup descartar a NF-e verdadeira.
    /-cce\.pdf$/.test(nomeLower) ||
    /carta de correc/.test(nomeLower) ||
    /^cc-?e[\s_.-]/.test(nomeLower) ||
    /^cte[\s_.-]/.test(nomeLower)
  )
}

/** Nome de arquivo que identifica uma NF-e mesmo sem parsear o conteúdo. */
export function ehNomePdfNFe(nomeLower: string): boolean {
  if (ehNomePdfIgnorado(nomeLower)) return false

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
    /\bnf[\s\-]?\d{5,}/.test(nomeLower) ||
    /\d{44}/.test(nomeLower)
  )
}

/** Extrai XMLs e PDFs de NF-e de um buffer ZIP. */
export function extrairXmlsDoZip(buffer: Buffer): Array<{ nome: string; conteudo: Buffer }> {
  try {
    const descompactado = unzipSync(new Uint8Array(buffer))
    const resultados: Array<{ nome: string; conteudo: Buffer }> = []
    for (const [nome, dados] of Object.entries(descompactado)) {
      const nomeLower = nome.toLowerCase()
      if (nomeLower.endsWith('.xml')) {
        resultados.push({ nome, conteudo: Buffer.from(dados) })
      } else if (nomeLower.endsWith('.pdf') && ehNomePdfNFe(nomeLower)) {
        resultados.push({ nome, conteudo: Buffer.from(dados) })
      }
    }
    return resultados
  } catch {
    return []
  }
}

/** Extrai todos os CNPJs (14 dígitos) de um texto qualquer. */
export function extrairCnpjsDoTexto(texto: string): string[] {
  const encontrados = new Set<string>()
  for (const m of texto.matchAll(/\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}/g)) {
    encontrados.add(m[0].replace(/\D/g, ''))
  }
  for (const m of texto.matchAll(/\b(\d{14})\b/g)) {
    encontrados.add(m[1])
  }
  return [...encontrados]
}

export interface FlagsAnexo {
  ehXML: boolean
  ehPDF: boolean
  ehZIP: boolean
}

/**
 * Processa um arquivo (nome + bytes) e adiciona em `anexosXML` se for
 * XML/PDF/ZIP de NF-e reconhecido. Idêntico ao comportamento da V1.
 */
export async function processarArquivoAnexo(
  nomeArquivo: string,
  contentType: string,
  buffer: Buffer,
  anexosXML: AnexoXML[],
): Promise<FlagsAnexo> {
  const nomeLower = nomeArquivo.toLowerCase()

  // Arquivos Office têm content-type "openxmlformats", que contém "xml" —
  // precisam ser excluídos antes das demais verificações.
  const ehOffice = /\.(xlsx|docx|pptx|xls|doc|ppt|odt|ods|odp|csv)$/.test(nomeLower)
  const ehXML = !ehOffice && (nomeLower.endsWith('.xml') || contentType.includes('xml'))
  const ehPDF = !ehOffice && nomeLower.endsWith('.pdf')
  if (ehPDF && ehNomePdfIgnorado(nomeLower)) {
    return { ehXML: false, ehPDF: false, ehZIP: false }
  }
  const ehPDFNomeNFe = ehPDF && ehNomePdfNFe(nomeLower)
  // ZIP só por extensão — octet-stream é genérico demais e abrange PDFs.
  const ehZIP = !ehOffice && (nomeLower.endsWith('.zip') || contentType.includes('zip'))

  const flags: FlagsAnexo = { ehXML, ehPDF: ehPDFNomeNFe, ehZIP }
  if (!ehXML && !ehPDF && !ehZIP) return flags

  if (ehZIP) {
    for (const arq of extrairXmlsDoZip(buffer)) {
      const nomeLowerZip = arq.nome.toLowerCase()
      const ehXmlZip = nomeLowerZip.endsWith('.xml')
      const hash = createHash('sha256').update(arq.conteudo).digest('hex')
      let dadosNFe: DadosNFe | null = null
      let conteudo = ''
      if (ehXmlZip) {
        conteudo = arq.conteudo.toString('utf-8')
        dadosNFe = await parseNFe(conteudo)
      } else {
        dadosNFe = await parseNFePDF(arq.conteudo)
        conteudo = `[PDF] ${arq.nome}`
      }
      if (!ehXmlZip && !dadosNFe?.chave_nfe && !dadosNFe?.numero_nfe && !ehNomePdfNFe(nomeLowerZip)) continue
      let pallets: number | null = null
      if (dadosNFe && dadosNFe.peso_liquido_total > 0) {
        pallets = calcularPallets(dadosNFe.peso_liquido_total / 1000)
      }
      anexosXML.push({ nome_arquivo: arq.nome, hash, conteudo, dados_nfe: dadosNFe, pallets_calculados: pallets })
    }
    return flags
  }

  const hash = createHash('sha256').update(buffer).digest('hex')

  const pushPdf = (dn: DadosNFe | null, h: string) => {
    let pallets: number | null = null
    if (dn && dn.peso_liquido_total > 0) pallets = calcularPallets(dn.peso_liquido_total / 1000)
    anexosXML.push({
      nome_arquivo: nomeArquivo, hash: h, conteudo: `[PDF] ${nomeArquivo}`,
      dados_nfe: dn, pallets_calculados: pallets,
    })
  }

  if (ehXML) {
    const conteudoXml = buffer.toString('utf-8')
    const dn = await parseNFe(conteudoXml)
    let pallets: number | null = null
    if (dn && dn.peso_liquido_total > 0) pallets = calcularPallets(dn.peso_liquido_total / 1000)
    anexosXML.push({ nome_arquivo: nomeArquivo, hash, conteudo: conteudoXml, dados_nfe: dn, pallets_calculados: pallets })
    return flags
  }

  // .pdf que na verdade contém XML (content-type errado)
  const inicio = buffer.slice(0, 5).toString('utf-8').trimStart()
  if (inicio.startsWith('<?xml') || inicio.startsWith('<nfe') || inicio.startsWith('<NFe')) {
    const dn = await parseNFe(buffer.toString('utf-8'))
    if (!dn?.chave_nfe && !dn?.numero_nfe && !ehNomePdfNFe(nomeLower)) return flags
    pushPdf(dn, hash)
    return flags
  }

  // PDF real — pode conter várias NF-es conglomeradas
  const todas = await parseNFePDFTodas(buffer)
  const validas = todas.filter(nf => nf.chave_nfe || nf.numero_nfe)
  if (validas.length === 0) {
    if (!ehNomePdfNFe(nomeLower)) return flags
    pushPdf(null, hash)
    return flags
  }
  for (const nf of validas) {
    // Hash único por nota quando há mais de uma no arquivo (evita dedup por hash)
    const hashNf = validas.length > 1 ? `${hash}-${nf.chave_nfe || nf.numero_nfe}` : hash
    pushPdf(nf, hashNf)
  }
  return flags
}

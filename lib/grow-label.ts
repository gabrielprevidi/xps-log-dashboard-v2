/**
 * Grow Label — notas de cobertura de material vindo da TUBOMAIS ou da
 * C.R. Embalagens.
 *
 * O fluxo real (thread "GROW LABEL - ARMAZENAR"):
 *   1. O fornecedor (TUBOMAIS / C.R. Embalagens) entrega na XPS.
 *   2. A logística da XPS conta os pallets À MÃO e manda um email com a
 *      tabela DATA | DANFES | FORNECEDOR | VOLUMES.
 *   3. A Grow responde no mesmo thread com a nota de cobertura (Grow → XPS),
 *      cujos DADOS ADICIONAIS dizem "REF A NOTA 18306 … TUBOMAIS".
 *
 * A quantidade da ESPÉCIE dessa nota de cobertura NÃO é pallet (é tubete,
 * caixa…: 168, 346…). O volume certo é o da tabela da logística, que vem
 * citada no corpo da resposta. Ex. real (30/10/2026): NF 49548 ref. 18306 —
 * espécie 31, tabela 2.
 */

const CNPJ_GROW_LABEL = '07988186000188'

export function ehClienteGrowLabel(cnpj: string | null | undefined): boolean {
  return String(cnpj ?? '').replace(/\D/g, '') === CNPJ_GROW_LABEL
}

/** Fornecedores cujas notas não vêm em pallets. */
const RE_FORNECEDOR = /TUBO\s*MAIS|C\s*\.?\s*R\s*\.?\s*EMBALAGENS/i

export function ehNotaCoberturaSemPallet(textoPdf: string | null | undefined): boolean {
  return RE_FORNECEDOR.test(textoPdf ?? '')
}

/** "23.344" → "23344", "018306" → "18306". */
function normalizarNumero(s: string): string {
  return s.replace(/\D/g, '').replace(/^0+/, '')
}

// Número de NF: 4+ dígitos ou milhar com ponto. Não pode ser parte de data.
const NUM = String.raw`(?<![\d/.])(\d{1,3}(?:\.\d{3})+|\d{4,9})(?![\d/])`

/**
 * Notas do fornecedor referenciadas na nota de cobertura. Formatos reais:
 *   "REF A NOTA 18306 DE 27/10/2026 TUBOMAIS"
 *   "REF. A NF 23.344 04/11/26 C.R. EMBALAGENS"
 *   "REFERENTE A NF 23402 DA DATA 10/11/2026 C. R. EMBALAGENS"
 */
export function notasReferenciadas(textoPdf: string | null | undefined): string[] {
  const t = (textoPdf ?? '').replace(/\s+/g, ' ')
  const re = new RegExp(
    String.raw`REF(?:ERENTE|\.)?\s*(?:[AÀ]S?\s+)?(?:NOTAS?|NFS?-?E?|N\.\s*F\.)\s*(?:FISCA(?:L|IS)\s*)?(?:N[º°O.]+\s*)?` +
    NUM + String.raw`((?:\s*(?:,|E)\s*(?:\d{1,3}(?:\.\d{3})+|\d{4,9})(?![\d/]))*)`,
    'gi',
  )
  const out = new Set<string>()
  for (const m of t.matchAll(re)) {
    out.add(normalizarNumero(m[1]))
    for (const extra of (m[2] ?? '').matchAll(new RegExp(NUM, 'g'))) out.add(normalizarNumero(extra[1]))
  }
  return [...out]
}

/**
 * Fallback quando o PDF não traz a referência: a resposta da Grow costuma
 * dizer "NF 49548 referente a nota 18306" (ou "49855 referentea 23402").
 */
export function notasReferenciadasNoCorpo(corpo: string, numeroCobertura: string | null | undefined): string[] {
  const n = normalizarNumero(numeroCobertura ?? '')
  if (!n) return []
  const re = new RegExp(
    String.raw`(?<!\d)0*${n}(?!\d)\s*(?:_1)?\s*refer\w*\s*(?:[aà]\s*)?(?:(?:a\s+)?(?:nota|nf)\s*)?` + NUM,
    'gi',
  )
  const out = new Set<string>()
  for (const m of corpo.matchAll(re)) out.add(normalizarNumero(m[1]))
  return [...out]
}

/** Texto do corpo em linhas limpas — HTML vira uma célula por linha. */
export function linhasDoCorpo(corpo: string): string[] {
  const texto = /<\w+[^>]*>/.test(corpo)
    ? corpo
        .replace(/<(style|script)[\s\S]*?<\/\1>/gi, ' ')
        .replace(/<br\s*\/?>|<\/(p|div|td|th|tr|li|h\d)>/gi, '\n')
        .replace(/<[^>]+>/g, ' ')
        .replace(/&nbsp;/gi, ' ')
        .replace(/&amp;/gi, '&')
    : corpo
  return texto
    .split(/\r?\n/)
    .map(l => l.replace(/^[\s>]+/, '').replace(/\s+/g, ' ').trim())
    .filter(Boolean)
}

/**
 * Volumes (pallets) que a logística da XPS contou para a DANFE `numero`, lidos
 * da tabela DATA | DANFES | FORNECEDOR | VOLUMES citada no corpo.
 *
 * Aceita a célula em linha própria (texto que o Outlook gera da tabela) e a
 * linha inteira ("28/10/2026 18313 TUBOMAIS 14"). Usa a primeira ocorrência,
 * que é a citação mais recente do thread.
 */
export function volumesDaTabelaLogistica(corpo: string, numero: string): number | null {
  const alvo = normalizarNumero(numero)
  if (!alvo || !/VOLUMES/i.test(corpo)) return null
  const linhas = linhasDoCorpo(corpo)
  const ehNumeroNF = (s: string) => /^(\d{1,3}(?:\.\d{3})+|\d{3,9})$/.test(s) && normalizarNumero(s) === alvo
  const ehFornecedor = (s: string) => /[A-Za-zÀ-ú]/.test(s) && !/^(TOTAL|DATA|DANFES?|VOLUMES)$/i.test(s)
  const ehQtd = (s: string) => /^\d{1,4}$/.test(s)

  for (let i = 0; i < linhas.length; i++) {
    const l = linhas[i]
    // Célula por linha: DANFE / FORNECEDOR / VOLUMES
    if (ehNumeroNF(l) && i + 2 < linhas.length && ehFornecedor(linhas[i + 1]) && ehQtd(linhas[i + 2])) {
      return Number(linhas[i + 2])
    }
    // Linha inteira
    const m = l.match(/^(?:\d{2}\/\d{2}\/\d{2,4}\s+)?(\d{1,3}(?:\.\d{3})+|\d{3,9})\s+(.*?[A-Za-zÀ-ú].*?)\s+(\d{1,4})$/)
    if (m && normalizarNumero(m[1]) === alvo) return Number(m[3])
  }
  return null
}

export interface PalletsCobertura {
  pallets: number | null
  referencias: string[]
  /** Referências que não foram achadas na tabela da logística. */
  faltando: string[]
}

/** Soma os volumes da tabela para todas as notas que a cobertura referencia. */
export function palletsDaCobertura(
  textoPdf: string | null | undefined,
  numeroCobertura: string | null | undefined,
  corpo: string | null | undefined,
): PalletsCobertura {
  const c = corpo ?? ''
  let referencias = notasReferenciadas(textoPdf)
  if (referencias.length === 0) referencias = notasReferenciadasNoCorpo(c, numeroCobertura)
  const faltando: string[] = []
  let total = 0
  for (const r of referencias) {
    const v = volumesDaTabelaLogistica(c, r)
    if (v === null) faltando.push(r)
    else total += v
  }
  const ok = referencias.length > 0 && faltando.length === 0
  return { pallets: ok ? total : null, referencias, faltando }
}

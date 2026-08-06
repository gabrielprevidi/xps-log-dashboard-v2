import type { DadosNFe } from './nfe-parser'
import { tipoOperacaoPorNatureza } from './nfe-classificacao'

function normalizarNumero(s: string): number {
  // Formato brasileiro: 15.000,000 → 15000.000
  return parseFloat(s.replace(/\./g, '').replace(',', '.')) || 0
}

function limparCnpj(s: string): string {
  return s.replace(/[.\-\/\s]/g, '')
}

// A lib `pdf-parse` (v1.1.1) guarda o módulo pdf.js num `let PDFJS` global,
// compartilhado por TODAS as chamadas no processo, e chama `doc.destroy()` ao
// final de cada parse. Se duas chamadas rodarem ao mesmo tempo (ex.: vários
// e-mails/anexos processados em paralelo no sync), o destroy() de uma pode
// abortar o getPage()/getTextContent() da outra — a lib engole esse erro
// internamente e devolve texto vazio, sem lançar exceção. O sintoma é NF-e
// salva com todos os campos nulos, de forma intermitente e mais frequente
// quanto mais anexos são processados concorrentemente. Serializa toda chamada
// à lib para garantir no máximo 1 parse de PDF em voo por vez no processo.
let filaPdf: Promise<unknown> = Promise.resolve()
function serializarPdfParse<T>(chamada: () => Promise<T>): Promise<T> {
  const resultado = filaPdf.then(chamada, chamada)
  filaPdf = resultado.then(() => undefined, () => undefined)
  return resultado
}

async function extrairTextoPDF(buffer: Buffer): Promise<string> {
  const pdfParseModule = await import('pdf-parse/lib/pdf-parse.js')
  const pdfParse = (pdfParseModule.default ?? pdfParseModule) as (data: Buffer) => Promise<{ text: string }>
  let result = await serializarPdfParse(() => pdfParse(buffer))
  if (!result.text || result.text.trim().length < 30) {
    // Texto vazio/quase vazio nunca acontece com um DANFE válido — é o sintoma
    // da falha silenciosa da lib descrita acima. Tenta mais uma vez (já fora
    // da janela de corrida, pois a fila serializada garante que outras
    // chamadas em andamento tenham terminado até aqui).
    result = await serializarPdfParse(() => pdfParse(buffer))
  }
  return result.text
}

export async function parseNFePDF(buffer: Buffer): Promise<DadosNFe | null> {
  try {
    return parseTextoNFe(await extrairTextoPDF(buffer))
  } catch (error) {
    console.error('Erro ao parsear NFe PDF:', error)
    return null
  }
}

/**
 * Renderiza o PDF página a página, agrupa as páginas pela chave de acesso e
 * retorna UMA NF-e por grupo. Trata PDFs com várias notas no mesmo arquivo
 * (conglomeradas) — cada NF costuma ocupar uma ou mais páginas próprias.
 */
export async function parseNFePDFTodas(buffer: Buffer): Promise<DadosNFe[]> {
  try {
    const pdfParseModule = await import('pdf-parse/lib/pdf-parse.js')
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const pdfParse = (pdfParseModule.default ?? pdfParseModule) as any

    const renderizarPaginas = async (): Promise<string[]> => {
      const pags: string[] = []
      await serializarPdfParse(() => pdfParse(buffer, {
        // Replica a quebra de linha do render padrão (newline quando muda o Y),
        // para o texto de cada página ficar equivalente ao do parse padrão.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        pagerender: (pageData: any) =>
          pageData
            .getTextContent({ normalizeWhitespace: false, disableCombineTextItems: false })
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            .then((tc: any) => {
              let lastY: number | undefined
              let text = ''
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              for (const item of tc.items as any[]) {
                if (lastY === item.transform[5] || lastY === undefined) text += item.str
                else text += '\n' + item.str
                lastY = item.transform[5]
              }
              pags.push(text)
              return text
            }),
      }))
      return pags
    }

    let paginas = await renderizarPaginas()
    if (paginas.every(p => !p || p.trim().length < 30)) {
      // Todas as páginas vieram vazias/quase vazias — sintoma da falha
      // silenciosa da lib (ver comentário de serializarPdfParse). Tenta de novo.
      paginas = await renderizarPaginas()
    }

    // Agrupa páginas consecutivas pela chave de acesso (44 dígitos)
    const grupos: string[][] = []
    const chaveDoGrupo: string[] = []
    let ultimaChave = ''
    for (const pag of paginas) {
      const cand = (pag.match(/(?:\d{4}[\s.]*){10}\d{4}/g) ?? [])
        .map(s => s.replace(/\D/g, ''))
        .find(c => c.length === 44)
      if (cand) ultimaChave = cand
      const chave = cand || ultimaChave
      const idx = chave ? chaveDoGrupo.indexOf(chave) : -1
      if (idx >= 0) grupos[idx].push(pag)
      else { grupos.push([pag]); chaveDoGrupo.push(chave || `_p${grupos.length}`) }
    }

    const resultado: DadosNFe[] = []
    for (const pags of grupos) {
      const nf = parseTextoNFe(pags.join('\n'))
      if (nf && (nf.chave_nfe || nf.numero_nfe)) resultado.push(nf)
    }
    if (resultado.length > 0) return resultado

    // Fallback: parse padrão do documento inteiro (layout sem páginas separáveis)
    const single = await parseNFePDF(buffer)
    return single ? [single] : []
  } catch (error) {
    console.error('Erro ao parsear NFe PDF (múltiplas):', error)
    const single = await parseNFePDF(buffer)
    return single ? [single] : []
  }
}

function parseTextoNFe(texto: string): DadosNFe | null {
  try {

    // --- Chave de acesso (44 dígitos em grupos de 4) ---
    // Tenta padrão estrito (grupos de 4 com espaços), depois looser (44 dígitos com espaços opcionais)
    let chave_nfe = ''
    // DANFEs de "Retorno" (Fedrigoni: documento gerado pela XPS referenciando a nota
    // ORIGINAL de entrada) citam a CHAVE DA NOTA REFERENCIADA em "INFORMAÇÕES
    // COMPLEMENTARES" / "REFERENTE A NOTA FISCAL ####". Se a chave própria do documento
    // vier quebrada no topo (ex.: "CHAVE DE ACESSO\n26 0532 ..." sem o "35" inicial —
    // bug de renderização desse template), os fallbacks abaixo (que buscam qualquer
    // sequência de 44 dígitos) acabam capturando a chave da nota REFERENCIADA em vez da
    // própria — e o dedup por chave descarta o retorno real como se já tivesse sido
    // importado (a chave "roubada" já pertence à entrada correspondente). Por isso, os
    // fallbacks buscam apenas ANTES dessa seção.
    const cortReferencia = texto.search(/INFORMA[ÇC][ÕO]ES COMPLEMENTARES|REFERENTE A NOTA FISCAL/i)
    const textoParaChave = cortReferencia >= 0 ? texto.slice(0, cortReferencia) : texto

    const chaveMatch1 = textoParaChave.match(/CHAVE DE ACESSO\s*((?:\d{4}\s*){10}\d{4})/)
    if (chaveMatch1) {
      chave_nfe = chaveMatch1[1].replace(/\s/g, '').slice(0, 44)
    }
    if (chave_nfe.length !== 44) {
      // Fallback: 44 dígitos consecutivos no texto (sem espaços)
      const chaveMatch2 = textoParaChave.match(/\b(\d{44})\b/)
      if (chaveMatch2) chave_nfe = chaveMatch2[1]
    }
    if (chave_nfe.length !== 44) {
      // Fallback: DANFEs de TRANSFERÊNCIA emitidos pela própria Tecnia (UF de Minas
      // Gerais, chave não começa com "35") têm o VALOR antes do rótulo "CHAVE DE
      // ACESSO DA NF-e" (ordem invertida em relação aos demais layouts). Precisa
      // rodar ANTES do fallback "35..." abaixo: como essas chaves começam com "31"
      // (não "35"), o padrão solto abaixo não as reconheceria e acabaria casando
      // lixo numérico solto em outra parte do texto (ex.: bloco de produtos).
      const chaveAntesDoRotulo = textoParaChave.match(
        /((?:\d{4}[\s.]+){10}\d{4})\s*\n\s*CHAVE DE ACESSO/i
      )
      if (chaveAntesDoRotulo) {
        const candidate = chaveAntesDoRotulo[1].replace(/[\s.]/g, '')
        if (candidate.length === 44) chave_nfe = candidate
      }
    }
    if (chave_nfe.length !== 44) {
      // Fallback: DANFEs como Fedrigoni exibem a chave em grupos, às vezes sem o rótulo.
      const candidatos = textoParaChave.match(/35(?:\D{0,3}\d){42}/g) ?? []
      for (const candidato of candidatos) {
        const digitos = candidato.replace(/\D/g, '')
        if (digitos.length === 44 && digitos.startsWith('35')) {
          chave_nfe = digitos
          break
        }
      }
    }
    if (chave_nfe.length !== 44) {
      // Fallback: qualquer bloco de ~47-60 chars após "CHAVE DE ACESSO" (pode ter quebras de linha)
      const chaveBlock = textoParaChave.match(/CHAVE DE ACESSO[\s\S]{0,40}?((?:\d\s*){44})/)
      if (chaveBlock) {
        const candidate = chaveBlock[1].replace(/\s/g, '')
        if (candidate.length === 44) chave_nfe = candidate
      }
    }
    if (chave_nfe.length !== 44) {
      // Fallback genérico: 11 grupos de 4 dígitos separados por espaço/ponto, em
      // qualquer lugar do texto (DANFEs onde a chave fica longe do rótulo
      // "CHAVE DE ACESSO", ex.: remessa de amostra grátis). Cobre qualquer UF.
      const chaveGrupos = textoParaChave.match(/(?:\d{4}[\s.]+){10}\d{4}/)
      if (chaveGrupos) {
        const candidate = chaveGrupos[0].replace(/[\s.]/g, '')
        if (candidate.length === 44) chave_nfe = candidate
      }
    }

    // --- Número da NF-e ---
    // Padrões: "NF-e Nº: 000.000.167", "Nº. 000.003.754" (com ponto), "N. 000093245"
    let numero_nfe = ''
    // Helper: só aceita o valor se o parse for um inteiro válido > 0 (evita capturar
    // "." em "Nº." e gravar "NaN", que bloquearia os fallbacks por ser truthy).
    const setNumero = (raw?: string | null) => {
      if (numero_nfe || !raw) return
      const n = parseInt(raw.replace(/\./g, ''), 10)
      if (!isNaN(n) && n > 0) numero_nfe = String(n)
    }
    // 1) "NF-e ... Nº[:.]? 000.000.167" — captura exige começar com dígito
    setNumero(texto.match(/N[Ff]-?[Ee]\s*N[°oº]\.?\s*[:.]?\s*(\d[\d.]*)/)?.[1])
    // 2) "Nº[.:] 000.003.754" isolado (com ponto OU dois-pontos após o Nº)
    setNumero(texto.match(/N[ºoO°]\s*[:.]?\s*(\d{1,3}(?:\.\d{3})+|\d{4,12})/)?.[1])
    // 3) "N. 000093245"
    setNumero(texto.match(/\bN\.\s*(\d[\d.]{4,})/)?.[1])
    // 4) Fallback pela chave de acesso (posições 25-33 = 9 dígitos do número da NF)
    if (!numero_nfe && chave_nfe.length === 44) setNumero(chave_nfe.substring(25, 34))

    // --- Data de emissão (DD/MM/YYYY → YYYY-MM-DD) ---
    // Aceita "DATA DE EMISSÃO" e "DATA DA EMISSÃO" (variação entre implementações)
    const dataMatch = texto.match(/DATA D[AE] EMISS[AÃ]O\s+(\d{2})\/(\d{2})\/(\d{4})/)
    let data_emissao = dataMatch
      ? `${dataMatch[3]}-${dataMatch[2]}-${dataMatch[1]}`
      : ''
    if (!data_emissao) {
      // Fallback: a data de autorização no protocolo coincide com a emissão
      // ("PROTOCOLO DE AUTORIZAÇÃO DE USO\n131... - 12/05/2026 13:41:58")
      const protMatch = texto.match(
        /PROTOCOLO DE AUTORIZA[CÇ][AÃ]O[\s\S]{0,80}?(\d{2})\/(\d{2})\/(\d{4})/
      )
      if (protMatch) data_emissao = `${protMatch[3]}-${protMatch[2]}-${protMatch[1]}`
    }
    if (!data_emissao) {
      // Fallback: DANFEs de TRANSFERÊNCIA da Tecnia trazem o VALOR antes do rótulo
      // ("04/05/2026\nDATA DE EMISSÃO"), ordem invertida em relação ao padrão acima.
      const dataAntesDoRotulo = texto.match(/(\d{2})\/(\d{2})\/(\d{4})\s*\n\s*DATA D[AE] EMISS[AÃ]O/)
      if (dataAntesDoRotulo) {
        data_emissao = `${dataAntesDoRotulo[3]}-${dataAntesDoRotulo[2]}-${dataAntesDoRotulo[1]}`
      }
    }

    // --- Destinatário ---
    // Vários layouts de DANFE; tenta do mais específico/confiável ao mais genérico.
    let nome_destinatario = ''
    const setNomeDest = (raw?: string | null) => { if (!nome_destinatario && raw) nome_destinatario = raw.trim() }
    // 1) Canhoto "DESTINATÁRIO: FEDRIGONI ... LTDA - R ANTONIO..." (notas de retorno)
    setNomeDest(texto.match(/DESTINAT[AÁ]RIO:\s*(.+?)\s+-\s/i)?.[1])
    // 2) "NOME/RAZÃO SOCIAL  X  CNPJ/CPF" (rótulo sem espaços ao redor da barra)
    setNomeDest(texto.match(/NOME\/RAZ[AÃ]O SOCIAL\s+(.+?)\s+CNPJ\/CPF/)?.[1])
    // 3) "NOME / RAZÃO SOCIAL\nX" (rótulo com espaços; valor na próxima linha)
    setNomeDest(texto.match(/NOME\s*\/\s*RAZ[AÃ]O SOCIAL\s*\n\s*([^\n]+)/i)?.[1])
    // 4) Linha logo após "DESTINATÁRIO" isolado
    setNomeDest(texto.match(/\bDESTINAT[AÁ]RIO\s*\n\s*([^\n]+)/i)?.[1])

    let cnpj_destinatario = ''
    const setCnpjDest = (raw?: string | null) => { if (!cnpj_destinatario && raw) cnpj_destinatario = limparCnpj(raw) }
    // 1) Rótulo sem espaços
    setCnpjDest(texto.match(/NOME\/RAZ[AÃ]O SOCIAL\s+.+?\s+CNPJ\/CPF\s+([\d.\/\-]+)/)?.[1])
    // 2) Primeiro CNPJ formatado APÓS o bloco "DESTINATÁRIO / REMETENTE"
    setCnpjDest(texto.match(/DESTINAT[AÁ]RIO\s*\/\s*REMETENTE[\s\S]{0,400}?(\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2})/i)?.[1])
    // 3) DANFE "amostra": CNPJ colado à data de emissão ("...0001-6812/05/2026")
    setCnpjDest(texto.match(/(\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2})\d{2}\/\d{2}\/\d{4}/)?.[1])

    // --- Emitente CNPJ ---
    // Tenta regex no texto primeiro; se falhar, extrai da chave NF-e (posições 6-19)
    const cnpjEmitenteMatch = texto.match(
      /INSCRI[CÇ][AÃ]O ESTADUAL SUB[\.\s]+TRIBUTARI[AÁ]\s+CNPJ\s+([\d.\/\-]+)/
    )
    const cnpj_emitente = cnpjEmitenteMatch
      ? limparCnpj(cnpjEmitenteMatch[1])
      : (chave_nfe.length === 44 ? chave_nfe.substring(6, 20) : '')

    // Nome: primeira linha após "SÉRIE: N\n" no bloco do emitente
    const nomeEmitenteMatch = texto.match(/SÉRIE:\s*\d+\n([^\n]+)\n/)
    const nomeEmitenteFedrigoniMatch = texto.match(/Identifica[cç][aã]o do emitente\s+([^\n]+)(?:\n\s*([^\n]+))?/i)
    let nome_emitente = nomeEmitenteMatch ? nomeEmitenteMatch[1].trim() : ''
    if (!nome_emitente && nomeEmitenteFedrigoniMatch) {
      const linhasNome = [nomeEmitenteFedrigoniMatch[1], nomeEmitenteFedrigoniMatch[2]]
        .filter(Boolean)
        .map(l => l.trim())
        .filter(l => l && !/^(r\.?|rua|av\.?|avenida)\b/i.test(l))
      nome_emitente = linhasNome.join(' ').replace(/\s+/g, ' ').trim()
    }
    if (!nome_emitente) {
      // Fallback: "RECEBEMOS DE {NOME} OS PRODUTOS/SERVIÇOS..." (canhoto do DANFE)
      const recMatch = texto.match(/RECEBEMOS DE\s+(.+?)\s+OS PRODUTOS/i)
      if (recMatch) nome_emitente = recMatch[1].trim()
    }

    // --- Natureza da operação ---
    const naturezaMatch = texto.match(/NATUREZA DA OPERA[CÇ][AÃ]O\s+([^\n]+)/)
    let natureza_operacao = naturezaMatch ? naturezaMatch[1].trim() : ''
    // Em alguns DANFEs o texto extraído embaralha a ordem e o rótulo "NATUREZA DA
    // OPERAÇÃO" é seguido por outros rótulos (ex.: "INSCRIÇÃO ESTADUAL..."). Nesse
    // caso, a natureza real fica na linha imediatamente antes da linha IE+CNPJ do
    // emitente (ex.: "REMESSA DE AMOSTRA GRATIS" antes de "005...61.178.630/0001-45").
    if (!natureza_operacao || /INSCRI[CÇ]|CHAVE DE ACESSO/i.test(natureza_operacao)) {
      const natFallback = texto.match(
        /\n([A-ZÀ-Ú][^\n]{4,60})\n\d{6,}\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}/
      )
      if (natFallback) natureza_operacao = natFallback[1].trim()
    }
    if (!natureza_operacao) {
      // Fallback: DANFEs de TRANSFERÊNCIA da Tecnia trazem o VALOR antes do rótulo,
      // em Title Case ("Natureza da Operação", não caixa alta como os demais layouts)
      // — ex.: "REMESSA PARA DEPOSITO FECHADO OU ARMAZEM GERAL\nNatureza da Operação".
      const natAntesDoRotulo = texto.match(/\n([A-ZÀ-Ú][^\n]{4,80})\n\s*Natureza da Opera[cç][aã]o\b/i)
      if (natAntesDoRotulo) natureza_operacao = natAntesDoRotulo[1].trim()
    }

    // --- CFOP: na linha do produto --- padrão "NCM O CST 6102 TON" ---
    const cfopProdMatch = texto.match(
      /\d{8}\s+\d+\s+\d{2}\s+(\d{4})\s+(?:TON|KG|UN|CX|PC|MT|M2|L)\b/
    )
    const cfop = cfopProdMatch ? cfopProdMatch[1] : ''

    const tipo_operacao = tipoOperacaoPorNatureza(natureza_operacao)

    // --- Peso líquido total (DANFE exibe em kg) ---
    const pesoMatch = texto.match(/PESO LIQUIDO\s+([\d.,]+)/)
    let peso_liquido_total = pesoMatch ? normalizarNumero(pesoMatch[1]) : 0
    if (peso_liquido_total === 0) {
      // Fallback: layouts em que "PESO LÍQUIDO" é apenas cabeçalho de coluna e o
      // valor real aparece na linha de dados dos volumes (ex.: "25,000 25,000" =
      // peso bruto / peso líquido). Exige 3 casas decimais para não capturar os
      // valores "0,00" do bloco de cálculo do imposto que aparecem antes.
      // \s* (não \s+): em muitos DANFEs os dois valores vêm colados ("25,00025,000")
      const volMatch = texto.match(
        /PESO BRUTO\s*PESO L[IÍ]QUIDO[\s\S]{0,400}?\d{1,6}[.,]\d{3}\s*(\d{1,6}[.,]\d{3})/
      )
      if (volMatch) peso_liquido_total = normalizarNumero(volMatch[1])
    }

    // --- Unidade predominante ---
    const unidade = /\bTON\b/.test(texto) ? 'TON' : 'KG'

    // --- Extração de itens do DANFE ---
    // Formato real identificado: 2 linhas por item
    //   Linha A: [CÓDIGO numérico][DESCRIÇÃO]  ex: "601840ARGILUM-60 18/40 - SKU 60.18"
    //   Linha B: [NCM 8d][extra][CFOP 4d][UNIDADE][QTD]  ex: "250830000 005102TON0,60004.254,04..."
    const itens: import('./nfe-parser').ItemNFe[] = []
    const linhas = texto.split(/\r?\n/)
    const UNIT_PAT = '(?:TON|KGS?|SC|SAC|UN|CX|PC|BAG|GR?|M2|L|MT)'

    for (let i = 0; i < linhas.length; i++) {
      const linha = linhas[i].trim()
      if (!linha) continue

      // Caso especial: CÓDIGO+DESCRIÇÃO+NCM+CFOP+UNID+QTD GRUDADOS na MESMA linha,
      // quando o PDF não quebra a linha entre a descrição e os dados. Ex.:
      //   "601840ARGILUM-60 18/40 - SKU 60.1840281820100 416905TON4,8000..."
      // A detecção padrão abaixo exige que a linha COMECE com 8 dígitos (NCM);
      // como esta começa com o código do produto, o item escaparia. Bloco aditivo:
      // só dispara em linhas que NÃO começam com NCM, sem afetar os itens já lidos.
      if (!/^\d{8}/.test(linha) && !/DESCRI|VALOR|NCM|CFOP|CODIGO/i.test(linha)) {
        const cdn = linha.match(
          new RegExp(`^(\\d{1,8}\\.\\d{1,8}|\\d{4,12})([A-Za-zÀ-ú].*?)(\\d{8})\\d*\\s+\\d{2,6}(?=${UNIT_PAT})`, 'i')
        )
        // NCM pelo bloco NCM+O/CST+CFOP+UNID., quando ele aparece inteiro na linha.
        // O `.*?` preguiçoso da descrição acima faz o grupo de 8 dígitos parar cedo
        // demais em descrição terminada em número: "... - SKU 60.0820" seguido do
        // NCM 25083000 era lido como "08202508" (NF-e 248 da Alphalum).
        const ncmBloco = linha.match(new RegExp(`(\\d{8})\\d\\s+\\d{2}\\d{4}(?=${UNIT_PAT})`, 'i'))
        const uq = linha.match(new RegExp(`(${UNIT_PAT})(\\d{1,4}[.,]\\d{1,4})`, 'i'))
        if (cdn && uq) {
          const quantidade = parseFloat(uq[2].replace(',', '.')) || 0
          const cfopM = linha.match(new RegExp(`(\\d{4})${UNIT_PAT}`, 'i'))
          if (quantidade > 0) {
            const descricao = cdn[2].replace(/\s*-?\s*SKU.*$/i, '').trim() || cdn[2].trim()
            itens.push({
              numero_item: itens.length + 1,
              codigo: cdn[1],
              descricao: descricao.slice(0, 80),
              ncm: ncmBloco?.[1] ?? cdn[3],
              cfop: cfopM ? cfopM[1] : '',
              unidade: uq[1].toUpperCase(),
              quantidade,
              peso_liquido: 0,
            })
            continue
          }
        }
      }

      // Linha de dados: começa com 8 dígitos (NCM) e contém unidade + quantidade
      if (!/^\d{8}/.test(linha)) continue
      if (/DESCRI|VALOR|NCM|CFOP|CODIGO/i.test(linha)) continue

      const ncm = linha.slice(0, 8)

      // Extrai unidade + quantidade: "TON0,6000" ou "KG1,500"
      const unitQtyRe = new RegExp(`(${UNIT_PAT})(\\d{1,4}[.,]\\d{1,4})`, 'i')
      const uqMatch = linha.match(unitQtyRe)
      if (!uqMatch) continue

      const unidade = uqMatch[1].toUpperCase()
      const quantidade = parseFloat(uqMatch[2].replace(',', '.')) || 0
      if (quantidade <= 0) continue

      // CFOP: 4 dígitos imediatamente antes da unidade
      const cfopRe = new RegExp(`(\\d{4})${UNIT_PAT}`, 'i')
      const cfopMatch = linha.match(cfopRe)
      const cfop = cfopMatch ? cfopMatch[1] : ''

      // Busca a(s) linha(s) anterior(es) com código + descrição. Quando a descrição
      // foi quebrada em mais de uma linha pelo PDF (ex.: "...48X25 KG - S" / "KU 60.0030"),
      // junta os fragmentos até encontrar a linha que começa com o CÓDIGO do produto.
      // Ignora linhas muito curtas (ex: "40", "80") que são artefatos do PDF.
      const partes: string[] = []
      for (let j = i - 1; j >= Math.max(0, i - 6); j--) {
        const prev = linhas[j].trim()
        if (!prev || prev.length < 8) continue  // pula linhas vazias ou muito curtas
        if (/^\d{8}/.test(prev)) break           // outra linha de dados — para
        partes.unshift(prev)
        // Linha que inicia com código numérico + descrição (início do item) → para
        if (/^\d+\s*[A-Za-zÀ-ú]/.test(prev)) break
        // Idem para código COM PONTO colado na descrição ("11.0009ALUM 9 TM..." da
        // Alphalum): sem isto a busca passava direto pelo início do item e varria mais
        // 4 linhas acima, colando cabeçalho de coluna na descrição
        // ("APROX. DOSTRIBUTOS11.0009ALUM..."). Exige a letra COLADA no número — com
        // espaço no meio o padrão casaria continuação de descrição ("1.37 X 50M" da
        // Avery), truncando o item.
        if (/^\d{1,8}\.\d{2,8}[A-Za-zÀ-ú]/.test(prev)) break
      }
      const codigoDesc = partes.join('')
      if (!codigoDesc) continue

      // Remove número de item inicial se existir ("1 601840ARGILUM...")
      const semNumItem = codigoDesc.replace(/^\d+\s+/, '')

      // Código puramente numérico colado à descrição: "601840ARGILUM..."
      // Ou código alfanumérico separado por espaço: "AB1234 Descrição"
      let codigo = `PROD_${itens.length + 1}`
      let descricao = semNumItem

      // Código numérico colado à descrição. A primeira alternativa cobre código
      // com ponto ("11.0009ALUM 9 TM 1.200 KG BIG BAG"); sem ela o item ficava
      // com código sintético PROD_n e a descrição inteira virava "descrição".
      const numColado = semNumItem.match(/^(\d{1,8}\.\d{1,8}|\d{4,12})([A-Za-z].*)/)
      if (numColado) {
        codigo = numColado[1]
        descricao = numColado[2].trim()
      } else {
        const alfaNum = semNumItem.match(/^([A-Z0-9]{4,20})\s+(.+)/i)
        if (alfaNum) {
          codigo = alfaNum[1]
          descricao = alfaNum[2].trim()
        }
      }

      if (/DESCRI|PRODUTO|NATUREZA|CFOP|CHAVE/i.test(descricao)) continue

      itens.push({
        numero_item: itens.length + 1,
        codigo,
        descricao: descricao.slice(0, 80),
        ncm,
        cfop,
        unidade,
        quantidade,
        peso_liquido: 0,
      })
    }

    // Fallback: apenas código + descrição sem quantidade (PDFs com layout diferente)
    if (itens.length === 0) {
      const itemRegexSimples = /\b([A-Z0-9]{5,20})\s{2,}([A-Z0-9][^\n]{3,80?}?)\s{2,}\d{8}\b/gm
      for (const m of texto.matchAll(itemRegexSimples)) {
        const codigo = m[1].trim()
        const descricao = m[2].trim()
        if (!/[A-Z]/.test(codigo) || !/[0-9]/.test(codigo)) continue
        if (/DESCRI|PRODUTO|NATUREZA|CFOP/i.test(descricao)) continue
        itens.push({ numero_item: itens.length + 1, codigo, descricao, ncm: '', cfop: '', unidade: '', quantidade: 0, peso_liquido: 0 })
      }
    }

    // --- Código de operação do DANFE (0 = entrada, 1 = saída) ---
    // Aparece logo abaixo de "DOCUMENTO AUXILIAR DA NOTA FISCAL ELETRÔNICA",
    // geralmente sozinho em linha ou ao lado de "ENTRADA"/"SAÍDA".
    let codigo_operacao_danfe: number | null = null
    // Tenta padrão: "0\nENTRADA" ou "1\nSAÍDA" (ou em ordem invertida)
    const danfeCode1 = texto.match(/\b([01])\s*\n\s*(?:ENTRADA|SA[IÍ]DA)\b/i)
    const danfeCode2 = texto.match(/(?:ENTRADA|SA[IÍ]DA)\s*\n\s*\b([01])\b/i)
    // Fallback: 0/1 na área do cabeçalho do DANFE (primeiros 600 chars)
    const danfeCode3 = texto.slice(0, 600).match(/DOCUMENTO AUXILIAR[\s\S]{0,300}?\b([01])\b/)
    const danfeCodeRaw = danfeCode1?.[1] ?? danfeCode2?.[1] ?? danfeCode3?.[1] ?? null
    if (danfeCodeRaw !== null) codigo_operacao_danfe = parseInt(danfeCodeRaw, 10)

    // --- QUANTIDADE total da seção ESPÉCIE (volumes transportados) ---
    // A seção "Dados dos Volumes Transportados" do DANFE tem colunas:
    // ESPÉCIE | MARCA | NUMERAÇÃO | QUANTIDADE | PESO BRUTO | PESO LÍQUIDO
    // A quantidade total (número de volumes, rolos, caixas, etc.) fica sob QUANTIDADE.
    let quantidade_especie: number | null = null
    // Tenta cabeçalho + valor na próxima linha: "QUANTIDADE\n30"
    const qEsp1 = texto.match(/QUANTIDADE\s*\n\s*([\d.]+)\s*\n/)
    // Fallback: valor inline após ESPECIE e QUANTIDADE no mesmo bloco
    const qEsp2 = texto.match(/ESP[EÉ]CIE[\s\S]{0,300}QUANTIDADE[\s\S]{0,50}\n([^\n]+)/)
    if (qEsp1) {
      quantidade_especie = normalizarNumero(qEsp1[1])
    } else if (qEsp2) {
      // Data row: extrai o primeiro número inteiro (valor da coluna QUANTIDADE)
      const dataRow = qEsp2[1].trim()
      const numMatch = dataRow.match(/\b(\d{1,6}(?:[.,]\d{1,3})?)\b/)
      if (numMatch) quantidade_especie = normalizarNumero(numMatch[1])
    } else {
      // Fallback: DANFEs de TRANSFERÊNCIA da Tecnia trazem o VALOR antes dos rótulos
      // ("17\nQTDE.\nPALLET\nESPÉCIE"), abreviado ("QTDE." em vez de "QUANTIDADE").
      const qEsp3 = texto.match(/(\d{1,6}(?:[.,]\d{1,3})?)\s*\nQTDE\.?\s*\n[A-ZÀ-Ú]+\s*\nESP[EÉ]CIE/i)
      if (qEsp3) {
        quantidade_especie = normalizarNumero(qEsp3[1])
      } else {
        // Fallback: DANFEs da Avery colam o cabeçalho "QUANTIDADE" direto no
        // "ESPÉCIE" sem quebra de linha (header vira "QUANTIDADEESPÉCIE..."),
        // então nenhum padrão acima casa. O dado real vem numa linha própria
        // mais abaixo, com o número colado ao nome da espécie sem espaço
        // (ex.: "28volumes", "3PALLET", "42VOLUMES").
        const qEsp4 = texto.match(/ESP[EÉ]CIE[\s\S]{0,500}?\n(\d{1,6})(?:PALLETS?|VOLUMES?)\b/i)
        if (qEsp4) quantidade_especie = normalizarNumero(qEsp4[1])
      }
    }
    if (quantidade_especie !== null && quantidade_especie <= 0) quantidade_especie = null

    return {
      chave_nfe,
      numero_nfe,
      data_emissao,
      cnpj_emitente,
      nome_emitente,
      cnpj_destinatario,
      nome_destinatario,
      cfop,
      natureza_operacao,
      tipo_operacao,
      itens,
      peso_liquido_total,
      unidade,
      texto_pdf: texto,  // texto bruto completo para fallback de keywords
      codigo_operacao_danfe,
      quantidade_especie,
    }
  } catch (error) {
    console.error('Erro ao parsear NFe PDF:', error)
    return null
  }
}

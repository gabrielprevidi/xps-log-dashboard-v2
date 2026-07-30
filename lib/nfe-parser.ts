import { parseStringPromise } from 'xml2js'
import { tipoOperacaoPorNatureza } from './nfe-classificacao'

export interface DadosNFe {
  chave_nfe: string
  numero_nfe: string
  data_emissao: string
  cnpj_emitente: string
  nome_emitente: string
  cnpj_destinatario: string
  nome_destinatario: string
  cfop: string
  natureza_operacao: string
  tipo_operacao: 'entrada' | 'saida' // derivado da natureza_operacao
  itens: ItemNFe[]
  peso_liquido_total: number
  unidade: string
  texto_pdf?: string  // texto bruto extraído do DANFE — usado para match de categorias em PDFs
  // Campo específico para cliente Fedrigoni (extraído do DANFE PDF)
  codigo_operacao_danfe?: number | null  // 0 = entrada, 1 = saída (código numérico no cabeçalho do DANFE)
  // QUANTIDADE de volumes transportados — no PDF vem do campo ESPÉCIE/QUANTIDADE do DANFE;
  // no XML é o mesmo dado, na tag <vol><qVol>. Ao contrário de pesoL (peso líquido),
  // que é opcional e muitas NF-e deixam em branco, qVol é preenchido de forma consistente.
  // Usado por clientes cujo modo_calculo não depende de peso (fedrigoni, tecnia, avery).
  quantidade_especie?: number | null
}

export interface ItemNFe {
  numero_item: number
  codigo: string   // cProd — código interno do produto na NF-e
  descricao: string
  ncm: string
  cfop: string
  unidade: string
  quantidade: number
  peso_liquido: number
}

function extrairTexto(obj: any): string {
  if (!obj) return ''
  if (typeof obj === 'string') return obj
  if (Array.isArray(obj)) return extrairTexto(obj[0])
  if (obj._) return obj._
  return String(obj)
}

export async function parseNFe(xmlString: string): Promise<DadosNFe | null> {
  try {
    const parsed = await parseStringPromise(xmlString, {
      explicitArray: true,
      mergeAttrs: false,
    })

    // Suporta tanto <nfeProc> quanto <NFe> como raiz
    const raiz = parsed.nfeProc || parsed.NFe || parsed
    const nfe = raiz.NFe?.[0] || raiz
    const infNFe = nfe.infNFe?.[0]

    if (!infNFe) return null

    const ide = infNFe.ide?.[0]
    const emit = infNFe.emit?.[0]
    const dest = infNFe.dest?.[0]
    const total = infNFe.total?.[0]
    const transp = infNFe.transp?.[0]

    // Chave da NFe vem do atributo Id do infNFe (remove prefixo NFe)
    const chaveRaw = infNFe.$?.Id || ''
    const chave_nfe = chaveRaw.replace('NFe', '')

    // Natureza da operação (campo natOp do XML)
    const natureza_operacao = extrairTexto(ide?.natOp) || ''

    const tipo_operacao = tipoOperacaoPorNatureza(natureza_operacao)

    // Itens
    const detArray = infNFe.det || []
    const itens: ItemNFe[] = detArray.map((det: any) => {
      const prod = det.prod?.[0]
      return {
        numero_item: parseInt(det.$?.nItem || '0'),
        codigo: extrairTexto(prod?.cProd),
        descricao: extrairTexto(prod?.xProd),
        ncm: extrairTexto(prod?.NCM),
        cfop: extrairTexto(prod?.CFOP),
        unidade: extrairTexto(prod?.uCom),
        quantidade: parseFloat(extrairTexto(prod?.qCom) || '0'),
        peso_liquido: parseFloat(extrairTexto(prod?.pesoL) || '0'),
      }
    })

    // Peso líquido total (pode estar no transporte)
    const pesoLiq = parseFloat(extrairTexto(transp?.vol?.[0]?.pesoL) || '0')

    // Quantidade de volumes transportados (qVol) — ver comentário no campo quantidade_especie
    const qVolRaw = extrairTexto(transp?.vol?.[0]?.qVol)
    const qVol = qVolRaw ? parseFloat(qVolRaw.replace(',', '.')) : NaN
    const quantidade_especie = !isNaN(qVol) && qVol > 0 ? qVol : null

    return {
      chave_nfe,
      numero_nfe: extrairTexto(ide?.nNF),
      data_emissao: extrairTexto(ide?.dhEmi)?.split('T')[0],
      cnpj_emitente: extrairTexto(emit?.CNPJ),
      nome_emitente: extrairTexto(emit?.xNome),
      cnpj_destinatario: extrairTexto(dest?.CNPJ),
      nome_destinatario: extrairTexto(dest?.xNome),
      cfop: itens[0]?.cfop || '',
      natureza_operacao,
      tipo_operacao,
      itens,
      peso_liquido_total: pesoLiq,
      unidade: itens[0]?.unidade || 'TON',
      quantidade_especie,
    }
  } catch (error) {
    console.error('Erro ao parsear NFe XML:', error)
    return null
  }
}

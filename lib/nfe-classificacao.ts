/**
 * Classifica o tipo de movimentação com base na natureza da operação da NF-e.
 *
 * Regra: naturezas que representam envio de mercadoria para armazenamento
 * são tratadas como ENTRADA no estoque do armazém. Demais são SAÍDA.
 */

const PADROES_ENTRADA = [
  'remessa de armazenagem',
  'remessa para armazenagem',
  'remessa para armazem',
  'remessa para armazém',
  'remessa p/ armazem',
  'remessa p/ armazém',
  'remessa p/armazem',
  'remessa p/armazém',
  'remessa a armazem',
  'remessa a armazém',
  'remessa deposito',
  'remessa depósito',
  'remessa para deposito',
  'remessa para depósito',
  'deposito fechado',
  'depósito fechado',
  'armazenagem',
]

function normalizarNatureza(natureza: string): string {
  return natureza
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
}

export function tipoOperacaoPorNatureza(natureza: string): 'entrada' | 'saida' {
  const n = normalizarNatureza(natureza)

  for (const padrao of PADROES_ENTRADA) {
    const p = padrao
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
    if (n.includes(p)) return 'entrada'
  }

  return 'saida'
}

/**
 * Classificação específica da Fedrigoni.
 * Retorna null para documentos informativos que não movimentam o estoque.
 */
export function classificarOperacaoFedrigoni(
  natureza: string,
  codigoOperacaoDanfe?: number | null,
): 'entrada' | 'saida' | null {
  const n = normalizarNatureza(natureza)

  const ehEntrada = n.includes('remessa') && n.includes('deposito')
  const ehSaida = n.includes('venda')
    || n.includes('amostra')
    || n.includes('retorno')
    || (n.includes('saida') && !ehEntrada)

  const ehRetornoSimbolico = n.includes('retorno simbolico')
  const ehInformativa = ehRetornoSimbolico
    || n.includes('compra')
    || n.includes('remessa ind')
    || n.includes('conta e ordem')
    || n.includes('transferencia')
    || n.includes('outra entrada')

  if (ehInformativa) return null
  if (ehEntrada) return 'entrada'
  if (ehSaida) return 'saida'
  if (codigoOperacaoDanfe === 0) return 'entrada'
  if (codigoOperacaoDanfe === 1) return 'saida'
  return null
}

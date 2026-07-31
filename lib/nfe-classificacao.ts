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
 * ─────────────────────────────────────────────────────────────────────────
 * V2 — Naturezas que NÃO movimentam o estoque do armazém.
 *
 * A regra da V1 (`tipoOperacaoPorNatureza`) nunca descarta: tudo que não é
 * entrada vira saída. Levantamento das 2208 notas já processadas mostrou o
 * efeito disso nos clientes em modo padrão:
 *
 *   COMPRA DO EXTERIOR PARA INDUSTRIALIZACAO   1x → virou saída (errado)
 *   "INSCRIÇÃO ESTADUALINSC. ESTADUAL DO..."   3x → virou saída (rótulo do
 *                                                   DANFE capturado por engano)
 *   (sem natureza)                             2x → virou saída (sem base)
 *
 * Esta lista é a mesma que a Fedrigoni já usava, estendida aos demais modos.
 * Alterar aqui muda o comportamento de todos os clientes na V2.
 * ─────────────────────────────────────────────────────────────────────────
 */
const PADROES_NAO_CONTABILIZA = [
  'compra',                 // COMPRA PARA COMERCIALIZACAO, COMPRA DO EXTERIOR…
  'outra entrada',
  'retorno simbolico',
  'transferencia',
  'conta e ordem',
  'remessa ind',            // remessa para industrialização
  'devol',                  // devolução de compra
]

/**
 * Classificação da operação para a V2, respeitando o modo do cliente.
 * Retorna `null` quando a nota é informativa e não deve gerar movimentação.
 *
 * Usada apenas pelo pipeline da V2. A V1 continua com
 * `tipoOperacaoPorNatureza`, que nunca descarta.
 */
export function classificarOperacaoV2(
  natureza: string,
  modo: string,
  codigoOperacaoDanfe?: number | null,
): { tipo: 'entrada' | 'saida' | null; motivo?: string } {
  if (modo === 'fedrigoni') {
    const t = classificarOperacaoFedrigoni(natureza, codigoOperacaoDanfe)
    return t ? { tipo: t } : { tipo: null, motivo: `natureza informativa: "${natureza || 'vazia'}"` }
  }

  const n = normalizarNatureza(natureza).trim()

  // Natureza vazia: nada foi lido do documento. Virar saída seria chute —
  // e chute em baixa de estoque vira erro de faturamento.
  if (!n) return { tipo: null, motivo: 'natureza não identificada no documento' }

  // Rótulo do DANFE capturado por engano pelo parser (ex.: "INSCRIÇÃO
  // ESTADUALINSC. ESTADUAL DO SUBST. TRIBUTÁRIOCNPJ"). Não é natureza.
  if (/inscricao estadual|subst\.? tributario/.test(n)) {
    return { tipo: null, motivo: `natureza irreconhecível (rótulo do DANFE): "${natureza}"` }
  }

  for (const p of PADROES_NAO_CONTABILIZA) {
    if (n.includes(p)) {
      return { tipo: null, motivo: `natureza informativa ("${p}"): "${natureza}"` }
    }
  }

  // ─────────────────────────────────────────────────────────────────────
  // RETORNO é SAÍDA — precisa vir antes da regra genérica.
  //
  // "Retorno de mercadoria depositada em depósito fechado ou armazém geral"
  // é a mercadoria voltando do armazém para o cliente: sai do estoque.
  // Mas a frase contém "depósito fechado", que `tipoOperacaoPorNatureza`
  // reconhece como padrão de ENTRADA — e classificaria ao contrário,
  // aumentando o estoque em vez de baixá-lo.
  //
  // Que saída é o correto está comprovado pelo histórico: Fedrigoni e Tecnia,
  // que têm classificação escrita à mão, registraram 93 e 162 movimentações
  // com esta natureza, todas como saída, nenhuma como entrada. Só a Avery —
  // que cai na regra genérica — tem 1 entrada, justamente por causa deste erro.
  // ─────────────────────────────────────────────────────────────────────
  if (n.includes('retorno')) {
    return { tipo: 'saida' }
  }

  return { tipo: tipoOperacaoPorNatureza(natureza) }
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

/**
 * Cálculos mensais de um cliente — fonte única de verdade compartilhada entre
 * o painel administrativo e o portal do cliente, garantindo que ambos exibam
 * exatamente os mesmos números.
 *
 * A lógica replica fielmente a do painel admin (app/clientes/[id]/page.tsx):
 * separação por unidade de sacaria, contabilização de pallets com floor,
 * excedentes, PP pico, estoque inicial com carry-over e totais.
 *
 * Funções puras (sem React) para poderem rodar em qualquer contexto.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
export type MovCalc = any

export interface ClienteCalc {
  valor_pallet: number | null
  aliquota_imposto: number | null
  regra_fator_pallet: number | null
  cobrar_manuseio?: boolean | null
  cobrar_separacao_sacaria?: boolean | null
  modo_calculo?: string | null
}

/**
 * Tabela progressiva de valor por pallet da Fedrigoni, por faixa de PP Pico.
 * Valor ÚNICO da faixa aplicado a todo o volume (desconto por volume).
 *   1–2500 → R$42 | 2501–3000 → R$41 | 3001–4000 → R$40
 *   4001–5000 → R$38 | 5001+ → R$36
 */
export function valorPalletFaixaFedrigoni(ppPico: number): number {
  if (ppPico <= 2500) return 42
  if (ppPico <= 3000) return 41
  if (ppPico <= 4000) return 40
  if (ppPico <= 5000) return 38
  return 36
}

/**
 * Valor por pallet efetivo do mês.
 * - Fedrigoni (modo_calculo === 'fedrigoni'): tabela por faixa de PP Pico.
 * - Demais: valor manual do mês > valor do cliente > padrão R$38.
 */
export function valorPalletEfetivo(args: {
  modoCalculo?: string | null
  ppPico: number
  valorManual?: number | null
  valorCliente?: number | null
}): number {
  if (args.modoCalculo === 'fedrigoni') return valorPalletFaixaFedrigoni(args.ppPico)
  return args.valorManual ?? args.valorCliente ?? 38
}

export interface SaldoCalc {
  competencia: string
  volume_inicial: number
  valor_pallet: number | null
  percentual_imposto: number | null
}

export interface CobrancaCalc {
  descricao: string
  valor: number
}

export function anoMesDe(dataStr: string): string {
  return (dataStr || '').slice(0, 7)
}

export function anoMesDeMov(m: MovCalc): string {
  return anoMesDe(m.data_entrada || m.data_saida || m.created_at || '')
}

export function fatorDe(m: MovCalc, cliente: ClienteCalc): number {
  return m.regra_fator_pallet ?? cliente.regra_fator_pallet ?? 1.2
}

export function contraparteDe(m: MovCalc): string {
  return (m.tipo_movimentacao === 'entrada'
    ? (m.fornecedor || m.arquivos_nfe?.nome_emitente)
    : (m.cliente_destino || m.arquivos_nfe?.nome_destinatario)) || '—'
}

/** PP pico: agrupa por dia, saldo corrente, retorna o máximo. */
export function calcPPPico(volumeInicial: number, movs: MovCalc[]): number {
  const porDia: Record<string, number> = {}
  for (const m of movs) {
    const data = m.data_entrada || m.data_saida || ''
    if (!data) continue
    const delta = m.tipo_movimentacao === 'entrada'
      ? (m.pallets_entrada || 0)
      : -(m.pallets_saida || 0)
    porDia[data] = (porDia[data] || 0) + delta
  }
  let saldo = volumeInicial
  let pico = volumeInicial
  for (const data of Object.keys(porDia).sort()) {
    saldo += porDia[data]
    if (saldo > pico) pico = saldo
  }
  return pico
}

export interface ExcessoCalc {
  movId: string
  nfe: string | null
  data: string | null
  contraparte: string
  produto_nome: string | null
  excessoTon: number
  fator: number
}

export interface ResultadoMes {
  mes: string
  volumeInicial: number
  valorPallet: number
  aliquota: number
  movsTodasMes: MovCalc[]
  movsContab: MovCalc[]
  movsSeparacao: MovCalc[]
  excessos: ExcessoCalc[]
  totalEntradas: number
  totalSaidas: number
  saldoFinal: number
  ppPico: number
  armazBase: number
  armazTotal: number
  totalSeparacao: number
  totalManuseio: number
  manuseioEfetivo: number
  totalCobrancas: number
  totalGeral: number
}

/**
 * Calcula todos os valores derivados de um mês para um cliente.
 * @param mesesAsc lista de meses com dados em ordem cronológica ascendente
 *                 (necessária para o carry-over do estoque inicial)
 */
export function calcularMesCliente(args: {
  mes: string
  todasMovs: MovCalc[]
  saldos: SaldoCalc[]
  cobrancas: CobrancaCalc[]
  cliente: ClienteCalc
  mesesAsc: string[]
}): ResultadoMes {
  const { mes, todasMovs, saldos, cobrancas, cliente, mesesAsc } = args
  const cobrarSep = cliente.cobrar_separacao_sacaria === true
  const cobrarManuseio = cliente.cobrar_manuseio ?? true

  const movsTodasMes = todasMovs.filter(m => anoMesDeMov(m) === mes)
  const movsAtivas = movsTodasMes.filter(m => !m.cancelada)

  const flagsPallet = new Set(
    todasMovs.filter(m => m.observacoes?.includes('conta_como_pallet')).map(m => m.id)
  )
  const flagsExcDismiss = new Set(
    todasMovs.filter(m => m.observacoes?.includes('excedente_ok')).map(m => m.id)
  )
  // Excedente promovido a 1 pallet (entra na armazenagem, sai da separação)
  const flagsExcPallet = new Set(
    todasMovs.filter(m => m.observacoes?.includes('excedente_pallet')).map(m => m.id)
  )
  // Excedente excluído (não cobra separação nem vira pallet)
  const flagsExcExcluido = new Set(
    todasMovs.filter(m => m.observacoes?.includes('excedente_excluido')).map(m => m.id)
  )

  // Separação por unidade de sacaria
  const movsSeparacao = movsAtivas.filter(m =>
    cobrarSep &&
    m.tipo_movimentacao === 'saida' &&
    (m.qtd_saida_ton ?? 0) > 0 &&
    (m.qtd_saida_ton ?? 0) < fatorDe(m, cliente)
  )
  const idsSeparacao = new Set(movsSeparacao.map(m => m.id))

  // Contabilização de pallets (floor quando ton > fator; separação excluída)
  const movsContab = movsAtivas
    .filter(m => !idsSeparacao.has(m.id) || flagsPallet.has(m.id))
    .map(m => {
      if (!cobrarSep) return m
      const ton = m.qtd_entrada_ton ?? m.qtd_saida_ton ?? 0
      const fator = fatorDe(m, cliente)
      if (ton <= fator || ton <= 0) return m
      let pf = Math.floor(Math.round((ton / fator) * 1e10) / 1e10)
      if (flagsExcPallet.has(m.id)) pf += 1   // excedente promovido a pallet
      return {
        ...m,
        pallets_entrada: m.tipo_movimentacao === 'entrada' ? pf : m.pallets_entrada,
        pallets_saida: m.tipo_movimentacao === 'saida' ? pf : m.pallets_saida,
      }
    })

  // Excedentes de tonelagem → separação. Os promovidos a pallet continuam
  // gerando cobrança de separação (além de somar 1 pallet à armazenagem);
  // apenas os marcados como excluídos não geram cobrança.
  const excessos: ExcessoCalc[] = cobrarSep
    ? movsAtivas
        .filter(m => !idsSeparacao.has(m.id) && !flagsExcDismiss.has(m.id)
          && !flagsExcExcluido.has(m.id)
          && m.tipo_movimentacao === 'saida')
        .flatMap(m => {
          const ton = m.qtd_saida_ton ?? 0
          const fator = fatorDe(m, cliente)
          if (ton <= fator || ton <= 0) return []
          const pf = Math.floor(Math.round((ton / fator) * 1e10) / 1e10)
          const exc = Math.round((ton - pf * fator) * 1e10) / 1e10
          if (exc < 0.001) return []
          return [{
            movId: m.id, nfe: m.numero_nfe, data: m.data_entrada || m.data_saida,
            contraparte: contraparteDe(m), produto_nome: m.produto_nome,
            excessoTon: exc, fator,
          }]
        })
    : []

  // Estoque inicial (saldo do mês ou carry-over do mês anterior)
  const saldoMes = saldos.find(s => anoMesDe(s.competencia) === mes)
  let volumeInicial: number
  if (saldoMes) {
    volumeInicial = saldoMes.volume_inicial
  } else {
    const idx = mesesAsc.indexOf(mes)
    if (idx <= 0) {
      volumeInicial = 0
    } else {
      const mesAnterior = mesesAsc[idx - 1]
      const saldoAnterior = saldos.find(s => anoMesDe(s.competencia) === mesAnterior)
      const volInicialAnterior = saldoAnterior?.volume_inicial ?? 0
      const movsAnterior = todasMovs.filter(m => anoMesDeMov(m) === mesAnterior && !m.cancelada)
      const ent = movsAnterior.reduce((s, m) => s + (m.pallets_entrada || 0), 0)
      const sai = movsAnterior.reduce((s, m) => s + (m.pallets_saida || 0), 0)
      volumeInicial = volInicialAnterior + ent - sai
    }
  }

  const aliquota = saldoMes?.percentual_imposto ?? cliente.aliquota_imposto ?? 2

  const totalEntradas = movsContab.reduce((s, m) => s + (m.pallets_entrada || 0), 0)
  const totalSaidas = movsContab.reduce((s, m) => s + (m.pallets_saida || 0), 0)
  const saldoFinal = volumeInicial + totalEntradas - totalSaidas
  const ppPico = calcPPPico(volumeInicial, movsContab)
  // Fedrigoni: valor por pallet vem da tabela por faixa de PP Pico (depende do pico).
  const valorPallet = valorPalletEfetivo({
    modoCalculo: cliente.modo_calculo,
    ppPico,
    valorManual: saldoMes?.valor_pallet,
    valorCliente: cliente.valor_pallet,
  })
  const armazBase = ppPico * valorPallet
  const armazTotal = armazBase * (1 + aliquota / 100)

  const totalSeparacao =
    movsSeparacao.reduce((s, m) => {
      const ton = m.qtd_entrada_ton ?? m.qtd_saida_ton ?? 0
      return s + (ton * 1000 / 25) * 4.5
    }, 0) +
    excessos.reduce((s, e) => s + (Math.round(e.excessoTon * 1000 / 25 * 100) / 100) * 4.5, 0)

  const totalManuseio = movsContab.reduce((s, m) => {
    const pallets = m.pallets_entrada || m.pallets_saida || 0
    const vm = Number(m.valor_manuseio ?? 4.5)
    return s + pallets * vm
  }, 0)
  const manuseioEfetivo = cobrarManuseio ? totalManuseio : 0

  const totalCobrancas = cobrancas.reduce((s, c) => s + Number(c.valor), 0)
  const totalGeral = manuseioEfetivo + totalSeparacao + totalCobrancas

  return {
    mes, volumeInicial, valorPallet, aliquota, movsTodasMes, movsContab,
    movsSeparacao, excessos, totalEntradas, totalSaidas, saldoFinal, ppPico,
    armazBase, armazTotal, totalSeparacao, totalManuseio, manuseioEfetivo,
    totalCobrancas, totalGeral,
  }
}

/** Lista de meses com dados (asc) a partir das movimentações. */
export function mesesComDadosAsc(todasMovs: MovCalc[]): string[] {
  return Array.from(new Set(todasMovs.map(anoMesDeMov).filter(Boolean))).sort()
}

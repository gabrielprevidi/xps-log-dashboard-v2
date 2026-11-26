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
import { ehMovGraphics } from './graphics-saldo'

export type MovCalc = any

export interface ClienteCalc {
  valor_pallet: number | null
  aliquota_imposto: number | null
  regra_fator_pallet: number | null
  cobrar_manuseio?: boolean | null
  cobrar_separacao_sacaria?: boolean | null
  modo_calculo?: string | null
  /** Soma a armazenagem ao Total Geral (ver migration 024). Hoje só a Alphalum. */
  somar_armazenagem_no_total?: boolean | null
  /** Avery: valor por pallet do Graphics (produto "Graphics" do cadastro). Sem ele, vale o valor normal. */
  valor_pallet_graphics?: number | null
  /** Usado para regras de um cliente só (período e tabela da FLEXCOAT). */
  cnpj?: string | null
}

// ─────────────────────────────────────────────────────────────────────────
// FLEXCOAT — período de cobrança e tabela de armazenagem próprios.
//
// Período: do dia 16 de um mês ao dia 15 do mês seguinte. A competência leva
// o nome do mês em que o período TERMINA: "Nov 2026" = 16/10 a 15/11/2026.
//
// Armazenagem por faixa de PP Pico, valor ÚNICO da faixa aplicado a todo o
// volume (mesmo critério da tabela da Fedrigoni):
//   1–500 → R$60 | 501–1500 → R$58 | 1501–3000 → R$56 | 3001+ → R$50
// ─────────────────────────────────────────────────────────────────────────
export const CNPJ_FLEXCOAT = '48062707000159'

function soDigitos(v?: string | null): string {
  return String(v ?? '').replace(/\D/g, '')
}

export function ehFlexcoat(cnpj?: string | null): boolean {
  return soDigitos(cnpj) === CNPJ_FLEXCOAT
}

/**
 * Estoque inicial encadeado mês a mês (ver `volumeInicialDoMes`). Avery e
 * FLEXCOAT — esta sem nenhum mês fechado quando a regra entrou (26/11/2026).
 */
export function encadearEstoque(cliente: { modo_calculo?: string | null; cnpj?: string | null } | null | undefined): boolean {
  return cliente?.modo_calculo === 'avery' || ehFlexcoat(cliente?.cnpj)
}

/** Dia em que começa o período de cobrança do cliente (1 = mês do calendário). */
export function diaInicioPeriodo(cnpj?: string | null): number {
  return ehFlexcoat(cnpj) ? 16 : 1
}

export function valorPalletFaixaFlexcoat(ppPico: number): number {
  if (ppPico <= 500) return 60
  if (ppPico <= 1500) return 58
  if (ppPico <= 3000) return 56
  return 50
}

function somarMes(anoMes: string, delta: number): string {
  const [a, m] = anoMes.split('-').map(Number)
  const d = new Date(Date.UTC(a, m - 1 + delta, 1))
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
}

/**
 * Competência ('YYYY-MM') de uma data. Com período começando no dia N > 1,
 * datas a partir do dia N pertencem à competência do mês seguinte.
 */
export function competenciaDaData(dataStr: string, diaInicio = 1): string {
  const anoMes = (dataStr || '').slice(0, 7)
  if (diaInicio <= 1 || anoMes.length < 7) return anoMes
  const dia = Number(dataStr.slice(8, 10))
  return dia >= diaInicio ? somarMes(anoMes, 1) : anoMes
}

/** Primeiro e último dia ('YYYY-MM-DD') do período de uma competência. */
export function periodoDaCompetencia(mes: string, diaInicio = 1): { inicio: string; fim: string } {
  const [a, m] = mes.split('-').map(Number)
  if (diaInicio <= 1) {
    const ultimo = new Date(Date.UTC(a, m, 0)).getUTCDate()
    return { inicio: `${mes}-01`, fim: `${mes}-${String(ultimo).padStart(2, '0')}` }
  }
  const dd = (n: number) => String(n).padStart(2, '0')
  return { inicio: `${somarMes(mes, -1)}-${dd(diaInicio)}`, fim: `${mes}-${dd(diaInicio - 1)}` }
}

/** "16/10 a 15/11" para períodos fora do mês do calendário; null no padrão. */
export function rotuloPeriodo(mes: string, diaInicio = 1): string | null {
  if (diaInicio <= 1 || !mes) return null
  const { inicio, fim } = periodoDaCompetencia(mes, diaInicio)
  const br = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`
  return `${br(inicio)} a ${br(fim)}`
}

/** Todos os dias ('YYYY-MM-DD') do período de uma competência, em ordem. */
export function diasDoPeriodo(mes: string, diaInicio = 1): string[] {
  const { inicio, fim } = periodoDaCompetencia(mes, diaInicio)
  const dias: string[] = []
  const d = new Date(`${inicio}T00:00:00Z`)
  const f = new Date(`${fim}T00:00:00Z`)
  while (d <= f) {
    dias.push(d.toISOString().slice(0, 10))
    d.setUTCDate(d.getUTCDate() + 1)
  }
  return dias
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
 * - FLEXCOAT (por CNPJ): tabela própria por faixa de PP Pico.
 * - Demais: valor manual do mês > valor do cliente > padrão R$38.
 */
export function valorPalletEfetivo(args: {
  modoCalculo?: string | null
  ppPico: number
  valorManual?: number | null
  valorCliente?: number | null
  cnpj?: string | null
}): number {
  if (args.modoCalculo === 'fedrigoni') return valorPalletFaixaFedrigoni(args.ppPico)
  if (ehFlexcoat(args.cnpj)) return valorPalletFaixaFlexcoat(args.ppPico)
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

/** Competência de uma movimentação (respeita o período do cliente). */
export function anoMesDeMov(m: MovCalc, diaInicio = 1): string {
  return competenciaDaData(m.data_entrada || m.data_saida || m.created_at || '', diaInicio)
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
  /** Parte do PP pico que é Graphics (cobrada a `valorPalletGraphics`). */
  ppPicoGraphics: number
  valorPalletGraphics: number
  armazBase: number
  armazTotal: number
  totalSeparacao: number
  totalManuseio: number
  manuseioEfetivo: number
  totalCobrancas: number
  totalGeral: number
  /**
   * Totais com a armazenagem incluída, para cliente com
   * `somar_armazenagem_no_total`. O imposto incide só na armazenagem —
   * separação, manuseio e adicionais entram cheios nos dois.
   * Sem a flag, ambos repetem `totalGeral`.
   */
  totalSemImposto: number
  totalComImposto: number
  /** true quando a armazenagem está somada nos dois totais acima. */
  armazenagemNoTotal: boolean
}

/**
 * PP pico com o dia em que ele ocorre (primeiro dia que atinge o máximo).
 * `data` = null quando o pico é o próprio estoque inicial (nenhum dia o supera).
 */
export function picoComData(volumeInicial: number, movs: MovCalc[]): { pico: number; data: string | null } {
  const porDia: Record<string, number> = {}
  for (const m of movs) {
    const data = m.data_entrada || m.data_saida || ''
    if (!data) continue
    const delta = m.tipo_movimentacao === 'entrada' ? (m.pallets_entrada || 0) : -(m.pallets_saida || 0)
    porDia[data] = (porDia[data] || 0) + delta
  }
  let saldo = volumeInicial
  let pico = volumeInicial
  let dataPico: string | null = null
  for (const data of Object.keys(porDia).sort()) {
    saldo += porDia[data]
    if (saldo > pico) { pico = saldo; dataPico = data }
  }
  return { pico, data: dataPico }
}

/**
 * Quantos pallets do PP pico são do Graphics: a ocupação dele (soma das linhas
 * sintéticas "gfx:") até o dia do pico, ou antes do mês quando o pico é o estoque
 * inicial. O Graphics tem valor por pallet próprio (`valor_pallet_graphics`).
 */
export function graphicsNoPicoMes(args: {
  mes: string
  volumeInicial: number
  movsContab: MovCalc[]
  todasMovs: MovCalc[]
}): number {
  const gfx = args.todasMovs.filter(m => ehMovGraphics(m) && !m.cancelada)
  if (gfx.length === 0) return 0
  const { pico, data } = picoComData(args.volumeInicial, args.movsContab)
  const limite = data ?? `${args.mes}-00`          // pico = estoque inicial → antes do mês
  const g = gfx.reduce((s, m) => {
    const d = m.data_entrada || m.data_saida || ''
    return d <= limite ? s + (m.pallets_entrada || 0) - (m.pallets_saida || 0) : s
  }, 0)
  return Math.max(0, Math.min(g, pico))
}

/** Armazenagem s/ imposto: pallets normais no valor do cliente + pallets do Graphics no valor próprio. */
export function armazenagemBase(args: {
  ppPico: number
  graphicsNoPico: number
  valorPallet: number
  valorPalletGraphics?: number | null
}): number {
  const vg = args.valorPalletGraphics ?? args.valorPallet
  return (args.ppPico - args.graphicsNoPico) * args.valorPallet + args.graphicsNoPico * vg
}

/**
 * Estoque inicial de um mês: o saldo cadastrado à mão, ou o carry-over do mês anterior.
 *
 * `encadear`: quando o mês anterior também não tem saldo cadastrado, usa o inicial
 * CALCULADO dele (recursivo) em vez de assumir 0. Sem isso, o inicial de um mês só
 * enxerga a variação do mês anterior e perde todo o resto — em outubro/2026 a Avery
 * ia de 6.291 para 742 pallets. Ligado só para a Avery: em Fedrigoni e Tecnia a
 * mudança alteraria o inicial de meses antigos já cobrados.
 */
export function volumeInicialDoMes(args: {
  mes: string
  mesesAsc: string[]
  saldos: SaldoCalc[]
  todasMovs: MovCalc[]
  encadear: boolean
  /** Dia de início do período de cobrança (ver `diaInicioPeriodo`). */
  diaInicio?: number
}): number {
  const { mes, mesesAsc, saldos, todasMovs, encadear } = args
  const diaInicio = args.diaInicio ?? 1
  const manual = saldos.find(s => anoMesDe(s.competencia) === mes)
  if (manual) return manual.volume_inicial
  const idx = mesesAsc.indexOf(mes)
  if (idx <= 0) return 0
  const mesAnterior = mesesAsc[idx - 1]
  const base = encadear
    ? volumeInicialDoMes({ ...args, mes: mesAnterior })
    : (saldos.find(s => anoMesDe(s.competencia) === mesAnterior)?.volume_inicial ?? 0)
  const movsAnterior = todasMovs.filter(m => anoMesDeMov(m, diaInicio) === mesAnterior && !m.cancelada)
  const ent = movsAnterior.reduce((s, m) => s + (m.pallets_entrada || 0), 0)
  const sai = movsAnterior.reduce((s, m) => s + (m.pallets_saida || 0), 0)
  return base + ent - sai
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

  const diaInicio = diaInicioPeriodo(cliente.cnpj)
  const movsTodasMes = todasMovs.filter(m => anoMesDeMov(m, diaInicio) === mes)
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
  const volumeInicial = volumeInicialDoMes({
    mes, mesesAsc, saldos, todasMovs, encadear: encadearEstoque(cliente), diaInicio,
  })

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
    cnpj: cliente.cnpj,
  })
  const ppPicoGraphics = graphicsNoPicoMes({ mes, volumeInicial, movsContab, todasMovs })
  const valorPalletGraphics = cliente.valor_pallet_graphics ?? valorPallet
  const armazBase = armazenagemBase({ ppPico, graphicsNoPico: ppPicoGraphics, valorPallet, valorPalletGraphics })
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

  // Armazenagem no total (migration 024). O imposto é da armazenagem, então só
  // a parcela dela muda entre os dois totais.
  const armazenagemNoTotal = cliente.somar_armazenagem_no_total === true
  const totalSemImposto = armazenagemNoTotal ? totalGeral + armazBase : totalGeral
  const totalComImposto = armazenagemNoTotal ? totalGeral + armazTotal : totalGeral

  return {
    mes, volumeInicial, valorPallet, aliquota, movsTodasMes, movsContab,
    movsSeparacao, excessos, totalEntradas, totalSaidas, saldoFinal, ppPico,
    ppPicoGraphics, valorPalletGraphics, armazBase, armazTotal, totalSeparacao, totalManuseio, manuseioEfetivo,
    totalCobrancas, totalGeral, totalSemImposto, totalComImposto,
    armazenagemNoTotal,
  }
}

/** Lista de meses com dados (asc) a partir das movimentações. */
export function mesesComDadosAsc(todasMovs: MovCalc[], diaInicio = 1): string[] {
  return Array.from(new Set(todasMovs.map(m => anoMesDeMov(m, diaInicio)).filter(Boolean))).sort()
}

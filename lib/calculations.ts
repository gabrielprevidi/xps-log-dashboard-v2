import { SaldoDiario, Movimentacao } from '@/types'

export function calcularPallets(quantidade_ton: number, fator: number = 1.2): number {
  // Arredonda para 10 casas decimais antes do ceil para eliminar erros de
  // ponto flutuante IEEE 754. Ex: 8.4 / 1.2 = 7.000000000000001 em JS →
  // sem arredondamento daria 8 pallets; com arredondamento dá 7 corretos.
  const divisao = Math.round((quantidade_ton / fator) * 1e10) / 1e10
  return Math.ceil(divisao)
}

export function calcularPalletsFracionado(quantidade_ton: number, fator: number = 1.2): number {
  return quantidade_ton / fator
}

export function calcularSaldoDiario(
  volumeInicial: number,
  movimentacoes: Movimentacao[],
  ano: number,
  mes: number
): SaldoDiario[] {
  const diasNoMes = new Date(ano, mes, 0).getDate()
  const resultado: SaldoDiario[] = []

  let saldoAnterior = volumeInicial

  for (let dia = 1; dia <= diasNoMes; dia++) {
    const dataStr = `${ano}-${String(mes).padStart(2, '0')}-${String(dia).padStart(2, '0')}`

    const movsEntradaPA = movimentacoes.filter(
      (m) =>
        m.tipo_movimentacao === 'entrada' &&
        m.categoria_movimentacao === 'pa' &&
        (m.data_entrada?.startsWith(dataStr) || m.data_saida?.startsWith(dataStr))
    )

    const movsSaidaPA = movimentacoes.filter(
      (m) =>
        m.tipo_movimentacao === 'saida' &&
        m.categoria_movimentacao === 'pa' &&
        (m.data_entrada?.startsWith(dataStr) || m.data_saida?.startsWith(dataStr))
    )

    const movsEntradaMP = movimentacoes.filter(
      (m) =>
        m.tipo_movimentacao === 'entrada' &&
        m.categoria_movimentacao === 'mp' &&
        (m.data_entrada?.startsWith(dataStr) || m.data_saida?.startsWith(dataStr))
    )

    const movsSaidaMP = movimentacoes.filter(
      (m) =>
        m.tipo_movimentacao === 'saida' &&
        m.categoria_movimentacao === 'mp' &&
        (m.data_entrada?.startsWith(dataStr) || m.data_saida?.startsWith(dataStr))
    )

    const entradaPA = movsEntradaPA.reduce((sum, m) => sum + (m.pallets_entrada || 0), 0)
    const saidaPA = movsSaidaPA.reduce((sum, m) => sum + (m.pallets_saida || 0), 0)
    const entradaMP = movsEntradaMP.reduce((sum, m) => sum + (m.pallets_entrada || 0), 0)
    const saidaMP = movsSaidaMP.reduce((sum, m) => sum + (m.pallets_saida || 0), 0)

    const saldo = saldoAnterior + entradaPA + entradaMP - saidaPA - saidaMP

    resultado.push({
      data: dataStr,
      inicial: saldoAnterior,
      pico: saldo,
      entrada_pa: entradaPA,
      saida_pa: saidaPA,
      entrada_mp: entradaMP,
      saida_mp: saidaMP,
      saldo,
    })

    saldoAnterior = saldo
  }

  return resultado
}

export function calcularPPPico(saldosDiarios: SaldoDiario[]): number {
  if (saldosDiarios.length === 0) return 0
  return Math.max(...saldosDiarios.map((s) => s.saldo))
}

export function calcularArmazenagemBase(ppPico: number, valorPallet: number): number {
  return ppPico * valorPallet
}

export function calcularArmazenagemTotal(armazenagemBase: number, percentualImposto: number): number {
  return armazenagemBase * (1 + percentualImposto / 100)
}

export function formatarMoeda(valor: number): string {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  }).format(valor)
}

export function formatarNumero(valor: number, casasDecimais: number = 2): string {
  return new Intl.NumberFormat('pt-BR', {
    minimumFractionDigits: casasDecimais,
    maximumFractionDigits: casasDecimais,
  }).format(valor)
}

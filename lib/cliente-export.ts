/**
 * Geração de planilha Excel (.xlsx) com todas as informações de um cliente,
 * separada por mês: uma aba "Resumo" + uma aba por mês.
 *
 * A lógica de cálculo (separação por sacaria, contabilização de pallets,
 * PP pico, estoque inicial com carry-over, totais) replica fielmente a da
 * página do cliente (app/clientes/[id]/page.tsx) para que a planilha bata
 * exatamente com o que é exibido na tela.
 */

import ExcelJS from 'exceljs'
import { valorPalletEfetivo } from './cliente-calculos'

/* eslint-disable @typescript-eslint/no-explicit-any */
type Mov = any

interface ClienteExport {
  id: string
  nome: string
  nome_fantasia: string | null
  cnpj: string | null
  valor_pallet: number | null
  aliquota_imposto: number | null
  regra_fator_pallet: number | null
  cobrar_manuseio?: boolean | null
  cobrar_separacao_sacaria?: boolean | null
  modo_calculo?: string | null
}

interface SaldoMensal {
  competencia: string
  volume_inicial: number
  valor_pallet: number | null
  percentual_imposto: number | null
}

interface Cobranca {
  competencia: string
  descricao: string
  valor: number
}

interface Fechamento {
  competencia: string
  status: string
}

const NOMES_MES = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez']

function mesLabel(anoMes: string): string {
  const [ano, mes] = anoMes.split('-')
  return `${NOMES_MES[Number(mes) - 1]} ${ano}`
}

function anoMesDe(dataStr: string): string {
  return (dataStr || '').slice(0, 7)
}

function anoMesDeMov(m: Mov): string {
  return anoMesDe(m.data_entrada || m.data_saida || m.created_at || '')
}

const STATUS_LABEL: Record<string, string> = {
  aberto: 'Aberto',
  fechado: 'Fechado',
  aprovado: 'Aprovado pelo cliente',
  nf_emitida: 'NF emitida',
}

interface ResumoMes {
  mes: string
  volumeInicial: number
  totalEntradas: number
  totalSaidas: number
  saldoFinal: number
  ppPico: number
  valorPallet: number
  aliquota: number
  armazBase: number
  armazTotal: number
  manuseio: number
  separacao: number
  cobrancas: number
  totalAdicionais: number
  status: string
  movsContab: Mov[]
  movsSeparacao: Mov[]
  excessos: Array<{ nfe: string | null; data: string | null; contraparte: string; produto_nome: string | null; excessoTon: number; fator: number }>
  movsTodasMes: Mov[]
  cobrancasMes: Cobranca[]
}

function fatorDe(m: Mov, cliente: ClienteExport): number {
  return m.regra_fator_pallet ?? cliente.regra_fator_pallet ?? 1.2
}

function calcPPPico(volumeInicial: number, movs: Mov[]): number {
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

function contraparteDe(m: Mov): string {
  return (m.tipo_movimentacao === 'entrada'
    ? (m.fornecedor || m.arquivos_nfe?.nome_emitente)
    : (m.cliente_destino || m.arquivos_nfe?.nome_destinatario)) || '—'
}

function calcularMes(
  mes: string,
  todasMovs: Mov[],
  saldos: SaldoMensal[],
  cobrancas: Cobranca[],
  fechamentos: Fechamento[],
  cliente: ClienteExport,
  mesesOrdenadosAsc: string[],
): ResumoMes {
  const cobrarSep = cliente.cobrar_separacao_sacaria === true
  const cobrarManuseio = cliente.cobrar_manuseio ?? true

  const movsTodasMes = todasMovs.filter(m => anoMesDeMov(m) === mes)
  const movsAtivas = movsTodasMes.filter(m => !m.cancelada)

  const flagsPallet = new Set(todasMovs.filter(m => m.observacoes?.includes('conta_como_pallet')).map(m => m.id))
  const flagsExcDismiss = new Set(todasMovs.filter(m => m.observacoes?.includes('excedente_ok')).map(m => m.id))
  const flagsExcPallet = new Set(todasMovs.filter(m => m.observacoes?.includes('excedente_pallet')).map(m => m.id))
  const flagsExcExcluido = new Set(todasMovs.filter(m => m.observacoes?.includes('excedente_excluido')).map(m => m.id))

  // Separação por unidade de sacaria
  const movsSeparacao = movsAtivas.filter(m =>
    cobrarSep &&
    m.tipo_movimentacao === 'saida' &&
    (m.qtd_saida_ton ?? 0) > 0 &&
    (m.qtd_saida_ton ?? 0) < fatorDe(m, cliente)
  )
  const idsSeparacao = new Set(movsSeparacao.map(m => m.id))

  // Contabilização de pallets (floor quando ton > fator, separação excluída)
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

  // Excedentes de tonelagem → separação (promovidos a pallet continuam
  // cobrando separação; apenas os excluídos não entram na cobrança)
  const excessos = cobrarSep
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
            nfe: m.numero_nfe, data: m.data_entrada || m.data_saida,
            contraparte: contraparteDe(m), produto_nome: m.produto_nome,
            excessoTon: exc, fator,
          }]
        })
    : []

  // Estoque inicial (saldo do mês, ou carry-over do mês anterior)
  const saldoMes = saldos.find(s => anoMesDe(s.competencia) === mes)
  let volumeInicial: number
  if (saldoMes) {
    volumeInicial = saldoMes.volume_inicial
  } else {
    const idx = mesesOrdenadosAsc.indexOf(mes)
    if (idx <= 0) {
      volumeInicial = 0
    } else {
      const mesAnterior = mesesOrdenadosAsc[idx - 1]
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
  const valorPallet = valorPalletEfetivo({
    modoCalculo: cliente.modo_calculo,
    ppPico,
    valorManual: saldoMes?.valor_pallet,
    valorCliente: cliente.valor_pallet,
  })
  const armazBase = ppPico * valorPallet
  const armazTotal = armazBase * (1 + aliquota / 100)

  const separacao =
    movsSeparacao.reduce((s, m) => {
      const ton = m.qtd_entrada_ton ?? m.qtd_saida_ton ?? 0
      return s + (ton * 1000 / 25) * 4.5
    }, 0) +
    excessos.reduce((s, e) => s + (Math.round(e.excessoTon * 1000 / 25 * 100) / 100) * 4.5, 0)

  const manuseioBruto = movsContab.reduce((s, m) => {
    const pallets = m.pallets_entrada || m.pallets_saida || 0
    const vm = Number(m.valor_manuseio ?? 4.5)
    return s + pallets * vm
  }, 0)
  const manuseio = cobrarManuseio ? manuseioBruto : 0

  const cobrancasMes = cobrancas.filter(c => anoMesDe(c.competencia) === mes)
  const totalCobrancas = cobrancasMes.reduce((s, c) => s + Number(c.valor), 0)

  const fechMes = fechamentos.find(f => anoMesDe(f.competencia) === mes)
  const status = fechMes ? (STATUS_LABEL[fechMes.status] ?? fechMes.status) : 'Aberto'

  return {
    mes, volumeInicial, totalEntradas, totalSaidas, saldoFinal, ppPico,
    valorPallet, aliquota, armazBase, armazTotal, manuseio, separacao,
    cobrancas: totalCobrancas, totalAdicionais: manuseio + separacao + totalCobrancas,
    status, movsContab, movsSeparacao, excessos, movsTodasMes, cobrancasMes,
  }
}

const MOEDA = 'R$ #,##0.00'
const NUM3 = '#,##0.000'

export async function gerarPlanilhaCliente(
  cliente: ClienteExport,
  todasMovs: Mov[],
  saldos: SaldoMensal[],
  cobrancas: Cobranca[],
  fechamentos: Fechamento[],
): Promise<Buffer> {
  const wb = new ExcelJS.Workbook()
  wb.creator = 'XPS LOG'
  wb.created = new Date()

  const nomeCli = cliente.nome_fantasia || cliente.nome

  // Meses com dados (ordem cronológica asc para carry-over; resumo/abas desc)
  const mesesAsc = Array.from(new Set(
    todasMovs.map(anoMesDeMov).filter(Boolean)
  )).sort()
  const mesesDesc = [...mesesAsc].reverse()

  const resumos = mesesAsc.map(mes =>
    calcularMes(mes, todasMovs, saldos, cobrancas, fechamentos, cliente, mesesAsc)
  )
  const resumoPorMes = new Map(resumos.map(r => [r.mes, r]))

  // ─────────────── ABA RESUMO ───────────────
  const wsResumo = wb.addWorksheet('Resumo', { views: [{ state: 'frozen', ySplit: 4 }] })

  wsResumo.mergeCells('A1:O1')
  const titulo = wsResumo.getCell('A1')
  titulo.value = `Relatório de Armazenagem — ${nomeCli}`
  titulo.font = { bold: true, size: 14, color: { argb: 'FF0D1B2E' } }

  wsResumo.mergeCells('A2:O2')
  const sub = wsResumo.getCell('A2')
  sub.value = `CNPJ: ${cliente.cnpj || '—'}   ·   Gerado em ${new Date().toLocaleString('pt-BR')}`
  sub.font = { size: 10, color: { argb: 'FF888888' } }

  const headerResumo = [
    'Mês', 'Estoque Inicial', 'Entradas (pallets)', 'Saídas (pallets)', 'Saldo Final',
    'PP Pico', 'Valor/Pallet', 'Armazenagem Base', 'Imposto %', 'Armazenagem c/ Imposto',
    'Manuseio', 'Separação Sacaria', 'Cobranças Adic.', 'Total Adicionais', 'Status',
  ]
  const headerRow = wsResumo.getRow(4)
  headerRow.values = headerResumo
  headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } }
  headerRow.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true }
  headerRow.eachCell(cell => {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0D1B2E' } }
    cell.border = { bottom: { style: 'thin', color: { argb: 'FFCCCCCC' } } }
  })

  // Linhas do resumo (mais recente primeiro)
  for (const mes of mesesDesc) {
    const r = resumoPorMes.get(mes)!
    const row = wsResumo.addRow([
      mesLabel(mes), r.volumeInicial, r.totalEntradas, r.totalSaidas, r.saldoFinal,
      r.ppPico, r.valorPallet, r.armazBase, r.aliquota, r.armazTotal,
      r.manuseio, r.separacao, r.cobrancas, r.totalAdicionais, r.status,
    ])
    row.getCell(7).numFmt = MOEDA
    row.getCell(8).numFmt = MOEDA
    row.getCell(9).numFmt = '0.00"%"'
    row.getCell(10).numFmt = MOEDA
    row.getCell(11).numFmt = MOEDA
    row.getCell(12).numFmt = MOEDA
    row.getCell(13).numFmt = MOEDA
    row.getCell(14).numFmt = MOEDA
  }

  // Linha de totais
  const totalGeralArmaz = resumos.reduce((s, r) => s + r.armazTotal, 0)
  const totalGeralAdic = resumos.reduce((s, r) => s + r.totalAdicionais, 0)
  const totRow = wsResumo.addRow([
    'TOTAL', '', '', '', '', '', '', '', '', totalGeralArmaz, '', '', '', totalGeralAdic, '',
  ])
  totRow.font = { bold: true }
  totRow.getCell(10).numFmt = MOEDA
  totRow.getCell(14).numFmt = MOEDA
  totRow.eachCell(cell => {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF5F5F0' } }
  })

  wsResumo.columns.forEach((col, i) => {
    col.width = i === 0 ? 14 : (i === 14 ? 22 : 16)
  })

  // ─────────────── ABA POR MÊS ───────────────
  for (const mes of mesesDesc) {
    const r = resumoPorMes.get(mes)!
    // Nome de aba: Excel não permite alguns caracteres; "Mai 2026" é seguro
    const ws = wb.addWorksheet(mesLabel(mes))

    let linha = 1
    const titMes = ws.getCell(`A${linha}`)
    ws.mergeCells(`A${linha}:H${linha}`)
    titMes.value = `${nomeCli} — ${mesLabel(mes)}`
    titMes.font = { bold: true, size: 13, color: { argb: 'FF0D1B2E' } }
    linha += 2

    // Bloco resumo do mês
    const resumoLinhas: Array<[string, any, string?]> = [
      ['Estoque Inicial (pallets)', r.volumeInicial],
      ['Entradas (pallets)', r.totalEntradas],
      ['Saídas (pallets)', r.totalSaidas],
      ['Saldo Final (pallets)', r.saldoFinal],
      ['PP Pico (pallets)', r.ppPico],
      ['Valor por Pallet', r.valorPallet, MOEDA],
      ['Armazenagem Base', r.armazBase, MOEDA],
      ['Imposto', r.aliquota, '0.00"%"'],
      ['Armazenagem c/ Imposto', r.armazTotal, MOEDA],
      ['Manuseio', r.manuseio, MOEDA],
      ['Separação por Sacaria', r.separacao, MOEDA],
      ['Cobranças Adicionais', r.cobrancas, MOEDA],
      ['Total Adicionais', r.totalAdicionais, MOEDA],
      ['Status do Fechamento', r.status],
    ]
    for (const [label, valor, fmt] of resumoLinhas) {
      const row = ws.getRow(linha)
      row.getCell(1).value = label
      row.getCell(1).font = { bold: true, color: { argb: 'FF555555' } }
      const c = row.getCell(2)
      c.value = valor
      if (fmt) c.numFmt = fmt
      linha++
    }
    linha += 1

    // Movimentações
    const tituloMov = ws.getCell(`A${linha}`)
    tituloMov.value = 'MOVIMENTAÇÕES'
    tituloMov.font = { bold: true, size: 11, color: { argb: 'FF0D1B2E' } }
    linha++
    const movHeader = ws.getRow(linha)
    movHeader.values = ['Data', 'NF-e', 'Tipo', 'Fornecedor / Destino', 'Produto', 'Toneladas', 'Fator', 'Pallets', 'Situação']
    movHeader.font = { bold: true, color: { argb: 'FFFFFFFF' } }
    movHeader.eachCell(cell => {
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0D1B2E' } }
    })
    linha++

    // Lista todas as movs do mês (inclui canceladas, marcadas)
    const movsOrdenadas = [...r.movsTodasMes].sort((a, b) => {
      const da = a.data_entrada || a.data_saida || a.created_at || ''
      const db = b.data_entrada || b.data_saida || b.created_at || ''
      return da.localeCompare(db)
    })
    for (const m of movsOrdenadas) {
      const ton = m.qtd_entrada_ton ?? m.qtd_saida_ton ?? 0
      const pallets = m.pallets_entrada ?? m.pallets_saida ?? 0
      const dataMov = (m.data_entrada || m.data_saida || '').slice(0, 10)
      const row = ws.getRow(linha)
      row.values = [
        dataMov,
        m.numero_nfe || '—',
        m.tipo_movimentacao === 'entrada' ? 'Entrada' : 'Saída',
        contraparteDe(m),
        m.produto_nome || '—',
        Number(ton),
        fatorDe(m, cliente),
        pallets,
        m.cancelada ? 'CANCELADA' : '',
      ]
      row.getCell(6).numFmt = NUM3
      if (m.cancelada) row.font = { strike: true, color: { argb: 'FF999999' } }
      linha++
    }
    linha += 1

    // Separação por unidade de sacaria
    if (cliente.cobrar_separacao_sacaria && (r.movsSeparacao.length > 0 || r.excessos.length > 0)) {
      const tituloSep = ws.getCell(`A${linha}`)
      tituloSep.value = 'SEPARAÇÃO POR UNIDADE DE SACARIA (R$ 4,50/un · volume = ton × 1000 ÷ 25)'
      tituloSep.font = { bold: true, size: 11, color: { argb: 'FF92400E' } }
      linha++
      const sepHeader = ws.getRow(linha)
      sepHeader.values = ['Data', 'NF-e', 'Destino', 'Toneladas', 'Fator', 'Volume (un)', 'Total (R$)']
      sepHeader.font = { bold: true, color: { argb: 'FFFFFFFF' } }
      sepHeader.eachCell(cell => {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD97706' } }
      })
      linha++

      for (const m of r.movsSeparacao) {
        const ton = m.qtd_entrada_ton ?? m.qtd_saida_ton ?? 0
        const volume = Math.round((ton * 1000) / 25 * 100) / 100
        const total = volume * 4.5
        const row = ws.getRow(linha)
        row.values = [
          (m.data_entrada || m.data_saida || '').slice(0, 10),
          m.numero_nfe || '—', contraparteDe(m), Number(ton),
          fatorDe(m, cliente), volume, total,
        ]
        row.getCell(4).numFmt = NUM3
        row.getCell(7).numFmt = MOEDA
        linha++
      }
      for (const e of r.excessos) {
        const volume = Math.round(e.excessoTon * 1000 / 25 * 100) / 100
        const total = volume * 4.5
        const row = ws.getRow(linha)
        row.values = [
          (e.data || '').slice(0, 10),
          `${e.nfe || '—'} (excedente)`, e.contraparte, Number(e.excessoTon),
          e.fator, volume, total,
        ]
        row.getCell(4).numFmt = NUM3
        row.getCell(7).numFmt = MOEDA
        linha++
      }
      const sepTot = ws.getRow(linha)
      sepTot.getCell(6).value = 'Total'
      sepTot.getCell(7).value = r.separacao
      sepTot.getCell(7).numFmt = MOEDA
      sepTot.font = { bold: true }
      linha += 2
    }

    // Cobrança de manuseio (R$/pallet movimentado) — só quando cobrar_manuseio
    if ((cliente.cobrar_manuseio ?? true) && r.movsContab.length > 0) {
      const tituloMan = ws.getCell(`A${linha}`)
      tituloMan.value = 'COBRANÇA DE MANUSEIO (valor por pallet movimentado)'
      tituloMan.font = { bold: true, size: 11, color: { argb: 'FF065F46' } }
      linha++
      const manHeader = ws.getRow(linha)
      manHeader.values = ['Data', 'NF-e', 'Fornecedor / Destino', 'Pallets', 'R$/Pallet', 'Total (R$)']
      manHeader.font = { bold: true, color: { argb: 'FFFFFFFF' } }
      manHeader.eachCell(cell => {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF059669' } }
      })
      linha++
      for (const m of r.movsContab) {
        const pallets = m.pallets_entrada || m.pallets_saida || 0
        const vm = Number(m.valor_manuseio ?? 4.5)
        const row = ws.getRow(linha)
        row.values = [
          (m.data_entrada || m.data_saida || '').slice(0, 10),
          m.numero_nfe || '—', contraparteDe(m), pallets, vm, pallets * vm,
        ]
        row.getCell(5).numFmt = MOEDA
        row.getCell(6).numFmt = MOEDA
        linha++
      }
      const manTot = ws.getRow(linha)
      manTot.getCell(5).value = 'Total'
      manTot.getCell(6).value = r.manuseio
      manTot.getCell(6).numFmt = MOEDA
      manTot.font = { bold: true }
      linha += 2
    }

    // Cobranças adicionais
    if (r.cobrancasMes.length > 0) {
      const tituloCob = ws.getCell(`A${linha}`)
      tituloCob.value = 'COBRANÇAS ADICIONAIS'
      tituloCob.font = { bold: true, size: 11, color: { argb: 'FF0D1B2E' } }
      linha++
      const cobHeader = ws.getRow(linha)
      cobHeader.values = ['Descrição', 'Valor (R$)']
      cobHeader.font = { bold: true, color: { argb: 'FFFFFFFF' } }
      cobHeader.eachCell(cell => {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0D1B2E' } }
      })
      linha++
      for (const c of r.cobrancasMes) {
        const row = ws.getRow(linha)
        row.values = [c.descricao, Number(c.valor)]
        row.getCell(2).numFmt = MOEDA
        linha++
      }
    }

    // Larguras
    ws.columns = [
      { width: 14 }, { width: 22 }, { width: 12 }, { width: 32 },
      { width: 22 }, { width: 12 }, { width: 8 }, { width: 12 }, { width: 14 },
    ]
  }

  if (mesesDesc.length === 0) {
    wsResumo.addRow(['Nenhuma movimentação encontrada para este cliente.'])
  }

  const arrayBuffer = await wb.xlsx.writeBuffer()
  return Buffer.from(arrayBuffer)
}

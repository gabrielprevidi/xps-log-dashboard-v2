import { NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

interface MesData {
  mes: string
  entradas: number
  saidas: number
}

interface ClienteAnalytics {
  clienteId: string
  nome: string
  valor_pallet: number
  aliquota_imposto: number
  meses: MesData[]
}

// ─── helpers ─────────────────────────────────────────────────────────────────

const NOMES_MESES: Record<string, string> = {
  '01': 'Janeiro', '02': 'Fevereiro', '03': 'Março', '04': 'Abril',
  '05': 'Maio', '06': 'Junho', '07': 'Julho', '08': 'Agosto',
  '09': 'Setembro', '10': 'Outubro', '11': 'Novembro', '12': 'Dezembro',
}

function mesLabel(anoMes: string) {
  return `${NOMES_MESES[anoMes.slice(5, 7)] ?? anoMes.slice(5, 7)}/${anoMes.slice(0, 4)}`
}

function receitaMensal(c: ClienteAnalytics, m: MesData) {
  return m.entradas * c.valor_pallet * (1 + c.aliquota_imposto / 100)
}

function mediaEntradas(meses: MesData[], ultimos?: number) {
  const lista = ultimos ? meses.slice(-ultimos) : meses
  if (!lista.length) return 0
  return lista.reduce((s, m) => s + m.entradas, 0) / lista.length
}

function mediaSaidas(meses: MesData[], ultimos?: number) {
  const lista = ultimos ? meses.slice(-ultimos) : meses
  if (!lista.length) return 0
  return lista.reduce((s, m) => s + m.saidas, 0) / lista.length
}

// Saldo acumulado até o fim de cada mês (running balance)
function saldoAcumulado(meses: MesData[]): number {
  return meses.reduce((s, m) => s + m.entradas - m.saidas, 0)
}

function pct(valor: number, total: number) {
  if (total === 0) return 0
  return (valor / total) * 100
}

function fmt(n: number) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(n)
}

// ─── engine de sugestões ─────────────────────────────────────────────────────

function gerarSugestoes(analytics: ClienteAnalytics[], mesFiltro: string): string {
  if (!analytics.length) {
    return 'Nenhum dado disponível para análise. Cadastre clientes e registre movimentações para obter sugestões.'
  }

  const sugestoes: string[] = []

  // ── métricas consolidadas ──
  const receitasPorCliente = analytics.map(c => {
    const mesRef = c.meses.find(m => m.mes === mesFiltro) ?? c.meses[c.meses.length - 1]
    const receita = mesRef ? receitaMensal(c, mesRef) : 0
    const totalEntradas = c.meses.reduce((s, m) => s + m.entradas, 0)
    const totalSaidas = c.meses.reduce((s, m) => s + m.saidas, 0)
    const saldo = saldoAcumulado(c.meses)
    const giroUlt3 = c.meses.length >= 3
      ? mediaSaidas(c.meses, 3) / (mediaEntradas(c.meses, 3) || 1)
      : totalSaidas / (totalEntradas || 1)
    const tendEntradas = c.meses.length >= 2
      ? c.meses[c.meses.length - 1].entradas - c.meses[c.meses.length - 2].entradas
      : 0
    return { c, mesRef, receita, totalEntradas, totalSaidas, saldo, giroUlt3, tendEntradas }
  })

  const receitaTotal = receitasPorCliente.reduce((s, r) => s + r.receita, 0)

  // ── 1. Concentração de receita ──
  const dominante = receitasPorCliente
    .sort((a, b) => b.receita - a.receita)[0]
  if (dominante && receitaTotal > 0) {
    const share = pct(dominante.receita, receitaTotal)
    if (share >= 55) {
      sugestoes.push(
        `**Diversificação da carteira de clientes**\n` +
        `${dominante.c.nome} representa ${share.toFixed(0)}% da receita mensal (${fmt(dominante.receita)}). ` +
        `Essa concentração expõe o negócio a risco caso o cliente reduza volume ou encerre contrato. ` +
        `Priorize a prospecção de ao menos 1–2 novos clientes para diluir essa dependência e ` +
        `aumentar o faturamento total.`
      )
    }
  }

  // ── 2. Giro de estoque baixo por cliente ──
  const baixoGiro = receitasPorCliente.filter(r => r.giroUlt3 < 0.4 && r.totalEntradas > 0)
  if (baixoGiro.length) {
    const nomes = baixoGiro.map(r => r.c.nome).join(', ')
    const exemplo = baixoGiro[0]
    const gPct = (exemplo.giroUlt3 * 100).toFixed(0)
    sugestoes.push(
      `**Estoque parado — revisão de giro para ${nomes}**\n` +
      `Nos últimos meses, ${exemplo.c.nome} registrou taxa de saída de apenas ${gPct}% em relação às entradas. ` +
      `Mercadorias paradas consomem capacidade de armazém sem gerar receita proporcional. ` +
      `Considere cobrar taxa de permanência prolongada após X dias ou negociar ` +
      `um prazo máximo de estoque com esses clientes.`
    )
  }

  // ── 3. Saldo acumulado alto (risco de capacidade) ──
  const totalSaldo = receitasPorCliente.reduce((s, r) => s + r.saldo, 0)
  const totalEntGeral = receitasPorCliente.reduce((s, r) => s + r.totalEntradas, 0)
  if (totalSaldo > 0 && totalEntGeral > 0 && pct(totalSaldo, totalEntGeral) > 40) {
    const maiorSaldo = receitasPorCliente.sort((a, b) => b.saldo - a.saldo)[0]
    sugestoes.push(
      `**Monitoramento de capacidade de armazenagem**\n` +
      `O saldo acumulado atual é de ${totalSaldo} pallets — ` +
      `equivalente a ${pct(totalSaldo, totalEntGeral).toFixed(0)}% do volume histórico de entradas. ` +
      `${maiorSaldo.c.nome} concentra o maior saldo (${maiorSaldo.saldo} pallets). ` +
      `Acompanhe a ocupação real do armazém para evitar gargalos e, se necessário, ` +
      `aplique tarifas diferenciadas para períodos de alta demanda.`
    )
  }

  // ── 4. Tendência de queda nas entradas ──
  const emQueda = receitasPorCliente.filter(r =>
    r.c.meses.length >= 3 && r.tendEntradas < 0
  )
  if (emQueda.length >= Math.ceil(analytics.length / 2)) {
    const quedaMedia = emQueda.reduce((s, r) => s + Math.abs(r.tendEntradas), 0) / emQueda.length
    sugestoes.push(
      `**Queda no volume de entradas — ação comercial recomendada**\n` +
      `${emQueda.length} de ${analytics.length} clientes registraram redução de entradas no último mês ` +
      `(queda média de ${quedaMedia.toFixed(0)} pallets). ` +
      `Isso pode indicar sazonalidade ou migração de parte do volume para outros armazéns. ` +
      `Entre em contato proativamente para entender o cenário e oferecer condições diferenciadas ` +
      `para manutenção ou aumento de volume.`
    )
  }

  // ── 5. Precificação abaixo da média ──
  const valoresPallet = analytics.map(c => c.valor_pallet).filter(v => v > 0)
  if (valoresPallet.length >= 2) {
    const mediaPallet = valoresPallet.reduce((s, v) => s + v, 0) / valoresPallet.length
    const abaixoMedia = analytics.filter(c => c.valor_pallet > 0 && c.valor_pallet < mediaPallet * 0.85)
    if (abaixoMedia.length) {
      const nomes = abaixoMedia.map(c => c.nome).join(', ')
      sugestoes.push(
        `**Oportunidade de reajuste de preço**\n` +
        `${nomes} ${abaixoMedia.length === 1 ? 'possui' : 'possuem'} valor de pallet ` +
        `abaixo da média da carteira (${fmt(mediaPallet)}/pallet). ` +
        `Avalie um reajuste gradual na próxima renovação contratual — ` +
        `mesmo um aumento de 10–15% no valor do pallet impacta diretamente ` +
        `a margem sem custo operacional adicional.`
      )
    }
  }

  // ── 6. Tendência de crescimento (oportunidade) ──
  const emCrescimento = receitasPorCliente.filter(r =>
    r.c.meses.length >= 3 && r.tendEntradas > 0
  )
  if (emCrescimento.length > 0 && emQueda.length < emCrescimento.length) {
    const maior = emCrescimento.sort((a, b) => b.tendEntradas - a.tendEntradas)[0]
    sugestoes.push(
      `**Aproveite o crescimento de ${maior.c.nome}**\n` +
      `As entradas desse cliente aumentaram ${maior.tendEntradas} pallets no último mês — ` +
      `sinal de expansão de estoque. É o momento ideal para oferecer serviços adicionais ` +
      `(cross-docking, separação de pedidos, etiquetagem) que aumentam o ticket médio ` +
      `sem exigir novo espaço físico.`
    )
  }

  // ── 7. Cliente com histórico curto (recém-cadastrado) ──
  const recentes = analytics.filter(c => c.meses.length <= 2 && c.meses.length > 0)
  if (recentes.length) {
    const nomes = recentes.map(c => c.nome).join(', ')
    sugestoes.push(
      `**Fidelização de clientes recentes**\n` +
      `${nomes} ${recentes.length === 1 ? 'está' : 'estão'} no início do relacionamento ` +
      `(histórico de até 2 meses). Esse é o período crítico para fidelização. ` +
      `Garanta um atendimento próximo, relatórios claros de movimentação e ` +
      `avalie oferecer um período de carência ou desconto progressivo por volume, ` +
      `estimulando o aumento do uso do armazém.`
    )
  }

  // ── fallback se nenhuma regra disparou ──
  if (!sugestoes.length) {
    const mesRef = mesLabel(mesFiltro)
    sugestoes.push(
      `**Operação estável em ${mesRef}**\n` +
      `Os indicadores analisados (giro de estoque, distribuição de receita, tendências mensais e ` +
      `precificação) estão dentro de parâmetros saudáveis. Continue monitorando o saldo ` +
      `acumulado de pallets para antecipar necessidade de ampliação de capacidade, ` +
      `e avalie reajustes anuais de preço para acompanhar a inflação do setor logístico.`
    )
  }

  const mesRef = mesLabel(mesFiltro)
  const header =
    `Análise referente a ${mesRef} · ${analytics.length} cliente${analytics.length !== 1 ? 's' : ''} · ` +
    `receita estimada total: ${fmt(receitaTotal)}\n` +
    `${'─'.repeat(52)}\n\n`

  return header + sugestoes.join('\n\n')
}

// ─── handler ─────────────────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  const body = await request.json()
  const { analytics, mesFiltro }: { analytics: ClienteAnalytics[]; mesFiltro: string } = body

  const sugestoes = gerarSugestoes(analytics ?? [], mesFiltro ?? '')
  return NextResponse.json({ sugestoes })
}

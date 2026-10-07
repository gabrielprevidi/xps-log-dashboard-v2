/**
 * Saldo e palets do Avery Graphics — funções puras (usadas pela tela, pelo
 * cálculo de cobrança e testáveis).
 *
 * Regra de palets, por SKU (nunca somando caixas de SKUs diferentes):
 *   • entrou  = CEIL(caixas que entraram / 30)   — palet incompleto conta como palet
 *   • saiu    = FLOOR(caixas que saíram / 30)    — só sai um palet a cada 30 caixas
 *               de saída ACUMULADAS daquele produto, mesmo que o palet de origem
 *               fosse incompleto
 *   • ocupados = entrou − saiu, e zero quando não há mais caixas do SKU
 * Ajuste comum positivo conta como entrada; negativo, como saída. O ajuste marcado
 * como inventário físico é ponto de partida: o saldo contado vira a entrada e as
 * saídas acumuladas recomeçam do zero.
 */

export interface GfxSku {
  id: string
  codigo: string
  descricao: string | null
  unidades_por_palet: number
}

export interface GfxMov {
  id: string
  sku_id: string
  arquivo_nfe_id: string | null
  numero_nfe: string | null
  tipo: 'entrada' | 'saida' | 'ajuste'
  data_mov: string            // YYYY-MM-DD
  qtd_unidades: number        // ajuste vem com sinal
  palets_declarados: number | null
  /** Ajuste que marca o inventário físico: a regra de palets recomeça dele. */
  inventario?: boolean
}

export function deltaCaixas(m: Pick<GfxMov, 'tipo' | 'qtd_unidades'>): number {
  return m.tipo === 'saida' ? -m.qtd_unidades : m.qtd_unidades
}

/** Caixas acumuladas de um SKU: entraram (E) e saíram (S). */
export interface AcumuladoSku { entrou: number; saiu: number }

export function acumuladoSku(movs: GfxMov[], ateInclusive?: string, antesDe?: string): AcumuladoSku {
  // Dentro do mesmo dia o inventário vem por último: a contagem já inclui as notas do dia.
  const ordem = [...movs].sort((a, b) =>
    a.data_mov.localeCompare(b.data_mov) || Number(!!a.inventario) - Number(!!b.inventario))
  let entrou = 0
  let saiu = 0
  for (const m of ordem) {
    if (ateInclusive !== undefined && m.data_mov > ateInclusive) continue
    if (antesDe !== undefined && m.data_mov >= antesDe) continue
    if (m.inventario) {
      // Ponto de partida: o saldo contado vira a entrada; saídas acumuladas recomeçam do zero.
      entrou = Math.max(0, entrou - saiu + m.qtd_unidades)
      saiu = 0
      continue
    }
    const d = deltaCaixas(m)
    if (d > 0) entrou += d
    else saiu -= d
  }
  // 4 casas: evita que 30,0000000001 caixas contem como um palet a mais
  const r4 = (v: number) => Math.round(v * 1e4) / 1e4
  return { entrou: r4(entrou), saiu: r4(saiu) }
}

/** Palets ocupados de um SKU pela regra acima. */
export function paletsOcupados(a: AcumuladoSku, fator: number): number {
  if (a.entrou - a.saiu <= 0) return 0
  return Math.max(0, Math.ceil(a.entrou / fator) - Math.floor(a.saiu / fator))
}

export interface LinhaSku {
  sku: GfxSku
  saldoInicio: number
  entradas: number
  saidas: number
  ajustes: number
  saldoFim: number
  paletsInicio: number
  paletsFim: number
  /** Palets que passaram a ser ocupados / foram liberados no mês (inclui liberação por saldo zerado). */
  paletsEntradaMes: number
  paletsSaidaMes: number
  /** Caixas de saída que ainda faltam para liberar o próximo palet (1–30). */
  faltamParaLiberar: number
}

export interface ResumoGraphicsMes {
  linhas: LinhaSku[]
  caixasInicio: number
  caixasFim: number
  caixasEntrada: number
  caixasSaida: number
  caixasAjuste: number
  paletsInicio: number
  paletsFim: number
  /** Palets que passaram a ser ocupados / foram liberados no mês. */
  paletsEntrada: number
  paletsSaida: number
  /** Maior ocupação diária de palets no mês — base de cobrança, como no restante da Avery. */
  paletsPico: number
  dias: Array<{ dia: number; palets: number }>
  /** Palets declarados nas NF-e do mês (campo ESPÉCIE). */
  declaradosEntrada: number
  declaradosSaida: number
  /** SKUs com saldo negativo (saída sem entrada registrada) — sinal de dado faltando. */
  skusNegativos: string[]
}

function proximoMes(competencia: string): string {
  const [a, m] = competencia.split('-').map(Number)
  return m === 12 ? `${a + 1}-01` : `${a}-${String(m + 1).padStart(2, '0')}`
}

/** competencia: 'YYYY-MM' */
export function resumoGraphicsMes(skus: GfxSku[], movs: GfxMov[], competencia: string): ResumoGraphicsMes {
  const ini = `${competencia}-01`
  const fim = `${proximoMes(competencia)}-01`   // exclusivo
  const [ano, mes] = competencia.split('-').map(Number)
  const diasNoMes = new Date(ano, mes, 0).getDate()

  const linhas: LinhaSku[] = []
  const palDia = new Array<number>(diasNoMes).fill(0)
  const negativos: string[] = []

  for (const sku of skus) {
    const doSku = movs.filter(m => m.sku_id === sku.id)
    const fator = sku.unidades_por_palet
    const noMesBruto = doSku.filter(m => m.data_mov >= ini && m.data_mov < fim)
    // Mês com inventário: a contagem é o estoque inicial; só contam as movimentações DEPOIS dela.
    const dataInv = noMesBruto.filter(m => m.inventario).map(m => m.data_mov).sort().pop()
    const noMes = dataInv ? noMesBruto.filter(m => m.data_mov > dataInv && !m.inventario) : noMesBruto
    const antes = dataInv ? acumuladoSku(doSku, dataInv) : acumuladoSku(doSku, undefined, ini)
    const ate = acumuladoSku(doSku, undefined, fim)
    const saldoInicio = antes.entrou - antes.saiu
    const entradas = noMes.filter(m => m.tipo === 'entrada').reduce((s, m) => s + m.qtd_unidades, 0)
    const saidas = noMes.filter(m => m.tipo === 'saida').reduce((s, m) => s + m.qtd_unidades, 0)
    const ajustes = noMes.filter(m => m.tipo === 'ajuste').reduce((s, m) => s + m.qtd_unidades, 0)
    const saldoFim = ate.entrou - ate.saiu
    if (saldoFim === 0 && saldoInicio === 0 && noMes.length === 0 && !dataInv) continue   // SKU sem relação com o mês
    if (saldoFim < 0) negativos.push(sku.codigo)

    // ocupação diária (fim de cada dia)
    for (let d = 1; d <= diasNoMes; d++) {
      const limite = `${competencia}-${String(d).padStart(2, '0')}`
      palDia[d - 1] += paletsOcupados(acumuladoSku(doSku, limite), fator)
    }

    linhas.push({
      sku, saldoInicio, entradas, saidas, ajustes, saldoFim,
      paletsInicio: paletsOcupados(antes, fator),
      paletsFim: paletsOcupados(ate, fator),
      paletsEntradaMes: Math.ceil(ate.entrou / fator) - Math.ceil(antes.entrou / fator),
      paletsSaidaMes: paletsOcupados(antes, fator) + (Math.ceil(ate.entrou / fator) - Math.ceil(antes.entrou / fator)) - paletsOcupados(ate, fator),
      faltamParaLiberar: fator - (ate.saiu % fator),
    })
  }

  linhas.sort((a, b) => a.sku.codigo.localeCompare(b.sku.codigo))
  const soma = (f: (l: LinhaSku) => number) => linhas.reduce((s, l) => s + f(l), 0)
  const noMesTodos = movs.filter(m => m.data_mov >= ini && m.data_mov < fim)
  const declarados = (tipo: GfxMov['tipo']) =>
    noMesTodos.filter(m => m.tipo === tipo).reduce((s, m) => s + (m.palets_declarados ?? 0), 0)

  return {
    linhas,
    caixasInicio: soma(l => l.saldoInicio),
    caixasFim: soma(l => l.saldoFim),
    caixasEntrada: soma(l => l.entradas),
    caixasSaida: soma(l => l.saidas),
    caixasAjuste: soma(l => l.ajustes),
    paletsInicio: soma(l => l.paletsInicio),
    paletsFim: soma(l => l.paletsFim),
    paletsEntrada: soma(l => l.paletsEntradaMes),
    paletsSaida: soma(l => l.paletsSaidaMes),
    paletsPico: palDia.reduce((mx, v) => Math.max(mx, v), 0),
    dias: palDia.map((palets, i) => ({ dia: i + 1, palets })),
    declaradosEntrada: declarados('entrada'),
    declaradosSaida: declarados('saida'),
    skusNegativos: negativos,
  }
}

/**
 * Movimentação sintética de palets do Graphics, no formato das movimentações
 * normais da Avery — para que pico, saldo, histórico, portal e exportação
 * contem o Graphics sem cada um precisar conhecer a regra.
 *
 * Uma linha por dia com variação líquida na ocupação total de palets
 * (entrada se subiu, saída se desceu). `id` começa com "gfx:" e a linha é só
 * leitura: não aparece nas tabelas de movimentação nem pode ser editada.
 */
export const PREFIXO_GFX = 'gfx:'

export function ehMovGraphics(m: { id: string }): boolean {
  return m.id.startsWith(PREFIXO_GFX)
}

export function movsOcupacaoGraphics(skus: GfxSku[], movs: GfxMov[], clienteId: string) {
  const datas = [...new Set(movs.map(m => m.data_mov))].sort()
  const porSku = new Map(skus.map(s => [s.id, movs.filter(m => m.sku_id === s.id)]))
  const saida: Array<Record<string, unknown>> = []
  let anterior = 0
  for (const data of datas) {
    let total = 0
    for (const sku of skus) total += paletsOcupados(acumuladoSku(porSku.get(sku.id) ?? [], data), sku.unidades_por_palet)
    const delta = total - anterior
    anterior = total
    if (delta === 0) continue
    const entrada = delta > 0
    saida.push({
      id: `${PREFIXO_GFX}${data}`,
      cliente_id: clienteId,
      arquivo_nfe_id: null,
      tipo_movimentacao: entrada ? 'entrada' : 'saida',
      categoria_movimentacao: 'pa',
      data_entrada: entrada ? data : null,
      data_saida: entrada ? null : data,
      pallets_entrada: entrada ? delta : null,
      pallets_saida: entrada ? null : -delta,
      qtd_entrada_ton: null,
      qtd_saida_ton: null,
      numero_nfe: null,
      fornecedor: null,
      cliente_destino: 'Graphics (ocupação por SKU)',
      produto_nome: null,
      cancelada: false,
      verificado: true,
      created_at: `${data}T12:00:00.000Z`,
    })
  }
  return saida
}

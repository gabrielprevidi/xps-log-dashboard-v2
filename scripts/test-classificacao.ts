/**
 * Teste da classificação de operação da V2.
 *
 * Cada caso é uma natureza real, extraída das 2208 notas já processadas pela
 * V1. O esperado vem do que a V1 gravou de fato para Fedrigoni e Tecnia —
 * clientes cuja classificação foi escrita à mão e revisada.
 *
 * Rodar:  node --experimental-strip-types scripts/test-classificacao.ts
 */
import { classificarOperacaoV2 } from '../lib/nfe-classificacao.ts'

type Esperado = 'entrada' | 'saida' | null

const CASOS: Array<{ natureza: string; modo: string; esperado: Esperado; porque: string }> = [
  // ── O caso que motivou a correção ──────────────────────────────────────
  {
    natureza: 'Retorno de mercadoria depositada em depósito fechado ou armazém geral',
    modo: 'padrao', esperado: 'saida',
    porque: 'mercadoria voltando do armazém ao cliente; V1 gravou 93 (Fedrigoni) + 162 (Tecnia) como saída',
  },
  {
    natureza: 'Retorno de mercadoria depositada em depósito fechado ou armazém geral',
    modo: 'avery', esperado: 'saida',
    porque: 'mesma natureza, mesmo resultado — a Avery tem 1 entrada errada gravada pela V1',
  },
  {
    natureza: 'Retorno de mercadoria depositada em depósito fechado ou arm',
    modo: 'fedrigoni', esperado: 'saida',
    porque: 'a lógica da Fedrigoni já tratava assim',
  },

  // ── Entradas ───────────────────────────────────────────────────────────
  { natureza: 'REMESSA PARA DEPOSITO FECHADO OU ARMAZEM GERAL', modo: 'padrao', esperado: 'entrada', porque: 'remessa para o armazém' },
  { natureza: 'Remes. para depósito fechado ou armazém geral', modo: 'avery', esperado: 'entrada', porque: 'abreviado, mesmo sentido' },
  { natureza: 'REMESSA PARA ARMAZEM', modo: 'padrao', esperado: 'entrada', porque: 'Alphalum, 15 ocorrências' },

  // ── Saídas ─────────────────────────────────────────────────────────────
  { natureza: 'Venda', modo: 'padrao', esperado: 'saida', porque: 'Alphalum, 67 ocorrências' },
  { natureza: 'VENDA DE PRODUCAO DO ESTABELECIMENTO', modo: 'padrao', esperado: 'saida', porque: 'venda comum' },
  { natureza: 'REMESSA DE AMOSTRA GRATIS', modo: 'padrao', esperado: 'saida', porque: 'amostra saindo do armazém' },

  // ── Tecnia: regra própria (remessa=entrada, retorno=saída, resto não conta) ──
  {
    natureza: 'REMESSA PARA DEPOSITO FECHADO OU ARMAZEM GERAL', modo: 'tecnia', esperado: 'entrada',
    porque: 'V1 gravou 28 movimentações assim',
  },
  {
    natureza: 'Retorno de mercadoria depositada em depósito fechado ou arm', modo: 'tecnia', esperado: 'saida',
    porque: 'V1 gravou 355 movimentações assim',
  },
  {
    natureza: 'VENDA DE MERCADORIA ADQUIRIDA OU RECEBIDA DE TERCEIROS', modo: 'tecnia', esperado: null,
    porque: 'venda não é remessa nem retorno; a pré-filtragem aprovava e a persistência recusava',
  },
  {
    natureza: 'Venda', modo: 'tecnia', esperado: null,
    porque: 'mesma regra — para a Tecnia, venda não movimenta o armazém',
  },

  // ── Não contabilizam ───────────────────────────────────────────────────
  { natureza: 'COMPRA PARA COMERCIALIZACAO', modo: 'padrao', esperado: null, porque: 'compra não movimenta o armazém' },
  { natureza: 'COMPRA DO EXTERIOR PARA INDUSTRIALIZACAO', modo: 'padrao', esperado: null, porque: 'virava saída indevida antes' },
  { natureza: 'Retorno simbólico de mercadoria depositada em depósito fech', modo: 'padrao', esperado: null, porque: 'simbólico: não há movimento físico' },
  { natureza: 'TRANSFERENCIA DE PRODUCAO DO ESTABELECIMENTO', modo: 'padrao', esperado: null, porque: 'transferência é informativa' },
  { natureza: 'OUTRA ENTRADA MERCADORIA / PREST.SERV. NAO ESPECIFICADO', modo: 'padrao', esperado: null, porque: 'informativa' },
  { natureza: 'REMESSA IND. POR CONTA E ORDEM ADQ. S/ TRANS. ESTAB.', modo: 'padrao', esperado: null, porque: 'industrialização por conta e ordem' },
  { natureza: 'INSCRIÇÃO ESTADUALINSC. ESTADUAL DO SUBST. TRIBUTÁRIOCNPJ', modo: 'padrao', esperado: null, porque: 'rótulo do DANFE capturado por engano pelo parser' },
  { natureza: '', modo: 'padrao', esperado: null, porque: 'natureza vazia: virar saída seria chute em baixa de estoque' },
  { natureza: 'Devol. Compras Ind. Fora PR', modo: 'padrao', esperado: null, porque: 'devolução de compra' },
]

let falhas = 0
console.log('\nclassificarOperacaoV2 — casos reais do histórico\n')

for (const c of CASOS) {
  const { tipo } = classificarOperacaoV2(c.natureza, c.modo)
  const ok = tipo === c.esperado
  if (!ok) falhas++
  const rotulo = (v: Esperado) => (v === null ? 'NÃO CONTA' : v.toUpperCase())
  console.log(
    `  ${ok ? '✅' : '❌'} [${c.modo.padEnd(9)}] ${rotulo(tipo).padEnd(9)} ` +
    `${ok ? '' : `(esperado ${rotulo(c.esperado)}) `}${c.natureza.slice(0, 52) || '(vazia)'}`,
  )
  if (!ok) console.log(`        motivo esperado: ${c.porque}`)
}

console.log(`\n  ${CASOS.length - falhas}/${CASOS.length} casos corretos`)
if (falhas > 0) {
  console.error(`  ${falhas} FALHA(S)\n`)
  process.exitCode = 1
} else {
  console.log('  tudo certo\n')
}

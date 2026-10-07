/**
 * Carrega o inventário físico do Graphics como ponto de partida.
 *
 * Para cada SKU (planilha ∪ sistema) grava um ajuste `inventario = true` na data
 * do inventário, de valor (contagem − saldo do sistema na data), levando o saldo
 * à contagem. SKU que não está na planilha vale 0; SKU novo é criado.
 * Idempotente: regrava os ajustes de inventário daquela data.
 *
 * Pré-requisito: migration 030 (coluna `inventario`) — só para --apply.
 * Seguro por padrão: sem --apply só simula e grava um relatório em backups/.
 *
 * Uso:
 *   npx tsx --env-file=.env.local scripts/inventario-graphics.mts <planilha.xlsx> [AAAA-MM-DD]          # simula
 *   npx tsx --env-file=.env.local scripts/inventario-graphics.mts <planilha.xlsx> [AAAA-MM-DD] --apply  # grava
 */
import { createClient } from '@supabase/supabase-js'
import { mkdirSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { acumuladoSku, paletsOcupados, type GfxMov } from '../lib/graphics-saldo'
import { dimsDaDescricao, ehCodigoGraphics, UNIDADES_POR_PALET_PADRAO } from '../lib/graphics'

const args = process.argv.slice(2).filter(a => !a.startsWith('--'))
const aplicar = process.argv.includes('--apply')
const [arquivo, dataInv = '2026-10-03'] = args
if (!arquivo) { console.error('uso: inventario-graphics.mts <planilha.xlsx> [AAAA-MM-DD] [--apply]'); process.exit(1) }

// Lê a planilha (aba única: ITEM_NUMBER = código do SKU; TOTAL = soma de todas as colunas)
const py = `
import openpyxl, json, sys
ws = openpyxl.load_workbook(sys.argv[1], data_only=True).active
hdr = [c.value for c in ws[2]]
ti = hdr.index('TOTAL'); ci = hdr.index('ITEM_NUMBER'); di = hdr.index('ITEM_DESCRIPTION')
out = []
for row in ws.iter_rows(min_row=3, values_only=True):
    if row[ci]: out.append({'codigo': str(row[ci]).strip(), 'descricao': row[di], 'total': row[ti] or 0})
print(json.dumps(out))
`
const linhas: Array<{ codigo: string; descricao: string; total: number }> =
  JSON.parse(execFileSync('python3', ['-c', py, arquivo], { encoding: 'utf-8' }))
const contagem = new Map<string, { descricao: string; total: number }>()
for (const l of linhas) {
  const a = contagem.get(l.codigo)
  contagem.set(l.codigo, { descricao: a?.descricao ?? l.descricao, total: (a?.total ?? 0) + Number(l.total) })   // SKU repetido: soma
}
const invalidos = [...contagem.keys()].filter(c => !ehCodigoGraphics(c))
if (invalidos.length) { console.error('códigos fora do padrão Graphics:', invalidos.join(', ')); process.exit(1) }

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
)
const { data: cli } = await supabase.from('clientes').select('id').eq('cnpj', '43.999.630/0001-24').single()
if (!cli) throw new Error('cliente Avery Dennison não encontrado')

const { data: skus } = await supabase.from('graphics_sku').select('id, codigo, descricao, unidades_por_palet').eq('cliente_id', cli.id)
const porCodigo = new Map((skus ?? []).map(s => [s.codigo as string, s]))
const ids = (skus ?? []).map(s => s.id as string)
const movs: GfxMov[] = []
for (let i = 0; i < ids.length; i += 100) {
  for (let o = 0; ; o += 1000) {
    const { data, error } = await supabase.from('graphics_movimentacoes')
      .select('id, sku_id, arquivo_nfe_id, numero_nfe, tipo, data_mov, qtd_unidades, palets_declarados')
      .in('sku_id', ids.slice(i, i + 100)).order('data_mov').range(o, o + 999)
    if (error) throw error
    movs.push(...((data ?? []) as GfxMov[]).map(m => ({ ...m, qtd_unidades: Number(m.qtd_unidades) })))
    if (!data || data.length < 1000) break
  }
}

// Plano: um ajuste por SKU
const codigos = [...new Set([...contagem.keys(), ...porCodigo.keys()])].sort()
interface Plano { codigo: string; novo: boolean; sistema: number; contado: number; delta: number; paletsAntes: number; paletsDepois: number; descricao: string }
const plano: Plano[] = []
for (const codigo of codigos) {
  const sku = porCodigo.get(codigo)
  const doSku = sku ? movs.filter(m => m.sku_id === sku.id) : []
  const a = acumuladoSku(doSku, dataInv)        // notas até a data já estão na contagem; o inventário é o saldo final do dia
  const sistema = Math.round((a.entrou - a.saiu) * 1e4) / 1e4
  const contado = contagem.get(codigo)?.total ?? 0
  plano.push({
    codigo, novo: !sku, sistema, contado, delta: Math.round((contado - sistema) * 1e4) / 1e4,
    paletsAntes: paletsOcupados(a, UNIDADES_POR_PALET_PADRAO), paletsDepois: Math.ceil(contado / UNIDADES_POR_PALET_PADRAO),
    descricao: sku?.descricao ?? contagem.get(codigo)?.descricao ?? '',
  })
}

const soma = (f: (p: Plano) => number) => plano.reduce((s, p) => s + f(p), 0)
console.log(`inventário de ${dataInv} · ${contagem.size} SKUs na planilha · ${porCodigo.size} no sistema · ${plano.length} no total`)
console.log(`SKUs novos: ${plano.filter(p => p.novo).map(p => `${p.codigo}=${p.contado}`).join(', ') || '—'}`)
console.log(`SKUs fora da planilha (viram 0): ${plano.filter(p => !contagem.has(p.codigo)).map(p => `${p.codigo} (sistema ${p.sistema})`).join(', ') || '—'}`)
console.log(`caixas — sistema: ${soma(p => p.sistema)} | inventário: ${soma(p => p.contado)} | diferença: ${soma(p => p.delta)}`)
console.log(`palets — sistema: ${soma(p => p.paletsAntes)} | inventário (CEIL ÷ 30): ${soma(p => p.paletsDepois)}`)
const maiores = [...plano].sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta)).slice(0, 12)
console.log('maiores diferenças (SKU: sistema → contado):')
for (const p of maiores) console.log(`  ${p.codigo}: ${p.sistema} → ${p.contado} (${p.delta > 0 ? '+' : ''}${p.delta})`)
console.log(`SKUs com diferença: ${plano.filter(p => p.delta !== 0).length} | iguais: ${plano.filter(p => p.delta === 0).length}`)

mkdirSync('backups', { recursive: true })
writeFileSync(`backups/inventario-graphics-${dataInv}-${aplicar ? 'aplicado' : 'simulacao'}.json`, JSON.stringify(plano, null, 1))
if (!aplicar) { console.log('\nSimulação concluída — nada foi gravado. Use --apply para gravar.'); process.exit(0) }

// ── Aplicação ────────────────────────────────────────────────────────────
for (const p of plano) {
  let skuId = porCodigo.get(p.codigo)?.id as string | undefined
  if (!skuId) {
    const d = dimsDaDescricao(p.descricao)
    const { data: novo, error } = await supabase.from('graphics_sku').insert({
      cliente_id: cli.id, codigo: p.codigo, descricao: p.descricao, unidades_por_palet: UNIDADES_POR_PALET_PADRAO,
      largura_mm: d.larguraMm, comprimento_m: d.comprimentoM,
    }).select('id').single()
    if (error || !novo) { console.log(`ERRO criando SKU ${p.codigo}: ${error?.message}`); continue }
    skuId = novo.id
  }
  await supabase.from('graphics_movimentacoes').delete().eq('sku_id', skuId).eq('inventario', true).eq('data_mov', dataInv)
  const { error } = await supabase.from('graphics_movimentacoes').insert({
    sku_id: skuId, tipo: 'ajuste', data_mov: dataInv, qtd_unidades: p.delta, inventario: true,
    observacoes: `Inventário físico de ${dataInv.split('-').reverse().join('/')}: contagem ${p.contado}, sistema ${p.sistema}`,
  })
  if (error) console.log(`ERRO gravando inventário de ${p.codigo}: ${error.message}`)
}
console.log(`\n✅ inventário gravado para ${plano.length} SKUs.`)

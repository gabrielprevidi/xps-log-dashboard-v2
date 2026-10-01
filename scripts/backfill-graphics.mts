/**
 * Backfill do controle Avery Graphics.
 *
 * Reclassifica as notas Graphics da AVERY DENNISON (entradas e saídas) que já foram
 * gravadas como Avery comum em `movimentacoes`: lê de novo o XML/PDF no e-mail (o banco não
 * guarda o texto da nota), identifica as Graphics pelo código dos itens (AAA999-FG9),
 * converte m² em caixas quando preciso e as move para `graphics_movimentacoes`.
 *
 * As movimentações antigas NÃO são apagadas: ficam `cancelada = true` com uma
 * observação, o que todos os cálculos já respeitam e permite desfazer.
 *
 * Seguro por padrão: sem --apply só simula e escreve um relatório.
 * Com --apply grava um backup JSON antes de alterar qualquer coisa.
 *
 * ORDEM: rode as migrations 028 e 029, faça o deploy do código novo e só então
 * use --apply — antes do deploy, o site atual deixaria de contar esses palets.
 *
 * Uso:
 *   npx tsx --env-file=.env.local scripts/backfill-graphics.mts           # simula
 *   npx tsx --env-file=.env.local scripts/backfill-graphics.mts --apply   # grava
 */
import { ImapFlow } from 'imapflow'
import { createClient } from '@supabase/supabase-js'
import { mkdirSync, writeFileSync } from 'node:fs'
import { processarArquivoAnexo, type AnexoXML } from '../lib/anexos'
import type { DadosNFe } from '../lib/nfe-parser'
import {
  ehNotaGraphics, aprenderDims, caixasDoItem, gravarGraphics, UNIDADES_POR_PALET_PADRAO,
  type DimsPorSku,
} from '../lib/graphics'
import { resumoGraphicsMes, type GfxMov, type GfxSku } from '../lib/graphics-saldo'

const aplicar = process.argv.includes('--apply')
const EXT = /\.(xml|pdf|zip)$/i
const PASTAS_FORA = /^(trash|spam|drafts|junk|lixeira|rascunhos)$/i

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
)

interface Mov {
  id: string; arquivo_nfe_id: string; numero_nfe: string | null; chave_nfe: string | null
  tipo_movimentacao: 'entrada' | 'saida'; data_entrada: string | null; data_saida: string | null
  pallets_entrada: number | null; pallets_saida: number | null; observacoes: string | null
  arquivos_nfe: { chave_nfe: string | null; email_id: string | null; numero_nfe: string | null } | null
}

// ── 1. Movimentações atuais da Avery Dennison ────────────────────────────
const { data: cli } = await supabase.from('clientes').select('id').eq('cnpj', '43.999.630/0001-24').single()
if (!cli) throw new Error('cliente Avery Dennison não encontrado')
const movs: Mov[] = []
for (let o = 0; ; o += 1000) {
  const { data, error } = await supabase
    .from('movimentacoes')
    .select('id,arquivo_nfe_id,numero_nfe,chave_nfe,tipo_movimentacao,data_entrada,data_saida,pallets_entrada,pallets_saida,observacoes,arquivos_nfe(chave_nfe,email_id,numero_nfe)')
    .eq('cliente_id', cli.id).eq('cancelada', false).not('arquivo_nfe_id', 'is', null)
    .range(o, o + 999)
  if (error) throw error
  movs.push(...((data ?? []) as unknown as Mov[]))
  if (!data || data.length < 1000) break
}
console.log(`movimentações ativas da Avery Dennison: ${movs.length}`)

// e-mails de origem (message_id) das notas
const emailIds = [...new Set(movs.map(m => m.arquivos_nfe?.email_id).filter(Boolean))] as string[]
const msgIdPorEmail = new Map<string, string>()
for (let i = 0; i < emailIds.length; i += 200) {
  const { data } = await supabase.from('emails_importados').select('id,message_id,data_recebimento').in('id', emailIds.slice(i, i + 200))
  for (const e of data ?? []) msgIdPorEmail.set(e.id, e.message_id)
}
const movsPorMsgId = new Map<string, Mov[]>()
for (const m of movs) {
  const mid = m.arquivos_nfe?.email_id ? msgIdPorEmail.get(m.arquivos_nfe.email_id) : undefined
  if (!mid) continue
  movsPorMsgId.set(mid, [...(movsPorMsgId.get(mid) ?? []), m])
}
console.log(`e-mails de origem distintos: ${movsPorMsgId.size} (de ${movs.length} movimentações; ${movs.filter(m => !m.arquivos_nfe?.email_id).length} sem e-mail registrado)\n`)

// ── 2. Localiza e relê os e-mails ────────────────────────────────────────
const client = new ImapFlow({
  host: process.env.IMAP_HOST!, port: Number(process.env.IMAP_PORT || 143),
  secure: String(process.env.IMAP_SECURE ?? 'false') === 'true',
  auth: { user: process.env.IMAP_USER!, pass: process.env.IMAP_PASSWORD! },
  logger: false, socketTimeout: 120_000,
})
await client.connect()

interface Lida { mov: Mov; nfe: DadosNFe }
const lidas: Lida[] = []
const pendentes = new Set(movsPorMsgId.keys())
const naoLocalizados = new Set(movsPorMsgId.keys())
const pastas = (await client.list()).filter(p => !PASTAS_FORA.test(p.name) && !p.flags.has('\\Noselect'))
// Janela: a movimentação mais antiga da Avery
const desde = new Date('2026-04-25')

for (const pasta of pastas) {
  if (pendentes.size === 0) break
  const lock = await client.getMailboxLock(pasta.path, { readOnly: true })
  try {
    const uids = (await client.search({ since: desde }, { uid: true })) || []
    if (uids.length === 0) continue
    process.stdout.write(`pasta "${pasta.path}": ${uids.length} mensagens… `)
    let casadas = 0
    // 1ª passada: só envelope + estrutura, para achar os message-ids de interesse
    const alvo: Array<{ uid: number; mid: string; estrutura: unknown }> = []
    // Em faixas de UID (a lista inteira estoura o limite de argumento do servidor)
    uids.sort((x, y) => x - y)
    for (let i = 0; i < uids.length; i += 500) {
      const faixa = `${uids[i]}:${uids[Math.min(i + 499, uids.length - 1)]}`
      for await (const msg of client.fetch(faixa, { uid: true, envelope: true, bodyStructure: true }, { uid: true })) {
        const mid = msg.envelope?.messageId
        if (mid && pendentes.has(mid)) alvo.push({ uid: msg.uid, mid, estrutura: msg.bodyStructure })
      }
    }
    for (const a of alvo) {
      const partes: Array<{ part: string; nome: string; tipo: string }> = []
      const varrer = (n: unknown): void => {
        const no = n as { part?: string; type?: string; childNodes?: unknown[]
          dispositionParameters?: { filename?: string }; parameters?: { name?: string } }
        if (!no) return
        const nome = no.dispositionParameters?.filename ?? no.parameters?.name
        if (nome && EXT.test(String(nome))) partes.push({ part: no.part || '1', nome: String(nome), tipo: `${no.type ?? ''}`.toLowerCase() })
        for (const f of no.childNodes ?? []) varrer(f)
      }
      varrer(a.estrutura)
      const anexos: AnexoXML[] = []
      for (const p of partes) {
        const { content } = await client.download(String(a.uid), p.part, { uid: true })
        const pedacos: Buffer[] = []
        for await (const x of content) pedacos.push(Buffer.from(x))
        await processarArquivoAnexo(p.nome, p.tipo, Buffer.concat(pedacos), anexos)
      }
      for (const mov of movsPorMsgId.get(a.mid) ?? []) {
        // casa a nota pela chave (ou, na falta, pelo número)
        const cand = anexos.filter(x =>
          (x.dados_nfe?.chave_nfe && x.dados_nfe.chave_nfe === mov.arquivos_nfe?.chave_nfe) ||
          (x.dados_nfe?.numero_nfe && x.dados_nfe.numero_nfe === mov.numero_nfe))
        // XML primeiro: descrição completa e quantidade sem ambiguidade de milhar
        const melhor = cand.find(x => x.nome_arquivo.toLowerCase().endsWith('.xml') && (x.dados_nfe?.itens.length ?? 0) > 0)
          ?? cand.find(x => (x.dados_nfe?.itens.length ?? 0) > 0) ?? cand[0]
        if (melhor?.dados_nfe) lidas.push({ mov, nfe: melhor.dados_nfe })
      }
      pendentes.delete(a.mid); naoLocalizados.delete(a.mid); casadas++
    }
    console.log(`${casadas} e-mails da Avery`)
  } finally { lock.release() }
}
await client.logout()

// ── 3. Classificação e conversão ─────────────────────────────────────────
const dataDe = (m: Mov) => m.data_entrada || m.data_saida || ''
const dims: DimsPorSku = new Map()
for (const l of lidas) aprenderDims(dims, l.nfe.itens)

const graphics = lidas.filter(l => ehNotaGraphics(l.nfe)).sort((a, b) => dataDe(a.mov).localeCompare(dataDe(b.mov)))
const semItens = lidas.filter(l => l.nfe.itens.length === 0)
const pendencias: Array<{ nf: string | null; motivo: string }> = []
const convertidas: Array<{ l: Lida; itens: Array<{ codigo: string; caixas: number }> }> = []
for (const l of graphics) {
  const itens: Array<{ codigo: string; caixas: number }> = []
  let falhou: string | null = null
  for (const it of l.nfe.itens) {
    const c = caixasDoItem(it, dims.get(it.codigo.trim()))
    if (c.erro || c.caixas == null) { falhou = c.erro ?? 'sem quantidade'; break }
    itens.push({ codigo: it.codigo.trim(), caixas: c.caixas })
  }
  if (falhou) pendencias.push({ nf: l.mov.numero_nfe, motivo: falhou })
  else convertidas.push({ l, itens })
}

const movsNaoLidas = [...naoLocalizados].flatMap(m => movsPorMsgId.get(m) ?? [])
console.log(`\n══ RESULTADO ${aplicar ? '(APLICANDO)' : '(SIMULAÇÃO)'} ══`)
console.log(`notas lidas: ${lidas.length} | sem itens legíveis (ficam como estão): ${semItens.length}`)
console.log(`notas Graphics (todos os itens com código -FG): ${graphics.length}  → entradas ${graphics.filter(g => g.mov.tipo_movimentacao === 'entrada').length}, saídas ${graphics.filter(g => g.mov.tipo_movimentacao === 'saida').length}`)
console.log(`  convertidas em caixas: ${convertidas.length} | pendentes (sem dimensão/unidade): ${pendencias.length}`)
for (const p of pendencias.slice(0, 15)) console.log(`    NF ${p.nf}: ${p.motivo}`)
console.log(`e-mails não localizados: ${naoLocalizados.size} (${movsNaoLidas.length} movimentações NÃO verificadas)`)

// efeito no estoque pela regra de palets
const skuMap = new Map<string, GfxSku>(); const gmovs: GfxMov[] = []
for (const { l, itens } of convertidas) {
  for (const it of itens) {
    if (!skuMap.has(it.codigo)) skuMap.set(it.codigo, { id: it.codigo, codigo: it.codigo, descricao: null, unidades_por_palet: UNIDADES_POR_PALET_PADRAO })
    gmovs.push({ id: `${l.mov.id}${it.codigo}`, sku_id: it.codigo, arquivo_nfe_id: null, numero_nfe: l.mov.numero_nfe,
      tipo: l.mov.tipo_movimentacao, data_mov: dataDe(l.mov), qtd_unidades: it.caixas, palets_declarados: null })
  }
}
const skus = [...skuMap.values()]
const meses = [...new Set(gmovs.map(m => m.data_mov.slice(0, 7)))].sort()
const tabela: Record<string, unknown> = {}
for (const mes of meses) {
  const r = resumoGraphicsMes(skus, gmovs, mes)
  const doMes = convertidas.filter(c => dataDe(c.l.mov).startsWith(mes))
  const sum = (tipo: 'entrada' | 'saida') => doMes.filter(c => c.l.mov.tipo_movimentacao === tipo)
    .reduce((s, c) => s + (c.l.mov.pallets_entrada ?? c.l.mov.pallets_saida ?? 0), 0)
  tabela[mes] = {
    notas: doMes.length, caixasEntrada: Math.round(r.caixasEntrada), caixasSaida: Math.round(r.caixasSaida),
    saldoCaixas: Math.round(r.caixasFim), paletsFim: r.paletsFim, pico: r.paletsPico,
    declEntrada: sum('entrada'), declSaida: sum('saida'), skusNegativos: r.skusNegativos.length,
  }
}
console.table(tabela)

mkdirSync('backups', { recursive: true })
const stamp = new Date().toISOString().replace(/[:.]/g, '-')
writeFileSync(`backups/graphics-${aplicar ? 'aplicado' : 'simulacao'}-${stamp}.json`, JSON.stringify({
  convertidas: convertidas.map(c => ({ ...c.l.mov, itens: c.itens })), pendencias,
  semItens: semItens.map(l => ({ numero: l.mov.numero_nfe, natureza: l.nfe.natureza_operacao })),
  naoLocalizados: movsNaoLidas.map(m => m.numero_nfe),
}, null, 1))

// ── 4. Aplicação ─────────────────────────────────────────────────────────
if (!aplicar) { console.log('\nSimulação concluída — nada foi gravado. Use --apply para gravar.'); process.exit(0) }

let movidas = 0
for (const { l } of convertidas) {
  const data = dataDe(l.mov)
  if (!data) { console.log(`  pulada NF ${l.mov.numero_nfe}: sem data`); continue }
  const g = await gravarGraphics(supabase, {
    clienteId: cli.id, arquivoNfeId: l.mov.arquivo_nfe_id, nfe: l.nfe,
    tipo: l.mov.tipo_movimentacao, data, dimsExtras: dims,
    paletsDeclarados: l.mov.tipo_movimentacao === 'entrada' ? l.mov.pallets_entrada : l.mov.pallets_saida,
  })
  if (g.erro) { console.log(`  ERRO NF ${l.mov.numero_nfe}: ${g.erro}`); continue }
  const obs = [l.mov.observacoes, 'Movida para o controle Graphics (caixas por SKU).'].filter(Boolean).join(' ')
  const { error } = await supabase.from('movimentacoes').update({ cancelada: true, observacoes: obs }).eq('id', l.mov.id)
  if (error) { console.log(`  ERRO ao cancelar NF ${l.mov.numero_nfe}: ${error.message}`); continue }
  movidas++
}
console.log(`\n✅ ${movidas} nota(s) movidas para o controle Graphics.`)

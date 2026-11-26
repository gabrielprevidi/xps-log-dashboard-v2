/**
 * FLEXCOAT — reaplica a regra de classificação nova às movimentações já gravadas.
 *   REM P/ARMAZEM GERAL gravada como saída → vira entrada (corrigirTipoMovimentacao)
 *   notas de importação gravadas como saída → canceladas (soft-delete, reversível)
 * Sem APLICAR=1 só simula. Salva backup das linhas em backups/ antes de mexer.
 */
import fs from 'fs'
import { getServerClient } from '../lib/supabase'
import { classificarOperacaoV2 } from '../lib/nfe-classificacao'
import { corrigirTipoMovimentacao, excluirMovimentacao } from '../lib/supabase-service'

const CLIENTE_ID = '50d2bdf7-6526-41df-bab5-7e4405fc7c99'
const APLICAR = process.env.APLICAR === '1'
const ator = { id: 'script', nome: 'Correção classificação FLEXCOAT' }

const sb = getServerClient()
const { data: movs, error } = await sb.from('movimentacoes')
  .select('*, arquivos_nfe:arquivo_nfe_id(natureza_operacao, cfop)')
  .eq('cliente_id', CLIENTE_ID).eq('cancelada', false)
if (error) throw error

const acoes: { id: string; nf: string; de: string; para: string }[] = []
for (const m of movs ?? []) {
  const f = m.arquivos_nfe as { natureza_operacao: string | null; cfop: string | null } | null
  if (!f) continue
  const { tipo } = classificarOperacaoV2(f.natureza_operacao ?? '', 'padrao', null, null,
    { cnpjCliente: '48062707000159', cfops: [f.cfop] })
  const para = tipo ?? 'cancelar'
  if (para !== m.tipo_movimentacao) acoes.push({ id: m.id, nf: m.numero_nfe, de: m.tipo_movimentacao, para })
}
console.table(acoes)
if (!APLICAR) { console.log('Simulação. APLICAR=1 para gravar.'); process.exit(0) }

const backup = `backups/flexcoat-classificacao-${new Date().toISOString().slice(0, 10)}.json`
fs.writeFileSync(backup, JSON.stringify((movs ?? []).filter(m => acoes.some(a => a.id === m.id)), null, 1))
console.log('backup:', backup)
for (const a of acoes) {
  if (a.para === 'cancelar') await excluirMovimentacao(a.id, ator)
  else await corrigirTipoMovimentacao(a.id, a.para as 'entrada' | 'saida', ator)
}
console.log(`${acoes.length} movimentações corrigidas`)

import { sb } from './db.mjs'
const { data: cli } = await sb.from('clientes').select('*').ilike('nome','%tecnia%')
console.log('CLIENTE:', JSON.stringify(cli,null,1))
const id = cli?.[0]?.id
const { data: prods } = await sb.from('cliente_produtos').select('*').eq('cliente_id',id).order('ordem')
console.log('\nPRODUTOS CADASTRADOS:', prods?.length)
for (const p of prods||[]) console.log(' ', JSON.stringify({nome:p.nome, ncm:p.codigo_ncm, kw:p.palavras_chave, fator:p.regra_fator_pallet, vp:p.valor_pallet, ativo:p.ativo}))

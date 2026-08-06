import { sb } from './db.mjs'
const CID='ba53b2e9-d354-45e2-a700-6d681b577e8f'
const { data: movs } = await sb.from('movimentacoes').select('*, arquivos_nfe(*)').eq('cliente_id',CID).order('numero_nfe')
console.log('movimentações Tecnia:', movs?.length)
for (const m of movs||[]) {
  const a=m.arquivos_nfe||{}
  console.log(JSON.stringify({nf:m.numero_nfe,tipo:m.tipo_movimentacao,e:m.qtd_entrada_ton,s:m.qtd_saida_ton,pe:m.pallets_entrada,ps:m.pallets_saida,prod:m.produto_nome,canc:m.cancelada,org:m.origem,arq:{peso:a.peso_liquido_ton,pal:a.pallets_calculados,nat:a.natureza_operacao,file:a.nome_arquivo}}))
}
console.log('\n── arquivos_nfe com 4306/4406 ──')
const { data: arqs } = await sb.from('arquivos_nfe').select('*').or('numero_nfe.eq.4306,numero_nfe.eq.4406')
for (const a of arqs||[]) console.log(JSON.stringify(a))

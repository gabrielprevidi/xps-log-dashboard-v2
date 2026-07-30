import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'

for (const line of readFileSync('.env.local', 'utf-8').split('\n')) {
  const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
  if (match) process.env[match[1]] = match[2].replace(/^["']|["']$/g, '')
}

const FEDRIGONI_ID = '3df258d0-259c-42b5-add1-7debce0922af'
const aplicar = process.argv.includes('--apply')

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !key) throw new Error('Credenciais do Supabase não configuradas; correção cancelada.')
  const supabase = createClient(url, key)

  const { data: arquivos, error: arqError } = await supabase
    .from('arquivos_nfe')
    .select('id, natureza_operacao')
    .ilike('natureza_operacao', '%retorno simb%')

  if (arqError) throw arqError

  const arquivoIds = (arquivos ?? [])
    .filter((arquivo) => /retorno simb[oó]lico/i.test(arquivo.natureza_operacao ?? ''))
    .map((arquivo) => arquivo.id)

  const { data: incorretas, error: movError } = await supabase
    .from('movimentacoes')
    .select('id, numero_nfe, data_saida, pallets_saida')
    .eq('cliente_id', FEDRIGONI_ID)
    .in('arquivo_nfe_id', arquivoIds)

  if (movError) throw movError

  const totalVolumes = (incorretas ?? []).reduce((total, mov) => total + (mov.pallets_saida ?? 0), 0)
  console.log(`Movimentações identificadas: ${incorretas?.length ?? 0}`)
  console.log(`Volumes de saída a desconsiderar: ${totalVolumes}`)
  console.log(`NFs: ${(incorretas ?? []).map((mov) => mov.numero_nfe).sort().join(', ')}`)

  if (!aplicar) {
    console.log('Simulação concluída. Use --apply para remover somente essas movimentações.')
    return
  }

  const ids = (incorretas ?? []).map((mov) => mov.id)
  if (ids.length === 0) {
    console.log('Nenhuma movimentação a remover.')
    return
  }

  const { error: deleteError } = await supabase.from('movimentacoes').delete().in('id', ids)
  if (deleteError) throw deleteError

  console.log(`Correção aplicada: ${ids.length} movimentações removidas.`)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})

/**
 * Script de setup do banco de dados Supabase.
 * Executa o schema SQL usando a Management API do Supabase.
 *
 * Uso:
 *   SUPABASE_ACCESS_TOKEN=seu_token npm run db:setup
 *
 * O token pode ser obtido em:
 *   https://supabase.com/dashboard/account/tokens
 */

import { readFileSync } from 'fs'
import { join } from 'path'

const PROJECT_REF = 'pdivfyduaraphufvfxlz'
const ACCESS_TOKEN = process.env.SUPABASE_ACCESS_TOKEN

if (!ACCESS_TOKEN) {
  console.error('\n❌ Variável SUPABASE_ACCESS_TOKEN não definida.')
  console.error('\n   Como obter:')
  console.error('   1. Acesse https://supabase.com/dashboard/account/tokens')
  console.error('   2. Crie um novo token com qualquer nome')
  console.error('   3. Execute: SUPABASE_ACCESS_TOKEN=<token> npm run db:setup\n')
  process.exit(1)
}

const sqlPath = join(import.meta.dirname ?? __dirname, '..', 'supabase', '001_schema.sql')
const sql = readFileSync(sqlPath, 'utf-8')

// Divide o SQL em statements individuais para executar um a um
// (a Management API aceita queries individuais)
const statements = sql
  .split(/;\s*\n/)
  .map(s => s.trim())
  .filter(s => s.length > 0 && !s.startsWith('--'))

async function runQuery(query: string): Promise<void> {
  const res = await fetch(
    `https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${ACCESS_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query }),
    }
  )

  if (!res.ok) {
    const body = await res.text()
    throw new Error(`HTTP ${res.status}: ${body}`)
  }
}

async function main() {
  console.log(`\n🚀 Configurando banco de dados do projeto ${PROJECT_REF}...\n`)

  let ok = 0
  let erros = 0

  for (const stmt of statements) {
    const preview = stmt.slice(0, 80).replace(/\n/g, ' ')
    try {
      await runQuery(stmt + ';')
      console.log(`  ✓ ${preview}`)
      ok++
    } catch (err: any) {
      // Ignora erros de "already exists" (idempotente)
      if (
        err.message.includes('already exists') ||
        err.message.includes('does not exist')
      ) {
        console.log(`  ~ ${preview} (já existe, ignorado)`)
        ok++
      } else {
        console.error(`  ✗ ${preview}`)
        console.error(`    ${err.message}`)
        erros++
      }
    }
  }

  console.log(`\n${erros === 0 ? '✅' : '⚠️'} Concluído: ${ok} statements OK, ${erros} erros.\n`)

  if (erros > 0) process.exit(1)
}

main().catch(err => {
  console.error('\n❌ Erro fatal:', err)
  process.exit(1)
})

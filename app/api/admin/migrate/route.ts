import { NextResponse } from 'next/server'
import { getSessaoAdmin } from '@/lib/admin-auth'
import { createClient } from '@supabase/supabase-js'

export const dynamic = 'force-dynamic'

// Aplica migrations SQL que não podem ser executadas via anon key.
// Requer sessão de administrador. Idempotente: ADD COLUMN IF NOT EXISTS.
export async function POST() {
  if (!(await getSessaoAdmin())) {
    return NextResponse.json({ error: 'Não autorizado' }, { status: 401 })
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = createClient(url, key) as any

  const migrations: { nome: string; sql: string }[] = [
    {
      nome: '009a: cobrar_manuseio em clientes',
      sql: `ALTER TABLE clientes ADD COLUMN IF NOT EXISTS cobrar_manuseio BOOLEAN NOT NULL DEFAULT true`,
    },
    {
      nome: '009b: categoria em cliente_produtos',
      sql: `ALTER TABLE cliente_produtos ADD COLUMN IF NOT EXISTS categoria TEXT NOT NULL DEFAULT 'pa'`,
    },
  ]

  const resultados: { nome: string; ok: boolean; erro?: string }[] = []

  for (const m of migrations) {
    const { error } = await supabase.rpc('exec_sql', { sql: m.sql }).catch(() => ({ error: { message: 'rpc indisponível' } }))
    if (error) {
      // tenta via query direta — apenas funciona com service role
      const res = await fetch(`${url}/rest/v1/`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          apikey: key,
          Authorization: `Bearer ${key}`,
          'X-Client-Info': 'migration',
        },
        body: JSON.stringify({ query: m.sql }),
      }).catch(() => null)
      resultados.push({ nome: m.nome, ok: res?.ok ?? false, erro: res?.ok ? undefined : 'Necessário service role key — execute manualmente no Supabase Dashboard' })
    } else {
      resultados.push({ nome: m.nome, ok: true })
    }
  }

  const sql_manual = migrations.map(m => m.sql + ';').join('\n')

  return NextResponse.json({ resultados, sql_manual })
}

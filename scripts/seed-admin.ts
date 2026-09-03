/**
 * Cria o primeiro usuário administrativo em `usuarios_admin`.
 *
 * Necessário rodar uma vez após a migration 020_usuarios_admin.sql, já que o
 * login por senha única (ADMIN_PASSWORD) deixa de funcionar — sem isso
 * ninguém consegue entrar no dashboard.
 *
 * Uso:
 *   NEXT_PUBLIC_SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
 *     npx tsx scripts/seed-admin.ts --nome "Seu Nome" --email voce@xpslog.com.br --senha "senha-forte"
 *
 * Se o e-mail já existir, atualiza a senha em vez de duplicar.
 */
import { createClient } from '@supabase/supabase-js'
import bcrypt from 'bcryptjs'

function arg(nome: string): string | undefined {
  const i = process.argv.indexOf(`--${nome}`)
  return i >= 0 ? process.argv[i + 1] : undefined
}

async function main() {
  const nome = arg('nome')
  const email = arg('email')
  const senha = arg('senha')

  if (!nome || !email || !senha) {
    console.error('\nUso: npx tsx scripts/seed-admin.ts --nome "Nome" --email email@xpslog.com.br --senha "senha"\n')
    process.exit(1)
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) {
    console.error('\n❌ NEXT_PUBLIC_SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY precisam estar definidas.\n')
    process.exit(1)
  }

  const supabase = createClient(url, key)
  const senha_hash = await bcrypt.hash(senha, 10)

  const { data: existente } = await supabase
    .from('usuarios_admin')
    .select('id')
    .ilike('email', email)
    .maybeSingle()

  if (existente) {
    const { error } = await supabase
      .from('usuarios_admin')
      .update({ nome, senha_hash, ativo: true, updated_at: new Date().toISOString() })
      .eq('id', existente.id)
    if (error) throw new Error(error.message)
    console.log(`\n✅ Usuário ${email} já existia — senha atualizada.\n`)
    return
  }

  const { error } = await supabase.from('usuarios_admin').insert({ nome, email, senha_hash })
  if (error) throw new Error(error.message)
  console.log(`\n✅ Usuário administrativo criado: ${nome} <${email}>\n`)
}

main().catch(e => {
  console.error('\n❌', e.message, '\n')
  process.exit(1)
})

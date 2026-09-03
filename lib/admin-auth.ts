import { SignJWT, jwtVerify } from 'jose'
import { cookies } from 'next/headers'

export const ADMIN_COOKIE_NAME = 'admin_session'

const JWT_SECRET = new TextEncoder().encode(
  process.env.ADMIN_JWT_SECRET || 'xpslog-admin-secret-change-in-production'
)

export interface UsuarioAdminSessao {
  id: string
  nome: string
  email: string
}

export async function criarSessaoAdmin(usuario: UsuarioAdminSessao): Promise<string> {
  return new SignJWT({ id: usuario.id, nome: usuario.nome, email: usuario.email })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('8h')
    .sign(JWT_SECRET)
}

export async function verificarSessaoAdmin(token: string): Promise<UsuarioAdminSessao | null> {
  try {
    const { payload } = await jwtVerify(token, JWT_SECRET)
    if (!payload.id || !payload.email) return null
    return { id: payload.id as string, nome: (payload.nome as string) || '', email: payload.email as string }
  } catch {
    return null
  }
}

/** Identidade do usuário logado (id, nome, email), ou null se não autenticado. */
export async function getUsuarioAtual(): Promise<UsuarioAdminSessao | null> {
  const cookieStore = await cookies()
  const token = cookieStore.get(ADMIN_COOKIE_NAME)?.value
  if (!token) return null
  return verificarSessaoAdmin(token)
}

/** Mantido para os call sites que só precisam saber se há sessão de admin válida. */
export async function getSessaoAdmin(): Promise<boolean> {
  return (await getUsuarioAtual()) !== null
}

import { SignJWT, jwtVerify } from 'jose'
import { cookies } from 'next/headers'

const COOKIE_NAME = 'portal_session'
const JWT_SECRET = new TextEncoder().encode(
  process.env.PORTAL_JWT_SECRET || 'xpslog-portal-secret-change-in-production'
)

export interface PortalSession {
  clienteId: string
  usuario: string
}

export async function criarSessao(session: PortalSession): Promise<string> {
  return new SignJWT({ ...session })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('7d')
    .sign(JWT_SECRET)
}

export async function verificarSessao(token: string): Promise<PortalSession | null> {
  try {
    const { payload } = await jwtVerify(token, JWT_SECRET)
    return { clienteId: payload.clienteId as string, usuario: payload.usuario as string }
  } catch {
    return null
  }
}

export async function getSessaoPortal(): Promise<PortalSession | null> {
  const cookieStore = await cookies()
  const token = cookieStore.get(COOKIE_NAME)?.value
  if (!token) return null
  return verificarSessao(token)
}

export { COOKIE_NAME }

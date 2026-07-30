import { NextRequest, NextResponse } from 'next/server'
import { jwtVerify } from 'jose'

const PORTAL_COOKIE = 'portal_session'
const ADMIN_COOKIE = 'admin_session'

const PORTAL_SECRET = new TextEncoder().encode(
  process.env.PORTAL_JWT_SECRET || 'xpslog-portal-secret-change-in-production'
)
const ADMIN_SECRET = new TextEncoder().encode(
  process.env.ADMIN_JWT_SECRET || 'xpslog-admin-secret-change-in-production'
)

async function isAdminAuthed(request: NextRequest): Promise<boolean> {
  const token = request.cookies.get(ADMIN_COOKIE)?.value
  if (!token) return false
  try { await jwtVerify(token, ADMIN_SECRET); return true } catch { return false }
}

async function isPortalAuthed(request: NextRequest): Promise<boolean> {
  const token = request.cookies.get(PORTAL_COOKIE)?.value
  if (!token) return false
  try { await jwtVerify(token, PORTAL_SECRET); return true } catch { return false }
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl

  // === PORTAL DO CLIENTE (páginas) ===
  if (pathname.startsWith('/portal') && pathname !== '/portal/login') {
    if (!(await isPortalAuthed(request))) {
      const res = NextResponse.redirect(new URL('/portal/login', request.url))
      res.cookies.delete(PORTAL_COOKIE)
      return res
    }
  }

  // === APIs exclusivas do admin (dashboard, analytics, notificações, email) ===
  const isAdminOnlyApi =
    pathname.startsWith('/api/dashboard') ||
    pathname.startsWith('/api/analytics') ||
    pathname.startsWith('/api/insights') ||
    pathname.startsWith('/api/email') ||
    pathname.startsWith('/api/notificacoes')

  if (isAdminOnlyApi) {
    if (!(await isAdminAuthed(request))) {
      return NextResponse.json({ error: 'Não autorizado' }, { status: 401 })
    }
  }

  // === APIs compartilhadas: admin OU portal autenticado podem chamar ===
  // Os route handlers internos controlam o que cada sessão pode ver/fazer
  const isSharedApi =
    pathname.startsWith('/api/clientes') ||
    pathname.startsWith('/api/fechamento') ||
    pathname.startsWith('/api/movimentacoes')

  if (isSharedApi) {
    const adminOk = await isAdminAuthed(request)
    const portalOk = adminOk || (await isPortalAuthed(request))
    if (!portalOk) {
      return NextResponse.json({ error: 'Não autorizado' }, { status: 401 })
    }
  }

  // === Páginas do dashboard administrativo ===
  const isAdminPage =
    pathname === '/' ||
    pathname.startsWith('/clientes') ||
    pathname.startsWith('/nfes') ||
    pathname.startsWith('/configuracoes')

  if (isAdminPage) {
    if (!(await isAdminAuthed(request))) {
      const res = NextResponse.redirect(new URL('/login', request.url))
      res.cookies.delete(ADMIN_COOKIE)
      return res
    }
  }

  return NextResponse.next()
}

export const config = {
  matcher: [
    '/',
    '/clientes/:path*',
    '/nfes/:path*',
    '/configuracoes/:path*',
    '/portal/:path*',
    '/api/dashboard/:path*',
    '/api/clientes/:path*',
    '/api/analytics/:path*',
    '/api/insights/:path*',
    '/api/email/:path*',
    '/api/movimentacoes/:path*',
    '/api/fechamento',
    '/api/fechamento/:path*',
    '/api/notificacoes/:path*',
  ],
}

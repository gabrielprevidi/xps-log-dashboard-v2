import { NextResponse } from 'next/server'
import { COOKIE_NAME } from '@/lib/portal-auth'

export const dynamic = 'force-dynamic'

export async function POST() {
  const response = NextResponse.json({ ok: true })
  response.cookies.delete(COOKIE_NAME)
  return response
}

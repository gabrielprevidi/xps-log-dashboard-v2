/**
 * Rota do sync manual da V1 — DESATIVADA NA V2.
 *
 * A V1 lia a caixa `xps.ai@exsa.srv.br` pelo Microsoft Graph quando alguém
 * clicava em "Sincronizar". A V2 lê `armazenagem@xpslog.com.br` por IMAP,
 * sozinha, a cada 15 minutos — ver `/api/cron/sync`.
 *
 * A rota continua existindo, em vez de simplesmente sumir, para que qualquer
 * botão ou atalho antigo receba uma explicação em vez de um 404 silencioso.
 */
import { NextResponse } from 'next/server'

const AVISO = {
  error: 'Sincronização manual desativada nesta versão',
  detalhe:
    'A V2 sincroniza sozinha a cada 15 minutos, lendo armazenagem@xpslog.com.br por IMAP. ' +
    'O status aparece no topo do dashboard. A sincronização manual pelo Microsoft Graph ' +
    'continua disponível na V1.',
}

export async function POST() {
  return NextResponse.json(AVISO, { status: 410 })
}

export async function GET() {
  return NextResponse.json({
    status: 'desativada',
    substituida_por: '/api/cron/sync',
    ...AVISO,
  })
}

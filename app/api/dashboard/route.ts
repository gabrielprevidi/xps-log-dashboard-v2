import { NextResponse } from 'next/server'
import {
  listarEmailsImportados,
  listarMovimentacoes,
  contarEmailsPorStatus,
} from '@/lib/supabase-service'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const [emails, movimentacoes, contagemEmails] = await Promise.all([
      listarEmailsImportados(50),
      listarMovimentacoes(100),
      contarEmailsPorStatus(),
    ])

    return NextResponse.json({ emails, movimentacoes, contagemEmails })
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || String(error) },
      { status: 500 }
    )
  }
}

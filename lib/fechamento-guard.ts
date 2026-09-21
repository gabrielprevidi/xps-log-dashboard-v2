import { getServerClient } from '@/lib/supabase'

/**
 * Bloqueio de meses fechados.
 *
 * Ao fechar um mês no painel administrativo o registro em `fechamento_mensal`
 * fica com status 'fechado' (ou 'nf_emitida'), e nenhuma alteração de dados
 * daquela competência é aceita até que o mês seja reaberto com a senha master.
 */

export const STATUS_BLOQUEADOS = ['fechado', 'nf_emitida'] as const

/** Erro de mês travado — os route handlers respondem 423 (Locked). */
export class MesFechadoError extends Error {
  readonly status = 423
  constructor(competencia: string) {
    super(`O mês ${competencia} está fechado. Reabra o mês (senha master) para fazer alterações.`)
    this.name = 'MesFechadoError'
  }
}

/** 'YYYY-MM' a partir de uma data ISO / Date. Retorna null se não houver data. */
export function competenciaDe(data?: string | Date | null): string | null {
  if (!data) return null
  const iso = typeof data === 'string' ? data : data.toISOString()
  const match = iso.match(/^(\d{4})-(\d{2})/)
  return match ? `${match[1]}-${match[2]}` : null
}

/** true se a competência do cliente está fechada. */
export async function mesBloqueado(clienteId?: string | null, competencia?: string | null): Promise<boolean> {
  if (!clienteId || !competencia) return false
  const supabase = getServerClient()
  const { data, error } = await supabase
    .from('fechamento_mensal')
    .select('status')
    .eq('cliente_id', clienteId)
    .eq('competencia', `${competencia}-01`)
    .maybeSingle()

  if (error || !data) return false
  return (STATUS_BLOQUEADOS as readonly string[]).includes(data.status)
}

/** Lança MesFechadoError se a competência estiver travada. */
export async function assertMesAberto(clienteId?: string | null, competencia?: string | null) {
  if (await mesBloqueado(clienteId, competencia)) {
    throw new MesFechadoError(competencia!)
  }
}

/**
 * Valida todas as competências afetadas por uma operação
 * (ex.: mover uma movimentação de um mês para outro).
 */
export async function assertMesesAbertos(clienteId: string | null | undefined, competencias: (string | null | undefined)[]) {
  const unicas = Array.from(new Set(competencias.filter(Boolean) as string[]))
  for (const c of unicas) await assertMesAberto(clienteId, c)
}

/** Status HTTP e mensagem para um erro qualquer vindo dos guards. */
export function respostaErro(error: any): { error: string; status: number } {
  return {
    error: error?.message || String(error),
    status: error instanceof MesFechadoError ? error.status : 500,
  }
}

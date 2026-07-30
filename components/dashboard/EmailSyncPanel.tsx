'use client'

import { useState } from 'react'
import { Mail, RefreshCw, CheckCircle, XCircle, Package, ChevronDown, ChevronUp } from 'lucide-react'
import { cn } from '@/lib/utils'

interface NFeInfo {
  numero: string
  chave: string
  data_emissao: string
  emitente: string
  destinatario: string
  natureza_operacao: string
  tipo_operacao: 'entrada' | 'saida'
  peso_liquido_ton: number
}

interface AnexoInfo {
  arquivo: string
  hash: string
  pallets_calculados: number | null
  nfe: NFeInfo | null
}


interface ResultadoSync {
  emails_lidos: number
  nfes_salvas: number
  duplicados: number
  erros: string[]
  detalhes: Array<{
    message_id: string
    assunto: string
    remetente: string
    data_recebimento: string
    movimentacoes_salvas: number
    duplicados: number
    nfes: AnexoInfo[]
  }>
}

export default function EmailSyncPanel({ onSyncComplete }: { onSyncComplete?: () => void }) {
  const [loading, setLoading] = useState(false)
  const [diasAtras, setDiasAtras] = useState(7)
  const [resultado, setResultado] = useState<ResultadoSync | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [expandido, setExpandido] = useState<string | null>(null)

  async function sincronizar() {
    setLoading(true)
    setErro(null)
    setResultado(null)

    try {
      const res = await fetch('/api/email/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dias_atras: diasAtras }),
      })

      const text = await res.text()
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let parsed: any
      try {
        parsed = JSON.parse(text)
      } catch {
        // Resposta não-JSON (ex: timeout da Vercel, erro de infra)
        const trecho = text.slice(0, 300).replace(/<[^>]+>/g, '').trim()
        throw new Error(trecho || 'Resposta inválida do servidor. Verifique os logs da Vercel.')
      }

      if (!res.ok) {
        throw new Error(parsed.detalhe || parsed.error || 'Falha na sincronização')
      }

      setResultado(parsed as ResultadoSync)
      onSyncComplete?.()
    } catch (err: any) {
      setErro(err.message || String(err))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="bg-white rounded-2xl border border-gray-100 p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-5">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-[#0d1b2e] flex items-center justify-center">
            <Mail className="w-5 h-5 text-white" />
          </div>
          <div>
            <h2 className="font-semibold text-[#0d1b2e]">Sincronização de Email</h2>
            <p className="text-xs text-gray-400">xps.ai@exsa.srv.br · Microsoft 365</p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <label className="text-xs text-gray-400">Período:</label>
            <select
              value={diasAtras}
              onChange={e => setDiasAtras(Number(e.target.value))}
              className="border border-gray-200 rounded-lg px-2 py-1.5 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-[#0d1b2e]/10"
              disabled={loading}
            >
              <option value={1}>Último dia</option>
              <option value={7}>Últimos 7 dias</option>
              <option value={15}>Últimos 15 dias</option>
              <option value={30}>Últimos 30 dias</option>
              <option value={60}>Últimos 60 dias</option>
            </select>
          </div>
          <button
            onClick={sincronizar}
            disabled={loading}
            className="flex items-center gap-2 bg-[#0d1b2e] text-white text-sm font-semibold px-4 py-2 rounded-xl hover:bg-[#1a3a5c] transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
          >
            <RefreshCw className={cn('w-4 h-4', loading && 'animate-spin')} />
            {loading ? 'Sincronizando...' : 'Sincronizar'}
          </button>
        </div>
      </div>

      {/* Erro */}
      {erro && (
        <div className="flex items-start gap-3 p-4 bg-red-50 rounded-xl mb-4">
          <XCircle className="w-5 h-5 text-red-500 shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-medium text-red-800">Erro na sincronização</p>
            <p className="text-xs text-red-600 mt-1">{erro}</p>
          </div>
        </div>
      )}

      {/* Resultado */}
      {resultado && (
        <>
          {/* Resumo */}
          <div className="grid grid-cols-3 gap-3 mb-5">
            <div className="bg-gray-50 rounded-xl p-4 text-center">
              <p className="text-2xl font-bold text-[#0d1b2e]">{resultado.emails_lidos}</p>
              <p className="text-xs text-gray-400 mt-1">Emails lidos</p>
            </div>
            <div className="bg-emerald-50 rounded-xl p-4 text-center">
              <p className="text-2xl font-bold text-emerald-700">{resultado.nfes_salvas}</p>
              <p className="text-xs text-emerald-600 mt-1">NFes salvas</p>
            </div>
            <div className="bg-amber-50 rounded-xl p-4 text-center">
              <p className="text-2xl font-bold text-amber-700">{resultado.duplicados}</p>
              <p className="text-xs text-amber-600 mt-1">Duplicados</p>
            </div>
          </div>

          {resultado.erros.length > 0 && (
            <div className="mb-4 p-3 bg-red-50 rounded-xl text-xs text-red-700 space-y-1">
              {resultado.erros.map((e, i) => <p key={i}>{e}</p>)}
            </div>
          )}

          {/* Lista de emails */}
          {resultado.detalhes.length === 0 ? (
            <div className="text-center py-8 text-gray-400">
              <Mail className="w-8 h-8 mx-auto mb-2 opacity-40" />
              <p className="text-sm">Nenhum email com NFe encontrado no período</p>
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              {resultado.detalhes.map((email) => (
                <div key={email.message_id} className="border border-gray-100 rounded-xl overflow-hidden">
                  <button
                    onClick={() =>
                      setExpandido(expandido === email.message_id ? null : email.message_id)
                    }
                    className="w-full flex items-center justify-between p-4 hover:bg-gray-50 text-left transition-colors"
                  >
                    <div className="flex items-center gap-3">
                      <CheckCircle className="w-5 h-5 text-emerald-500 shrink-0" />
                      <div>
                        <p className="text-sm font-medium text-[#0d1b2e]">{email.assunto}</p>
                        <p className="text-xs text-gray-400">
                          {email.remetente} ·{' '}
                          {new Date(email.data_recebimento).toLocaleString('pt-BR', {
                            day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit'
                          })}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs bg-blue-50 text-blue-700 px-2 py-1 rounded-full font-medium">
                        {email.nfes.length} NFe(s)
                      </span>
                      {expandido === email.message_id ? (
                        <ChevronUp className="w-4 h-4 text-gray-400" />
                      ) : (
                        <ChevronDown className="w-4 h-4 text-gray-400" />
                      )}
                    </div>
                  </button>

                  {expandido === email.message_id && (
                    <div className="border-t border-gray-50 p-4 bg-gray-50/50">
                      <div className="flex flex-col gap-3">
                        {email.nfes.map((anexo, i) => (
                          <div key={i} className="bg-white rounded-xl p-4 border border-gray-100">
                            <div className="flex items-center justify-between mb-3">
                              <span className="text-xs font-mono text-gray-500">{anexo.arquivo}</span>
                              {anexo.pallets_calculados !== null && (
                                <div className="flex items-center gap-1.5 bg-[#0d1b2e] text-white px-3 py-1 rounded-full">
                                  <Package className="w-3 h-3" />
                                  <span className="text-xs font-bold">{anexo.pallets_calculados} pallets</span>
                                </div>
                              )}
                            </div>
                            {anexo.nfe ? (
                              <div className="grid grid-cols-2 gap-2 text-xs">
                                <div>
                                  <span className="text-gray-400">NFe nº</span>
                                  <p className="font-semibold text-[#0d1b2e]">{anexo.nfe.numero}</p>
                                </div>
                                <div>
                                  <span className="text-gray-400">Data emissão</span>
                                  <p className="font-semibold text-[#0d1b2e]">
                                    {new Date(anexo.nfe.data_emissao + 'T12:00:00').toLocaleDateString('pt-BR')}
                                  </p>
                                </div>
                                <div>
                                  <span className="text-gray-400">Emitente</span>
                                  <p className="font-semibold text-[#0d1b2e] truncate">{anexo.nfe.emitente}</p>
                                </div>
                                <div>
                                  <span className="text-gray-400">Destinatário</span>
                                  <p className="font-semibold text-[#0d1b2e] truncate">{anexo.nfe.destinatario}</p>
                                </div>
                                <div>
                                  <span className="text-gray-400">Natureza</span>
                                  <p className="font-semibold text-[#0d1b2e] text-xs">{anexo.nfe.natureza_operacao || '—'}</p>
                                </div>
                                <div>
                                  <span className="text-gray-400">Tipo</span>
                                  <p className={cn(
                                    'font-semibold',
                                    anexo.nfe.tipo_operacao === 'entrada' ? 'text-blue-600' : 'text-orange-600'
                                  )}>
                                    {anexo.nfe.tipo_operacao === 'entrada' ? 'Entrada' : 'Saída'}
                                  </p>
                                </div>
                                <div>
                                  <span className="text-gray-400">Peso líquido</span>
                                  <p className="font-semibold text-[#0d1b2e]">
                                    {anexo.nfe.peso_liquido_ton.toFixed(3)} ton
                                  </p>
                                </div>
                              </div>
                            ) : (
                              <p className="text-xs text-red-500">Não foi possível extrair dados da NFe</p>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {/* Estado inicial */}
      {!resultado && !erro && !loading && (
        <div className="text-center py-8 text-gray-400">
          <Mail className="w-8 h-8 mx-auto mb-2 opacity-40" />
          <p className="text-sm">Clique em Sincronizar para ler os emails de NFe</p>
          <p className="text-xs mt-1">Serão verificados emails dos últimos {diasAtras} dias</p>
        </div>
      )}
    </div>
  )
}

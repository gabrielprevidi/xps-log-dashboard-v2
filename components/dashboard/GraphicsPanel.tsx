'use client'

import { useEffect, useState } from 'react'
import { resumoGraphicsMes, type GfxSku, type GfxMov } from '@/lib/graphics-saldo'

const n = (v: number) => v.toLocaleString('pt-BR', { maximumFractionDigits: 1 })

function mesLabel(anoMes: string) {
  const [a, m] = anoMes.split('-')
  const nomes = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro']
  return `${nomes[parseInt(m, 10) - 1]} de ${a}`
}

function dataBr(d: string) {
  const [a, m, dia] = d.split('-')
  return `${dia}/${m}/${a}`
}

/**
 * Avery Graphics — controle por CAIXAS (cobrança por palet).
 * Palet ocupado = CEIL(saldo do SKU / 30): só deixa de contar quando a última
 * caixa do palet sai.
 */
export default function GraphicsPanel({ clienteId, mesAtual }: { clienteId: string; mesAtual: string }) {
  const [skus, setSkus] = useState<GfxSku[]>([])
  const [movs, setMovs] = useState<GfxMov[]>([])
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState<string | null>(null)
  const [verMovs, setVerMovs] = useState(false)

  useEffect(() => {
    let vivo = true
    setCarregando(true)
    fetch(`/api/clientes/${clienteId}/graphics`)
      .then(async r => {
        const j = await r.json()
        if (!r.ok) throw new Error(j.error || 'Erro ao carregar o Graphics')
        return j
      })
      .then(j => { if (vivo) { setSkus(j.skus); setMovs(j.movimentacoes); setErro(null) } })
      .catch(e => { if (vivo) setErro(e.message) })
      .finally(() => { if (vivo) setCarregando(false) })
    return () => { vivo = false }
  }, [clienteId])

  const r = resumoGraphicsMes(skus, movs, mesAtual)
  const skuPorId = new Map(skus.map(s => [s.id, s]))
  const movsMes = movs
    .filter(m => m.data_mov.startsWith(mesAtual))
    .sort((a, b) => b.data_mov.localeCompare(a.data_mov))
  const temDados = movs.length > 0
  const temAjuste = r.caixasAjuste !== 0 || r.linhas.some(l => l.ajustes !== 0)

  return (
    <div className="bg-white rounded-2xl border border-gray-100 p-6 mb-6">
      <div className="flex items-start justify-between mb-4">
        <div>
          <h2 className="font-semibold text-[#0d1b2e]">Graphics — controle por caixas · {mesLabel(mesAtual)}</h2>
          <p className="text-xs text-gray-400 mt-0.5">
            Contagem por SKU em caixas, 30 caixas por palet. Um palet só sai quando 30 caixas do mesmo SKU
            são contabilizadas como saída (acumulado), mesmo que o palet de entrada fosse incompleto.
          </p>
        </div>
      </div>

      {carregando && <p className="text-sm text-gray-400 py-6 text-center">Carregando…</p>}
      {erro && <p className="text-sm text-red-600 py-4">{erro}</p>}

      {!carregando && !erro && !temDados && (
        <p className="text-sm text-gray-400 py-6 text-center">Nenhuma nota Graphics registrada ainda.</p>
      )}

      {!carregando && !erro && temDados && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
            <div className="rounded-xl bg-gray-50 p-4">
              <p className="text-xs text-gray-500">Caixas em estoque</p>
              <p className="text-2xl font-bold text-[#0d1b2e]">{n(r.caixasFim)}</p>
              <p className="text-xs text-gray-400 mt-1">início do mês: {n(r.caixasInicio)}</p>
            </div>
            <div className="rounded-xl bg-gray-50 p-4">
              <p className="text-xs text-gray-500">Palets ocupados (fim)</p>
              <p className="text-2xl font-bold text-[#0d1b2e]">{n(r.paletsFim)}</p>
              <p className="text-xs text-gray-400 mt-1">início do mês: {n(r.paletsInicio)}</p>
            </div>
            <div className="rounded-xl bg-blue-50 p-4">
              <p className="text-xs text-blue-700">Pico de palets no mês</p>
              <p className="text-2xl font-bold text-blue-900">{n(r.paletsPico)}</p>
              <p className="text-xs text-blue-600 mt-1">maior ocupação diária</p>
            </div>
            <div className="rounded-xl bg-gray-50 p-4">
              <p className="text-xs text-gray-500">Caixas no mês</p>
              <p className="text-sm font-semibold text-emerald-700">+{n(r.caixasEntrada)} entradas</p>
              <p className="text-sm font-semibold text-red-600">−{n(r.caixasSaida)} saídas</p>
            </div>
          </div>

          <div className="rounded-xl border border-gray-100 p-4 mb-5 text-sm">
            <p className="text-xs font-semibold text-gray-500 mb-2">Palets do mês: regra por SKU × declarados nas notas</p>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-gray-700">
              <div>Entrada por SKU: <strong>{n(r.paletsEntrada)}</strong></div>
              <div>Entrada declarada: <strong>{n(r.declaradosEntrada)}</strong></div>
              <div>Saída por SKU: <strong>{n(r.paletsSaida)}</strong></div>
              <div>Saída declarada: <strong>{n(r.declaradosSaida)}</strong></div>
            </div>
            <p className="text-xs text-gray-400 mt-2">
              “Por SKU”: entram CEIL(caixas ÷ 30) palets e saem FLOOR(caixas de saída acumuladas ÷ 30). “Declarado” é o número
              de palets informado nas NF-e (campo espécie). Podem diferir quando há palet incompleto ou misto.
            </p>
          </div>

          {r.skusNegativos.length > 0 && (
            <p className="text-xs text-amber-700 bg-amber-50 rounded-lg px-3 py-2 mb-4">
              Saldo negativo em {r.skusNegativos.join(', ')}: há saída sem entrada registrada. Falta o saldo inicial
              (ajuste) ou uma nota de entrada anterior.
            </p>
          )}

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs text-gray-500 border-b border-gray-100">
                  <th className="px-3 py-2 text-left">SKU</th>
                  <th className="px-3 py-2 text-left">Descrição</th>
                  <th className="px-3 py-2 text-right">Saldo inicial</th>
                  <th className="px-3 py-2 text-right">Entradas</th>
                  <th className="px-3 py-2 text-right">Saídas</th>
                  {temAjuste && <th className="px-3 py-2 text-right" title="Ajuste de inventário físico">Ajuste</th>}
                  <th className="px-3 py-2 text-right">Saldo final</th>
                  <th className="px-3 py-2 text-right">Palets</th>
                  <th className="px-3 py-2 text-right">Faltam p/ liberar palet</th>
                </tr>
              </thead>
              <tbody>
                {r.linhas.length === 0 && (
                  <tr><td colSpan={temAjuste ? 9 : 8} className="px-3 py-6 text-center text-gray-400">Sem SKUs com saldo ou movimento neste mês.</td></tr>
                )}
                {r.linhas.map(l => (
                  <tr key={l.sku.id} className="border-b border-gray-50">
                    <td className="px-3 py-2 font-mono text-xs text-gray-700 whitespace-nowrap">{l.sku.codigo}</td>
                    <td className="px-3 py-2 text-gray-500 max-w-[280px] truncate" title={l.sku.descricao ?? ''}>{l.sku.descricao}</td>
                    <td className="px-3 py-2 text-right">{n(l.saldoInicio)}</td>
                    <td className="px-3 py-2 text-right text-emerald-700">{l.entradas ? `+${n(l.entradas)}` : '—'}</td>
                    <td className="px-3 py-2 text-right text-red-600">{l.saidas ? `−${n(l.saidas)}` : '—'}</td>
                    {temAjuste && <td className="px-3 py-2 text-right text-gray-600">{l.ajustes ? `${l.ajustes > 0 ? '+' : '−'}${n(Math.abs(l.ajustes))}` : '—'}</td>}
                    <td className={`px-3 py-2 text-right font-semibold ${l.saldoFim < 0 ? 'text-amber-700' : ''}`}>{n(l.saldoFim)}</td>
                    <td className="px-3 py-2 text-right font-semibold text-[#0d1b2e]">{n(l.paletsFim)}</td>
                    <td className="px-3 py-2 text-right text-gray-500">{l.paletsFim > 0 ? l.faltamParaLiberar : '—'}</td>
                  </tr>
                ))}
              </tbody>
              {r.linhas.length > 0 && (
                <tfoot>
                  <tr className="text-sm font-semibold text-[#0d1b2e]">
                    <td colSpan={2} className="px-3 py-2">Total</td>
                    <td className="px-3 py-2 text-right">{n(r.caixasInicio)}</td>
                    <td className="px-3 py-2 text-right">+{n(r.caixasEntrada)}</td>
                    <td className="px-3 py-2 text-right">−{n(r.caixasSaida)}</td>
                    {temAjuste && <td className="px-3 py-2 text-right">{r.caixasAjuste >= 0 ? '+' : '−'}{n(Math.abs(r.caixasAjuste))}</td>}
                    <td className="px-3 py-2 text-right">{n(r.caixasFim)}</td>
                    <td className="px-3 py-2 text-right">{n(r.paletsFim)}</td>
                    <td />
                  </tr>
                </tfoot>
              )}
            </table>
          </div>

          <div className="mt-4">
            <button onClick={() => setVerMovs(v => !v)} className="text-xs font-semibold text-blue-700 hover:underline">
              {verMovs ? 'Ocultar' : 'Ver'} notas do mês ({movsMes.length})
            </button>
            {verMovs && (
              <div className="overflow-x-auto mt-2">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-gray-500 border-b border-gray-100">
                      <th className="px-3 py-2 text-left">Data</th>
                      <th className="px-3 py-2 text-left">NF-e</th>
                      <th className="px-3 py-2 text-left">SKU</th>
                      <th className="px-3 py-2 text-left">Tipo</th>
                      <th className="px-3 py-2 text-right">Caixas</th>
                    </tr>
                  </thead>
                  <tbody>
                    {movsMes.map(m => (
                      <tr key={m.id} className="border-b border-gray-50">
                        <td className="px-3 py-1.5 whitespace-nowrap">{dataBr(m.data_mov)}</td>
                        <td className="px-3 py-1.5 font-mono">{m.numero_nfe ?? '—'}</td>
                        <td className="px-3 py-1.5 font-mono">{skuPorId.get(m.sku_id)?.codigo ?? '—'}</td>
                        <td className="px-3 py-1.5">{m.inventario ? 'Inventário' : m.tipo === 'entrada' ? 'Entrada' : m.tipo === 'saida' ? 'Saída' : 'Ajuste'}</td>
                        <td className="px-3 py-1.5 text-right">{m.tipo === 'ajuste' && m.qtd_unidades > 0 ? '+' : ''}{n(m.qtd_unidades)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}

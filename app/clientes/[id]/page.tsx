'use client'

import { useEffect, useState, useCallback } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import {
  ArrowLeft, Edit2, X, Loader2, Package, ArrowDownToLine,
  ArrowUpFromLine, TrendingUp, ChevronLeft, ChevronRight,
  Save, AlertCircle, Lock, FileUp, CheckCircle, ExternalLink, Send, FileText,
  Pencil, Plus, Trash2, ShieldAlert, RotateCcw, Scissors, Download,
} from 'lucide-react'
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, Cell,
  ResponsiveContainer, LabelList, Legend,
} from 'recharts'
import { formatarMoeda, calcularPallets } from '@/lib/calculations'
import { valorPalletEfetivo } from '@/lib/cliente-calculos'

// ─────────────────────────────── types ───────────────────────────────

interface Movimentacao {
  id: string
  tipo_movimentacao: 'entrada' | 'saida'
  numero_nfe: string
  data_entrada: string | null
  data_saida: string | null
  qtd_entrada_ton: number | null
  qtd_saida_ton: number | null
  pallets_entrada: number | null
  pallets_saida: number | null
  fornecedor: string | null
  cliente_destino: string | null
  valor_manuseio: number | null
  cancelada: boolean | null
  produto_nome: string | null
  observacoes: string | null
  regra_fator_pallet: number | null
  created_at: string | null
  arquivos_nfe: { nome_emitente: string; nome_destinatario: string } | null
}

interface ClienteProdutoSimples {
  id: string
  nome: string
}

interface Fechamento {
  id: string
  competencia: string
  status: 'aberto' | 'fechado' | 'aprovado' | 'nf_emitida'
  arquivo_cobranca_url: string | null
  arquivo_cobranca_nome: string | null
  aprovado_em: string | null
}

interface SaldoMensal {
  id: string
  competencia: string
  volume_inicial: number
  valor_pallet: number | null
  percentual_imposto: number | null
}

interface Cliente {
  id: string
  nome: string
  nome_fantasia: string
  cnpj: string
  valor_pallet: number
  aliquota_imposto: number
  regra_fator_pallet: number
  cobrar_manuseio: boolean
  cobrar_separacao_sacaria: boolean
  modo_calculo?: string | null
}

interface CobrancaAdicional {
  id: string
  descricao: string
  valor: number
}

interface MovForm {
  tipo: 'entrada' | 'saida'
  data: string
  numero_nfe: string
  contraparte: string
  pallets: string
  toneladas: string
  valor_manuseio: string
}

const MOV_FORM_VAZIO: MovForm = {
  tipo: 'entrada', data: '', numero_nfe: '', contraparte: '',
  pallets: '', toneladas: '', valor_manuseio: '4.50',
}

// ─────────────────────────────── helpers ───────────────────────────────

function mesLabel(anoMes: string) {
  const [ano, mes] = anoMes.split('-')
  const nomes = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez']
  return `${nomes[+mes - 1]} ${ano}`
}

function anoMesDe(dataStr: string) {
  return dataStr.slice(0, 7)
}

function anoMesDeMovimentacao(m: Movimentacao) {
  return anoMesDe(m.data_entrada || m.data_saida || m.created_at || '')
}

function calcPPPico(volumeInicial: number, movs: Movimentacao[]) {
  // Agrupa por dia (igual ao gráfico) para evitar picos intradiários artificiais.
  // Ex: 3 entradas e 1 saída no mesmo dia não geram pico entre as entradas.
  const porDia: Record<string, number> = {}
  for (const m of movs) {
    const data = m.data_entrada || m.data_saida || ''
    if (!data) continue
    const delta = m.tipo_movimentacao === 'entrada'
      ? (m.pallets_entrada || 0)
      : -(m.pallets_saida || 0)
    porDia[data] = (porDia[data] || 0) + delta
  }
  let saldo = volumeInicial
  let pico = volumeInicial
  for (const data of Object.keys(porDia).sort()) {
    saldo += porDia[data]
    if (saldo > pico) pico = saldo
  }
  return pico
}

function gerarDadosGrafico(volumeInicial: number, movs: Movimentacao[], anoMes: string) {
  const [ano, mes] = anoMes.split('-').map(Number)
  const ultimoDia = new Date(ano, mes, 0).getDate()
  const porDia: Record<number, number> = {}
  for (const m of movs) {
    const data = m.data_entrada || m.data_saida || ''
    if (!data) continue  // movimentações sem data são ignoradas no gráfico diário
    const dia = parseInt(data.slice(8, 10))
    const delta = m.tipo_movimentacao === 'entrada'
      ? (m.pallets_entrada || 0)
      : -(m.pallets_saida || 0)
    porDia[dia] = (porDia[dia] || 0) + delta
  }
  let saldo = volumeInicial
  const dados: { dia: string; saldo: number }[] = []
  for (let d = 1; d <= ultimoDia; d++) {
    saldo += (porDia[d] || 0)
    dados.push({ dia: String(d).padStart(2, '0'), saldo: Math.max(0, saldo) })
  }
  return dados
}

function movToForm(mov: Movimentacao): MovForm {
  return {
    tipo: mov.tipo_movimentacao,
    data: (mov.data_entrada || mov.data_saida || '').slice(0, 10),
    numero_nfe: mov.numero_nfe || '',
    contraparte: (mov.tipo_movimentacao === 'entrada'
      ? (mov.fornecedor || mov.arquivos_nfe?.nome_emitente)
      : (mov.cliente_destino || mov.arquivos_nfe?.nome_destinatario)) || '',
    pallets: String(mov.pallets_entrada || mov.pallets_saida || ''),
    toneladas: String(mov.qtd_entrada_ton || mov.qtd_saida_ton || ''),
    valor_manuseio: String(mov.valor_manuseio ?? '4.50'),
  }
}

function formToPayload(form: MovForm, clienteId: string) {
  const pallets = parseInt(form.pallets) || 0
  const ton = parseFloat(form.toneladas) || null
  const vm = parseFloat(form.valor_manuseio) || null
  return {
    cliente_id: clienteId,
    tipo_movimentacao: form.tipo,
    numero_nfe: form.numero_nfe || null,
    fornecedor: form.tipo === 'entrada' ? (form.contraparte || null) : null,
    cliente_destino: form.tipo === 'saida' ? (form.contraparte || null) : null,
    data_entrada: form.tipo === 'entrada' ? (form.data || null) : null,
    data_saida: form.tipo === 'saida' ? (form.data || null) : null,
    pallets_entrada: form.tipo === 'entrada' ? pallets : null,
    pallets_saida: form.tipo === 'saida' ? pallets : null,
    qtd_entrada_ton: form.tipo === 'entrada' ? ton : null,
    qtd_saida_ton: form.tipo === 'saida' ? ton : null,
    valor_manuseio: vm,
  }
}

// Inline form row for editing a movimentação. Precisa ficar no escopo do
// módulo (fora de ClienteDetailPage): definir componentes dentro do corpo de
// outro componente faz o React tratá-los como um tipo novo a cada render,
// desmontando o <tr>/<input> inteiro a cada tecla digitada (o input perde o
// foco e cada caractere exige clicar no campo de novo).
function MovFormRow({ f, setF, onSave, onCancel, saving }: {
  f: MovForm
  setF: (v: MovForm) => void
  onSave: () => void
  onCancel: () => void
  saving: boolean
}) {
  return (
    <tr className="bg-blue-50/50 border-y border-blue-200">
      <td className="px-2 py-2">
        <input
          type="date"
          value={f.data}
          onChange={e => setF({ ...f, data: e.target.value })}
          className="w-32 border border-gray-200 rounded-lg px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-blue-400"
        />
      </td>
      <td className="px-2 py-2">
        <input
          type="text"
          placeholder="NF#"
          value={f.numero_nfe}
          onChange={e => setF({ ...f, numero_nfe: e.target.value })}
          className="w-24 border border-gray-200 rounded-lg px-2 py-1 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-blue-400"
        />
      </td>
      <td className="px-2 py-2">
        <select
          value={f.tipo}
          onChange={e => setF({ ...f, tipo: e.target.value as 'entrada' | 'saida' })}
          className="border border-gray-200 rounded-lg px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-blue-400"
        >
          <option value="entrada">Entrada</option>
          <option value="saida">Saída</option>
        </select>
      </td>
      <td className="px-2 py-2">
        <input
          type="text"
          placeholder="Fornecedor / Destino"
          value={f.contraparte}
          onChange={e => setF({ ...f, contraparte: e.target.value })}
          className="w-36 border border-gray-200 rounded-lg px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-blue-400"
        />
      </td>
      <td className="px-2 py-2">
        <input
          type="number"
          placeholder="0.000"
          step="0.001"
          value={f.toneladas}
          onChange={e => setF({ ...f, toneladas: e.target.value })}
          className="w-20 border border-gray-200 rounded-lg px-2 py-1 text-xs text-right focus:outline-none focus:ring-2 focus:ring-blue-400"
        />
      </td>
      <td className="px-2 py-2">
        <input
          type="number"
          placeholder="0"
          value={f.pallets}
          onChange={e => setF({ ...f, pallets: e.target.value })}
          className="w-16 border border-gray-200 rounded-lg px-2 py-1 text-xs text-right focus:outline-none focus:ring-2 focus:ring-blue-400"
        />
      </td>
      <td className="px-2 py-2 text-right">
        <div className="flex items-center justify-end gap-1">
          <button
            onClick={onSave}
            disabled={saving}
            className="p-1.5 rounded-lg bg-emerald-500 text-white hover:bg-emerald-600 disabled:opacity-50"
            title="Salvar"
          >
            {saving ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />}
          </button>
          <button
            onClick={onCancel}
            className="p-1.5 rounded-lg border border-gray-200 text-gray-500 hover:bg-gray-100"
            title="Cancelar"
          >
            <X size={12} />
          </button>
        </div>
      </td>
    </tr>
  )
}

// ─────────────────────────────── component ───────────────────────────────

export default function ClienteDetailPage() {
  const params = useParams()
  const id = params.id as string

  const [cliente, setCliente] = useState<Cliente | null>(null)
  const [todasMovs, setTodasMovs] = useState<Movimentacao[]>([])
  const [saldosMensais, setSaldosMensais] = useState<SaldoMensal[]>([])
  const [clienteProdutos, setClienteProdutos] = useState<ClienteProdutoSimples[]>([])
  const [loading, setLoading] = useState(true)
  const [erro, setErro] = useState<string | null>(null)

  const [mesAtual, setMesAtual] = useState(() => {
    const now = new Date()
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
  })

  // modals / editing
  const [editando, setEditando] = useState(false)
  const [salvando, setSalvando] = useState(false)
  const [form, setForm] = useState({ nome_fantasia: '', nome: '', cnpj: '', valor_pallet: '', aliquota_imposto: '', regra_fator_pallet: '' })

  // fechamento do mês
  const [fechamentos, setFechamentos] = useState<Fechamento[]>([])
  const [fechandoMes, setFechandoMes] = useState(false)
  const [enviandoFechamento, setEnviandoFechamento] = useState(false)
  const [anexandoNF, setAnexandoNF] = useState(false)
  const [arquivoNF, setArquivoNF] = useState<File | null>(null)
  const [enviandoNF, setEnviandoNF] = useState(false)

  // reabrir mês
  const [reabrindoMes, setReabrindoMes] = useState(false)
  const [senhaReabrir, setSenhaReabrir] = useState('')
  const [erroReabrir, setErroReabrir] = useState<string | null>(null)
  const [enviandoReabrir, setEnviandoReabrir] = useState(false)

  // estoque inicial inline edit
  const [editandoEstoque, setEditandoEstoque] = useState(false)
  const [estoqueInput, setEstoqueInput] = useState('')
  const [salvandoEstoque, setSalvandoEstoque] = useState(false)

  // manuseio editing (local, salva on blur)
  const [manuseioLocal, setManuseioLocal] = useState<Record<string, string>>({})

  // fator pallet editável por linha (local, salva on blur)
  const [fatorLocal, setFatorLocal] = useState<Record<string, string>>({})

  // edit movimentação inline
  const [editandoMovId, setEditandoMovId] = useState<string | null>(null)
  const [editMovForm, setEditMovForm] = useState<MovForm>(MOV_FORM_VAZIO)
  const [salvandoMovId, setSalvandoMovId] = useState<string | null>(null)

  // nova movimentação
  const [adicionandoMov, setAdicionandoMov] = useState(false)
  const [novaMovForm, setNovaMovForm] = useState<MovForm>(MOV_FORM_VAZIO)
  const [salvandoNovaMov, setSalvandoNovaMov] = useState(false)

  // cobranças adicionais
  const [cobrancasAdicionais, setCobrancasAdicionais] = useState<CobrancaAdicional[]>([])
  const [novaCobrancaDesc, setNovaCobrancaDesc] = useState('')
  const [novaCobrancaValor, setNovaCobrancaValor] = useState('')
  const [adicionandoCobranca, setAdicionandoCobranca] = useState(false)
  const [salvandoCobranca, setSalvandoCobranca] = useState(false)
  const [excluindoCobrancaId, setExcluindoCobrancaId] = useState<string | null>(null)

  // dividir movimentação da separação em N partes iguais
  const [dividindoMov, setDividindoMov] = useState<Movimentacao | null>(null)
  const [dividirPartes, setDividirPartes] = useState('2')
  const [salvandoDivisao, setSalvandoDivisao] = useState(false)

  // edição de linha de excedente (virtual → movimento real)
  const [editandoExcedente, setEditandoExcedente] = useState<string | null>(null) // parentMovId
  const [editExcForm, setEditExcForm] = useState({ ton: '', contraparte: '' })
  const [salvandoExcedente, setSalvandoExcedente] = useState(false)

  // nova linha manual na seção Separação por Unidade de Sacaria
  const [adicionandoSeparacao, setAdicionandoSeparacao] = useState(false)
  const [novaSepForm, setNovaSepForm] = useState({ data: '', numero_nfe: '', tipo: 'saida' as 'entrada' | 'saida', contraparte: '', toneladas: '' })
  const [salvandoSep, setSalvandoSep] = useState(false)

  // limpar dados do cliente
  const [confirmandoLimpeza, setConfirmandoLimpeza] = useState(false)
  const [limpandoDados, setLimpandoDados] = useState(false)
  const [resultadoLimpeza, setResultadoLimpeza] = useState<{ movimentacoes: number; arquivos: number } | null>(null)

  // exportar planilha Excel
  const [exportando, setExportando] = useState(false)

  // filtros da tabela de movimentações (apenas visual — não afeta totais/cobrança)
  const [filtroTipo, setFiltroTipo] = useState<'todos' | 'entrada' | 'saida'>('todos')
  const [filtroCategorias, setFiltroCategorias] = useState<Set<string>>(new Set())

  // ── load ──
  const carregarDados = useCallback(async () => {
    setLoading(true); setErro(null)
    try {
      const [resCliente, resSaldos, resFechamentos, resProdutos] = await Promise.all([
        fetch(`/api/clientes/${id}`),
        fetch(`/api/clientes/${id}/saldos`),
        fetch(`/api/fechamento?cliente_id=${id}`),
        fetch(`/api/clientes/${id}/produtos`),
      ])
      const dataCliente = await resCliente.json()
      const dataSaldos = await resSaldos.json()
      const dataFechamentos = await resFechamentos.json()
      const dataProdutos = await resProdutos.json()
      if (dataCliente.error) throw new Error(dataCliente.error)
      setCliente(dataCliente.cliente)
      // Ordena por data real da NF-e (entrada ou saída), mais recente primeiro
      const movOrdenadas = [...(dataCliente.movimentacoes ?? [])].sort((a: Movimentacao, b: Movimentacao) => {
        const da = a.data_entrada || a.data_saida || a.created_at || ''
        const db = b.data_entrada || b.data_saida || b.created_at || ''
        return db.localeCompare(da)
      })
      setTodasMovs(movOrdenadas)
      setSaldosMensais(Array.isArray(dataSaldos) ? dataSaldos : [])
      setFechamentos(Array.isArray(dataFechamentos) ? dataFechamentos : [])
      setClienteProdutos(Array.isArray(dataProdutos) ? dataProdutos : [])
    } catch (e: any) { setErro(e.message) }
    finally { setLoading(false) }
  }, [id])

  useEffect(() => { carregarDados() }, [carregarDados])

  // ── cobranças adicionais por mês ──
  const carregarCobrancas = useCallback(async () => {
    try {
      const res = await fetch(`/api/clientes/${id}/cobrancas?competencia=${mesAtual}`)
      if (res.ok) {
        const data = await res.json()
        setCobrancasAdicionais(Array.isArray(data) ? data : [])
      }
    } catch { /* silently ignore */ }
  }, [id, mesAtual])

  useEffect(() => { carregarCobrancas() }, [carregarCobrancas])

  // separacaoComPallet: observacoes pode ter múltiplas flags separadas por "|"
  const separacaoComPallet = new Set(
    todasMovs.filter(m => m.observacoes?.includes('conta_como_pallet')).map(m => m.id)
  )
  // excedentes já convertidos em movimento real (não mostrar virtual novamente)
  const excessosDismissidos = new Set(
    todasMovs.filter(m => m.observacoes?.includes('excedente_ok')).map(m => m.id)
  )
  // excedente promovido a 1 pallet (conta na armazenagem, sai da separação)
  const excedentePalletSet = new Set(
    todasMovs.filter(m => m.observacoes?.includes('excedente_pallet')).map(m => m.id)
  )
  // excedente excluído (não cobra separação nem vira pallet)
  const excedenteExcluidoSet = new Set(
    todasMovs.filter(m => m.observacoes?.includes('excedente_excluido')).map(m => m.id)
  )

  // ── derived ──
  const mesesComDados = Array.from(new Set([
    ...todasMovs.map(m => anoMesDeMovimentacao(m)).filter(Boolean),
    mesAtual,
  ])).sort().reverse()

  // movimentações ativas do mês (excluindo canceladas para cálculos)
  const movsDoMesAtivas = todasMovs.filter(m =>
    anoMesDeMovimentacao(m) === mesAtual && !m.cancelada
  )
  // todas do mês para exibição (incluindo canceladas)
  const movsDoMesTodas = todasMovs.filter(m =>
    anoMesDeMovimentacao(m) === mesAtual
  )

  // ── separação por unidade de sacaria ──
  // Critério: cliente tem cobrar_separacao_sacaria = true (ex: Alphalum)
  // + tonnage > 0 e < fator salvo no banco por linha
  //
  // IMPORTANTE: usa apenas o valor do banco (m.regra_fator_pallet),
  // nunca fatorLocal. Isso evita que o input seja desmontado enquanto
  // o usuário ainda está digitando — se o input sumisse antes do onBlur,
  // o fetch nunca seria disparado e o valor não seria salvo.
  // O item só muda de seção APÓS o save ser confirmado pelo banco.
  const getMovFatorDB = (m: Movimentacao) =>
    m.regra_fator_pallet ?? cliente?.regra_fator_pallet ?? 1.2

  const movsParaSeparacao = movsDoMesAtivas.filter(m =>
    cliente?.cobrar_separacao_sacaria === true &&
    m.tipo_movimentacao === 'saida' &&
    (m.qtd_saida_ton ?? 0) > 0 &&
    (m.qtd_saida_ton ?? 0) < getMovFatorDB(m)
  )
  const idsSeparacao = new Set(movsParaSeparacao.map(m => m.id))

  // Helper: fator efetivo por linha (local editado > DB > padrão do cliente)
  function getMovFator(movId: string, movFatorDb: number | null | undefined): number {
    const local = fatorLocal[movId]
    if (local !== undefined) { const f = parseFloat(local); if (!isNaN(f) && f > 0) return f }
    return movFatorDb ?? cliente?.regra_fator_pallet ?? 1.2
  }

  // ── filtro visual da tabela de movimentações (tipo e/ou categoria) ──
  // Apenas filtra a EXIBIÇÃO da tabela — não altera totais, gráfico nem cobrança.
  const movsTabelaBase = movsDoMesTodas.filter(m => !idsSeparacao.has(m.id) || separacaoComPallet.has(m.id))
  const categoriasDisponiveis = Array.from(
    new Set(movsTabelaBase.map(m => m.produto_nome || '(Sem categoria)'))
  ).sort((a, b) => a === '(Sem categoria)' ? 1 : b === '(Sem categoria)' ? -1 : a.localeCompare(b))
  const movsTabela = movsTabelaBase.filter(m => {
    if (filtroTipo !== 'todos' && m.tipo_movimentacao !== filtroTipo) return false
    if (filtroCategorias.size > 0 && !filtroCategorias.has(m.produto_nome || '(Sem categoria)')) return false
    return true
  })
  const filtrosAtivos = filtroTipo !== 'todos' || filtroCategorias.size > 0
  const toggleCategoria = (cat: string) => setFiltroCategorias(prev => {
    const next = new Set(prev)
    if (next.has(cat)) next.delete(cat); else next.add(cat)
    return next
  })

  // Movimentações para contabilização de pallets:
  // - exclui itens de separação, EXCETO os que foram promovidos (+Pallet)
  // - para clientes Alphalum: corrige contagem para floor(ton/fator) em vez de ceil
  const movsParaContabilizacao = movsDoMesAtivas
    .filter(m => !idsSeparacao.has(m.id) || separacaoComPallet.has(m.id))
    .map(m => {
      if (!cliente?.cobrar_separacao_sacaria) return m
      const ton = m.qtd_entrada_ton ?? m.qtd_saida_ton ?? 0
      const fator = getMovFator(m.id, m.regra_fator_pallet)
      if (ton <= fator || ton <= 0) return m
      let pf = Math.floor(Math.round((ton / fator) * 1e10) / 1e10)
      // Excedente promovido a pallet: soma 1 pallet (o resto vira ocupação, não separação)
      if (excedentePalletSet.has(m.id)) pf += 1
      return {
        ...m,
        pallets_entrada: m.tipo_movimentacao === 'entrada' ? pf : m.pallets_entrada,
        pallets_saida:   m.tipo_movimentacao === 'saida'   ? pf : m.pallets_saida,
      }
    })

  // Excedentes de tonelagem → vão para Separação (quando ton não é múltiplo exato do fator)
  // Ex: 15t, fator=1,2 → floor=12 pallets (14,4t) + excedente 0,6t → Separação
  const excessosSeparacao: Array<{
    movId: string; nfe: string | null; data: string | null
    contraparte: string; produto_nome: string | null; excessoTon: number; fator: number
    status: 'normal' | 'pallet' | 'excluido'
  }> = cliente?.cobrar_separacao_sacaria
    ? movsDoMesAtivas
        .filter(m => !idsSeparacao.has(m.id) && !excessosDismissidos.has(m.id) && m.tipo_movimentacao === 'saida')
        .flatMap(m => {
          const ton = m.qtd_saida_ton ?? 0
          // Usa apenas o fator salvo no banco (não fatorLocal) — o input de fator
          // do excedente não pode desmontar a linha enquanto o usuário digita.
          const fator = getMovFatorDB(m)
          if (ton <= fator || ton <= 0) return []
          const pf  = Math.floor(Math.round((ton / fator) * 1e10) / 1e10)
          const exc = Math.round((ton - pf * fator) * 1e10) / 1e10
          if (exc < 0.001) return []
          const contraparte = m.tipo_movimentacao === 'entrada'
            ? (m.fornecedor || m.arquivos_nfe?.nome_emitente || '—')
            : (m.cliente_destino || m.arquivos_nfe?.nome_destinatario || '—')
          const status: 'normal' | 'pallet' | 'excluido' =
            excedentePalletSet.has(m.id) ? 'pallet'
            : excedenteExcluidoSet.has(m.id) ? 'excluido' : 'normal'
          return [{ movId: m.id, nfe: m.numero_nfe, data: m.data_entrada || m.data_saida, contraparte, produto_nome: m.produto_nome, excessoTon: exc, fator, status }]
        })
    : []

  // total de cobrança da separação (itens regulares + excedentes NORMAIS e
  // promovidos a pallet; apenas excedentes excluídos não entram na separação)
  const totalSeparacao =
    movsParaSeparacao.reduce((s, m) => {
      const ton = m.qtd_entrada_ton ?? m.qtd_saida_ton ?? 0
      return s + (ton * 1000 / 25) * 4.5
    }, 0) +
    excessosSeparacao.filter(e => e.status !== 'excluido').reduce((s, e) => s + (Math.round(e.excessoTon * 1000 / 25 * 100) / 100) * 4.5, 0)

  const saldoMes = saldosMensais.find(s => s.competencia.slice(0, 7) === mesAtual)

  const volumeInicial = (() => {
    if (saldoMes) return saldoMes.volume_inicial
    const mesesOrdenados = [...mesesComDados].sort()
    const idx = mesesOrdenados.indexOf(mesAtual)
    if (idx === 0) return 0
    const mesAnterior = mesesOrdenados[idx - 1]
    const saldoAnterior = saldosMensais.find(s => s.competencia.slice(0, 7) === mesAnterior)
    const volInicialAnterior = saldoAnterior?.volume_inicial ?? 0
    const movsAnterior = todasMovs.filter(m =>
      anoMesDeMovimentacao(m) === mesAnterior && !m.cancelada
    )
    const entradas = movsAnterior.reduce((s, m) => s + (m.pallets_entrada || 0), 0)
    const saidas = movsAnterior.reduce((s, m) => s + (m.pallets_saida || 0), 0)
    return volInicialAnterior + entradas - saidas
  })()

  const aliquota = saldoMes?.percentual_imposto ?? cliente?.aliquota_imposto ?? 2

  const totalEntradas = movsParaContabilizacao.reduce((s, m) => s + (m.pallets_entrada || 0), 0)
  const totalSaidas = movsParaContabilizacao.reduce((s, m) => s + (m.pallets_saida || 0), 0)
  const saldoFinal = volumeInicial + totalEntradas - totalSaidas
  const ppPico = calcPPPico(volumeInicial, movsParaContabilizacao)

  // Fedrigoni: valor por pallet pela tabela de faixa de PP Pico (depende do pico).
  const valorPallet = valorPalletEfetivo({
    modoCalculo: cliente?.modo_calculo,
    ppPico,
    valorManual: saldoMes?.valor_pallet,
    valorCliente: cliente?.valor_pallet,
  })
  const armazBase = ppPico * valorPallet
  const armazTotal = armazBase * (1 + aliquota / 100)

  // ── resumo por categoria de produto ──
  const temCategorias = clienteProdutos.length > 0
  const resumoPorCategoria = (() => {
    if (!temCategorias) return []
    const map = new Map<string, { nome: string; entradas: number; entradasTon: number; saidas: number; saidasTon: number }>()
    for (const mov of movsParaContabilizacao) {
      const key = mov.produto_nome || '(Sem categoria)'
      if (!map.has(key)) map.set(key, { nome: key, entradas: 0, entradasTon: 0, saidas: 0, saidasTon: 0 })
      const entry = map.get(key)!
      if (mov.tipo_movimentacao === 'entrada') {
        entry.entradas += mov.pallets_entrada || 0
        entry.entradasTon += mov.qtd_entrada_ton || 0
      } else {
        entry.saidas += mov.pallets_saida || 0
        entry.saidasTon += mov.qtd_saida_ton || 0
      }
    }
    return Array.from(map.values()).sort((a, b) => {
      if (a.nome === '(Sem categoria)') return 1
      if (b.nome === '(Sem categoria)') return -1
      return a.nome.localeCompare(b.nome)
    })
  })()

  const totalManuseio = movsParaContabilizacao.reduce((s, m) => {
    const pallets = m.pallets_entrada || m.pallets_saida || 0
    const vm = parseFloat(manuseioLocal[m.id] ?? String(m.valor_manuseio ?? 4.5))
    return s + pallets * vm
  }, 0)

  const totalCobrancasAdicionais = cobrancasAdicionais.reduce((s, c) => s + c.valor, 0)

  // ── actions ──
  function abrirEdicao() {
    if (!cliente) return
    setForm({ nome_fantasia: cliente.nome_fantasia, nome: cliente.nome, cnpj: cliente.cnpj, valor_pallet: String(cliente.valor_pallet), aliquota_imposto: String(cliente.aliquota_imposto), regra_fator_pallet: String(cliente.regra_fator_pallet) })
    setEditando(true)
  }

  async function salvarEdicao() {
    setSalvando(true)
    try {
      const res = await fetch(`/api/clientes/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ nome_fantasia: form.nome_fantasia, nome: form.nome, cnpj: form.cnpj, valor_pallet: parseFloat(form.valor_pallet), aliquota_imposto: parseFloat(form.aliquota_imposto), regra_fator_pallet: parseFloat(form.regra_fator_pallet) }) })
      const data = await res.json()
      if (data.error) throw new Error(data.error)
      setCliente(data)
      setEditando(false)
    } catch (e: any) { alert('Erro: ' + e.message) }
    finally { setSalvando(false) }
  }

  async function salvarEdicao_SeparacaoToggle() {
    if (!cliente) return
    const novoValor = !cliente.cobrar_separacao_sacaria
    try {
      const res = await fetch(`/api/clientes/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ cobrar_separacao_sacaria: novoValor }) })
      const data = await res.json()
      if (data.error) throw new Error(data.error)
      setCliente(data)
    } catch (e: any) { alert('Erro ao atualizar: ' + e.message) }
  }

  async function salvarEstoqueInicial() {
    setSalvandoEstoque(true)
    try {
      const vol = parseInt(estoqueInput)
      if (isNaN(vol)) throw new Error('Valor inválido')
      const competencia = `${mesAtual}-01`
      const res = await fetch(`/api/clientes/${id}/saldos`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ competencia, volume_inicial: vol }) })
      const data = await res.json()
      if (data.error) throw new Error(data.error)
      setSaldosMensais(prev => {
        const sem = prev.filter(s => s.competencia.slice(0, 7) !== mesAtual)
        return [...sem, data]
      })
      setEditandoEstoque(false)
    } catch (e: any) { alert('Erro: ' + e.message) }
    finally { setSalvandoEstoque(false) }
  }

  // Salva nova linha manual na Separação por Unidade de Sacaria
  async function salvarNovaSeparacao() {
    const ton = parseFloat(novaSepForm.toneladas.replace(',', '.'))
    if (!novaSepForm.data || isNaN(ton) || ton <= 0 || ton > 1.2) {
      alert('Preencha a data e uma tonelagem entre 0,001 e 1,200 ton.')
      return
    }
    setSalvandoSep(true)
    try {
      const pallets = calcularPallets(ton)
      const payload = {
        cliente_id: id,
        tipo_movimentacao: novaSepForm.tipo,
        numero_nfe: novaSepForm.numero_nfe || null,
        fornecedor: novaSepForm.tipo === 'entrada' ? (novaSepForm.contraparte || null) : null,
        cliente_destino: novaSepForm.tipo === 'saida' ? (novaSepForm.contraparte || null) : null,
        data_entrada: novaSepForm.tipo === 'entrada' ? (novaSepForm.data || null) : null,
        data_saida: novaSepForm.tipo === 'saida' ? (novaSepForm.data || null) : null,
        qtd_entrada_ton: novaSepForm.tipo === 'entrada' ? ton : null,
        qtd_saida_ton: novaSepForm.tipo === 'saida' ? ton : null,
        pallets_entrada: novaSepForm.tipo === 'entrada' ? pallets : null,
        pallets_saida: novaSepForm.tipo === 'saida' ? pallets : null,
        valor_manuseio: 0,
      }
      const res = await fetch('/api/movimentacoes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const data = await res.json()
      if (data.error) throw new Error(data.error)
      setTodasMovs(prev => [data, ...prev])
      setAdicionandoSeparacao(false)
      setNovaSepForm({ data: '', numero_nfe: '', tipo: 'saida', contraparte: '', toneladas: '' })
    } catch (e: any) {
      alert('Erro ao salvar: ' + e.message)
    } finally {
      setSalvandoSep(false)
    }
  }

  // Salva excedente virtual como movimento real e marca o pai como dismissido
  async function salvarExcedente(parentMovId: string) {
    const exc = excessosSeparacao.find(e => e.movId === parentMovId)
    const parentMov = todasMovs.find(m => m.id === parentMovId)
    if (!exc || !parentMov) return
    const ton = parseFloat(editExcForm.ton.replace(',', '.'))
    if (isNaN(ton) || ton <= 0) { alert('Informe uma tonelagem válida.'); return }
    setSalvandoExcedente(true)
    try {
      // 1. Cria movimento real para o excedente
      const payload = {
        cliente_id: id,
        tipo_movimentacao: parentMov.tipo_movimentacao,
        numero_nfe: exc.nfe,
        fornecedor: parentMov.tipo_movimentacao === 'entrada' ? (editExcForm.contraparte || exc.contraparte) : null,
        cliente_destino: parentMov.tipo_movimentacao === 'saida' ? (editExcForm.contraparte || exc.contraparte) : null,
        data_entrada: parentMov.tipo_movimentacao === 'entrada' ? exc.data : null,
        data_saida: parentMov.tipo_movimentacao === 'saida' ? exc.data : null,
        qtd_entrada_ton: parentMov.tipo_movimentacao === 'entrada' ? ton : null,
        qtd_saida_ton: parentMov.tipo_movimentacao === 'saida' ? ton : null,
        pallets_entrada: parentMov.tipo_movimentacao === 'entrada' ? calcularPallets(ton) : null,
        pallets_saida: parentMov.tipo_movimentacao === 'saida' ? calcularPallets(ton) : null,
        valor_manuseio: 0,
      }
      const res = await fetch('/api/movimentacoes', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
      const data = await res.json()
      if (data.error) throw new Error(data.error)
      setTodasMovs(prev => [data, ...prev])
      // 2. Marca o pai como excedente-registrado (dismissido)
      const flags = (parentMov.observacoes ?? '').split('|').filter(Boolean)
      if (!flags.includes('excedente_ok')) flags.push('excedente_ok')
      const novoObs = flags.join('|') || null
      await fetch(`/api/movimentacoes/${parentMovId}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ observacoes: novoObs }) })
      setTodasMovs(prev => prev.map(m => m.id === parentMovId ? { ...m, observacoes: novoObs } : m))
      setEditandoExcedente(null)
    } catch (e: any) { alert('Erro: ' + e.message) }
    finally { setSalvandoExcedente(false) }
  }

  // Define o tratamento de um EXCEDENTE: 'pallet' (vira 1 pallet na armazenagem),
  // 'excluido' (não cobra nada) ou 'normal' (volta a cobrar como separação).
  // Flags mutuamente exclusivas; preserva as demais flags em observacoes.
  async function alternarExcedente(parentMovId: string, modo: 'pallet' | 'excluido' | 'normal') {
    const mov = todasMovs.find(m => m.id === parentMovId)
    if (!mov) return
    const flags = (mov.observacoes ?? '').split('|').map(s => s.trim())
      .filter(f => f && f !== 'excedente_pallet' && f !== 'excedente_excluido')
    if (modo === 'pallet') flags.push('excedente_pallet')
    else if (modo === 'excluido') flags.push('excedente_excluido')
    const novoObs = flags.join('|') || null
    setTodasMovs(prev => prev.map(m => m.id === parentMovId ? { ...m, observacoes: novoObs } : m))
    await fetch(`/api/movimentacoes/${parentMovId}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ observacoes: novoObs }) })
  }

  // Adiciona/remove um item de Separação da contabilização de pallets (preserva outras flags)
  async function alternarPallet(movId: string, adicionar: boolean) {
    const mov = todasMovs.find(m => m.id === movId)
    const flags = (mov?.observacoes ?? '').split('|').filter(Boolean)
    if (adicionar) { if (!flags.includes('conta_como_pallet')) flags.push('conta_como_pallet') }
    else { const idx = flags.indexOf('conta_como_pallet'); if (idx >= 0) flags.splice(idx, 1) }
    const novoObs = flags.join('|') || null
    setTodasMovs(prev => prev.map(m => m.id === movId ? { ...m, observacoes: novoObs } : m))
    await fetch(`/api/movimentacoes/${movId}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ observacoes: novoObs }) })
  }

  async function salvarFatorPallet(movId: string, fatorDireto?: number) {
    if (mesAprovado) return
    const mov = todasMovs.find(m => m.id === movId)
    if (!mov) return
    // Usa o valor vindo direto do DOM (fatorDireto) para evitar closure stale:
    // o onBlur pode capturar fatorLocal antes do setState do onChange ser aplicado.
    const fator = (fatorDireto !== undefined && !isNaN(fatorDireto) && fatorDireto > 0)
      ? fatorDireto
      : getMovFator(movId, mov.regra_fator_pallet)
    if (!fator || fator <= 0) return
    const ton = mov.qtd_entrada_ton ?? mov.qtd_saida_ton ?? 0
    const newPallets = ton > 0 ? Math.ceil(Math.round((ton / fator) * 1e10) / 1e10) : 0
    try {
      const res = await fetch(`/api/movimentacoes/${movId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          regra_fator_pallet: fator,
          ...(mov.tipo_movimentacao === 'entrada' ? { pallets_entrada: newPallets } : { pallets_saida: newPallets }),
        }),
      })
      const data = await res.json()
      if (data.error) throw new Error(data.error)
      // Atualiza o estado com o dado confirmado pelo banco
      setTodasMovs(prev => prev.map(m =>
        m.id === movId
          ? { ...m, regra_fator_pallet: data.regra_fator_pallet ?? fator,
              pallets_entrada: data.pallets_entrada ?? m.pallets_entrada,
              pallets_saida:   data.pallets_saida   ?? m.pallets_saida }
          : m
      ))
    } catch (e: any) {
      alert('Erro ao salvar fator pallet: ' + e.message)
    } finally {
      // Limpa o estado local para que o display use o valor salvo no banco
      setFatorLocal(prev => { const next = { ...prev }; delete next[movId]; return next })
    }
  }

  async function salvarManuseio(movId: string) {
    const val = parseFloat(manuseioLocal[movId] ?? '4.5')
    if (isNaN(val)) return
    await fetch(`/api/movimentacoes/${movId}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ valor_manuseio: val }) })
  }

  async function fecharMes() {
    setEnviandoFechamento(true)
    try {
      const res = await fetch('/api/fechamento', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cliente_id: id, competencia: mesAtual }),
      })
      const data = await res.json()
      if (data.error) throw new Error(data.error)
      setFechamentos(prev => {
        const sem = prev.filter(f => f.competencia.slice(0, 7) !== mesAtual)
        return [...sem, data]
      })
      setFechandoMes(false)
    } catch (e: any) {
      alert('Erro ao fechar mês: ' + e.message)
    } finally {
      setEnviandoFechamento(false)
    }
  }

  async function emitirNF() {
    if (!arquivoNF) { alert('Selecione a NF antes de continuar.'); return }
    if (!fechamentoMes) return
    setEnviandoNF(true)
    try {
      const fd = new FormData()
      fd.append('arquivo', arquivoNF)
      const res = await fetch(`/api/fechamento/${fechamentoMes.id}`, { method: 'PATCH', body: fd })
      const data = await res.json()
      if (data.error) throw new Error(data.error)
      setFechamentos(prev => prev.map(f => f.id === fechamentoMes.id ? data : f))
      setAnexandoNF(false)
      setArquivoNF(null)
    } catch (e: any) {
      alert('Erro ao emitir NF: ' + e.message)
    } finally {
      setEnviandoNF(false)
    }
  }

  async function reabrirMes() {
    if (!fechamentoMes) return
    setErroReabrir(null)
    setEnviandoReabrir(true)
    try {
      const res = await fetch(`/api/fechamento/${fechamentoMes.id}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ senha_master: senhaReabrir }),
      })
      const data = await res.json()
      if (data.error) throw new Error(data.error)
      setFechamentos(prev => prev.map(f => f.id === fechamentoMes.id ? data : f))
      setReabrindoMes(false)
      setSenhaReabrir('')
    } catch (e: any) {
      setErroReabrir(e.message)
    } finally {
      setEnviandoReabrir(false)
    }
  }

  // ── exportar planilha Excel do cliente ──
  async function exportarPlanilha() {
    setExportando(true)
    try {
      const res = await fetch(`/api/clientes/${id}/export`)
      if (!res.ok) {
        let msg = `Erro ${res.status}`
        try { const j = await res.json(); if (j.error) msg = j.error } catch { /* ignore */ }
        throw new Error(msg)
      }
      const blob = await res.blob()
      // Extrai o nome do arquivo do header (fallback genérico)
      const disp = res.headers.get('Content-Disposition') || ''
      const match = disp.match(/filename="([^"]+)"/)
      const fileName = match ? match[1] : `XPSLOG_${nomeCliente}_${mesAtual}.xlsx`
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = fileName
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
    } catch (e: any) {
      alert('Erro ao exportar planilha: ' + e.message)
    } finally {
      setExportando(false)
    }
  }

  // ── limpar todos os dados do cliente ──
  async function limparDados() {
    setLimpandoDados(true)
    setResultadoLimpeza(null)
    try {
      const res = await fetch(`/api/clientes/${id}/limpar`, {
        method: 'DELETE',
        headers: { 'X-Confirm': 'limpar' },
      })
      const data = await res.json()
      if (data.error) throw new Error(data.error)
      setResultadoLimpeza({ movimentacoes: data.movimentacoes_removidas, arquivos: data.arquivos_removidos })
      // Recarrega os dados da página
      await carregarDados()
    } catch (e: any) {
      alert('Erro ao limpar dados: ' + e.message)
      setConfirmandoLimpeza(false)
    } finally {
      setLimpandoDados(false)
    }
  }

  // ── movimentações inline edit ──
  function iniciarEditMov(mov: Movimentacao) {
    setEditandoMovId(mov.id)
    setEditMovForm(movToForm(mov))
  }

  async function salvarEditMov(movId: string) {
    setSalvandoMovId(movId)
    try {
      const payload = formToPayload(editMovForm, id)
      const res = await fetch(`/api/movimentacoes/${movId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const data = await res.json()
      if (data.error) throw new Error(data.error)
      setTodasMovs(prev => prev.map(m => m.id === movId ? { ...m, ...data } : m))
      setEditandoMovId(null)
    } catch (e: any) {
      alert('Erro ao salvar: ' + e.message)
    } finally {
      setSalvandoMovId(null)
    }
  }

  async function salvarNovaMov() {
    setSalvandoNovaMov(true)
    try {
      const payload = formToPayload(novaMovForm, id)
      const res = await fetch('/api/movimentacoes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const data = await res.json()
      if (data.error) throw new Error(data.error)
      setTodasMovs(prev => [data, ...prev])
      setAdicionandoMov(false)
      setNovaMovForm({ ...MOV_FORM_VAZIO, tipo: 'entrada' })
    } catch (e: any) {
      alert('Erro ao adicionar: ' + e.message)
    } finally {
      setSalvandoNovaMov(false)
    }
  }

  async function cancelarMovimentacao(movId: string) {
    if (!confirm('Marcar esta movimentação como excluída? Ela ficará riscada no histórico.')) return
    try {
      await fetch(`/api/movimentacoes/${movId}`, { method: 'DELETE' })
      setTodasMovs(prev => prev.map(m => m.id === movId ? { ...m, cancelada: true } : m))
    } catch (e: any) {
      alert('Erro: ' + e.message)
    }
  }

  async function restaurarMovimentacao(movId: string) {
    try {
      const res = await fetch(`/api/movimentacoes/${movId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cancelada: false }),
      })
      const data = await res.json()
      if (data.error) throw new Error(data.error)
      setTodasMovs(prev => prev.map(m => m.id === movId ? { ...m, cancelada: false } : m))
    } catch (e: any) {
      alert('Erro ao restaurar: ' + e.message)
    }
  }

  // ── cobranças adicionais ──
  async function adicionarCobranca() {
    if (!novaCobrancaDesc.trim() || !novaCobrancaValor) return
    setSalvandoCobranca(true)
    try {
      const res = await fetch(`/api/clientes/${id}/cobrancas`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ competencia: mesAtual, descricao: novaCobrancaDesc, valor: parseFloat(novaCobrancaValor) }),
      })
      const data = await res.json()
      if (data.error) throw new Error(data.error)
      setCobrancasAdicionais(prev => [...prev, data])
      setNovaCobrancaDesc('')
      setNovaCobrancaValor('')
      setAdicionandoCobranca(false)
    } catch (e: any) {
      alert('Erro: ' + e.message)
    } finally {
      setSalvandoCobranca(false)
    }
  }

  async function excluirCobranca(cobrancaId: string) {
    if (!confirm('Excluir esta cobrança?')) return
    setExcluindoCobrancaId(cobrancaId)
    try {
      await fetch(`/api/clientes/${id}/cobrancas?cobranca_id=${cobrancaId}`, { method: 'DELETE' })
      setCobrancasAdicionais(prev => prev.filter(c => c.id !== cobrancaId))
    } catch (e: any) {
      alert('Erro: ' + e.message)
    } finally {
      setExcluindoCobrancaId(null)
    }
  }

  const dadosGrafico = gerarDadosGrafico(volumeInicial, movsParaContabilizacao, mesAtual)
  const picoValor = dadosGrafico.reduce((max, d) => d.saldo > max ? d.saldo : max, 0)

  const fechamentoMes = fechamentos.find(f => f.competencia.slice(0, 7) === mesAtual)
  const mesNFEmitida = fechamentoMes?.status === 'nf_emitida'
  const mesAprovadoCliente = fechamentoMes?.status === 'aprovado'
  const mesAprovado = mesAprovadoCliente || mesNFEmitida
  const mesFechado = fechamentoMes?.status === 'fechado' || mesAprovado

  // Edição de movimentações só permitida quando o mês não está travado
  const podeEditarMovs = !mesAprovado

  // ── render helpers ──
  if (loading) return <div className="flex items-center justify-center min-h-[60vh] text-gray-400"><Loader2 className="w-6 h-6 animate-spin mr-2" />Carregando...</div>
  if (erro || !cliente) return <div className="max-w-[1400px] mx-auto px-6 py-8"><div className="bg-red-50 text-red-700 rounded-xl p-4 text-sm">{erro || 'Cliente não encontrado'}</div></div>

  const nomeCliente = cliente.nome_fantasia || cliente.nome

  return (
    <main className="max-w-[1400px] mx-auto px-6 py-8">

      {/* Breadcrumb */}
      <div className="flex items-center gap-2 mb-6">
        <Link href="/clientes" className="flex items-center gap-1.5 text-gray-400 hover:text-gray-700 text-sm">
          <ArrowLeft className="w-4 h-4" /> Clientes
        </Link>
        <span className="text-gray-300">/</span>
        <span className="text-sm text-[#0d1b2e] font-medium">{nomeCliente}</span>
      </div>

      {/* Header do cliente */}
      <div className="bg-white rounded-2xl border border-gray-100 p-6 mb-6">
        <div className="flex items-start justify-between flex-wrap gap-4">
          <div className="flex items-center gap-4">
            <div className="w-16 h-16 rounded-2xl bg-[#0d1b2e] flex items-center justify-center text-white font-bold text-2xl">
              {nomeCliente.slice(0, 2).toUpperCase()}
            </div>
            <div>
              <h1 className="text-2xl font-bold text-[#0d1b2e]">{nomeCliente}</h1>
              <p className="text-gray-500">{cliente.nome}</p>
              <p className="text-sm text-gray-400">CNPJ: {cliente.cnpj}</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex gap-4 text-sm bg-gray-50 rounded-xl p-4">
              <div className="text-center">
                <p className="text-gray-400 text-xs">Valor/pallet</p>
                <p className="font-bold text-[#0d1b2e]">{formatarMoeda(valorPallet)}</p>
              </div>
              <div className="w-px bg-gray-200" />
              <div className="text-center">
                <p className="text-gray-400 text-xs">Imposto</p>
                <p className="font-bold text-[#0d1b2e]">{aliquota}%</p>
              </div>
              <div className="w-px bg-gray-200" />
              <div className="text-center">
                <p className="text-gray-400 text-xs">Fator pallet</p>
                <p className="font-bold text-[#0d1b2e]">1/{cliente.regra_fator_pallet}</p>
              </div>
            </div>
            <button
              onClick={exportarPlanilha}
              disabled={exportando}
              className="flex items-center gap-2 border border-emerald-200 rounded-xl px-3 py-2 text-sm text-emerald-600 hover:bg-emerald-50 disabled:opacity-50"
              title="Baixar planilha Excel com todas as informações do cliente, separada por mês"
            >
              {exportando ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
              {exportando ? 'Gerando...' : 'Exportar Excel'}
            </button>
            <button
              onClick={() => { setConfirmandoLimpeza(true); setResultadoLimpeza(null) }}
              className="flex items-center gap-2 border border-red-200 rounded-xl px-3 py-2 text-sm text-red-500 hover:bg-red-50"
              title="Apagar todas as movimentações e NF-es deste cliente"
            >
              <Trash2 className="w-4 h-4" /> Limpar Dados
            </button>
            <button onClick={abrirEdicao} className="flex items-center gap-2 border border-gray-200 rounded-xl px-3 py-2 text-sm text-gray-600 hover:bg-gray-50">
              <Edit2 className="w-4 h-4" /> Editar
            </button>
          </div>
        </div>
      </div>

      {/* Seletor de mês */}
      <div className="flex items-center gap-3 mb-6">
        <button
          onClick={() => {
            const idx = mesesComDados.indexOf(mesAtual)
            if (idx < mesesComDados.length - 1) setMesAtual(mesesComDados[idx + 1])
          }}
          className="w-8 h-8 rounded-lg border border-gray-200 flex items-center justify-center text-gray-400 hover:bg-gray-50 disabled:opacity-30"
          disabled={mesesComDados.indexOf(mesAtual) === mesesComDados.length - 1}
        >
          <ChevronLeft className="w-4 h-4" />
        </button>
        <select
          value={mesAtual}
          onChange={e => setMesAtual(e.target.value)}
          className="border border-gray-200 rounded-xl px-4 py-2 text-sm font-semibold text-[#0d1b2e] focus:outline-none focus:ring-2 focus:ring-[#0d1b2e]/10 bg-white"
        >
          {mesesComDados.map(m => (
            <option key={m} value={m}>{mesLabel(m)}</option>
          ))}
        </select>
        <button
          onClick={() => {
            const idx = mesesComDados.indexOf(mesAtual)
            if (idx > 0) setMesAtual(mesesComDados[idx - 1])
          }}
          className="w-8 h-8 rounded-lg border border-gray-200 flex items-center justify-center text-gray-400 hover:bg-gray-50 disabled:opacity-30"
          disabled={mesesComDados.indexOf(mesAtual) === 0}
        >
          <ChevronRight className="w-4 h-4" />
        </button>
        <span className="text-sm text-gray-400">— movimentações de {mesLabel(mesAtual)}</span>

        <div className="ml-auto flex items-center gap-2">
          {/* Botão reabrir (aparece quando há fechamento) */}
          {fechamentoMes && fechamentoMes.status !== 'aberto' && (
            <button
              onClick={() => { setReabrindoMes(true); setSenhaReabrir(''); setErroReabrir(null) }}
              className="flex items-center gap-1.5 text-xs px-2 py-1.5 rounded-lg border border-amber-300 text-amber-600 hover:bg-amber-50 transition-colors"
              title="Reabrir mês (requer senha master)"
            >
              <RotateCcw className="w-3 h-3" /> Reabrir
            </button>
          )}

          {mesNFEmitida ? (
            <span className="flex items-center gap-1.5 text-xs text-emerald-600 bg-emerald-50 border border-emerald-200 px-3 py-1.5 rounded-full">
              <CheckCircle className="w-3.5 h-3.5" /> NF Emitida — mês encerrado
              {fechamentoMes?.arquivo_cobranca_url && (
                <a href={fechamentoMes.arquivo_cobranca_url} target="_blank" rel="noopener noreferrer"
                  className="ml-1 hover:underline flex items-center gap-0.5">
                  <ExternalLink className="w-3 h-3" /> Ver NF
                </a>
              )}
            </span>
          ) : mesAprovadoCliente ? (
            <div className="flex items-center gap-2">
              <span className="flex items-center gap-1.5 text-xs text-emerald-600 bg-emerald-50 border border-emerald-200 px-3 py-1.5 rounded-full">
                <CheckCircle className="w-3.5 h-3.5" /> Cliente aprovou
                {fechamentoMes?.aprovado_em && (
                  <span className="text-emerald-500">· {new Date(fechamentoMes.aprovado_em).toLocaleDateString('pt-BR')}</span>
                )}
              </span>
              <button
                onClick={() => setAnexandoNF(true)}
                className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-xl bg-[#0d1b2e] text-white hover:bg-[#1a2d47] transition-colors font-semibold"
              >
                <FileUp className="w-3.5 h-3.5" /> Anexar NF
              </button>
            </div>
          ) : mesFechado ? (
            <span className="flex items-center gap-1.5 text-xs text-amber-600 bg-amber-50 border border-amber-200 px-3 py-1.5 rounded-full">
              <Lock className="w-3.5 h-3.5" /> Aguardando aprovação do cliente
            </span>
          ) : (
            <button
              onClick={() => setFechandoMes(true)}
              className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-xl border border-gray-200 text-gray-600 hover:bg-gray-50 transition-colors"
            >
              <Lock className="w-3.5 h-3.5" /> Fechar mês
            </button>
          )}
        </div>
      </div>

      {/* Modal fechar mês */}
      {fechandoMes && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md mx-4 p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-bold text-[#0d1b2e]">Fechar {mesLabel(mesAtual)}</h2>
              <button onClick={() => setFechandoMes(false)} className="text-gray-400 hover:text-gray-700">
                <X className="w-5 h-5" />
              </button>
            </div>
            <p className="text-sm text-gray-500 mb-6">
              O mês será fechado e o cliente receberá uma notificação para aprovação no portal. Após a aprovação, você poderá anexar a NF.
            </p>
            <div className="flex justify-end gap-2">
              <button onClick={() => setFechandoMes(false)} className="px-4 py-2 rounded-xl border border-gray-200 text-sm text-gray-600 hover:bg-gray-50">Cancelar</button>
              <button
                onClick={fecharMes}
                disabled={enviandoFechamento}
                className="flex items-center gap-2 px-4 py-2 rounded-xl bg-[#0d1b2e] text-white text-sm font-semibold hover:bg-[#1a2d47] disabled:opacity-50"
              >
                {enviandoFechamento ? <Loader2 className="w-4 h-4 animate-spin" /> : <Lock className="w-4 h-4" />}
                Fechar e enviar ao cliente
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal reabrir mês */}
      {reabrindoMes && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md mx-4 p-6">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <ShieldAlert className="w-5 h-5 text-red-500" />
                <h2 className="text-lg font-bold text-[#0d1b2e]">Reabrir {mesLabel(mesAtual)}</h2>
              </div>
              <button onClick={() => setReabrindoMes(false)} className="text-gray-400 hover:text-gray-700">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="bg-red-50 border border-red-200 rounded-xl p-4 mb-5">
              <p className="text-sm text-red-700 font-semibold mb-1">Operação de alto risco</p>
              <p className="text-xs text-red-600">
                Reabrir um mês fechado/aprovado desfaz o processo de aprovação e remove o bloqueio. Qualquer NF já anexada será desvinculada do status. Use somente para correções críticas.
              </p>
            </div>
            <div className="mb-4">
              <label className="text-xs text-gray-500 mb-1 block">Senha master de administrador</label>
              <input
                type="password"
                value={senhaReabrir}
                onChange={e => { setSenhaReabrir(e.target.value); setErroReabrir(null) }}
                placeholder="Digite a senha master"
                className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-400"
                onKeyDown={e => { if (e.key === 'Enter') reabrirMes() }}
              />
              {erroReabrir && (
                <p className="text-xs text-red-500 mt-1.5 flex items-center gap-1">
                  <AlertCircle className="w-3 h-3" /> {erroReabrir}
                </p>
              )}
            </div>
            <div className="flex justify-end gap-2">
              <button onClick={() => setReabrindoMes(false)} className="px-4 py-2 rounded-xl border border-gray-200 text-sm text-gray-600 hover:bg-gray-50">Cancelar</button>
              <button
                onClick={reabrirMes}
                disabled={enviandoReabrir || !senhaReabrir}
                className="flex items-center gap-2 px-4 py-2 rounded-xl bg-red-600 text-white text-sm font-semibold hover:bg-red-700 disabled:opacity-50"
              >
                {enviandoReabrir ? <Loader2 className="w-4 h-4 animate-spin" /> : <RotateCcw className="w-4 h-4" />}
                Confirmar reabertura
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal anexar NF */}
      {anexandoNF && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md mx-4 p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-bold text-[#0d1b2e]">Emitir NF — {mesLabel(mesAtual)}</h2>
              <button onClick={() => { setAnexandoNF(false); setArquivoNF(null) }} className="text-gray-400 hover:text-gray-700">
                <X className="w-5 h-5" />
              </button>
            </div>
            <p className="text-sm text-gray-500 mb-4">
              Anexe a NF. Após o envio, o mês ficará com status <strong>NF Emitida</strong> e não poderá mais ser alterado.
            </p>
            <div className="border-2 border-dashed border-gray-200 rounded-xl p-6 text-center mb-4">
              <FileText className="w-8 h-8 text-gray-400 mx-auto mb-2" />
              <label className="cursor-pointer text-sm text-blue-600 hover:underline">
                {arquivoNF ? arquivoNF.name : 'Clique para selecionar a NF (PDF)'}
                <input
                  type="file"
                  accept=".pdf,.xml"
                  className="hidden"
                  onChange={e => setArquivoNF(e.target.files?.[0] || null)}
                />
              </label>
              {arquivoNF && <p className="text-xs text-gray-400 mt-1">{(arquivoNF.size / 1024).toFixed(0)} KB</p>}
            </div>
            <div className="flex justify-end gap-2">
              <button onClick={() => { setAnexandoNF(false); setArquivoNF(null) }} className="px-4 py-2 rounded-xl border border-gray-200 text-sm text-gray-600 hover:bg-gray-50">Cancelar</button>
              <button
                onClick={emitirNF}
                disabled={enviandoNF || !arquivoNF}
                className="flex items-center gap-2 px-4 py-2 rounded-xl bg-emerald-600 text-white text-sm font-semibold hover:bg-emerald-700 disabled:opacity-50"
              >
                {enviandoNF ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                Emitir NF e fechar mês
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal limpar dados do cliente */}
      {confirmandoLimpeza && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md mx-4 p-6">
            {resultadoLimpeza ? (
              /* Tela de resultado */
              <>
                <div className="flex items-center gap-2 mb-4">
                  <CheckCircle className="w-5 h-5 text-emerald-500" />
                  <h2 className="text-lg font-bold text-[#0d1b2e]">Dados removidos</h2>
                </div>
                <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4 mb-5 text-sm text-emerald-700 space-y-1">
                  <p><strong>{resultadoLimpeza.movimentacoes}</strong> movimentação(ões) removida(s)</p>
                  <p><strong>{resultadoLimpeza.arquivos}</strong> arquivo(s) NF-e removido(s)</p>
                </div>
                <div className="flex justify-end">
                  <button
                    onClick={() => { setConfirmandoLimpeza(false); setResultadoLimpeza(null) }}
                    className="px-4 py-2 rounded-xl bg-[#0d1b2e] text-white text-sm font-semibold hover:bg-[#1a2d47]"
                  >
                    Fechar
                  </button>
                </div>
              </>
            ) : (
              /* Tela de confirmação */
              <>
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-2">
                    <ShieldAlert className="w-5 h-5 text-red-500" />
                    <h2 className="text-lg font-bold text-[#0d1b2e]">Limpar dados de {nomeCliente}</h2>
                  </div>
                  <button onClick={() => setConfirmandoLimpeza(false)} className="text-gray-400 hover:text-gray-700">
                    <X className="w-5 h-5" />
                  </button>
                </div>
                <div className="bg-red-50 border border-red-200 rounded-xl p-4 mb-5">
                  <p className="text-sm text-red-700 font-semibold mb-1">Operação irreversível</p>
                  <p className="text-xs text-red-600">
                    Todos os registros de <strong>movimentações</strong> (entradas e saídas) e os <strong>arquivos de NF-e</strong> vinculados a este cliente serão permanentemente apagados. Emails importados e saldos mensais <strong>não</strong> serão afetados.
                  </p>
                </div>
                <p className="text-sm text-gray-500 mb-5">
                  Útil para reiniciar o histórico após testes ou reimportação de dados.
                  Deseja continuar?
                </p>
                <div className="flex justify-end gap-2">
                  <button
                    onClick={() => setConfirmandoLimpeza(false)}
                    className="px-4 py-2 rounded-xl border border-gray-200 text-sm text-gray-600 hover:bg-gray-50"
                  >
                    Cancelar
                  </button>
                  <button
                    onClick={limparDados}
                    disabled={limpandoDados}
                    className="flex items-center gap-2 px-4 py-2 rounded-xl bg-red-600 text-white text-sm font-semibold hover:bg-red-700 disabled:opacity-50"
                  >
                    {limpandoDados
                      ? <Loader2 className="w-4 h-4 animate-spin" />
                      : <Trash2 className="w-4 h-4" />}
                    {limpandoDados ? 'Removendo...' : 'Sim, limpar tudo'}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* KPI row */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-4 mb-4">
        <div className="bg-white rounded-2xl border border-gray-100 p-4 relative group">
          <div className="flex items-center gap-2 mb-2">
            <Package className="w-4 h-4 text-gray-400" />
            <span className="text-xs text-gray-400 uppercase tracking-wider">Est. Inicial</span>
          </div>
          {editandoEstoque ? (
            <div className="flex items-center gap-2">
              <input
                type="number"
                value={estoqueInput}
                onChange={e => setEstoqueInput(e.target.value)}
                className="w-20 border border-gray-200 rounded-lg px-2 py-1 text-lg font-bold text-[#0d1b2e] focus:outline-none focus:ring-2 focus:ring-[#0d1b2e]/10"
                autoFocus
                onKeyDown={e => { if (e.key === 'Enter') salvarEstoqueInicial(); if (e.key === 'Escape') setEditandoEstoque(false) }}
              />
              <button onClick={salvarEstoqueInicial} disabled={salvandoEstoque} className="text-emerald-600 hover:text-emerald-700">
                <Save className="w-4 h-4" />
              </button>
              <button onClick={() => setEditandoEstoque(false)} className="text-gray-400 hover:text-gray-600">
                <X className="w-4 h-4" />
              </button>
            </div>
          ) : (
            <button
              onClick={() => { if (!mesAprovado) { setEstoqueInput(String(volumeInicial)); setEditandoEstoque(true) } }}
              disabled={mesAprovado}
              className="text-left w-full"
            >
              <p className="text-3xl font-bold text-[#0d1b2e]">{volumeInicial}</p>
              <p className="text-xs text-gray-400 mt-1 flex items-center gap-1">
                pallets · <span className="underline decoration-dashed text-blue-500">editar</span>
              </p>
            </button>
          )}
          {!saldoMes && !editandoEstoque && (
            <div className="absolute top-2 right-2">
              <AlertCircle className="w-3 h-3 text-amber-400" />
            </div>
          )}
        </div>

        <div className="bg-white rounded-2xl border border-gray-100 p-4">
          <div className="flex items-center gap-2 mb-2">
            <ArrowDownToLine className="w-4 h-4 text-blue-500" />
            <span className="text-xs text-gray-400 uppercase tracking-wider">Entradas</span>
          </div>
          <p className="text-3xl font-bold text-[#0d1b2e]">{totalEntradas}</p>
          <p className="text-xs text-gray-400 mt-1">{movsDoMesAtivas.filter(m => m.tipo_movimentacao === 'entrada').reduce((s, m) => s + (m.qtd_entrada_ton || 0), 0).toFixed(2)} ton</p>
        </div>

        <div className="bg-white rounded-2xl border border-gray-100 p-4">
          <div className="flex items-center gap-2 mb-2">
            <ArrowUpFromLine className="w-4 h-4 text-orange-500" />
            <span className="text-xs text-gray-400 uppercase tracking-wider">Saídas</span>
          </div>
          <p className="text-3xl font-bold text-[#0d1b2e]">{totalSaidas}</p>
          <p className="text-xs text-gray-400 mt-1">{movsDoMesAtivas.filter(m => m.tipo_movimentacao === 'saida').reduce((s, m) => s + (m.qtd_saida_ton || 0), 0).toFixed(2)} ton</p>
        </div>

        <div className="bg-white rounded-2xl border border-gray-100 p-4">
          <div className="flex items-center gap-2 mb-2">
            <TrendingUp className="w-4 h-4 text-emerald-500" />
            <span className="text-xs text-gray-400 uppercase tracking-wider">Saldo Final</span>
          </div>
          <p className="text-3xl font-bold text-[#0d1b2e]">{saldoFinal}</p>
          <p className="text-xs text-gray-400 mt-1">pallets</p>
        </div>

        <div className="bg-[#0d1b2e] rounded-2xl p-4">
          <div className="flex items-center gap-2 mb-2">
            <TrendingUp className="w-4 h-4 text-blue-300" />
            <span className="text-xs text-blue-300 uppercase tracking-wider">PP Pico</span>
          </div>
          <p className="text-3xl font-bold text-white">{ppPico}</p>
          <p className="text-xs text-blue-300 mt-1">pallets — base cobrança</p>
        </div>
      </div>

      {/* Armazenagem */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-6">
        <div className="bg-white rounded-2xl border border-gray-100 p-5">
          <p className="text-xs text-gray-400 uppercase tracking-wider mb-2">Armazenagem s/ imposto</p>
          <p className="text-3xl font-bold text-[#0d1b2e]">{formatarMoeda(armazBase)}</p>
          <p className="text-xs text-gray-400 mt-1">{ppPico} pallets × {formatarMoeda(valorPallet)}</p>
        </div>
        <div className="bg-emerald-50 rounded-2xl border border-emerald-100 p-5">
          <p className="text-xs text-emerald-600 uppercase tracking-wider mb-2">Armazenagem c/ imposto ({aliquota}%)</p>
          <p className="text-3xl font-bold text-emerald-700">{formatarMoeda(armazTotal)}</p>
          <p className="text-xs text-emerald-600 mt-1">+{formatarMoeda(armazTotal - armazBase)} em impostos</p>
        </div>
      </div>

      {/* Gráfico */}
      <div className="bg-white rounded-2xl border border-gray-100 p-6 mb-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="font-semibold text-[#0d1b2e]">Evolução do Estoque — {mesLabel(mesAtual)}</h2>
            <p className="text-xs text-gray-400 mt-0.5">Saldo de pallets por dia, do início ao fim do mês</p>
          </div>
          <div className="flex items-center gap-2 text-xs text-gray-500">
            <span className="inline-block w-3 h-3 rounded-sm bg-[#0d1b2e]" />
            <span>Pico: <strong className="text-[#0d1b2e]">{picoValor} pallets</strong></span>
          </div>
        </div>
        {dadosGrafico.length > 0 ? (
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={dadosGrafico} barCategoryGap="20%" margin={{ top: 20, right: 0, left: 0, bottom: 0 }}>
              <XAxis dataKey="dia" tick={{ fontSize: 11, fill: '#9ca3af' }} axisLine={false} tickLine={false} interval={2} />
              <YAxis tick={{ fontSize: 11, fill: '#9ca3af' }} axisLine={false} tickLine={false} width={36} />
              <Tooltip
                formatter={(value) => [`${value} pallets`, 'Saldo']}
                labelFormatter={(label) => `Dia ${label}`}
                contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #e5e7eb' }}
              />
              <Bar dataKey="saldo" radius={[3, 3, 0, 0]}>
                {dadosGrafico.map((entry, index) => (
                  <Cell key={`cell-${index}`} fill={entry.saldo === picoValor && picoValor > 0 ? '#0d1b2e' : '#bfdbfe'} />
                ))}
                <LabelList
                  dataKey="saldo"
                  position="top"
                  content={({ x, y, width, value }) => {
                    if (value !== picoValor || picoValor === 0) return null
                    const cx = (x as number) + (width as number) / 2
                    return <text x={cx} y={(y as number) - 4} textAnchor="middle" fontSize={10} fontWeight={700} fill="#0d1b2e">{String(value)}</text>
                  }}
                />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        ) : (
          <p className="text-sm text-gray-400 text-center py-10">Sem movimentações para exibir.</p>
        )}
      </div>

      {/* Movimentações do mês */}
      <div className="bg-white rounded-2xl border border-gray-100 p-6 mb-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-semibold text-[#0d1b2e]">Movimentações — {mesLabel(mesAtual)}</h2>
          <div className="flex items-center gap-2">
            <span className="text-xs text-gray-400">
              {filtrosAtivos
                ? `${movsTabela.length} de ${movsTabelaBase.length} NF${movsTabelaBase.length !== 1 ? '-es' : '-e'}`
                : `${movsTabela.length} NF${movsTabela.length !== 1 ? '-es' : '-e'}`}
            </span>
            {podeEditarMovs && (
              <button
                onClick={() => { setAdicionandoMov(true); setNovaMovForm({ ...MOV_FORM_VAZIO, tipo: 'entrada' }) }}
                className="flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-lg border border-blue-200 text-blue-600 hover:bg-blue-50 transition-colors"
              >
                <Plus size={12} /> Nova linha
              </button>
            )}
          </div>
        </div>

        {/* Filtros (apenas exibição da tabela) */}
        <div className="flex flex-wrap items-center gap-2 mb-4">
          {/* Tipo */}
          <div className="inline-flex rounded-lg border border-gray-200 overflow-hidden">
            {([['todos', 'Todos'], ['entrada', 'Entradas'], ['saida', 'Saídas']] as const).map(([val, label]) => (
              <button
                key={val}
                onClick={() => setFiltroTipo(val)}
                className={`px-3 py-1.5 text-xs font-medium transition-colors ${filtroTipo === val ? 'bg-[#0d1b2e] text-white' : 'bg-white text-gray-500 hover:bg-gray-50'}`}
              >
                {label}
              </button>
            ))}
          </div>
          {/* Categorias (somente quando há categorias de produto, ex.: Fedrigoni) */}
          {temCategorias && categoriasDisponiveis.length > 1 && (
            <div className="flex flex-wrap items-center gap-1.5">
              {categoriasDisponiveis.map(cat => {
                const ativo = filtroCategorias.has(cat)
                return (
                  <button
                    key={cat}
                    onClick={() => toggleCategoria(cat)}
                    className={`text-xs px-2.5 py-1 rounded-full border font-medium transition-colors ${ativo ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-indigo-50 text-indigo-700 border-indigo-100 hover:bg-indigo-100'}`}
                  >
                    {cat}
                  </button>
                )
              })}
            </div>
          )}
          {filtrosAtivos && (
            <button
              onClick={() => { setFiltroTipo('todos'); setFiltroCategorias(new Set()) }}
              className="text-xs px-2.5 py-1 rounded-lg text-gray-500 hover:text-gray-700 hover:bg-gray-100 transition-colors"
            >
              Limpar filtros
            </button>
          )}
        </div>

        {movsTabela.length === 0 && !adicionandoMov ? (
          <p className="text-sm text-gray-400 text-center py-8">
            {filtrosAtivos ? 'Nenhuma movimentação com os filtros selecionados.' : 'Nenhuma movimentação neste mês.'}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 text-gray-500 text-xs uppercase tracking-wider">
                  <th className="px-4 py-3 text-left">Data</th>
                  <th className="px-4 py-3 text-left">NF-e</th>
                  <th className="px-4 py-3 text-left">Tipo</th>
                  <th className="px-4 py-3 text-left">Fornecedor / Destino</th>
                  {temCategorias && <th className="px-4 py-3 text-left">Produto</th>}
                  <th className="px-4 py-3 text-right">Toneladas</th>
                  {cliente?.cobrar_separacao_sacaria && <th className="px-4 py-3 text-right">Fator</th>}
                  <th className="px-4 py-3 text-right">Pallets</th>
                  {podeEditarMovs && <th className="px-4 py-3 text-right">Ações</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {movsTabela.map(mov => {
                  const data = mov.data_entrada || mov.data_saida
                  const ton = mov.qtd_entrada_ton || mov.qtd_saida_ton || 0
                  // Alphalum: mostra floor(ton/fator) em vez de ceil para refletir excedente em Separação
                  const movFator = getMovFator(mov.id, mov.regra_fator_pallet)
                  const pallets = (cliente?.cobrar_separacao_sacaria && ton > movFator
                    ? Math.floor(Math.round((ton / movFator) * 1e10) / 1e10)
                    : (mov.pallets_entrada || mov.pallets_saida || 0))
                    + (excedentePalletSet.has(mov.id) ? 1 : 0)  // excedente promovido a pallet
                  const contraparte = mov.tipo_movimentacao === 'entrada'
                    ? (mov.fornecedor || mov.arquivos_nfe?.nome_emitente || '—')
                    : (mov.cliente_destino || mov.arquivos_nfe?.nome_destinatario || '—')
                  const cancelada = mov.cancelada === true

                  if (editandoMovId === mov.id) {
                    return (
                      <MovFormRow
                        key={mov.id}
                        f={editMovForm}
                        setF={setEditMovForm}
                        onSave={() => salvarEditMov(mov.id)}
                        onCancel={() => setEditandoMovId(null)}
                        saving={salvandoMovId === mov.id}
                      />
                    )
                  }

                  return (
                    <tr key={mov.id} className={`hover:bg-gray-50 ${cancelada ? 'opacity-50 bg-red-50/20' : ''}`}>
                      <td className={`px-4 py-3 text-gray-600 ${cancelada ? 'line-through' : ''}`}>
                        {data ? new Date(data + 'T12:00:00').toLocaleDateString('pt-BR') : '—'}
                      </td>
                      <td className={`px-4 py-3 font-mono text-xs text-gray-600 ${cancelada ? 'line-through' : ''}`}>{mov.numero_nfe || '—'}</td>
                      <td className="px-4 py-3">
                        <span className={`text-xs font-semibold px-2 py-1 rounded-full ${cancelada ? 'bg-gray-100 text-gray-400' : mov.tipo_movimentacao === 'entrada' ? 'bg-blue-50 text-blue-700' : 'bg-orange-50 text-orange-700'}`}>
                          {cancelada ? 'Cancelada' : mov.tipo_movimentacao === 'entrada' ? 'Entrada' : 'Saída'}
                        </span>
                      </td>
                      <td className={`px-4 py-3 text-xs text-gray-500 max-w-[180px] truncate ${cancelada ? 'line-through' : ''}`}>{contraparte}</td>
                      {temCategorias && (
                        <td className="px-4 py-3">
                          {mov.produto_nome ? (
                            <span className="text-xs bg-indigo-50 text-indigo-700 border border-indigo-100 px-2 py-0.5 rounded-full font-medium whitespace-nowrap">{mov.produto_nome}</span>
                          ) : (
                            <span className="text-xs text-gray-300">—</span>
                          )}
                        </td>
                      )}
                      <td className={`px-4 py-3 text-right text-gray-600 ${cancelada ? 'line-through' : ''}`}>{ton.toFixed(2)} t</td>
                      {cliente?.cobrar_separacao_sacaria && (
                        <td className="px-4 py-3 text-right">
                          <div className="flex items-center justify-end gap-1">
                          <input
                            id={`fator-mov-${mov.id}`}
                            type="number" step="0.1" min="0.1"
                            value={fatorLocal[mov.id] ?? String(mov.regra_fator_pallet ?? cliente?.regra_fator_pallet ?? 1.2)}
                            onChange={e => setFatorLocal(prev => ({ ...prev, [mov.id]: e.target.value }))}
                            onKeyDown={e => { if (e.key === 'Enter') salvarFatorPallet(mov.id, parseFloat((e.target as HTMLInputElement).value)) }}
                            disabled={mesAprovado || cancelada}
                            className="w-14 text-right border border-gray-200 rounded-lg px-1 py-1 text-xs font-semibold text-[#0d1b2e] focus:outline-none focus:ring-2 focus:ring-[#0d1b2e]/10 disabled:bg-gray-50 disabled:text-gray-400"
                          />
                          {!(mesAprovado || cancelada) && (
                            <button
                              onClick={() => {
                                const el = document.getElementById(`fator-mov-${mov.id}`) as HTMLInputElement | null
                                const valor = parseFloat(el?.value ?? fatorLocal[mov.id] ?? String(mov.regra_fator_pallet ?? 1.2))
                                salvarFatorPallet(mov.id, valor)
                              }}
                              className="p-1 rounded bg-blue-500 text-white hover:bg-blue-600 flex-shrink-0"
                              title="Salvar fator"
                            >
                              <Save size={10} />
                            </button>
                          )}
                          </div>
                        </td>
                      )}
                      <td className={`px-4 py-3 text-right font-bold text-[#0d1b2e] ${cancelada ? 'line-through text-gray-400' : ''}`}>{pallets}</td>
                      {podeEditarMovs && (
                        <td className="px-4 py-3 text-right">
                          {cancelada ? (
                            <button
                              onClick={() => restaurarMovimentacao(mov.id)}
                              className="flex items-center gap-1 text-xs px-2 py-1 rounded-lg border border-green-200 text-green-700 hover:bg-green-50 transition-colors"
                              title="Restaurar movimentação"
                            >
                              <RotateCcw size={11} /> Restaurar
                            </button>
                          ) : (
                            <div className="flex items-center justify-end gap-1">
                              <button
                                onClick={() => iniciarEditMov(mov)}
                                className="p-1.5 rounded-lg border border-gray-200 text-gray-400 hover:border-blue-400 hover:text-blue-600 transition-colors"
                                title="Editar"
                              >
                                <Pencil size={12} />
                              </button>
                              <button
                                onClick={() => cancelarMovimentacao(mov.id)}
                                className="p-1.5 rounded-lg border border-gray-200 text-gray-400 hover:border-red-400 hover:text-red-600 transition-colors"
                                title="Excluir (soft)"
                              >
                                <Trash2 size={12} />
                              </button>
                            </div>
                          )}
                        </td>
                      )}
                    </tr>
                  )
                })}

                {/* Linha de nova movimentação */}
                {adicionandoMov && (
                  <MovFormRow
                    f={novaMovForm}
                    setF={setNovaMovForm}
                    onSave={salvarNovaMov}
                    onCancel={() => setAdicionandoMov(false)}
                    saving={salvandoNovaMov}
                  />
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Separação por Unidade de Sacaria */}
      {(movsParaSeparacao.length > 0 || excessosSeparacao.length > 0 || adicionandoSeparacao) && cliente?.cobrar_separacao_sacaria && (
        <div className="bg-white rounded-2xl border border-amber-100 p-6 mb-6">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="font-semibold text-[#0d1b2e]">Separação por Unidade de Sacaria — {mesLabel(mesAtual)}</h2>
              <p className="text-xs text-gray-400 mt-0.5">
                Itens com QTD ≤ 1,2 ton — cobrança por unidade (R$ 4,50/un · volume = ton × 1000 ÷ 25)
              </p>
            </div>
            <div className="flex items-center gap-4">
              {podeEditarMovs && (
                <button
                  onClick={() => { setAdicionandoSeparacao(v => !v); setNovaSepForm({ data: '', numero_nfe: '', tipo: 'saida', contraparte: '', toneladas: '' }) }}
                  className="flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-lg border border-amber-300 text-amber-700 hover:bg-amber-50 transition-colors"
                >
                  <Plus size={12} /> Nova linha
                </button>
              )}
              <div className="text-right">
                <p className="text-xs text-gray-400">Total separação</p>
                <p className="text-xl font-bold text-amber-700">{formatarMoeda(totalSeparacao)}</p>
              </div>
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-amber-50 text-gray-500 text-xs uppercase tracking-wider">
                  <th className="px-4 py-3 text-left">Data</th>
                  <th className="px-4 py-3 text-left">NF-e</th>
                  <th className="px-4 py-3 text-left">Fornecedor / Destino</th>
                  {temCategorias && <th className="px-4 py-3 text-left">Produto</th>}
                  <th className="px-4 py-3 text-right">Toneladas</th>
                  <th className="px-4 py-3 text-right">Fator</th>
                  <th className="px-4 py-3 text-right">Volume (un)</th>
                  <th className="px-4 py-3 text-right">Total</th>
                  <th className="px-4 py-3 text-center w-24">+ Pallet</th>
                  {podeEditarMovs && <th className="px-4 py-3 w-12" />}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {movsParaSeparacao.map(mov => {
                  const data = mov.data_entrada || mov.data_saida
                  const ton = mov.qtd_entrada_ton ?? mov.qtd_saida_ton ?? 0
                  const volume = Math.round((ton * 1000) / 25 * 100) / 100
                  const total = volume * 4.5
                  const contraparte = mov.tipo_movimentacao === 'entrada'
                    ? (mov.fornecedor || mov.arquivos_nfe?.nome_emitente || '—')
                    : (mov.cliente_destino || mov.arquivos_nfe?.nome_destinatario || '—')
                  return (
                    <tr key={mov.id} className="hover:bg-amber-50/40">
                      <td className="px-4 py-3 text-gray-600">
                        {data ? new Date(data + 'T12:00:00').toLocaleDateString('pt-BR') : '—'}
                      </td>
                      <td className="px-4 py-3 font-mono text-xs text-gray-600">{mov.numero_nfe || '—'}</td>
                      <td className="px-4 py-3 text-xs text-gray-500 max-w-[180px] truncate">{contraparte}</td>
                      {temCategorias && (
                        <td className="px-4 py-3">
                          {mov.produto_nome
                            ? <span className="text-xs bg-indigo-50 text-indigo-700 border border-indigo-100 px-2 py-0.5 rounded-full font-medium">{mov.produto_nome}</span>
                            : <span className="text-xs text-gray-300">—</span>}
                        </td>
                      )}
                      <td className="px-4 py-3 text-right text-gray-600">{ton.toFixed(3)} t</td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex items-center justify-end gap-1">
                          <input
                            id={`fator-sep-${mov.id}`}
                            type="number" step="0.1" min="0.1"
                            value={fatorLocal[mov.id] ?? String(mov.regra_fator_pallet ?? cliente?.regra_fator_pallet ?? 1.2)}
                            onChange={e => setFatorLocal(prev => ({ ...prev, [mov.id]: e.target.value }))}
                            onKeyDown={e => { if (e.key === 'Enter') salvarFatorPallet(mov.id, parseFloat((e.target as HTMLInputElement).value)) }}
                            disabled={mesAprovado}
                            className="w-14 text-right border border-amber-200 rounded-lg px-1 py-1 text-xs font-semibold text-amber-800 focus:outline-none focus:ring-2 focus:ring-amber-300 disabled:bg-gray-50 disabled:text-gray-400"
                          />
                          {!mesAprovado && (
                            <button
                              onClick={() => {
                                const el = document.getElementById(`fator-sep-${mov.id}`) as HTMLInputElement | null
                                const valor = parseFloat(el?.value ?? fatorLocal[mov.id] ?? String(mov.regra_fator_pallet ?? 1.2))
                                salvarFatorPallet(mov.id, valor)
                              }}
                              className="p-1 rounded bg-amber-500 text-white hover:bg-amber-600 flex-shrink-0"
                              title="Salvar fator"
                            >
                              <Save size={10} />
                            </button>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-right font-bold text-amber-700">{volume.toFixed(2)}</td>
                      <td className="px-4 py-3 text-right font-semibold text-[#0d1b2e]">{formatarMoeda(total)}</td>
                      <td className="px-4 py-3 text-center">
                        {!mesAprovado && (
                          separacaoComPallet.has(mov.id) ? (
                            <button
                              onClick={() => alternarPallet(mov.id, false)}
                              className="flex items-center gap-1 text-xs px-2 py-1 rounded-lg border border-emerald-300 text-emerald-700 bg-emerald-50 hover:bg-emerald-100 transition-colors mx-auto"
                              title="Pallet já adicionado em Movimentações — clique para remover"
                            >
                              <CheckCircle size={11} /> Adicionado
                            </button>
                          ) : (
                            <button
                              onClick={() => alternarPallet(mov.id, true)}
                              className="flex items-center gap-1 text-xs px-2 py-1 rounded-lg border border-blue-200 text-blue-600 hover:bg-blue-50 transition-colors mx-auto"
                              title="Adicionar também como pallet em Movimentações (item permanece na Separação)"
                            >
                              <Package size={11} /> Pallet
                            </button>
                          )
                        )}
                      </td>
                      {podeEditarMovs && (
                        <td className="px-4 py-3 text-center">
                          <button
                            onClick={() => cancelarMovimentacao(mov.id)}
                            className="p-1.5 rounded-lg border border-gray-200 text-gray-400 hover:border-red-400 hover:text-red-600 transition-colors"
                            title="Excluir linha"
                          >
                            <Trash2 size={12} />
                          </button>
                        </td>
                      )}
                    </tr>
                  )
                })}

                {/* Linhas de excedente (ton não divisível pelo fator) */}
                {excessosSeparacao.map(exc => {
                  const volume = Math.round(exc.excessoTon * 1000 / 25 * 100) / 100
                  const total  = volume * 4.5
                  const emEdicao = editandoExcedente === exc.movId

                  if (emEdicao) {
                    const tonPreview = parseFloat(editExcForm.ton.replace(',', '.'))
                    const volPreview = !isNaN(tonPreview) ? Math.round(tonPreview * 1000 / 25 * 100) / 100 : 0
                    return (
                      <tr key={`exc-${exc.movId}`} className="bg-orange-50/60 border-y border-orange-200">
                        <td className="px-2 py-2 text-xs text-gray-500">
                          {exc.data ? new Date(exc.data + 'T12:00:00').toLocaleDateString('pt-BR') : '—'}
                        </td>
                        <td className="px-2 py-2 font-mono text-xs text-gray-500">
                          {exc.nfe || '—'}
                          <span className="ml-1 text-[10px] bg-orange-100 text-orange-700 px-1 rounded">excedente</span>
                        </td>
                        <td className="px-2 py-2">
                          <input type="text" placeholder="Fornecedor / Destino"
                            value={editExcForm.contraparte}
                            onChange={e => setEditExcForm(f => ({ ...f, contraparte: e.target.value }))}
                            className="w-36 border border-gray-200 rounded-lg px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-orange-300" />
                        </td>
                        {temCategorias && <td className="px-2 py-2"><span className="text-xs text-gray-300">—</span></td>}
                        <td className="px-2 py-2 text-right">
                          <input type="number" step="0.001" min="0.001" placeholder="0.000"
                            value={editExcForm.ton}
                            onChange={e => setEditExcForm(f => ({ ...f, ton: e.target.value }))}
                            className="w-20 border border-gray-200 rounded-lg px-2 py-1 text-xs text-right focus:outline-none focus:ring-2 focus:ring-orange-300" />
                        </td>
                        <td className="px-2 py-2 text-right text-xs text-gray-400">{exc.fator.toFixed(1)}</td>
                        <td className="px-2 py-2 text-right text-xs font-bold text-amber-700">
                          {volPreview > 0 ? volPreview.toFixed(2) : '—'}
                        </td>
                        <td className="px-2 py-2 text-right text-xs font-semibold text-[#0d1b2e]">
                          {volPreview > 0 ? formatarMoeda(volPreview * 4.5) : '—'}
                        </td>
                        <td className="px-2 py-2" />
                        {podeEditarMovs && (
                          <td className="px-2 py-2 text-center">
                            <div className="flex items-center justify-center gap-1">
                              <button onClick={() => salvarExcedente(exc.movId)} disabled={salvandoExcedente}
                                className="p-1.5 rounded-lg bg-orange-500 text-white hover:bg-orange-600 disabled:opacity-50" title="Salvar">
                                {salvandoExcedente ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />}
                              </button>
                              <button onClick={() => setEditandoExcedente(null)}
                                className="p-1.5 rounded-lg border border-gray-200 text-gray-500 hover:bg-gray-100" title="Cancelar">
                                <X size={12} />
                              </button>
                            </div>
                          </td>
                        )}
                      </tr>
                    )
                  }

                  return (
                    <tr key={`exc-${exc.movId}`} className="hover:bg-amber-50/40 bg-orange-50/30">
                      <td className="px-4 py-3 text-gray-600">
                        {exc.data ? new Date(exc.data + 'T12:00:00').toLocaleDateString('pt-BR') : '—'}
                      </td>
                      <td className="px-4 py-3 font-mono text-xs text-gray-600">
                        {exc.nfe || '—'}
                        <span className="ml-1 text-[10px] bg-orange-100 text-orange-700 px-1 rounded">excedente</span>
                      </td>
                      <td className="px-4 py-3 text-xs text-gray-500 max-w-[180px] truncate">{exc.contraparte}</td>
                      {temCategorias && (
                        <td className="px-4 py-3">
                          {exc.produto_nome
                            ? <span className="text-xs bg-indigo-50 text-indigo-700 border border-indigo-100 px-2 py-0.5 rounded-full font-medium">{exc.produto_nome}</span>
                            : <span className="text-xs text-gray-300">—</span>}
                        </td>
                      )}
                      <td className="px-4 py-3 text-right text-gray-600">{exc.excessoTon.toFixed(3)} t</td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex items-center justify-end gap-1">
                          <input
                            id={`fator-exc-${exc.movId}`}
                            type="number" step="0.1" min="0.1"
                            value={fatorLocal[exc.movId] ?? String(exc.fator)}
                            onChange={e => setFatorLocal(prev => ({ ...prev, [exc.movId]: e.target.value }))}
                            onKeyDown={e => { if (e.key === 'Enter') salvarFatorPallet(exc.movId, parseFloat((e.target as HTMLInputElement).value)) }}
                            disabled={mesAprovado}
                            className="w-14 text-right border border-amber-200 rounded-lg px-1 py-1 text-xs font-semibold text-amber-800 focus:outline-none focus:ring-2 focus:ring-amber-300 disabled:bg-gray-50 disabled:text-gray-400"
                          />
                          {!mesAprovado && (
                            <button
                              onClick={() => {
                                const el = document.getElementById(`fator-exc-${exc.movId}`) as HTMLInputElement | null
                                const valor = parseFloat(el?.value ?? fatorLocal[exc.movId] ?? String(exc.fator))
                                salvarFatorPallet(exc.movId, valor)
                              }}
                              className="p-1 rounded bg-amber-500 text-white hover:bg-amber-600 flex-shrink-0"
                              title="Salvar fator (recalcula pallets e excedente)"
                            >
                              <Save size={10} />
                            </button>
                          )}
                        </div>
                      </td>
                      <td className={`px-4 py-3 text-right font-bold ${exc.status === 'excluido' ? 'text-gray-300 line-through' : 'text-amber-700'}`}>{volume.toFixed(2)}</td>
                      <td className="px-4 py-3 text-right font-semibold">
                        {exc.status === 'excluido' ? (
                          <span className="text-xs font-semibold text-gray-400 bg-gray-50 border border-gray-200 px-2 py-0.5 rounded-full">excluído</span>
                        ) : (
                          <div className="flex items-center justify-end gap-1.5">
                            {exc.status === 'pallet' && (
                              <span className="text-xs font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-full whitespace-nowrap">+1 pallet</span>
                            )}
                            <span className="text-[#0d1b2e]">{formatarMoeda(total)}</span>
                          </div>
                        )}
                      </td>
                      {/* Coluna "Pallet": promove o excedente a 1 pallet (toggle) */}
                      <td className="px-4 py-3 text-center">
                        {!mesAprovado && (
                          exc.status === 'pallet' ? (
                            <button
                              onClick={() => alternarExcedente(exc.movId, 'normal')}
                              className="flex items-center gap-1 text-xs px-2 py-1 rounded-lg border border-emerald-300 text-emerald-700 bg-emerald-50 hover:bg-emerald-100 transition-colors mx-auto"
                              title="Excedente contado também como 1 pallet (permanece na separação) — clique para reverter"
                            >
                              <CheckCircle size={11} /> Pallet
                            </button>
                          ) : exc.status === 'normal' ? (
                            <button
                              onClick={() => alternarExcedente(exc.movId, 'pallet')}
                              className="flex items-center gap-1 text-xs px-2 py-1 rounded-lg border border-blue-200 text-blue-600 hover:bg-blue-50 transition-colors mx-auto"
                              title="Contar também como 1 pallet em Movimentações (item permanece na separação)"
                            >
                              <Package size={11} /> Pallet
                            </button>
                          ) : null
                        )}
                      </td>
                      {podeEditarMovs && (
                        <td className="px-4 py-3 text-center">
                          <div className="flex items-center justify-center gap-1">
                            {exc.status === 'excluido' ? (
                              <button
                                onClick={() => alternarExcedente(exc.movId, 'normal')}
                                className="flex items-center gap-1 text-xs px-2 py-1 rounded-lg border border-gray-300 text-gray-600 hover:bg-gray-100 transition-colors"
                                title="Restaurar (volta a cobrar separação)"
                              >
                                <RotateCcw size={11} /> Restaurar
                              </button>
                            ) : (
                              <>
                                <button
                                  onClick={() => { setEditandoExcedente(exc.movId); setEditExcForm({ ton: exc.excessoTon.toFixed(3), contraparte: exc.contraparte }) }}
                                  className="p-1.5 rounded-lg border border-gray-200 text-gray-400 hover:border-orange-400 hover:text-orange-600 transition-colors"
                                  title="Editar excedente"
                                >
                                  <Pencil size={12} />
                                </button>
                                <button
                                  onClick={() => alternarExcedente(exc.movId, 'excluido')}
                                  className="p-1.5 rounded-lg border border-gray-200 text-gray-400 hover:border-red-400 hover:text-red-600 transition-colors"
                                  title="Excluir linha (não cobra separação)"
                                >
                                  <Trash2 size={12} />
                                </button>
                              </>
                            )}
                          </div>
                        </td>
                      )}
                    </tr>
                  )
                })}

                {/* Formulário de nova linha manual */}
                {adicionandoSeparacao && (
                  <tr className="bg-amber-50/60 border-y border-amber-200">
                    <td className="px-2 py-2">
                      <input type="date" value={novaSepForm.data}
                        onChange={e => setNovaSepForm(f => ({ ...f, data: e.target.value }))}
                        className="w-32 border border-gray-200 rounded-lg px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-amber-400" />
                    </td>
                    <td className="px-2 py-2">
                      <input type="text" placeholder="NF#" value={novaSepForm.numero_nfe}
                        onChange={e => setNovaSepForm(f => ({ ...f, numero_nfe: e.target.value }))}
                        className="w-20 border border-gray-200 rounded-lg px-2 py-1 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-amber-400" />
                    </td>
                    <td className="px-2 py-2">
                      <div className="flex gap-1">
                        <select value={novaSepForm.tipo} onChange={e => setNovaSepForm(f => ({ ...f, tipo: e.target.value as 'entrada' | 'saida' }))}
                          className="border border-gray-200 rounded-lg px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-amber-400">
                          <option value="saida">Saída</option>
                          <option value="entrada">Entrada</option>
                        </select>
                        <input type="text" placeholder="Fornecedor / Destino" value={novaSepForm.contraparte}
                          onChange={e => setNovaSepForm(f => ({ ...f, contraparte: e.target.value }))}
                          className="w-32 border border-gray-200 rounded-lg px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-amber-400" />
                      </div>
                    </td>
                    {temCategorias && <td className="px-2 py-2"><span className="text-xs text-gray-300">—</span></td>}
                    <td className="px-2 py-2 text-right">
                      <input type="number" placeholder="0.000" step="0.001" min="0.001" max="1.200" value={novaSepForm.toneladas}
                        onChange={e => setNovaSepForm(f => ({ ...f, toneladas: e.target.value }))}
                        className="w-20 border border-gray-200 rounded-lg px-2 py-1 text-xs text-right focus:outline-none focus:ring-2 focus:ring-amber-400" />
                    </td>
                    <td className="px-2 py-2 text-right text-xs text-gray-400">—</td>
                    <td className="px-2 py-2 text-right text-xs text-amber-700 font-bold">
                      {novaSepForm.toneladas ? (Math.round(parseFloat(novaSepForm.toneladas.replace(',','.')) * 1000 / 25 * 100) / 100).toFixed(2) : '—'}
                    </td>
                    <td className="px-2 py-2 text-right text-xs font-semibold text-[#0d1b2e]">
                      {novaSepForm.toneladas ? formatarMoeda(Math.round(parseFloat(novaSepForm.toneladas.replace(',','.')) * 1000 / 25 * 100) / 100 * 4.5) : '—'}
                    </td>
                    <td className="px-2 py-2 text-center">
                      <div className="flex items-center justify-center gap-1">
                        <button onClick={salvarNovaSeparacao} disabled={salvandoSep}
                          className="p-1.5 rounded-lg bg-amber-500 text-white hover:bg-amber-600 disabled:opacity-50" title="Salvar">
                          {salvandoSep ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />}
                        </button>
                        <button onClick={() => setAdicionandoSeparacao(false)}
                          className="p-1.5 rounded-lg border border-gray-200 text-gray-500 hover:bg-gray-100" title="Cancelar">
                          <X size={12} />
                        </button>
                      </div>
                    </td>
                  </tr>
                )}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-amber-200 bg-amber-50">
                  <td colSpan={temCategorias ? 4 : 3} className="px-4 py-3 text-sm font-semibold text-gray-600">Total</td>

                  <td className="px-4 py-3 text-right text-gray-500 text-xs">
                    {(
                      movsParaSeparacao.reduce((s, m) => s + (m.qtd_entrada_ton ?? m.qtd_saida_ton ?? 0), 0) +
                      excessosSeparacao.reduce((s, e) => s + e.excessoTon, 0)
                    ).toFixed(3)} t
                  </td>
                  <td className="px-4 py-3 text-right font-bold text-amber-700">
                    {(
                      movsParaSeparacao.reduce((s, m) => s + Math.round((m.qtd_entrada_ton ?? m.qtd_saida_ton ?? 0) * 1000 / 25 * 100) / 100, 0) +
                      excessosSeparacao.reduce((s, e) => s + Math.round(e.excessoTon * 1000 / 25 * 100) / 100, 0)
                    ).toFixed(2)} un
                  </td>
                  <td className="px-4 py-3 text-right font-bold text-amber-700 text-base">{formatarMoeda(totalSeparacao)}</td>
                  <td />
                  {podeEditarMovs && <td />}
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      )}

      {/* Movimentações por Categoria */}
      {temCategorias && (
        <div className="bg-white rounded-2xl border border-gray-100 p-6 mb-6">
          <div className="flex items-center justify-between mb-5">
            <div>
              <h2 className="font-semibold text-[#0d1b2e]">Movimentações por Categoria — {mesLabel(mesAtual)}</h2>
              <p className="text-xs text-gray-400 mt-0.5">Entradas e saídas agrupadas por categoria de produto</p>
            </div>
          </div>

          {resumoPorCategoria.length === 0 ? (
            <p className="text-sm text-gray-400 text-center py-8">Nenhuma movimentação com categoria neste mês.</p>
          ) : (
            <>
              {/* Gráfico por categoria */}
              <div className="mb-6">
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart
                    data={resumoPorCategoria.map(c => ({ categoria: c.nome, Entradas: c.entradas, Saídas: c.saidas }))}
                    barCategoryGap="30%"
                    barGap={4}
                  >
                    <XAxis dataKey="categoria" tick={{ fontSize: 11, fill: '#6b7280' }} axisLine={false} tickLine={false} />
                    <YAxis tick={{ fontSize: 11, fill: '#9ca3af' }} axisLine={false} tickLine={false} width={36} />
                    <Tooltip
                      formatter={(value, name) => [`${value} pallets`, String(name)]}
                      contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #e5e7eb' }}
                    />
                    <Legend wrapperStyle={{ fontSize: 12 }} />
                    <Bar dataKey="Entradas" fill="#bfdbfe" radius={[3, 3, 0, 0]} />
                    <Bar dataKey="Saídas" fill="#fed7aa" radius={[3, 3, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>

              {/* Tabela por categoria */}
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-gray-50 text-gray-500 text-xs uppercase tracking-wider">
                      <th className="px-4 py-3 text-left">Categoria</th>
                      <th className="px-4 py-3 text-right">Entradas (pallets)</th>
                      <th className="px-4 py-3 text-right">Entradas (ton)</th>
                      <th className="px-4 py-3 text-right">Saídas (pallets)</th>
                      <th className="px-4 py-3 text-right">Saídas (ton)</th>
                      <th className="px-4 py-3 text-right">Saldo</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {resumoPorCategoria.map(cat => (
                      <tr key={cat.nome} className="hover:bg-gray-50">
                        <td className="px-4 py-3 font-medium text-[#0d1b2e]">
                          <span className={`inline-flex items-center gap-1.5 ${cat.nome === '(Sem categoria)' ? 'text-gray-400 italic text-xs' : ''}`}>
                            {cat.nome}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-right text-blue-700 font-semibold">{cat.entradas}</td>
                        <td className="px-4 py-3 text-right text-gray-500 text-xs">{cat.entradasTon.toFixed(2)} t</td>
                        <td className="px-4 py-3 text-right text-orange-600 font-semibold">{cat.saidas}</td>
                        <td className="px-4 py-3 text-right text-gray-500 text-xs">{cat.saidasTon.toFixed(2)} t</td>
                        <td className="px-4 py-3 text-right font-bold text-[#0d1b2e]">{cat.entradas - cat.saidas}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="border-t-2 border-gray-200 bg-gray-50">
                      <td className="px-4 py-3 text-sm font-semibold text-gray-600">Total</td>
                      <td className="px-4 py-3 text-right font-bold text-blue-700">{resumoPorCategoria.reduce((s, c) => s + c.entradas, 0)}</td>
                      <td className="px-4 py-3 text-right text-gray-500 text-xs">{resumoPorCategoria.reduce((s, c) => s + c.entradasTon, 0).toFixed(2)} t</td>
                      <td className="px-4 py-3 text-right font-bold text-orange-600">{resumoPorCategoria.reduce((s, c) => s + c.saidas, 0)}</td>
                      <td className="px-4 py-3 text-right text-gray-500 text-xs">{resumoPorCategoria.reduce((s, c) => s + c.saidasTon, 0).toFixed(2)} t</td>
                      <td className="px-4 py-3 text-right font-bold text-[#0d1b2e]">{resumoPorCategoria.reduce((s, c) => s + (c.entradas - c.saidas), 0)}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </>
          )}
        </div>
      )}

      {/* Cobrança de Manuseio — oculto quando cliente.cobrar_manuseio === false */}
      {(cliente?.cobrar_manuseio ?? true) && <div className="bg-white rounded-2xl border border-gray-100 p-6 mb-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="font-semibold text-[#0d1b2e]">Cobrança de Manuseio — {mesLabel(mesAtual)}</h2>
            <p className="text-xs text-gray-400 mt-0.5">Valor cobrado por pallet movimentado (padrão: R$4,50/pallet)</p>
          </div>
          <div className="flex items-center gap-3">
            {podeEditarMovs && (
              <button
                onClick={() => { setAdicionandoMov(true); setNovaMovForm({ ...MOV_FORM_VAZIO, tipo: 'entrada' }) }}
                className="flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-lg border border-blue-200 text-blue-600 hover:bg-blue-50 transition-colors"
              >
                <Plus size={12} /> Nova linha
              </button>
            )}
            <div className="text-right">
              <p className="text-xs text-gray-400">Total manuseio</p>
              <p className="text-xl font-bold text-[#0d1b2e]">{formatarMoeda(totalManuseio)}</p>
            </div>
          </div>
        </div>

        {movsDoMesAtivas.length === 0 ? (
          <p className="text-sm text-gray-400 text-center py-8">Nenhuma movimentação ativa neste mês.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 text-gray-500 text-xs uppercase tracking-wider">
                  <th className="px-4 py-3 text-left">Data</th>
                  <th className="px-4 py-3 text-left">NF-e</th>
                  <th className="px-4 py-3 text-left">Fornecedor / Destino</th>
                  <th className="px-4 py-3 text-right">Pallets</th>
                  {cliente?.cobrar_separacao_sacaria && <th className="px-4 py-3 text-right">Fator</th>}
                  <th className="px-4 py-3 text-right">R$/pallet</th>
                  <th className="px-4 py-3 text-right">Total</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {movsParaContabilizacao.map(mov => {
                  const data = mov.data_entrada || mov.data_saida
                  const pallets = mov.pallets_entrada || mov.pallets_saida || 0
                  const vmLocal = manuseioLocal[mov.id] ?? String(mov.valor_manuseio ?? '4.50')
                  const vmNum = parseFloat(vmLocal) || 0
                  const total = pallets * vmNum
                  const contraparte = mov.tipo_movimentacao === 'entrada'
                    ? (mov.fornecedor || mov.arquivos_nfe?.nome_emitente || '—')
                    : (mov.cliente_destino || mov.arquivos_nfe?.nome_destinatario || '—')
                  return (
                    <tr key={mov.id} className="hover:bg-gray-50">
                      <td className="px-4 py-3 text-gray-600">{data ? new Date(data + 'T12:00:00').toLocaleDateString('pt-BR') : '—'}</td>
                      <td className="px-4 py-3 font-mono text-xs text-gray-600">{mov.numero_nfe || '—'}</td>
                      <td className="px-4 py-3 text-xs text-gray-500 max-w-[180px] truncate">{contraparte}</td>
                      <td className="px-4 py-3 text-right font-bold text-[#0d1b2e]">{pallets}</td>
                      {cliente?.cobrar_separacao_sacaria && (
                        <td className="px-4 py-3 text-right">
                          <input
                            type="number" step="0.1" min="0.1"
                            value={fatorLocal[mov.id] ?? String(mov.regra_fator_pallet ?? cliente?.regra_fator_pallet ?? 1.2)}
                            onChange={e => setFatorLocal(prev => ({ ...prev, [mov.id]: e.target.value }))}
                            onBlur={e => salvarFatorPallet(mov.id, parseFloat(e.target.value))}
                            disabled={mesAprovado}
                            className="w-14 text-right border border-gray-200 rounded-lg px-1 py-1 text-xs font-semibold text-[#0d1b2e] focus:outline-none focus:ring-2 focus:ring-[#0d1b2e]/10 disabled:bg-gray-50 disabled:text-gray-400"
                          />
                        </td>
                      )}
                      <td className="px-4 py-3 text-right">
                        <div className="flex items-center justify-end gap-1">
                          <span className="text-gray-400 text-xs">R$</span>
                          <input
                            type="number"
                            step="0.01"
                            value={vmLocal}
                            onChange={e => setManuseioLocal(prev => ({ ...prev, [mov.id]: e.target.value }))}
                            onBlur={() => !mesAprovado && salvarManuseio(mov.id)}
                            disabled={mesAprovado}
                            className="w-16 text-right border border-gray-200 rounded-lg px-2 py-1 text-sm font-semibold text-[#0d1b2e] focus:outline-none focus:ring-2 focus:ring-[#0d1b2e]/10 disabled:bg-gray-50 disabled:text-gray-400"
                          />
                        </div>
                      </td>
                      <td className="px-4 py-3 text-right font-semibold text-[#0d1b2e]">{formatarMoeda(total)}</td>
                    </tr>
                  )
                })}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-gray-200 bg-gray-50">
                  <td colSpan={3} className="px-4 py-3 text-sm font-semibold text-gray-600">Total</td>
                  <td className="px-4 py-3 text-right font-bold text-[#0d1b2e]">{movsParaContabilizacao.reduce((s, m) => s + (m.pallets_entrada || m.pallets_saida || 0), 0)} pallets</td>
                  <td className="px-4 py-3" />
                  <td className="px-4 py-3 text-right font-bold text-emerald-700 text-base">{formatarMoeda(totalManuseio)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>}

      {/* Cobranças Adicionais */}
      <div className="bg-white rounded-2xl border border-gray-100 p-6 mb-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="font-semibold text-[#0d1b2e]">Cobranças Adicionais — {mesLabel(mesAtual)}</h2>
            <p className="text-xs text-gray-400 mt-0.5">Cobranças extras lançadas manualmente</p>
          </div>
          <div className="flex items-center gap-3">
            <div className="text-right">
              <p className="text-xs text-gray-400">Subtotal</p>
              <p className="text-xl font-bold text-[#0d1b2e]">{formatarMoeda(totalCobrancasAdicionais)}</p>
            </div>
            {!mesAprovado && (
              <button
                onClick={() => setAdicionandoCobranca(v => !v)}
                className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border border-blue-200 text-blue-600 hover:bg-blue-50 transition-colors"
              >
                <Plus size={12} /> Adicionar
              </button>
            )}
          </div>
        </div>

        {/* Formulário nova cobrança */}
        {adicionandoCobranca && (
          <div className="bg-blue-50 rounded-xl p-4 mb-4 flex flex-wrap items-end gap-3">
            <div className="flex-1 min-w-[200px]">
              <label className="text-xs text-gray-500 mb-1 block">Descrição</label>
              <input
                type="text"
                placeholder="Ex: Taxa de paletização especial"
                value={novaCobrancaDesc}
                onChange={e => setNovaCobrancaDesc(e.target.value)}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
              />
            </div>
            <div className="w-32">
              <label className="text-xs text-gray-500 mb-1 block">Valor (R$)</label>
              <input
                type="number"
                step="0.01"
                placeholder="0,00"
                value={novaCobrancaValor}
                onChange={e => setNovaCobrancaValor(e.target.value)}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 text-right"
                onKeyDown={e => { if (e.key === 'Enter') adicionarCobranca() }}
              />
            </div>
            <div className="flex gap-2">
              <button
                onClick={adicionarCobranca}
                disabled={salvandoCobranca || !novaCobrancaDesc.trim() || !novaCobrancaValor}
                className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-emerald-500 text-white text-sm font-semibold hover:bg-emerald-600 disabled:opacity-50"
              >
                {salvandoCobranca ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                Salvar
              </button>
              <button
                onClick={() => { setAdicionandoCobranca(false); setNovaCobrancaDesc(''); setNovaCobrancaValor('') }}
                className="px-3 py-2 rounded-lg border border-gray-200 text-sm text-gray-500 hover:bg-gray-100"
              >
                <X size={14} />
              </button>
            </div>
          </div>
        )}

        {cobrancasAdicionais.length === 0 && !adicionandoCobranca ? (
          <p className="text-sm text-gray-400 text-center py-6">Nenhuma cobrança adicional para {mesLabel(mesAtual)}.</p>
        ) : cobrancasAdicionais.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 text-gray-500 text-xs uppercase tracking-wider">
                  <th className="px-4 py-3 text-left">Descrição</th>
                  <th className="px-4 py-3 text-right">Valor</th>
                  {!mesAprovado && <th className="px-4 py-3 text-center w-16" />}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {cobrancasAdicionais.map(c => (
                  <tr key={c.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 text-gray-700">{c.descricao}</td>
                    <td className="px-4 py-3 text-right font-semibold text-[#0d1b2e]">{formatarMoeda(c.valor)}</td>
                    {!mesAprovado && (
                      <td className="px-4 py-3 text-center">
                        <button
                          onClick={() => excluirCobranca(c.id)}
                          disabled={excluindoCobrancaId === c.id}
                          className="p-1.5 rounded-lg border border-gray-200 text-gray-400 hover:border-red-400 hover:text-red-600 transition-colors disabled:opacity-40"
                        >
                          {excluindoCobrancaId === c.id ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />}
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-gray-200 bg-gray-50">
                  <td className="px-4 py-3 text-sm font-semibold text-gray-600">Total cobranças adicionais</td>
                  <td className="px-4 py-3 text-right font-bold text-emerald-700 text-base">{formatarMoeda(totalCobrancasAdicionais)}</td>
                  {!mesAprovado && <td />}
                </tr>
              </tfoot>
            </table>
          </div>
        ) : null}

        {/* Resumo geral do mês */}
        {(() => {
          const manuseioEfetivo = (cliente?.cobrar_manuseio ?? true) ? totalManuseio : 0
          const grand = manuseioEfetivo + totalSeparacao + totalCobrancasAdicionais
          if (grand === 0) return null
          const partes = [
            manuseioEfetivo > 0 && 'manuseio',
            totalSeparacao > 0 && 'separação',
            totalCobrancasAdicionais > 0 && 'adicionais',
          ].filter(Boolean).join(' + ')
          return (
            <div className="mt-4 pt-4 border-t border-gray-100 flex items-center justify-between">
              <span className="text-sm text-gray-500 font-medium">Total Geral ({partes})</span>
              <span className="text-xl font-bold text-[#0d1b2e]">{formatarMoeda(grand)}</span>
            </div>
          )
        })()}
      </div>

      {/* Histórico por mês */}
      {mesesComDados.length > 1 && (
        <div className="bg-white rounded-2xl border border-gray-100 p-6 mb-6">
          <h2 className="font-semibold text-[#0d1b2e] mb-4">Histórico por Mês</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 text-gray-500 text-xs uppercase tracking-wider">
                  <th className="px-4 py-3 text-left">Mês</th>
                  <th className="px-4 py-3 text-right">Est. Inicial</th>
                  <th className="px-4 py-3 text-right">Entradas</th>
                  <th className="px-4 py-3 text-right">Saídas</th>
                  <th className="px-4 py-3 text-right">Saldo Final</th>
                  <th className="px-4 py-3 text-right">PP Pico</th>
                  <th className="px-4 py-3 text-right">Armazenagem s/ imp.</th>
                  <th className="px-4 py-3 text-right">Armazenagem c/ imp.</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {[...mesesComDados].sort().map(mes => {
                  const movsM = todasMovs.filter(m => anoMesDeMovimentacao(m) === mes && !m.cancelada)
                  const saldoM = saldosMensais.find(s => s.competencia.slice(0, 7) === mes)
                  const mesesOrdenados = [...mesesComDados].sort()
                  const idx = mesesOrdenados.indexOf(mes)
                  let volIni = 0
                  if (saldoM) {
                    volIni = saldoM.volume_inicial
                  } else if (idx > 0) {
                    const mesAnt = mesesOrdenados[idx - 1]
                    const saldoAnt = saldosMensais.find(s => s.competencia.slice(0, 7) === mesAnt)
                    const volIniAnt = saldoAnt?.volume_inicial ?? 0
                    const movsAnt = todasMovs.filter(m => anoMesDeMovimentacao(m) === mesAnt && !m.cancelada)
                    volIni = volIniAnt + movsAnt.reduce((s, m) => s + (m.pallets_entrada || 0), 0) - movsAnt.reduce((s, m) => s + (m.pallets_saida || 0), 0)
                  }
                  const ent = movsM.reduce((s, m) => s + (m.pallets_entrada || 0), 0)
                  const sai = movsM.reduce((s, m) => s + (m.pallets_saida || 0), 0)
                  const saldoFinalM = volIni + ent - sai
                  const pico = calcPPPico(volIni, movsM)
                  const vp = valorPalletEfetivo({ modoCalculo: cliente?.modo_calculo, ppPico: pico, valorManual: saldoM?.valor_pallet, valorCliente: cliente?.valor_pallet })
                  const iq = saldoM?.percentual_imposto ?? cliente?.aliquota_imposto ?? 2
                  const base = pico * vp
                  const total = base * (1 + iq / 100)
                  const isAtual = mes === mesAtual
                  return (
                    <tr
                      key={mes}
                      className={`cursor-pointer hover:bg-gray-50 transition-colors ${isAtual ? 'bg-blue-50/50' : ''}`}
                      onClick={() => setMesAtual(mes)}
                    >
                      <td className="px-4 py-3 font-medium text-[#0d1b2e]">
                        <div className="flex items-center gap-2">
                          {mesLabel(mes)}
                          {isAtual && <span className="text-xs bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded-full font-medium">atual</span>}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-right text-gray-600">{volIni}</td>
                      <td className="px-4 py-3 text-right text-blue-700 font-medium">{ent}</td>
                      <td className="px-4 py-3 text-right text-orange-600 font-medium">{sai}</td>
                      <td className="px-4 py-3 text-right font-bold text-[#0d1b2e]">{saldoFinalM}</td>
                      <td className="px-4 py-3 text-right font-bold text-[#0d1b2e]">{pico}</td>
                      <td className="px-4 py-3 text-right text-gray-600">{formatarMoeda(base)}</td>
                      <td className="px-4 py-3 text-right font-semibold text-emerald-700">{formatarMoeda(total)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Modal de edição do cliente */}
      {editando && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md mx-4 p-6">
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-lg font-bold text-[#0d1b2e]">Editar Cliente</h2>
              <button onClick={() => setEditando(false)} className="text-gray-400 hover:text-gray-700"><X className="w-5 h-5" /></button>
            </div>
            <div className="flex flex-col gap-3">
              <div>
                <label className="text-xs text-gray-500 mb-1 block">Nome fantasia</label>
                <input className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0d1b2e]/10" value={form.nome_fantasia} onChange={e => setForm(f => ({ ...f, nome_fantasia: e.target.value }))} />
              </div>
              <div>
                <label className="text-xs text-gray-500 mb-1 block">Razão social</label>
                <input className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0d1b2e]/10" value={form.nome} onChange={e => setForm(f => ({ ...f, nome: e.target.value }))} />
              </div>
              <div>
                <label className="text-xs text-gray-500 mb-1 block">CNPJ</label>
                <input className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0d1b2e]/10" value={form.cnpj} onChange={e => setForm(f => ({ ...f, cnpj: e.target.value }))} />
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="text-xs text-gray-500 mb-1 block">Valor/pallet (R$)</label>
                  <input type="number" step="0.01" className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0d1b2e]/10" value={form.valor_pallet} onChange={e => setForm(f => ({ ...f, valor_pallet: e.target.value }))} />
                </div>
                <div>
                  <label className="text-xs text-gray-500 mb-1 block">Imposto (%)</label>
                  <input type="number" step="0.01" className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0d1b2e]/10" value={form.aliquota_imposto} onChange={e => setForm(f => ({ ...f, aliquota_imposto: e.target.value }))} />
                </div>
                <div>
                  <label className="text-xs text-gray-500 mb-1 block">Fator pallet</label>
                  <input type="number" step="0.1" className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0d1b2e]/10" value={form.regra_fator_pallet} onChange={e => setForm(f => ({ ...f, regra_fator_pallet: e.target.value }))} />
                </div>
              </div>
              {/* Toggle Separação por Unidade de Sacaria */}
              <div className="mt-4 flex items-center justify-between p-3 bg-amber-50 rounded-xl border border-amber-100">
                <div>
                  <p className="text-sm font-medium text-gray-700">Separação por Unidade de Sacaria</p>
                  <p className="text-xs text-gray-400 mt-0.5">Itens &lt; 1,2 ton são cobrados por unidade de sacaria (R$ 4,50/un) em vez de pallets</p>
                </div>
                <button
                  type="button"
                  onClick={() => salvarEdicao_SeparacaoToggle()}
                  className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${cliente?.cobrar_separacao_sacaria ? 'bg-amber-500' : 'bg-gray-200'}`}
                >
                  <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${cliente?.cobrar_separacao_sacaria ? 'translate-x-6' : 'translate-x-1'}`} />
                </button>
              </div>
            </div>
            <div className="flex justify-end gap-2 mt-6">
              <button onClick={() => setEditando(false)} className="px-4 py-2 rounded-xl border border-gray-200 text-sm text-gray-600 hover:bg-gray-50">Cancelar</button>
              <button onClick={salvarEdicao} disabled={salvando} className="px-4 py-2 rounded-xl bg-[#0d1b2e] text-white text-sm font-semibold hover:bg-[#1a3a5c] disabled:opacity-60">
                {salvando ? 'Salvando...' : 'Salvar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  )
}

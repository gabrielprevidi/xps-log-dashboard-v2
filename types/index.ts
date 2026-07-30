export interface Cliente {
  id: string
  nome: string
  nome_fantasia: string
  cnpj: string
  ativo: boolean
  valor_pallet: number
  aliquota_imposto: number
  regra_fator_pallet: number
  modo_calculo: string  // 'padrao' | 'fedrigoni'
  created_at: string
  updated_at: string
}

export interface ClienteProduto {
  id: string
  cliente_id: string
  nome: string
  codigo_ncm: string | null
  palavras_chave: string | null
  valor_pallet: number
  aliquota_imposto: number
  regra_fator_pallet: number
  ativo: boolean
  ordem: number
  created_at: string
  updated_at: string
}

export interface Movimentacao {
  id: string
  cliente_id: string
  arquivo_nfe_id: string | null
  produto_id: string | null
  produto_nome: string | null
  tipo_movimentacao: 'entrada' | 'saida'
  categoria_movimentacao: 'mp' | 'pa' | 'sacaria' | 'big_bag' | 'descarga_pallet' | 'outro'
  fornecedor: string | null
  cliente_destino: string | null
  tipo_produto: string | null
  descricao_produto: string | null
  data_entrada: string | null
  qtd_entrada_ton: number | null
  pallets_entrada: number | null
  data_saida: string | null
  qtd_saida_ton: number | null
  pallets_saida: number | null
  valor_pallet: number | null
  percentual_imposto: number | null
  numero_nfe: string | null
  chave_nfe: string | null
  observacoes: string | null
  created_at: string
  updated_at: string
}

export interface SaldoMensal {
  id: string
  cliente_id: string
  competencia: string
  volume_inicial: number
  valor_pallet: number
  percentual_imposto: number
  observacoes: string | null
  created_at: string
  updated_at: string
}

export interface ArquivoNfe {
  id: string
  email_id: string | null
  nome_arquivo: string
  tipo_arquivo: 'xml' | 'pdf' | 'outro'
  url_storage: string | null
  hash_arquivo: string | null
  chave_nfe: string | null
  numero_nfe: string | null
  data_emissao: string | null
  processado: boolean
  created_at: string
}

export interface EmailImportado {
  id: string
  message_id: string
  assunto: string
  remetente: string
  data_recebimento: string
  status_processamento: 'pendente' | 'processado' | 'erro' | 'duplicado'
  erro_processamento: string | null
  created_at: string
}

export interface SaldoDiario {
  data: string
  inicial: number
  pico: number
  entrada_pa: number
  saida_pa: number
  entrada_mp: number
  saida_mp: number
  saldo: number
}

export interface FechamentoMensal {
  cliente_id: string
  competencia: string
  volume_inicial: number
  total_entradas: number
  total_saidas: number
  saldo_final: number
  pp_pico: number
  valor_pallet: number
  percentual_imposto: number
  valor_armazenagem_base: number
  valor_armazenagem_com_imposto: number
}

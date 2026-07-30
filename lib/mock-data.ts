import { Cliente, Movimentacao, SaldoMensal, EmailImportado } from '@/types'

export const mockClientes: Cliente[] = [
  {
    id: '1',
    nome: 'Alpha Lum Indústria e Comércio Ltda',
    nome_fantasia: 'Alpha Lum',
    cnpj: '12.345.678/0001-99',
    ativo: true,
    valor_pallet: 38,
    aliquota_imposto: 2,
    regra_fator_pallet: 1.2,
    modo_calculo: 'padrao',
    created_at: '2025-01-01T00:00:00Z',
    updated_at: '2025-11-01T00:00:00Z',
  },
  {
    id: '2',
    nome: 'Beta Indústrias S.A.',
    nome_fantasia: 'Beta Ind',
    cnpj: '98.765.432/0001-11',
    ativo: true,
    valor_pallet: 42,
    aliquota_imposto: 2,
    regra_fator_pallet: 1.2,
    modo_calculo: 'padrao',
    created_at: '2025-01-01T00:00:00Z',
    updated_at: '2025-11-01T00:00:00Z',
  },
  {
    id: '3',
    nome: 'Gamma Distribuidora Ltda',
    nome_fantasia: 'Gamma Dist',
    cnpj: '55.444.333/0001-22',
    ativo: true,
    valor_pallet: 35,
    aliquota_imposto: 3,
    regra_fator_pallet: 1.2,
    modo_calculo: 'padrao',
    created_at: '2025-01-01T00:00:00Z',
    updated_at: '2025-11-01T00:00:00Z',
  },
]

export const mockSaldosMensais: SaldoMensal[] = [
  {
    id: '1',
    cliente_id: '1',
    competencia: '2025-11-01',
    volume_inicial: 95,
    valor_pallet: 38,
    percentual_imposto: 2,
    observacoes: null,
    created_at: '2025-11-01T00:00:00Z',
    updated_at: '2025-11-01T00:00:00Z',
  },
  {
    id: '2',
    cliente_id: '2',
    competencia: '2025-11-01',
    volume_inicial: 60,
    valor_pallet: 42,
    percentual_imposto: 2,
    observacoes: null,
    created_at: '2025-11-01T00:00:00Z',
    updated_at: '2025-11-01T00:00:00Z',
  },
]

export function gerarMovimentacoesAlphaLum(): Movimentacao[] {
  const movs: Movimentacao[] = []
  const dados = [
    { dia: 3, tipo: 'entrada', cat: 'pa', ton: 2.4, pallets: 2 },
    { dia: 5, tipo: 'entrada', cat: 'mp', ton: 3.6, pallets: 3 },
    { dia: 7, tipo: 'saida', cat: 'pa', ton: 1.2, pallets: 1 },
    { dia: 10, tipo: 'entrada', cat: 'pa', ton: 6.0, pallets: 5 },
    { dia: 12, tipo: 'saida', cat: 'mp', ton: 2.4, pallets: 2 },
    { dia: 15, tipo: 'entrada', cat: 'pa', ton: 4.8, pallets: 4 },
    { dia: 18, tipo: 'saida', cat: 'pa', ton: 3.6, pallets: 3 },
    { dia: 20, tipo: 'entrada', cat: 'mp', ton: 2.6, pallets: 3 },
    { dia: 22, tipo: 'saida', cat: 'pa', ton: 2.4, pallets: 2 },
    { dia: 25, tipo: 'entrada', cat: 'pa', ton: 3.6, pallets: 3 },
    { dia: 28, tipo: 'saida', cat: 'mp', ton: 1.2, pallets: 1 },
  ]

  dados.forEach((d, i) => {
    const data = `2025-11-${String(d.dia).padStart(2, '0')}`
    movs.push({
      id: `mov-alpha-${i + 1}`,
      cliente_id: '1',
      arquivo_nfe_id: `nfe-${i + 1}`,
      tipo_movimentacao: d.tipo as 'entrada' | 'saida',
      categoria_movimentacao: d.cat as 'pa' | 'mp',
      fornecedor: d.tipo === 'entrada' ? 'Fornecedor Exemplo Ltda' : null,
      cliente_destino: d.tipo === 'saida' ? 'Cliente Final S.A.' : null,
      tipo_produto: d.cat === 'pa' ? 'Produto Acabado' : 'Matéria Prima',
      descricao_produto: d.cat === 'pa' ? 'Produto PA-001' : 'Matéria Prima MP-001',
      data_entrada: d.tipo === 'entrada' ? data : null,
      qtd_entrada_ton: d.tipo === 'entrada' ? d.ton : null,
      pallets_entrada: d.tipo === 'entrada' ? d.pallets : null,
      data_saida: d.tipo === 'saida' ? data : null,
      qtd_saida_ton: d.tipo === 'saida' ? d.ton : null,
      pallets_saida: d.tipo === 'saida' ? d.pallets : null,
      valor_pallet: 38,
      percentual_imposto: 2,
      numero_nfe: `${55000 + i}`,
      chave_nfe: `35251112345678000199550010000550${String(i).padStart(9, '0')}`,
      observacoes: null,
      produto_id: null,
      produto_nome: null,
      created_at: `2025-11-${String(d.dia).padStart(2, '0')}T08:00:00Z`,
      updated_at: `2025-11-${String(d.dia).padStart(2, '0')}T08:00:00Z`,
    })
  })

  return movs
}

export const mockEmailsImportados: EmailImportado[] = [
  {
    id: '1',
    message_id: '<msg001@email.com>',
    assunto: 'NFe - Entrada Mercadoria - Alpha Lum',
    remetente: 'nfe@fornecedor.com.br',
    data_recebimento: '2025-11-03T09:15:00Z',
    status_processamento: 'processado',
    erro_processamento: null,
    created_at: '2025-11-03T09:15:00Z',
  },
  {
    id: '2',
    message_id: '<msg002@email.com>',
    assunto: 'NFe - Saída - Alpha Lum',
    remetente: 'nfe@fornecedor.com.br',
    data_recebimento: '2025-11-07T10:30:00Z',
    status_processamento: 'processado',
    erro_processamento: null,
    created_at: '2025-11-07T10:30:00Z',
  },
  {
    id: '3',
    message_id: '<msg003@email.com>',
    assunto: 'NFe - Entrada - Beta Ind',
    remetente: 'fiscal@beta.com.br',
    data_recebimento: '2025-11-10T14:00:00Z',
    status_processamento: 'erro',
    erro_processamento: 'XML inválido: tag <infNFe> não encontrada',
    created_at: '2025-11-10T14:00:00Z',
  },
  {
    id: '4',
    message_id: '<msg004@email.com>',
    assunto: 'NFe - Entrada Mercadoria - Alpha Lum',
    remetente: 'nfe@fornecedor.com.br',
    data_recebimento: '2025-11-15T11:20:00Z',
    status_processamento: 'processado',
    erro_processamento: null,
    created_at: '2025-11-15T11:20:00Z',
  },
  {
    id: '5',
    message_id: '<msg005@email.com>',
    assunto: 'NFe - Saída',
    remetente: 'nfe@clientefinal.com.br',
    data_recebimento: '2025-11-22T09:00:00Z',
    status_processamento: 'pendente',
    erro_processamento: null,
    created_at: '2025-11-22T09:00:00Z',
  },
]

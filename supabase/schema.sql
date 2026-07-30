-- XPS Log — Controle de Armazenagem
-- Schema Supabase

-- ============================================================
-- TABELA: clientes
-- ============================================================
create table clientes (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  nome_fantasia text not null,
  cnpj text unique not null,
  ativo boolean default true,
  valor_pallet numeric(10, 2) default 0,
  aliquota_imposto numeric(5, 2) default 0,
  regra_fator_pallet numeric(5, 2) default 1.2,
  cobrar_separacao_sacaria boolean default false,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- ============================================================
-- TABELA: emails_importados
-- ============================================================
create table emails_importados (
  id uuid primary key default gen_random_uuid(),
  message_id text unique not null,
  assunto text,
  remetente text,
  data_recebimento timestamptz,
  status_processamento text default 'pendente'
    check (status_processamento in ('pendente', 'processado', 'erro', 'duplicado')),
  erro_processamento text,
  created_at timestamptz default now()
);

-- ============================================================
-- TABELA: arquivos_nfe
-- ============================================================
create table arquivos_nfe (
  id uuid primary key default gen_random_uuid(),
  email_id uuid references emails_importados(id),
  nome_arquivo text not null,
  tipo_arquivo text not null
    check (tipo_arquivo in ('xml', 'pdf', 'outro')),
  url_storage text,
  hash_arquivo text unique,
  chave_nfe text unique,
  numero_nfe text,
  data_emissao date,
  processado boolean default false,
  created_at timestamptz default now()
);

-- ============================================================
-- TABELA: movimentacoes
-- ============================================================
create table movimentacoes (
  id uuid primary key default gen_random_uuid(),
  cliente_id uuid references clientes(id) not null,
  arquivo_nfe_id uuid references arquivos_nfe(id),
  tipo_movimentacao text not null
    check (tipo_movimentacao in ('entrada', 'saida')),
  categoria_movimentacao text not null
    check (categoria_movimentacao in ('mp', 'pa', 'sacaria', 'big_bag', 'descarga_pallet', 'outro')),
  fornecedor text,
  cliente_destino text,
  tipo_produto text,
  descricao_produto text,
  data_entrada date,
  qtd_entrada_ton numeric(12, 4),
  pallets_entrada integer,
  data_saida date,
  qtd_saida_ton numeric(12, 4),
  pallets_saida integer,
  valor_pallet numeric(10, 2),
  percentual_imposto numeric(5, 2),
  numero_nfe text,
  chave_nfe text,
  observacoes text,
  created_by text,
  updated_by text,
  source_email_id uuid references emails_importados(id),
  source_file_id uuid references arquivos_nfe(id),
  processamento_log text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Índices de performance
create index idx_movimentacoes_cliente_id on movimentacoes(cliente_id);
create index idx_movimentacoes_data_entrada on movimentacoes(data_entrada);
create index idx_movimentacoes_data_saida on movimentacoes(data_saida);
create index idx_movimentacoes_tipo on movimentacoes(tipo_movimentacao);

-- ============================================================
-- TABELA: saldos_mensais
-- ============================================================
create table saldos_mensais (
  id uuid primary key default gen_random_uuid(),
  cliente_id uuid references clientes(id) not null,
  competencia date not null,
  volume_inicial numeric(10, 2) default 0,
  valor_pallet numeric(10, 2) default 0,
  percentual_imposto numeric(5, 2) default 0,
  observacoes text,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique(cliente_id, competencia)
);

-- ============================================================
-- VIEW: fechamento_mensal_cliente
-- ============================================================
create or replace view fechamento_mensal_cliente as
select
  m.cliente_id,
  date_trunc('month', coalesce(m.data_entrada, m.data_saida))::date as competencia,
  sm.volume_inicial,
  sum(case when m.tipo_movimentacao = 'entrada' then m.pallets_entrada else 0 end) as total_entradas,
  sum(case when m.tipo_movimentacao = 'saida' then m.pallets_saida else 0 end) as total_saidas,
  sm.volume_inicial
    + sum(case when m.tipo_movimentacao = 'entrada' then m.pallets_entrada else 0 end)
    - sum(case when m.tipo_movimentacao = 'saida' then m.pallets_saida else 0 end) as saldo_final,
  sm.valor_pallet,
  sm.percentual_imposto
from movimentacoes m
left join saldos_mensais sm
  on sm.cliente_id = m.cliente_id
  and sm.competencia = date_trunc('month', coalesce(m.data_entrada, m.data_saida))::date
group by
  m.cliente_id,
  date_trunc('month', coalesce(m.data_entrada, m.data_saida)),
  sm.volume_inicial,
  sm.valor_pallet,
  sm.percentual_imposto;

-- ============================================================
-- TABELA: mapeamento_clientes (para identificação automática)
-- ============================================================
create table mapeamento_clientes (
  id uuid primary key default gen_random_uuid(),
  cliente_id uuid references clientes(id) not null,
  cnpj_emitente text,
  cnpj_destinatario text,
  fornecedor_padrao text,
  alias_nome text,
  created_at timestamptz default now()
);

-- ============================================================
-- DADOS INICIAIS DE EXEMPLO
-- ============================================================

-- Inserir cliente Alpha Lum
insert into clientes (nome, nome_fantasia, cnpj, valor_pallet, aliquota_imposto, regra_fator_pallet)
values (
  'Alpha Lum Indústria e Comércio Ltda',
  'Alpha Lum',
  '12.345.678/0001-99',
  38.00,
  2.00,
  1.20
);

-- Saldo inicial Novembro 2025
insert into saldos_mensais (cliente_id, competencia, volume_inicial, valor_pallet, percentual_imposto)
select id, '2025-11-01', 95, 38.00, 2.00 from clientes where nome_fantasia = 'Alpha Lum';

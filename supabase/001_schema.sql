-- =============================================================
-- XPS LOG — Schema inicial do Supabase
-- Execute no SQL Editor do Supabase ou via script de migração
-- =============================================================

-- Extensões necessárias
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ─────────────────────────────────────────
-- CLIENTES
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS clientes (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nome            TEXT NOT NULL,
  nome_fantasia   TEXT,
  cnpj            TEXT UNIQUE,
  ativo           BOOLEAN DEFAULT true,
  valor_pallet    NUMERIC(10,2) DEFAULT 38.00,
  aliquota_imposto NUMERIC(5,2) DEFAULT 2.00,
  regra_fator_pallet NUMERIC(5,2) DEFAULT 1.2,
  created_at      TIMESTAMPTZ DEFAULT now(),
  updated_at      TIMESTAMPTZ DEFAULT now()
);

-- Mapeamento CNPJ → cliente (emitentes e destinatários)
CREATE TABLE IF NOT EXISTS clientes_cnpj (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cliente_id  UUID NOT NULL REFERENCES clientes(id) ON DELETE CASCADE,
  cnpj        TEXT NOT NULL,
  tipo        TEXT DEFAULT 'emitente',  -- 'emitente' | 'destinatario'
  created_at  TIMESTAMPTZ DEFAULT now(),
  UNIQUE (cliente_id, cnpj)
);

-- ─────────────────────────────────────────
-- EMAILS IMPORTADOS
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS emails_importados (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id            TEXT UNIQUE NOT NULL,
  assunto               TEXT,
  remetente             TEXT,
  data_recebimento      TIMESTAMPTZ,
  status_processamento  TEXT DEFAULT 'processado',
  -- 'pendente' | 'processado' | 'erro' | 'ignorado' | 'duplicado'
  erro_processamento    TEXT,
  created_at            TIMESTAMPTZ DEFAULT now()
);

-- ─────────────────────────────────────────
-- ARQUIVOS NFE
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS arquivos_nfe (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email_id            UUID REFERENCES emails_importados(id),
  nome_arquivo        TEXT,
  tipo_arquivo        TEXT DEFAULT 'pdf',  -- 'xml' | 'pdf'
  hash_arquivo        TEXT UNIQUE,
  chave_nfe           TEXT UNIQUE,
  numero_nfe          TEXT,
  data_emissao        DATE,
  cnpj_emitente       TEXT,
  nome_emitente       TEXT,
  cnpj_destinatario   TEXT,
  nome_destinatario   TEXT,
  cfop                TEXT,
  tipo_operacao       TEXT,               -- 'entrada' | 'saida'
  peso_liquido_ton    NUMERIC(12,4),
  pallets_calculados  INTEGER,
  processado          BOOLEAN DEFAULT true,
  created_at          TIMESTAMPTZ DEFAULT now()
);

-- ─────────────────────────────────────────
-- MOVIMENTAÇÕES (tabela principal)
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS movimentacoes (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cliente_id              UUID REFERENCES clientes(id),
  arquivo_nfe_id          UUID REFERENCES arquivos_nfe(id),
  tipo_movimentacao       TEXT NOT NULL,   -- 'entrada' | 'saida'
  categoria_movimentacao  TEXT DEFAULT 'pa',
  -- 'mp' | 'pa' | 'sacaria' | 'big_bag' | 'descarga_pallet' | 'outro'
  fornecedor              TEXT,
  cliente_destino         TEXT,
  tipo_produto            TEXT,
  descricao_produto       TEXT,
  data_entrada            DATE,
  qtd_entrada_ton         NUMERIC(12,4),
  pallets_entrada         INTEGER,
  data_saida              DATE,
  qtd_saida_ton           NUMERIC(12,4),
  pallets_saida           INTEGER,
  valor_pallet            NUMERIC(10,2),
  percentual_imposto      NUMERIC(5,2),
  numero_nfe              TEXT,
  chave_nfe               TEXT,
  observacoes             TEXT,
  created_at              TIMESTAMPTZ DEFAULT now(),
  updated_at              TIMESTAMPTZ DEFAULT now()
);

-- ─────────────────────────────────────────
-- SALDOS MENSAIS (input manual por cliente/mês)
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS saldos_mensais (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cliente_id          UUID NOT NULL REFERENCES clientes(id),
  competencia         DATE NOT NULL,  -- primeiro dia do mês: 2025-11-01
  volume_inicial      INTEGER DEFAULT 0,
  valor_pallet        NUMERIC(10,2),
  percentual_imposto  NUMERIC(5,2),
  observacoes         TEXT,
  created_at          TIMESTAMPTZ DEFAULT now(),
  updated_at          TIMESTAMPTZ DEFAULT now(),
  UNIQUE (cliente_id, competencia)
);

-- ─────────────────────────────────────────
-- INDEXES
-- ─────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_emails_message_id      ON emails_importados(message_id);
CREATE INDEX IF NOT EXISTS idx_emails_data            ON emails_importados(data_recebimento DESC);
CREATE INDEX IF NOT EXISTS idx_arquivos_hash          ON arquivos_nfe(hash_arquivo);
CREATE INDEX IF NOT EXISTS idx_arquivos_chave         ON arquivos_nfe(chave_nfe);
CREATE INDEX IF NOT EXISTS idx_arquivos_email         ON arquivos_nfe(email_id);
CREATE INDEX IF NOT EXISTS idx_mov_cliente            ON movimentacoes(cliente_id);
CREATE INDEX IF NOT EXISTS idx_mov_data_entrada       ON movimentacoes(data_entrada DESC);
CREATE INDEX IF NOT EXISTS idx_mov_data_saida         ON movimentacoes(data_saida DESC);
CREATE INDEX IF NOT EXISTS idx_mov_arquivo            ON movimentacoes(arquivo_nfe_id);
CREATE INDEX IF NOT EXISTS idx_clientes_cnpj_cnpj     ON clientes_cnpj(cnpj);

-- ─────────────────────────────────────────
-- VIEW: fechamento mensal por cliente
-- ─────────────────────────────────────────
CREATE OR REPLACE VIEW fechamento_mensal_cliente AS
SELECT
  m.cliente_id,
  date_trunc('month', COALESCE(m.data_entrada, m.data_saida))::DATE AS competencia,
  c.nome_fantasia  AS cliente_nome,
  c.nome           AS cliente_razao_social,
  sm.volume_inicial,
  COALESCE(sm.valor_pallet, c.valor_pallet)                 AS valor_pallet,
  COALESCE(sm.percentual_imposto, c.aliquota_imposto)       AS percentual_imposto,
  COALESCE(SUM(CASE WHEN m.tipo_movimentacao = 'entrada' THEN m.pallets_entrada ELSE 0 END), 0)  AS total_entradas_pallets,
  COALESCE(SUM(CASE WHEN m.tipo_movimentacao = 'saida'   THEN m.pallets_saida   ELSE 0 END), 0)  AS total_saidas_pallets,
  COALESCE(SUM(CASE WHEN m.tipo_movimentacao = 'entrada' THEN m.qtd_entrada_ton ELSE 0 END), 0)  AS total_entradas_ton,
  COALESCE(SUM(CASE WHEN m.tipo_movimentacao = 'saida'   THEN m.qtd_saida_ton   ELSE 0 END), 0)  AS total_saidas_ton,
  COUNT(*)  AS total_nfes
FROM movimentacoes m
JOIN clientes c ON m.cliente_id = c.id
LEFT JOIN saldos_mensais sm
  ON sm.cliente_id  = m.cliente_id
  AND sm.competencia = date_trunc('month', COALESCE(m.data_entrada, m.data_saida))::DATE
WHERE m.cliente_id IS NOT NULL
GROUP BY
  m.cliente_id,
  date_trunc('month', COALESCE(m.data_entrada, m.data_saida))::DATE,
  c.nome_fantasia,
  c.nome,
  sm.volume_inicial,
  sm.valor_pallet,
  c.valor_pallet,
  sm.percentual_imposto,
  c.aliquota_imposto;

-- ─────────────────────────────────────────
-- RLS — desabilitado por enquanto (habilitar depois com policies corretas)
-- ─────────────────────────────────────────
ALTER TABLE clientes           DISABLE ROW LEVEL SECURITY;
ALTER TABLE clientes_cnpj      DISABLE ROW LEVEL SECURITY;
ALTER TABLE emails_importados  DISABLE ROW LEVEL SECURITY;
ALTER TABLE arquivos_nfe       DISABLE ROW LEVEL SECURITY;
ALTER TABLE movimentacoes      DISABLE ROW LEVEL SECURITY;
ALTER TABLE saldos_mensais     DISABLE ROW LEVEL SECURITY;

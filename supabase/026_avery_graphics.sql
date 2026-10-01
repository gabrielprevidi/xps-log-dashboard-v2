-- Migration 026: controle de estoque Avery Graphics (caixas × palets)
--
-- O produto Graphics da Avery é contabilizado por UNIDADE (caixa), mas cobrado
-- por PALET. Um palet fechado tem 30 caixas do mesmo SKU e só deixa de contar
-- quando a última caixa dele sai:
--
--     palets ocupados = CEIL(saldo_em_caixas / unidades_por_palet)
--
-- Premissa: a separação esvazia um palet por vez (as saídas consomem o palet
-- aberto antes de abrir outro). Os saldos são sempre por SKU, nunca somados
-- entre SKUs diferentes.
--
-- Itens Graphics ficam FORA de `movimentacoes` (que conta volumes 1:1 no modo
-- 'avery'), para não contar o mesmo produto duas vezes na cobrança.
--
-- Esta migration só cria estrutura; a ingestão e o backfill vêm depois.

-- ─────────────────────────────────────────
-- SKUs do Graphics
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS graphics_sku (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cliente_id          UUID NOT NULL REFERENCES clientes(id) ON DELETE CASCADE,
  codigo              TEXT NOT NULL,                 -- cProd da NF-e
  descricao           TEXT,
  unidades_por_palet  INTEGER NOT NULL DEFAULT 30 CHECK (unidades_por_palet > 0),
  ativo               BOOLEAN NOT NULL DEFAULT true,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (cliente_id, codigo)
);

-- ─────────────────────────────────────────
-- Movimentações em caixas, uma linha por item de NF-e
-- ─────────────────────────────────────────
-- tipo:
--   'entrada' | 'saida'  → vêm das NF-e; qtd_unidades sempre positiva
--   'ajuste'             → inventário físico / saldo de abertura;
--                          qtd_unidades COM SINAL (+ soma, − subtrai)
CREATE TABLE IF NOT EXISTS graphics_movimentacoes (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sku_id          UUID NOT NULL REFERENCES graphics_sku(id) ON DELETE CASCADE,
  arquivo_nfe_id  UUID REFERENCES arquivos_nfe(id) ON DELETE SET NULL,
  numero_nfe      TEXT,
  tipo            TEXT NOT NULL CHECK (tipo IN ('entrada', 'saida', 'ajuste')),
  data_mov        DATE NOT NULL,
  qtd_unidades    INTEGER NOT NULL,
  observacoes     TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (tipo = 'ajuste' OR qtd_unidades > 0)
);

CREATE INDEX IF NOT EXISTS idx_graphics_sku_cliente ON graphics_sku(cliente_id);
CREATE INDEX IF NOT EXISTS idx_graphics_mov_sku_data ON graphics_movimentacoes(sku_id, data_mov);
CREATE INDEX IF NOT EXISTS idx_graphics_mov_arquivo ON graphics_movimentacoes(arquivo_nfe_id);

-- Reprocessar a mesma NF-e não pode duplicar o item
CREATE UNIQUE INDEX IF NOT EXISTS uq_graphics_mov_nfe_sku
  ON graphics_movimentacoes(arquivo_nfe_id, sku_id, tipo)
  WHERE arquivo_nfe_id IS NOT NULL;

-- ─────────────────────────────────────────
-- Saldo por SKU e mês
-- ─────────────────────────────────────────
-- Uma linha por SKU/mês com movimento. Os palets são derivados do saldo:
--   palets_inicio / palets_fim → ocupação no começo e no fim do mês
--   palets_entrada = palets que passaram a ser ocupados no mês (≥ 0)
--   palets_saida   = palets liberados no mês (≥ 0)
-- (calculados pela variação líquida da ocupação, não pela soma das notas)
CREATE OR REPLACE VIEW graphics_saldo_mensal AS
WITH mensal AS (
  SELECT
    m.sku_id,
    date_trunc('month', m.data_mov)::date AS competencia,
    SUM(CASE WHEN m.tipo = 'entrada' THEN m.qtd_unidades ELSE 0 END) AS caixas_entrada,
    SUM(CASE WHEN m.tipo = 'saida'   THEN m.qtd_unidades ELSE 0 END) AS caixas_saida,
    SUM(CASE WHEN m.tipo = 'ajuste'  THEN m.qtd_unidades ELSE 0 END) AS caixas_ajuste
  FROM graphics_movimentacoes m
  GROUP BY m.sku_id, date_trunc('month', m.data_mov)
),
acumulado AS (
  SELECT
    mensal.*,
    SUM(caixas_entrada - caixas_saida + caixas_ajuste)
      OVER (PARTITION BY sku_id ORDER BY competencia) AS saldo_fim
  FROM mensal
)
SELECT
  s.cliente_id,
  a.sku_id,
  s.codigo,
  s.descricao,
  a.competencia,
  s.unidades_por_palet,
  a.caixas_entrada,
  a.caixas_saida,
  a.caixas_ajuste,
  (a.saldo_fim - a.caixas_entrada + a.caixas_saida - a.caixas_ajuste) AS saldo_inicio,
  a.saldo_fim,
  CEIL((a.saldo_fim - a.caixas_entrada + a.caixas_saida - a.caixas_ajuste)::numeric
       / s.unidades_por_palet)::int AS palets_inicio,
  CEIL(a.saldo_fim::numeric / s.unidades_por_palet)::int AS palets_fim,
  GREATEST(0, CEIL(a.saldo_fim::numeric / s.unidades_por_palet)::int
            - CEIL((a.saldo_fim - a.caixas_entrada + a.caixas_saida - a.caixas_ajuste)::numeric
                   / s.unidades_por_palet)::int) AS palets_entrada,
  GREATEST(0, CEIL((a.saldo_fim - a.caixas_entrada + a.caixas_saida - a.caixas_ajuste)::numeric
                   / s.unidades_por_palet)::int
            - CEIL(a.saldo_fim::numeric / s.unidades_por_palet)::int) AS palets_saida,
  (a.saldo_fim % s.unidades_por_palet) AS caixas_palet_aberto
FROM acumulado a
JOIN graphics_sku s ON s.id = a.sku_id;

ALTER TABLE graphics_sku           DISABLE ROW LEVEL SECURITY;
ALTER TABLE graphics_movimentacoes DISABLE ROW LEVEL SECURITY;

-- Migration 029: Graphics — dimensões do rolo e caixas fracionadas
--
-- 2026-10-01: as saídas do Graphics vêm nas NF-e em m², não em caixas. Uma
-- caixa é um rolo (largura × comprimento, ex.: W1270/L50 = 1,27 m × 50 m =
-- 63,5 m²), então caixas = m² ÷ (largura × comprimento). Cortes menores que um
-- rolo geram fração de caixa, que se acumula entre notas — por isso a
-- quantidade passa a ser NUMERIC.
--
-- A view da migration 026 usava a regra antiga (CEIL do saldo) e depende da
-- coluna alterada; é removida. O cálculo de saldo e palets vive em
-- lib/graphics-saldo.ts, que é o que a tela e a cobrança usam.

DROP VIEW IF EXISTS graphics_saldo_mensal;

ALTER TABLE graphics_sku
  ADD COLUMN IF NOT EXISTS largura_mm    INTEGER,
  ADD COLUMN IF NOT EXISTS comprimento_m NUMERIC(8,2);

ALTER TABLE graphics_movimentacoes
  ALTER COLUMN qtd_unidades TYPE NUMERIC(12,4);

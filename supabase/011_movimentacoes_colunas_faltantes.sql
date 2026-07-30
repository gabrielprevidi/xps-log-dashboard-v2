-- Migration 011: Colunas faltantes na tabela movimentacoes
-- Adiciona campos usados pelo código mas ausentes no schema original.

-- Fator pallet por linha de movimentação (editável na Separação por Sacaria)
ALTER TABLE movimentacoes
  ADD COLUMN IF NOT EXISTS regra_fator_pallet NUMERIC(5,2);

-- Soft-delete: marca movimentação como cancelada sem removê-la do histórico
ALTER TABLE movimentacoes
  ADD COLUMN IF NOT EXISTS cancelada BOOLEAN NOT NULL DEFAULT false;

-- Valor de manuseio por unidade de sacaria (R$ por unidade)
ALTER TABLE movimentacoes
  ADD COLUMN IF NOT EXISTS valor_manuseio NUMERIC(10,2);

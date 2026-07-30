-- Adiciona coluna natureza_operacao em arquivos_nfe
-- Necessário para classificar entrada/saída pela natureza da NF-e

ALTER TABLE arquivos_nfe
  ADD COLUMN IF NOT EXISTS natureza_operacao TEXT;

-- Migration 010: Modo de cálculo por cliente
-- Permite configurar lógica de armazenagem específica por cliente.
-- 'padrao'   → comportamento padrão (Alphalum e demais): pallets via peso × fator
-- 'fedrigoni' → leitura somente PDF, classificação por código DANFE (0/1),
--               volume = QUANTIDADE do campo ESPÉCIE, fator 1:1, valor fixo por volume

ALTER TABLE clientes
  ADD COLUMN IF NOT EXISTS modo_calculo TEXT NOT NULL DEFAULT 'padrao';

COMMENT ON COLUMN clientes.modo_calculo IS 'Modo de cálculo de armazenagem: padrao | fedrigoni';

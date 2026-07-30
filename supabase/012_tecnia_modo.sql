-- Migration 012: Modo de cálculo Tecnia
-- Adiciona o modo 'tecnia' à documentação da coluna modo_calculo (já criada
-- na migration 010, sem CHECK constraint — aceita qualquer texto).
-- 'tecnia' → leitura somente PDF, sem identificação de categoria,
--            volume = QUANTIDADE do campo ESPÉCIE, fator 1:1,
--            entrada = natureza contendo "remessa", saída = natureza contendo "retorno"

COMMENT ON COLUMN clientes.modo_calculo IS 'Modo de cálculo de armazenagem: padrao | fedrigoni | tecnia';

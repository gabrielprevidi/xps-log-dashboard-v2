-- Migration 013: Modo de cálculo Avery
-- Adiciona o modo 'avery' à documentação da coluna modo_calculo (já criada
-- na migration 010, sem CHECK constraint — aceita qualquer texto).
-- 'avery' → lê XML e PDF normalmente, sem identificação de categoria,
--           volume = QUANTIDADE de volumes transportados (qVol do XML /
--           campo ESPÉCIE do DANFE), fator 1:1, entrada/saída pela
--           natureza da operação (regra padrão).
-- Motivo: a Avery não informa peso líquido nas NF-e (campo opcional que
-- o emitente deixa em branco), então o cálculo padrão por peso zerava a
-- quantidade em todas as notas.

COMMENT ON COLUMN clientes.modo_calculo IS 'Modo de cálculo de armazenagem: padrao | fedrigoni | tecnia | avery';

UPDATE clientes SET modo_calculo = 'avery' WHERE cnpj = '43.999.630/0001-24';

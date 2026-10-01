-- Migration 028: palets declarados na NF-e (Graphics)
--
-- A regra de palets do Graphics é por SKU (CEIL(caixas / 30)), mas a NF-e
-- declara o número de palets físicos (campo ESPÉCIE) e os dois nem sempre
-- coincidem — palet incompleto, palet misto de SKUs com poucas caixas.
-- Guardamos o declarado para exibir lado a lado.
--
-- Gravado APENAS na primeira linha de cada nota (os itens da mesma NF-e
-- compartilham o valor, então somar a coluna não duplica).

ALTER TABLE graphics_movimentacoes
  ADD COLUMN IF NOT EXISTS palets_declarados INTEGER;

-- Migration 030: inventário físico do Graphics como ponto de partida
--
-- 2026-10-07: inventário de todos os SKUs do Graphics feito em 03/10/2026.
-- Cada SKU recebe um lançamento de ajuste (tipo 'ajuste', com sinal) que leva o
-- saldo do sistema à contagem física. `inventario = true` marca esse ajuste
-- como ponto de partida: a regra de palets (entram CEIL(caixas/30), saem
-- FLOOR(saídas acumuladas/30)) recomeça dele, com os acumulados zerados e o
-- estoque contado como entrada — o palet de uma contagem física vale
-- CEIL(unidades/30), sem herdar frações de saídas antigas.

ALTER TABLE graphics_movimentacoes
  ADD COLUMN IF NOT EXISTS inventario BOOLEAN NOT NULL DEFAULT false;

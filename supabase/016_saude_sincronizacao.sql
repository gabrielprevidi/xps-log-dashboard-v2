-- Migration 016 — Detecção de sincronização travada
--
-- Motivo: entre 31/07 e 06/08/2026 a rotina rodou a cada 15 minutos retornando
-- "ok" em todas as execuções, mas presa na mesma mensagem. 825 emails ficaram
-- parados por dois dias e ninguém percebeu — os contadores existentes não
-- distinguem "rodou e não havia nada" de "rodou e não conseguiu avançar".
--
-- Estas duas colunas tornam a diferença visível:
--   avancou        → a marca d'água mexeu nesta rodada?
--   fila_restante  → quantas mensagens ainda esperam, somando todas as pastas
--
-- Travada = várias rodadas seguidas com avancou = false E fila_restante > 0.
-- Ocioso  = fila_restante = 0, independentemente de avancou.

ALTER TABLE sync_execucoes
  ADD COLUMN IF NOT EXISTS avancou BOOLEAN,
  ADD COLUMN IF NOT EXISTS fila_restante INTEGER;

COMMENT ON COLUMN sync_execucoes.avancou IS
  'A marca d''água de alguma pasta avançou nesta rodada. false com fila_restante > 0 em rodadas seguidas indica sincronização travada.';

COMMENT ON COLUMN sync_execucoes.fila_restante IS
  'Mensagens ainda não examinadas, somando todas as pastas monitoradas.';

-- Consulta de saúde (a mesma que a rota usa):
--
--   SELECT iniciado_em, status, emails_lidos, avancou, fila_restante
--     FROM sync_execucoes
--    ORDER BY iniciado_em DESC
--    LIMIT 5;
--
-- Se as 3 mais recentes tiverem avancou = false e fila_restante > 0,
-- a sincronização está travada.

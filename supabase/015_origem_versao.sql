-- Migration 015 — Identificação da versão que processou cada registro
--
-- Permite V1 e V2 rodarem em paralelo com rastreabilidade completa e, acima de
-- tudo, com reversão cirúrgica: se a V2 processar algo errado, apaga-se apenas
-- o que veio dela, sem tocar em nada da V1.
--
-- ADITIVA E SEGURA PARA A V1:
--   O DEFAULT 'v1' faz com que os INSERTs da V1 — que não conhecem esta coluna
--   e listam os campos explicitamente — sejam rotulados automaticamente.
--   Nada no código da V1 precisa mudar; ela continua funcionando sem saber que
--   a coluna existe.
--
-- ⚠ LIMITE IMPORTANTE:
--   Esta coluna NÃO separa os cálculos. Saldo diário, PP Pico, armazenagem e
--   fechamento mensal somam todas as movimentações do cliente, independentemente
--   da origem. Se a mesma nota entrar pelas duas versões, a deduplicação por
--   chave_nfe impede a duplicata — mas notas DIFERENTES vindas das duas caixas
--   somam no mesmo saldo. Para isolamento real de números, cada cliente deve ser
--   processado por uma única versão.

-- ─────────────────────────────────────────────────────────────
-- 1. Coluna nas três tabelas que recebem escrita das duas versões
-- ─────────────────────────────────────────────────────────────
ALTER TABLE movimentacoes
  ADD COLUMN IF NOT EXISTS origem TEXT NOT NULL DEFAULT 'v1';

ALTER TABLE arquivos_nfe
  ADD COLUMN IF NOT EXISTS origem TEXT NOT NULL DEFAULT 'v1';

ALTER TABLE emails_importados
  ADD COLUMN IF NOT EXISTS origem TEXT NOT NULL DEFAULT 'v1';

COMMENT ON COLUMN movimentacoes.origem IS
  'Versão que criou o registro: v1 (Microsoft Graph, xps.ai@exsa.srv.br, manual) | v2 (IMAP, armazenagem@xpslog.com.br, automático) | manual (inserção pelo dashboard)';

-- ─────────────────────────────────────────────────────────────
-- 2. Índices — as consultas de conferência e a reversão filtram por origem
-- ─────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_movimentacoes_origem     ON movimentacoes (origem);
CREATE INDEX IF NOT EXISTS idx_arquivos_nfe_origem      ON arquivos_nfe (origem);
CREATE INDEX IF NOT EXISTS idx_emails_importados_origem ON emails_importados (origem);

-- ─────────────────────────────────────────────────────────────
-- 3. Data de corte da V2
--    A V2 só considera emails recebidos a partir de 30/07/2026. Registrado em
--    sync_estado para que a rotina não dependa de constante no código.
-- ─────────────────────────────────────────────────────────────
ALTER TABLE sync_estado
  ADD COLUMN IF NOT EXISTS data_corte DATE NOT NULL DEFAULT '2026-07-30';

-- Marca d'água inicial do IMAP, lida da caixa em 30/07/2026:
--   host imap.xpslog.com.br:143 (STARTTLS) · Dovecot
--   INBOX: 13.325 mensagens · uidValidity 1639517096 · uidNext 175766
-- Começar em 175765 faz a primeira rodada pegar apenas mensagens novas.
UPDATE sync_estado
   SET pasta        = 'INBOX',
       uid_validity = 1639517096,
       ultimo_uid   = 175765,
       data_corte   = '2026-07-30',
       atualizado_em = now()
 WHERE id = 'imap';

-- ─────────────────────────────────────────────────────────────
-- Conferência (rodar depois, quando a V2 estiver ativa):
--
--   SELECT origem, count(*), min(created_at), max(created_at)
--     FROM movimentacoes GROUP BY origem;
--
-- Reversão total da V2, se necessário:
--
--   DELETE FROM movimentacoes     WHERE origem = 'v2';
--   DELETE FROM arquivos_nfe      WHERE origem = 'v2';
--   DELETE FROM emails_importados WHERE origem = 'v2';
-- ─────────────────────────────────────────────────────────────

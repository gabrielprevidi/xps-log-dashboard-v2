-- Migration 014 — Estado da ingestão automática (V2)
--
-- Aditiva: não altera nem remove nada da V1. As duas versões convivem no mesmo
-- banco enquanto a V1 estiver ativa.
--
-- Duas tabelas:
--   sync_estado     → posição de leitura no IMAP (rede de segurança; o controle
--                     principal de "já vi este email" é o move entre pastas no
--                     próprio servidor de email)
--   sync_execucoes  → uma linha por rodada do cron. Serve simultaneamente de
--                     log, de lock (impede rodadas sobrepostas) e de gatilho
--                     para o Realtime atualizar o dashboard.

-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS sync_estado (
  id            TEXT PRIMARY KEY DEFAULT 'imap',
  pasta         TEXT NOT NULL DEFAULT 'XPS/Entrada',
  uid_validity  BIGINT,
  ultimo_uid    BIGINT,
  atualizado_em TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO sync_estado (id, pasta)
VALUES ('imap', 'XPS/Entrada')
ON CONFLICT (id) DO NOTHING;

-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS sync_execucoes (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  iniciado_em        TIMESTAMPTZ NOT NULL DEFAULT now(),
  finalizado_em      TIMESTAMPTZ,
  status             TEXT NOT NULL DEFAULT 'rodando',  -- rodando | ok | erro
  gatilho            TEXT NOT NULL DEFAULT 'cron',     -- cron | manual
  emails_lidos       INT NOT NULL DEFAULT 0,
  emails_aceitos     INT NOT NULL DEFAULT 0,
  emails_descartados INT NOT NULL DEFAULT 0,
  nfes_salvas        INT NOT NULL DEFAULT 0,
  duplicados         INT NOT NULL DEFAULT 0,
  -- Contagem agregada dos motivos de descarte. Nunca guarda conteúdo de anexo.
  -- Ex.: {"sem_cliente": 4, "operacao_informativa": 2, "anexo_nao_nfe": 7}
  motivos_descarte   JSONB NOT NULL DEFAULT '{}'::jsonb,
  duracao_ms         INT,
  erro               TEXT
);

CREATE INDEX IF NOT EXISTS idx_sync_execucoes_iniciado
  ON sync_execucoes (iniciado_em DESC);

-- Lock: no máximo uma rodada com status 'rodando' por vez.
CREATE UNIQUE INDEX IF NOT EXISTS idx_sync_execucoes_lock
  ON sync_execucoes ((status)) WHERE status = 'rodando';

-- ─────────────────────────────────────────────────────────────
-- Realtime: o dashboard assina estas tabelas para atualizar sozinho quando o
-- cron termina. `movimentacoes` já existe desde a migration 001.
DO $$
BEGIN
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE sync_execucoes;
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE movimentacoes;
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;
END $$;

-- ─────────────────────────────────────────────────────────────
-- Retenção: a própria rotina apaga execuções com mais de 90 dias.
-- ~96 linhas/dia × 90 dias ≈ 8.600 linhas. Irrelevante em tamanho.

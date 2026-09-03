-- =============================================================
-- Verificação manual (conferência linha a linha) das movimentações
-- =============================================================

ALTER TABLE movimentacoes
  ADD COLUMN IF NOT EXISTS verificado            BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS verificado_em         TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS verificado_por        UUID REFERENCES usuarios_admin(id),
  ADD COLUMN IF NOT EXISTS verificado_por_nome   TEXT;

CREATE INDEX IF NOT EXISTS idx_mov_verificado ON movimentacoes(verificado);

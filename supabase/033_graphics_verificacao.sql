-- Migration 033: conferência das movimentações do Graphics (Avery Dennison)
--
-- Mesmo controle que a 022 criou para `movimentacoes`: cada lançamento em caixas
-- do Graphics pode ser marcado como conferido, guardando quem e quando.
ALTER TABLE graphics_movimentacoes
  ADD COLUMN IF NOT EXISTS verificado            BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS verificado_em         TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS verificado_por        UUID REFERENCES usuarios_admin(id),
  ADD COLUMN IF NOT EXISTS verificado_por_nome   TEXT;

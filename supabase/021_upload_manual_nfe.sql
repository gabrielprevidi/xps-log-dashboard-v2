-- =============================================================
-- Upload manual de NF-e (PDF) por cliente
-- =============================================================

ALTER TABLE arquivos_nfe
  ADD COLUMN IF NOT EXISTS arquivo_url    TEXT,
  ADD COLUMN IF NOT EXISTS upload_manual  BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS enviado_por    UUID REFERENCES usuarios_admin(id);

INSERT INTO storage.buckets (id, name, public)
VALUES ('notas-fiscais', 'notas-fiscais', true)
ON CONFLICT (id) DO NOTHING;

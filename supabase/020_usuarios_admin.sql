-- =============================================================
-- Usuários administrativos individuais + log de auditoria
-- Substitui a senha única de admin (ADMIN_PASSWORD) por contas
-- nominais, para sabermos quem fez cada alteração.
-- =============================================================

CREATE TABLE IF NOT EXISTS usuarios_admin (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nome        TEXT NOT NULL,
  email       TEXT UNIQUE NOT NULL,
  senha_hash  TEXT NOT NULL,
  ativo       BOOLEAN DEFAULT true,
  created_at  TIMESTAMPTZ DEFAULT now(),
  updated_at  TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS logs_auditoria (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  usuario_id    UUID REFERENCES usuarios_admin(id) ON DELETE SET NULL,
  usuario_nome  TEXT,        -- snapshot: sobrevive à exclusão do usuário
  acao          TEXT NOT NULL,   -- 'criar' | 'editar' | 'excluir' | 'verificar' | 'login' | ...
  entidade      TEXT NOT NULL,   -- 'cliente' | 'movimentacao' | 'nfe_manual' | 'usuario' | ...
  entidade_id   TEXT,
  detalhes      JSONB,
  criado_em     TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_logs_criado_em  ON logs_auditoria(criado_em DESC);
CREATE INDEX IF NOT EXISTS idx_logs_entidade   ON logs_auditoria(entidade, entidade_id);
CREATE INDEX IF NOT EXISTS idx_logs_usuario    ON logs_auditoria(usuario_id);

ALTER TABLE usuarios_admin  DISABLE ROW LEVEL SECURITY;
ALTER TABLE logs_auditoria  DISABLE ROW LEVEL SECURITY;

-- Adiciona credenciais de acesso ao portal do cliente
ALTER TABLE clientes
  ADD COLUMN IF NOT EXISTS portal_usuario TEXT UNIQUE,
  ADD COLUMN IF NOT EXISTS portal_senha_hash TEXT;

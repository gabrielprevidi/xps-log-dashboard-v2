-- Adiciona campo para vincular cliente ao domínio/email do remetente
-- Usado como fallback quando o CNPJ da NF-e não identifica o cliente

ALTER TABLE clientes
  ADD COLUMN IF NOT EXISTS email_remetente TEXT;

COMMENT ON COLUMN clientes.email_remetente IS
  'Email ou domínio do remetente para identificação automática. Ex: empresa.com ou joao@empresa.com';

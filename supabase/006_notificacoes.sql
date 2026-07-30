-- Notificações para o administrador
CREATE TABLE IF NOT EXISTS notificacoes (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  tipo TEXT NOT NULL,          -- 'aprovacao_cobranca'
  cliente_id UUID REFERENCES clientes(id) ON DELETE CASCADE,
  competencia TEXT,            -- 'YYYY-MM'
  mensagem TEXT,
  lida BOOLEAN DEFAULT FALSE,
  criado_em TIMESTAMPTZ DEFAULT NOW()
);

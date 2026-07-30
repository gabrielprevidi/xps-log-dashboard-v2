-- Fechamento mensal de cobrança por cliente
CREATE TABLE IF NOT EXISTS fechamento_mensal (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  cliente_id UUID NOT NULL REFERENCES clientes(id) ON DELETE CASCADE,
  competencia DATE NOT NULL,          -- primeiro dia do mês: YYYY-MM-01
  arquivo_cobranca_url  TEXT,         -- URL pública no Supabase Storage
  arquivo_cobranca_nome TEXT,
  status TEXT NOT NULL DEFAULT 'aberto',  -- aberto | fechado | aprovado
  aprovado_em TIMESTAMPTZ,
  criado_em   TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(cliente_id, competencia)
);

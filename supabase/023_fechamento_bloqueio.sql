-- Fechamento centralizado no painel administrativo
-- Fluxo antigo: aberto → fechado → (cliente aprova) aprovado → nf_emitida
-- Fluxo novo:   aberto → fechado (mês travado) → nf_emitida (NF anexada pelo admin)

ALTER TABLE fechamento_mensal ADD COLUMN IF NOT EXISTS fechado_em    TIMESTAMPTZ;
ALTER TABLE fechamento_mensal ADD COLUMN IF NOT EXISTS fechado_por   TEXT;
ALTER TABLE fechamento_mensal ADD COLUMN IF NOT EXISTS nf_anexada_em TIMESTAMPTZ;

-- Meses já aprovados pelo cliente continuam travados, agora como 'fechado'
UPDATE fechamento_mensal
   SET status = 'fechado'
 WHERE status = 'aprovado';

-- Preenche fechado_em para registros antigos (usa aprovado_em ou a criação)
UPDATE fechamento_mensal
   SET fechado_em = COALESCE(aprovado_em, criado_em)
 WHERE fechado_em IS NULL
   AND status IN ('fechado', 'nf_emitida');

-- Notificações do fluxo antigo de aprovação não têm mais uso
DELETE FROM notificacoes WHERE tipo IN ('aprovacao_cobranca', 'nf_emitida');

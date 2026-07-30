-- Bucket para NFs de cobrança mensal
INSERT INTO storage.buckets (id, name, public)
VALUES ('cobrancas', 'cobrancas', true)
ON CONFLICT (id) DO NOTHING;

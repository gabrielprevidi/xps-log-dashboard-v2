-- Migration 009: Toggle de manuseio + categoria de produto + produtos Fedrigoni
-- cobrar_manuseio: oculta cobrança de manuseio no dashboard do cliente quando false.
-- categoria: classifica produtos para exibição agrupada nas movimentações.

ALTER TABLE clientes
  ADD COLUMN IF NOT EXISTS cobrar_manuseio BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE cliente_produtos
  ADD COLUMN IF NOT EXISTS categoria TEXT NOT NULL DEFAULT 'pa';
-- Valores: 'pa' | 'mp' | 'embalagem' | 'lintec_casting' | 'semi_acabado' | 'outro'

-- Garante que o anon key possa operar em cliente_produtos (como nas demais tabelas)
ALTER TABLE cliente_produtos DISABLE ROW LEVEL SECURITY;

-- ─── Produtos da Fedrigoni ────────────────────────────────────────────────────
-- Os códigos (cProd) da NF-e são usados como palavras-chave para match automático.
DO $$
DECLARE
  fedrigoni_id UUID;
BEGIN
  SELECT id INTO fedrigoni_id FROM clientes WHERE cnpj = '34661762000150' LIMIT 1;

  IF fedrigoni_id IS NULL THEN
    RAISE NOTICE 'Cliente Fedrigoni não encontrado — pulando inserção de produtos.';
    RETURN;
  END IF;

  -- Remove produtos anteriores para garantir idempotência
  DELETE FROM cliente_produtos WHERE cliente_id = fedrigoni_id;

  INSERT INTO cliente_produtos
    (cliente_id, nome, palavras_chave, valor_pallet, aliquota_imposto, regra_fator_pallet, categoria, ordem)
  VALUES
    (fedrigoni_id, 'Lintec / Casting',
     '8r0013ln0031520,8e02889277,ltc083,mattplus,pp tc8 gloss',
     38, 2, 1.2, 'lintec_casting', 1),

    (fedrigoni_id, 'Produto Acabado',
     '870393c46115016,f1190,sht 5234,coated mc80',
     38, 2, 1.2, 'pa', 2),

    (fedrigoni_id, 'Matéria-Prima',
     '0l017522,cb72 mjo,cb72',
     38, 2, 1.2, 'mp', 3),

    (fedrigoni_id, 'Embalagem',
     'ok008300,caixa 66x96,adhoc',
     38, 2, 1.2, 'embalagem', 4);

  RAISE NOTICE 'Produtos Fedrigoni inseridos com sucesso.';
END;
$$;

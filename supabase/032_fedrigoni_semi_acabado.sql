-- Migration 032: categoria "Semi-Acabado" cadastrada na Fedrigoni
--
-- O seletor de categoria da linha manual (página do cliente) lista os
-- registros de `cliente_produtos`. A migration 009 cadastrou só 4 categorias
-- (Lintec, PA, MP, Embalagem); Semi-Acabado era gravada pela ingestão apenas
-- como `produto_nome`, com `produto_id` null — então não aparecia no seletor
-- e, ao editar uma linha Semi-Acabado, a categoria caía para "Sem categoria".
--
-- Sem palavras-chave: a classificação da Fedrigoni é pelo COD. PROD
-- (classificarCategoriaFedrigoniPorCodigo); o matcher de palavra-chave é só
-- fallback e não deve passar a capturar notas por este cadastro.

DO $$
DECLARE
  fedrigoni_id UUID;
  semi_id UUID;
BEGIN
  SELECT id INTO fedrigoni_id FROM clientes WHERE cnpj = '34661762000150' LIMIT 1;
  IF fedrigoni_id IS NULL THEN
    RAISE NOTICE 'Cliente Fedrigoni não encontrado — nada a fazer.';
    RETURN;
  END IF;

  SELECT id INTO semi_id FROM cliente_produtos
  WHERE cliente_id = fedrigoni_id AND nome = 'Semi-Acabado' LIMIT 1;

  IF semi_id IS NULL THEN
    INSERT INTO cliente_produtos
      (cliente_id, nome, palavras_chave, valor_pallet, aliquota_imposto, regra_fator_pallet, categoria, ordem, ativo)
    VALUES
      (fedrigoni_id, 'Semi-Acabado', NULL, 38, 2, 1.2, 'semi_acabado', 3, true)
    RETURNING id INTO semi_id;
  END IF;

  -- Mesma ordem da tela de configurações: Lintec, PA, Semi, MP, Embalagem
  UPDATE cliente_produtos SET ordem = 4 WHERE cliente_id = fedrigoni_id AND nome = 'Matéria-Prima';
  UPDATE cliente_produtos SET ordem = 5 WHERE cliente_id = fedrigoni_id AND nome = 'Embalagem';

  -- Vincula as movimentações já gravadas como Semi-Acabado
  UPDATE movimentacoes SET produto_id = semi_id
  WHERE cliente_id = fedrigoni_id AND produto_nome = 'Semi-Acabado' AND produto_id IS NULL;
END;
$$;

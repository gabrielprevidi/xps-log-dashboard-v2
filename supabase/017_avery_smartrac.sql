-- Migration 017: separação Avery Dennison × Avery Smartrac
--
-- São duas empresas distintas com nomes parecidos e o MESMO domínio de email
-- (averydennison.com), que até agora caíam no mesmo cadastro:
--   • AVERY DENNISON DO BRASIL LTDA      43.999.630/0001-24
--   • AVERY DENNISON SMARTRAC LATAM LTDA 42.554.848/0001-02
--
-- A identificação por CNPJ (clientes_cnpj → clientes.cnpj) roda ANTES do
-- fallback por email_remetente em identificarCliente, então o domínio
-- compartilhado não confunde as duas: notas novas já caem no cadastro certo.
-- O que faltava era o cadastro da Smartrac e a migração do histórico.
--
-- Modo de cálculo: 'avery' (volumes 1:1), não 'padrao'. Os XMLs da Smartrac
-- TRAZEM peso líquido — ao contrário dos DANFEs da Avery Dennison, que foi o
-- motivo original do modo — mas a cobrança é pelo espaço ocupado, e contar
-- por peso subestimaria: a NF 2374 tem 7 volumes e 3,45 t, que pelo fator de
-- 1,2 t/pallet daria 3 pallets para 7 posições ocupadas.

COMMENT ON COLUMN clientes.modo_calculo IS 'Modo de cálculo de armazenagem: padrao | fedrigoni | tecnia | avery';

UPDATE clientes SET modo_calculo = 'avery' WHERE cnpj = '42.554.848/0001-02';

-- Histórico: movimentações geradas por NF-e da Smartrac (emitente ou
-- destinatário 42554848000102) estavam sob o cadastro da Avery Dennison.
-- Os pallets gravados já estão na base de volumes e permanecem como estão;
-- só o valor por pallet acompanha o cadastro novo (R$ 65,84).
UPDATE movimentacoes m
SET cliente_id  = (SELECT id FROM clientes WHERE cnpj = '42.554.848/0001-02'),
    valor_pallet = (SELECT valor_pallet FROM clientes WHERE cnpj = '42.554.848/0001-02')
FROM arquivos_nfe a
WHERE m.arquivo_nfe_id = a.id
  AND m.cliente_id = (SELECT id FROM clientes WHERE cnpj = '43.999.630/0001-24')
  AND (a.cnpj_emitente = '42554848000102' OR a.cnpj_destinatario = '42554848000102');

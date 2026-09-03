-- Migration 019: Modo 'especie' — clientes zerados migrados do padrão
-- para leitura só-PDF com identificação por CNPJ e quantidade pelo campo
-- ESPÉCIE do DANFE (mesma leitura da Fedrigoni/Tecnia), mas SEM herdar a
-- tabela de preço progressiva nem a categorização por produto exclusivas
-- da Fedrigoni — valor por volume continua vindo do cadastro do cliente.
--
-- Clientes escolhidos: cadastrados, com CNPJ e email_remetente configurados,
-- porém com zero movimentações até aqui (nenhum email desses remetentes
-- chegou ainda na caixa armazenagem@xpslog.com.br nem na xps.ai@exsa.srv.br).

COMMENT ON COLUMN clientes.modo_calculo IS 'Modo de cálculo de armazenagem: padrao | fedrigoni | tecnia | avery | especie';

UPDATE clientes SET modo_calculo = 'especie' WHERE cnpj IN (
  '02.929.563/0001-94', -- Prakolar Rotulos
  '18.745.862/0001-09', -- Quadrante Ind e Com de Rotulos LTDA.
  '17.740.079/0001-90', -- Tecnoset Rio Informatica Prod E Serv LTDA.
  '04.020.662/0001-84', -- Visionflex Soluc. Graf. LTDA.
  '04.207.230/0001-87', -- Crown Roll Leaf do Brasil LTDA.
  '06.313.527/0001-52', -- Adegraf Etiquetas Adesivas LTDA.
  '03.385.913/0006-76', -- Automatech Sistema de Automação LTDA.
  '35.659.497/0001-39', -- Grafica NMC LTDA.
  '23.680.573/0001-09'  -- Maju Etiquetas e Adesivos LTDA.
);

-- 2026-09-03: Grow Label (07.988.186/0001-88) tinha modo 'padrao', mas os
-- DANFEs dela também não carregam peso líquido utilizável — 4 das 5 notas já
-- registradas tinham ficado com 0 ton / 0 pallets. Migrada para 'especie' e
-- com cobrança de manuseio desligada (pedido explícito do cliente/usuário).
UPDATE clientes SET modo_calculo = 'especie', cobrar_manuseio = false
WHERE cnpj = '07.988.186/0001-88';

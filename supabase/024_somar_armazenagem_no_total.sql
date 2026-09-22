-- Migration 024: armazenagem somada ao Total Geral da cobrança
--
-- O Total Geral do mês somava apenas manuseio + separação de sacaria +
-- cobranças adicionais, deixando a armazenagem de fora (ela aparecia só nos
-- cartões do topo). Para a Alphalum a cobrança fechada inclui a armazenagem,
-- então o total precisa somá-la.
--
-- Ligado por cliente, não por modo de cálculo: `modo_calculo` da Alphalum é
-- 'padrao', igual ao da Servir, e a única flag que hoje separa as duas
-- (cobrar_separacao_sacaria) descreve outra regra — acoplar as duas faria um
-- cliente novo herdar este total sem querer.
--
-- Com a flag ligada o resumo passa a exibir quatro linhas: armazenagem sem e
-- com imposto, e o total nas duas versões. O imposto incide só na armazenagem;
-- separação, manuseio e adicionais entram pelo valor cheio nos dois totais.

ALTER TABLE clientes
  ADD COLUMN IF NOT EXISTS somar_armazenagem_no_total BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN clientes.somar_armazenagem_no_total IS
  'Soma a armazenagem ao Total Geral do mês e exibe os totais sem e com imposto. Default false: os demais clientes seguem com o total de manuseio + separação + adicionais.';

-- Alphalum (CNPJ 61178630000145) — único cliente com a regra hoje.
UPDATE clientes
   SET somar_armazenagem_no_total = true,
       updated_at = NOW()
 WHERE regexp_replace(cnpj, '\D', '', 'g') = '61178630000145';

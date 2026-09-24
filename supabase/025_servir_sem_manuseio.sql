-- Migration 025: Servirprint sem cobrança de manuseio
--
-- 2026-09-24: pedido do usuário — a Servirprint segue a mesma regra da
-- Fedrigoni: não existe cobrança de manuseio. Clientes no mesmo sistema da
-- Fedrigoni consideram SOMENTE as movimentações (entradas/saídas que formam
-- saldo e armazenagem); manuseio não é cobrado nem entra no Total Geral.
--
-- Só a flag muda. `modo_calculo` continua 'padrao': o modo 'fedrigoni' traz a
-- tabela de preço progressiva e a categorização por produto exclusivas da
-- Fedrigoni, que não se aplicam à Servir.
--
-- A flag vale para todos os meses. O fechamento de 08/2026 já está com NF
-- emitida (PDF anexado), que não é recalculado; a tela desse mês passa a
-- mostrar o total sem manuseio.

UPDATE clientes
   SET cobrar_manuseio = false,
       updated_at = NOW()
 WHERE regexp_replace(cnpj, '\D', '', 'g') = '10561158000194';

-- Migration 033: FLEXCOAT sem cobrança de manuseio
--
-- 2026-11-26: pedido do usuário — a FLEXCOAT não tem cobrança de manuseio.
-- Mesmo critério das migrations 025 (Servirprint): só a flag muda; o painel,
-- o portal e a planilha escondem a seção e tiram o manuseio do Total Geral.
-- A FLEXCOAT não tinha nenhum mês fechado quando a flag foi desligada.

UPDATE clientes
   SET cobrar_manuseio = false,
       updated_at = NOW()
 WHERE regexp_replace(cnpj, '\D', '', 'g') = '48062707000159';

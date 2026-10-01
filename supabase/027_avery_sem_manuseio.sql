-- Migration 027: Avery sem cobrança de manuseio e sem categoria por produto
--
-- 2026-10-01: pedido do usuário — as Avery (Dennison e Smartrac, modo 'avery')
-- consideram apenas movimentações por volume: não há cobrança de manuseio e
-- não há quebra por categoria de produto. O que o Graphics tem de produto é
-- controlado à parte, por SKU (ver 026_avery_graphics.sql).
--
-- A flag vale para todos os meses. Meses já fechados com NF emitida não são
-- recalculados; a tela passa a mostrar o total sem manuseio.
-- A ocultação das categorias é feita no código (modo_calculo = 'avery').

UPDATE clientes
   SET cobrar_manuseio = false,
       updated_at = NOW()
 WHERE modo_calculo = 'avery';

-- Migration 008: Produtos por cliente
-- Permite cadastrar múltiplos produtos por cliente com configurações individuais.
-- Ao importar NF-e, o sistema tenta identificar o produto pelo NCM ou palavras-chave da descrição.

-- Tabela de produtos por cliente
CREATE TABLE IF NOT EXISTS cliente_produtos (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cliente_id          UUID NOT NULL REFERENCES clientes(id) ON DELETE CASCADE,
  nome                TEXT NOT NULL,
  codigo_ncm          TEXT,           -- NCM para match exato contra itens da NF-e
  palavras_chave      TEXT,           -- palavras separadas por vírgula para match na descrição
  valor_pallet        NUMERIC(10,2) NOT NULL,
  aliquota_imposto    NUMERIC(5,2)  NOT NULL DEFAULT 2.00,
  regra_fator_pallet  NUMERIC(5,2)  NOT NULL DEFAULT 1.20,
  ativo               BOOLEAN       NOT NULL DEFAULT true,
  ordem               INTEGER       NOT NULL DEFAULT 0,
  created_at          TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

-- Índice para busca rápida por cliente
CREATE INDEX IF NOT EXISTS idx_cliente_produtos_cliente_id ON cliente_produtos(cliente_id);

-- Referência ao produto identificado na movimentação
ALTER TABLE movimentacoes
  ADD COLUMN IF NOT EXISTS produto_id   UUID REFERENCES cliente_produtos(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS produto_nome TEXT;

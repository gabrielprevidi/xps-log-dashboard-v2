# XPS Log Dashboard — V2

Ingestão **automática** de NF-es a partir do webmail `armazenagem@xpslog.com.br` (IMAP).

> **V1 continua em produção** em `../xps-log-dashboard/` (repo
> `gabrielprevidi/xps-log-dashboard`, email `xps.ai@exsa.srv.br` via Microsoft Graph,
> sincronização manual). Ver `../V1-REGISTRO.md`.
>
> Esta pasta partiu de uma cópia da V1 no commit `151da9c`.

---

## O que muda em relação à V1

| | V1 | V2 |
|---|---|---|
| Canal | Microsoft Graph (`xps.ai@exsa.srv.br`) | IMAP (`armazenagem@xpslog.com.br`) |
| Acionamento | Botão "Sincronizar" | Cron a cada 15 min |
| Filtro | Só em código | Filtro Sieve no servidor + pipeline |
| Gravação | Grava o email/anexo **antes** de identificar o cliente | Só grava se **(a)** bater com cliente cadastrado **e (b)** a NF-e for entrada ou saída |
| Controle do "já processei" | Tabela `emails_importados` | Move entre pastas no servidor de email |
| Atualização da tela | Refetch após o clique | Supabase Realtime |

## O que **não** muda

Parsers (`nfe-parser`, `nfe-pdf-parser`), cálculos, modos por cliente
(`padrao`/`fedrigoni`/`tecnia`/`avery`), páginas, portal do cliente e o banco
Supabase — que é **o mesmo da V1**.

---

## Setup

```bash
npm install
```

Preencher em `.env.local` (já tem as variáveis herdadas da V1):

| Variável | Valor |
|---|---|
| `IMAP_HOST` | `imap.xpslog.com.br` |
| `IMAP_PORT` | `993` |
| `IMAP_USER` | `armazenagem@xpslog.com.br` |
| `IMAP_PASSWORD` | **preencher** — não colar no chat |
| `CRON_SECRET` | **preencher** — token do agendador externo |

Aplicar a migration no Supabase (SQL Editor):

```
supabase/014_v2_sync_state.sql
```

É aditiva: cria `sync_estado` e `sync_execucoes` e habilita Realtime.
Não altera nada que a V1 usa.

---

## Pastas no webmail

Criar antes da Fase 1:

```
XPS/Entrada       ← o filtro Sieve entrega aqui; única pasta lida pela rotina
XPS/Processados   ← movido quando gerou movimentação
XPS/Descartados   ← movido quando não gerou (expira em 30 dias)
```

---

## Estado

Fase 0 (estrutura) concluída. Fase 1 em diante: ver
`../planejamento-v2-email-automatico.md`.

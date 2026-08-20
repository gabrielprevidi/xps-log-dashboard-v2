-- Migration 018 — sincronização automática a cada 5 minutos, sem serviço externo
--
-- Substitui o cron-job.org. O motivo é o episódio de 17/08/2026: uma mensagem
-- pesada matou a rodada, o agendador externo viu falhas seguidas e DESATIVOU o
-- job sozinho. A fila ficou três dias parada com 690 emails e ninguém teve como
-- perceber pelo painel dele — o status de lá nunca foi confiável, porque a
-- Vercel conclui a função mesmo com a conexão cortada.
--
-- Aqui quem chama é o próprio banco: pg_cron agenda, pg_net faz o POST. Não há
-- conta de terceiro para desativar o job, e o histórico fica em sync_execucoes,
-- que já é a fonte de verdade do dashboard.
--
-- O cron nativo da Vercel não serve: o plano Hobby permite 1 execução por dia.
--
-- ─────────────────────────────────────────────────────────────────────────
-- COMO APLICAR (uma vez, no editor SQL do Supabase)
--
--   1. Rode o PASSO 1 abaixo colando o valor de CRON_SECRET (o mesmo que está
--      nas variáveis de ambiente do projeto na Vercel). Ele vai para o Vault,
--      não para este arquivo nem para o texto do agendamento.
--   2. Rode o PASSO 2.
--   3. Confira com as consultas do final.
-- ─────────────────────────────────────────────────────────────────────────

-- PASSO 1 — guardar o token no Vault (troque o valor entre aspas)
--
--   select vault.create_secret(
--     'COLE_AQUI_O_CRON_SECRET',
--     'xps_cron_secret',
--     'Token do endpoint /api/cron/sync da V2'
--   );
--
-- Se precisar trocar o token depois:
--   select vault.update_secret(
--     (select id from vault.secrets where name = 'xps_cron_secret'),
--     'NOVO_VALOR'
--   );


-- PASSO 2 — extensões e agendamento
create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Remove o agendamento anterior, se já existir, para esta migration poder ser
-- reaplicada sem duplicar o job.
select cron.unschedule('xps-sync-5min')
where exists (select 1 from cron.job where jobname = 'xps-sync-5min');

select cron.schedule(
  'xps-sync-5min',
  '*/5 * * * *',
  $$
  select net.http_post(
    url     := 'https://xps-log-dashboard-v2.vercel.app/api/cron/sync',
    headers := jsonb_build_object(
                 'Content-Type', 'application/json',
                 'Authorization', 'Bearer ' || (
                   select decrypted_secret from vault.decrypted_secrets
                   where name = 'xps_cron_secret'
                 )
               ),
    body    := jsonb_build_object('gatilho', 'cron'),
    -- 5s é só a espera do banco pela resposta. A Vercel conclui a função mesmo
    -- com a conexão cortada, então a rodada roda inteira do outro lado — é o
    -- mesmo comportamento que o agendador externo já tinha, e foi testado.
    timeout_milliseconds := 5000
  );
  $$
);


-- ─────────────────────────────────────────────────────────────────────────
-- CONFERÊNCIA
--
--   -- o job está agendado?
--   select jobid, jobname, schedule, active from cron.job where jobname = 'xps-sync-5min';
--
--   -- as últimas execuções do agendamento (status do pg_cron, não da rodada)
--   select start_time, status, return_message
--     from cron.job_run_details
--    where jobid = (select jobid from cron.job where jobname = 'xps-sync-5min')
--    order by start_time desc limit 10;
--
--   -- o que a rotina fez de fato — esta é a fonte de verdade
--   select iniciado_em, gatilho, status, emails_lidos, nfes_salvas, fila_restante
--     from sync_execucoes order by iniciado_em desc limit 10;
--
-- PARA DESLIGAR:  select cron.unschedule('xps-sync-5min');
-- ─────────────────────────────────────────────────────────────────────────

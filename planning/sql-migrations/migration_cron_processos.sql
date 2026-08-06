-- Migration: crons diários do ciclo de processos (fases 2-4 do
-- planning/PROCESSOS_GLOBAL.md) via pg_cron + pg_net.
--
-- Ordem da manhã (UTC; BRT = UTC-3):
--   ~02h-05h BRT  sync DJEN (cron EXISTENTE no n8n — não mexemos)
--   06:00/06/12   sync-datajud-movimentacoes (3 passadas de até 60 processos;
--                 dias=90 enquanto o backfill não completa — dedup torna
--                 inofensivo depois; a fila anda por ultima_sync nulls-first)
--   06:30 BRT     ia-triagem-andamentos (resumo + tarefas; janela 10 dias)
--   06:45 BRT     digest-diario (por ora SÓ pra Naira via "para"; quando
--                 validar, remover o campo "para" pra ir a todos os internos)
--
-- As functions são --no-verify-jwt, então o pg_net chama sem credencial.
-- timeout_milliseconds alto: o gateway derruba em 150s; as functions param
-- sozinhas em ~110s.
--
-- Idempotente: cron.schedule com mesmo jobname substitui o job.

create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.schedule(
  'msc-datajud-sync-1',
  '0 9 * * *',
  $$ select net.http_post(
       url := 'https://llugytkdsfsrciavhrfw.supabase.co/functions/v1/sync-datajud-movimentacoes',
       headers := '{"Content-Type": "application/json", "x-region": "sa-east-1"}'::jsonb,
       body := '{"dias": 90, "limite": 60}'::jsonb,
       timeout_milliseconds := 145000
     ) $$
);

select cron.schedule(
  'msc-datajud-sync-2',
  '6 9 * * *',
  $$ select net.http_post(
       url := 'https://llugytkdsfsrciavhrfw.supabase.co/functions/v1/sync-datajud-movimentacoes',
       headers := '{"Content-Type": "application/json", "x-region": "sa-east-1"}'::jsonb,
       body := '{"dias": 90, "limite": 60}'::jsonb,
       timeout_milliseconds := 145000
     ) $$
);

select cron.schedule(
  'msc-datajud-sync-3',
  '12 9 * * *',
  $$ select net.http_post(
       url := 'https://llugytkdsfsrciavhrfw.supabase.co/functions/v1/sync-datajud-movimentacoes',
       headers := '{"Content-Type": "application/json", "x-region": "sa-east-1"}'::jsonb,
       body := '{"dias": 90, "limite": 60}'::jsonb,
       timeout_milliseconds := 145000
     ) $$
);

-- Triagem IA: usuario_id da Naira (dona da integração de IA configurada).
--
-- DESATIVADO em 2026-08-06 a pedido da Naira: o escritório vai se estabelecer
-- primeiro no administrativo e só depois puxar o judicial. Esta triagem lê
-- apenas andamentos de origem 'datajud' e 'djen' — as duas fontes judiciais —
-- então desligá-la não afeta nada do administrativo.
--
-- O que continua rodando: sync do DataJud e as publicações (elas geram
-- andamentos, não tarefas, então não poluem a lista).
--
-- Para reativar: descomente o bloco abaixo e rode esta migration de novo.
/*
select cron.schedule(
  'msc-ia-triagem',
  '30 9 * * *',
  $$ select net.http_post(
       url := 'https://llugytkdsfsrciavhrfw.supabase.co/functions/v1/ia-triagem-andamentos',
       headers := '{"Content-Type": "application/json"}'::jsonb,
       body := '{"usuario_id": "e911d384-f1fb-48d6-a05f-2571a1bc3882", "limite": 40}'::jsonb,
       timeout_milliseconds := 145000
     ) $$
);
*/

select cron.schedule(
  'msc-digest-diario',
  '45 9 * * *',
  $$ select net.http_post(
       url := 'https://llugytkdsfsrciavhrfw.supabase.co/functions/v1/digest-diario',
       headers := '{"Content-Type": "application/json"}'::jsonb,
       body := '{"horas": 24, "para": "nairaromerovian@gmail.com"}'::jsonb,
       timeout_milliseconds := 145000
     ) $$
);

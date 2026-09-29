-- Migration: sincronização diária do DJEN no pg_cron (sai do n8n).
--
-- Até 2026-09-23 quem disparava `sync-djen-publicacoes` era o workflow
-- `djen-sync` do n8n (planning/dje/n8n-djen-sync.json), todo dia às 07:00
-- de Brasília, com corpo {"dias": 2} e o header x-region: sa-east-1 (a
-- Comunica API bloqueia chamada de fora do Brasil). Decisão de 2026-09-23:
-- nenhuma rotina do sistema passa mais pelo n8n (ele fica na máquina para
-- uso futuro, sem workflow ativo). O disparo vai para o pg_cron, igual ao
-- INSS, ao DataJud e ao digest: pg_net + assinatura de sistema
-- (`ops.headers_sistema`, que já manda Content-Type e x-region).
--
-- Horário: 10:00 UTC = 07:00 em Brasília — o mesmo do n8n e ANTES do
-- `msc-djen-rematch` (10:30 UTC), que casa publicações órfãs com processos.
-- A function aceita a identidade `cron:djen-sync` (antes `n8n:djen-sync`).
--
-- Só faz sentido em PRODUÇÃO: no staging e no local não há pg_cron nem
-- `ops.headers_sistema`, e a migration vira no-op com aviso (registrada
-- mesmo assim, para o board saber que rodou). A URL é a do projeto de
-- produção, como nos outros jobs.
--
-- Depois de aplicar em produção: DESLIGAR o workflow `djen-sync` no n8n
-- (ele ainda seria aceito pela chave de service role e sincronizaria em
-- dobro — o dedup por djen_id evita duplicata, mas é trabalho à toa) e
-- conferir no dia seguinte `cron.job_run_details` do job `msc-djen-sync`
-- e `sync_log` (source djen_publicacoes).
--
-- Idempotente: cron.schedule com o mesmo jobname substitui o job.

do $$
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    raise notice 'pg_cron ausente neste banco (staging/local): job msc-djen-sync não agendado';
    return;
  end if;
  if to_regprocedure('ops.headers_sistema(text)') is null then
    raise notice 'ops.headers_sistema ausente neste banco: job msc-djen-sync não agendado';
    return;
  end if;

  perform cron.schedule(
    'msc-djen-sync',
    '0 10 * * *',
    $job$ select net.http_post(
       url := 'https://llugytkdsfsrciavhrfw.supabase.co/functions/v1/sync-djen-publicacoes',
       headers := ops.headers_sistema('cron:djen-sync'),
       body := '{"dias": 2}'::jsonb,
       timeout_milliseconds := 150000
     ) $job$
  );
  raise notice 'job msc-djen-sync agendado (10:00 UTC = 07:00 Brasília)';
end $$;

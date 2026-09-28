-- Cron da saída de WhatsApp (sem n8n): a cada minuto o pg_cron chama a edge
-- function `whatsapp-outbox-enviar` com a assinatura de sistema; ela drena
-- `whatsapp_outbox` por escritório (migration_rbac_14). Enquanto a saída
-- estiver pausada (migration_pausa_whatsapp_saida) a fila fica vazia e a
-- chamada volta em milissegundos.
--
-- Só em PRODUÇÃO (pg_cron + ops.headers_sistema); no staging/local vira
-- aviso. Antes, quem fazia isso era o workflow de saída do n8n
-- (planning/whatsapp/n8n-workflow-saida.json, só histórico).
-- Idempotente: cron.schedule com o mesmo jobname substitui o job.

do $$
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    raise notice 'pg_cron ausente neste banco (staging/local): job msc-whatsapp-outbox não agendado';
    return;
  end if;
  if to_regprocedure('ops.headers_sistema(text)') is null then
    raise notice 'ops.headers_sistema ausente neste banco: job msc-whatsapp-outbox não agendado';
    return;
  end if;
  perform cron.schedule(
    'msc-whatsapp-outbox',
    '* * * * *',
    $job$ select net.http_post(
       url := 'https://llugytkdsfsrciavhrfw.supabase.co/functions/v1/whatsapp-outbox-enviar',
       headers := ops.headers_sistema('cron:whatsapp-outbox'),
       body := '{"limite": 20}'::jsonb,
       timeout_milliseconds := 60000
     ) $job$
  );
  raise notice 'job msc-whatsapp-outbox agendado (a cada minuto)';
end $$;

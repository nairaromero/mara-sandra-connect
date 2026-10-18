-- =============================================================================
-- Migration: a fila da leitura de documentos (card #434)
--
-- A IA roda QUANDO OS DOCUMENTOS CHEGAM (Naira, 18/10) — mas não arquivo a
-- arquivo: o parceiro sobe seis de uma vez, e o padrão de organização trabalha
-- com a pasta inteira (é assim que se acha duplicata e se juntam páginas
-- soltas). Então a fila só entrega um caso depois que ele PAROU de receber
-- arquivo — a poeira baixa, e aí se lê tudo junto.
--
-- Só entra na fila caso que tem conferência aberta: pasta de caso antigo não
-- vira conta de IA sem ninguém ter pedido.
-- =============================================================================

create or replace function public.casos_com_leitura_pendente(
  p_quieto_minutos int default 2,
  p_limite int default 20
)
returns table(caso_id uuid, pendentes bigint, ultimo_upload timestamptz)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select d.caso_id,
         count(*) filter (where d.ia_lido_em is null) as pendentes,
         max(d.created_at) as ultimo_upload
    from public.documentos d
   where exists (
     select 1 from public.tarefas t
      where t.caso_id = d.caso_id
        and t.status = 'a_fazer'
        and (t.metadata->>'organizacao_documentos')::boolean is true
   )
   group by d.caso_id
  having count(*) filter (where d.ia_lido_em is null) > 0
     -- a poeira baixou: nada novo chegou nos últimos minutos
     and max(d.created_at) < now() - make_interval(mins => p_quieto_minutos)
   order by max(d.created_at)
   limit p_limite;
$$;

revoke all on function public.casos_com_leitura_pendente(int, int) from public;
revoke all on function public.casos_com_leitura_pendente(int, int) from anon;
grant execute on function public.casos_com_leitura_pendente(int, int) to authenticated;

-- ---------------------------------------------------------------------------
-- O disparo. Como os outros jobs da casa: pg_net + assinatura de sistema, e
-- no-op onde não há pg_cron (staging e local — lá o gatilho é o botão da
-- tarefa ou o `cronSimulado` dos roteiros).
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    raise notice 'pg_cron ausente (staging/local): job msc-identificar-documentos não agendado';
    return;
  end if;
  if to_regprocedure('ops.headers_sistema(text)') is null then
    raise notice 'ops.headers_sistema ausente: job msc-identificar-documentos não agendado';
    return;
  end if;

  perform cron.schedule(
    'msc-identificar-documentos',
    '*/10 * * * *',
    $job$ select net.http_post(
       url := 'https://llugytkdsfsrciavhrfw.supabase.co/functions/v1/identificar-documentos',
       headers := ops.headers_sistema('cron:identificar-documentos'),
       body := '{}'::jsonb,
       timeout_milliseconds := 280000
     ) $job$
  );
  raise notice 'job msc-identificar-documentos agendado (a cada 10 min)';
end $$;

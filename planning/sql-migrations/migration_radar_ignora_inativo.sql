-- Radar de caso sem próximo passo: ignorar clientes STATUS:INATIVO.
--
-- Feedback da Naira (2026-09-02): caso de cliente com a etiqueta "inativo" é
-- caso sabidamente parado — não faz sentido o radar cobrar próximo passo dele.
-- Hoje entram 52 casos assim (medido no staging), poluindo a rede de segurança.
--
-- Etiquetas são por CLIENTE (clientes_etiquetas → etiquetas). A etiqueta real
-- é "STATUS:INATIVO" (família STATUS: herdada da migração do TI); casamos por
-- igualdade case-insensitive (mais o "INATIVO" pelado por segurança), NÃO por
-- LIKE — matching amplo já mordeu antes.
--
-- Corpo partido do pg_get_functiondef da PRODUÇÃO (2026-09-02); a ÚNICA
-- mudança é o novo `not exists` das etiquetas. Idempotente (create or replace).

create or replace function public.casos_sem_proximo_passo()
returns table (
  caso_id uuid,
  cliente_nome text,
  tipo_beneficio text,
  parado_desde timestamptz,
  dias_parado integer,
  em_acompanhamento_judicial boolean,
  dias_sem_movimento integer,
  motivo text
)
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $function$
  select
    c.id as caso_id,
    cl.nome as cliente_nome,
    c.tipo_beneficio,
    sinal.ultimo as parado_desde,
    floor(extract(epoch from (now() - sinal.ultimo)) / 86400)::int as dias_parado,
    juri.tem as em_acompanhamento_judicial,
    mov.dias as dias_sem_movimento,
    case
      when not juri.tem then 'sem_proximo_passo'
      when mov.dias >= 90 then 'judicial_mudo'
      else 'acompanhamento_judicial'
    end as motivo
  from public.casos c
  join public.clientes cl on cl.id = c.cliente_id
  cross join lateral (
    select greatest(
      c.created_at,
      coalesce((select max(t.completed_at) from public.tarefas t
                 where t.caso_id = c.id and t.completed_at is not null), c.created_at),
      coalesce((select max(a.created_at) from public.andamentos a
                 where a.caso_id = c.id), c.created_at)
    ) as ultimo
  ) sinal
  cross join lateral (
    select exists (
      select 1 from public.processos_judiciais pj where pj.caso_id = c.id
    ) as tem
  ) juri
  cross join lateral (
    select floor(extract(epoch from (now() - coalesce(
      (select max(a.created_at) from public.andamentos a where a.caso_id = c.id),
      c.created_at
    ))) / 86400)::int as dias
  ) mov
  where public.is_interno()
    and c.status not in ('arquivado', 'concluido_exito', 'concluido_sem_exito')
    and not exists (
      select 1 from public.tarefas t
       where t.caso_id = c.id and t.status in ('a_fazer', 'fazendo')
    )
    and not exists (
      select 1 from public.agenda_eventos e
       where e.caso_id = c.id and e.start_at > now()
    )
    -- NOVO: caso de cliente "inativo" é caso parado de propósito — fora do radar.
    and not exists (
      select 1 from public.clientes_etiquetas ce
        join public.etiquetas et on et.id = ce.etiqueta_id
       where ce.cliente_id = c.cliente_id
         and upper(et.nome) in ('STATUS:INATIVO', 'INATIVO')
    )
  order by sinal.ultimo asc;
$function$;

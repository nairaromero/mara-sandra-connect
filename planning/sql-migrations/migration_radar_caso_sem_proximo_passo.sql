-- =============================================================================
-- Migration: radar de CASO SEM PRÓXIMO PASSO
-- (piloto anti-perda-de-prazo aprovado pela Naira, 2026-08-28).
--
-- Prazo se perde quando o caso fica órfão: sem tarefa aberta e sem evento
-- futuro, ninguém mais é lembrado dele. A RPC lista esses casos pros internos
-- (a tela de Tarefas mostra o radar). Na primeira medição em produção eram
-- 194 de 416 casos abertos nessa situação.
--
-- "Parado desde" = o último sinal de vida do caso (tarefa concluída,
-- andamento ou a criação do caso) — ordena os mais esquecidos primeiro.
--
-- Idempotente. SÓ STAGING até a Naira validar.
-- =============================================================================

create or replace function public.casos_sem_proximo_passo()
returns table (
  caso_id uuid,
  cliente_nome text,
  tipo_beneficio text,
  parado_desde timestamptz,
  dias_parado integer
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select
    c.id as caso_id,
    cl.nome as cliente_nome,
    c.tipo_beneficio,
    sinal.ultimo as parado_desde,
    floor(extract(epoch from (now() - sinal.ultimo)) / 86400)::int as dias_parado
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
  order by sinal.ultimo asc;
$$;

grant execute on function public.casos_sem_proximo_passo() to authenticated;

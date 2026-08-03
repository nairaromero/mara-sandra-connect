-- Perícias de UM caso — para o bloco "Perícia" no topo dos Andamentos.
--
-- Tanto a equipe quanto o parceiro precisam ver, dentro do caso, se ele tem
-- perícia agendada (além da tarefa). A agenda interna mescla duas fontes:
-- agenda_eventos (tipo='pericia') e tarefas tipo='pericia' ativas com due_at
-- (migradas do TI / processador INSS). RLS de ambas é só-interno; o parceiro
-- não lê tarefas direto. Esta função SECURITY DEFINER devolve a união
-- SANITIZADA das perícias do caso, com checagem de acesso na entrada:
--   - interno (is_interno()) vê qualquer caso;
--   - parceiro vê só o caso onde casos.parceiro_id = auth.uid().
-- Quem não tem acesso recebe lista vazia (o WHERE de acesso não casa).
--
-- Espelha a lógica de natureza/heurística de pericias_do_parceiro() e
-- ehPericiaEmSi() de agenda.tsx.
--
-- Idempotente: create or replace.

create or replace function public.pericias_do_caso(p_caso_id uuid)
returns table (
  fonte text,
  id uuid,
  caso_id uuid,
  titulo text,
  start_at timestamptz,
  end_at timestamptz,
  local text,
  natureza text     -- 'judicial' | 'admin' | null (não identificada)
)
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
  with acesso as (
    select c.id
    from public.casos c
    where c.id = p_caso_id
      and (public.is_interno() or c.parceiro_id = auth.uid())
  )
  select
    'evento'::text as fonte,
    e.id, e.caso_id, e.titulo, e.start_at, e.end_at, e.local,
    case
      when e.processo_judicial_id is not null then 'judicial'
      when e.processo_admin_id is not null then 'admin'
      when e.titulo ~* 'judicial' then 'judicial'
      when e.titulo ~* 'inss' then 'admin'
      else null
    end as natureza
  from public.agenda_eventos e
  join acesso a on a.id = e.caso_id
  where e.tipo = 'pericia'
    and e.restrito_a is null
  union all
  select
    'tarefa'::text as fonte,
    t.id, t.caso_id, t.titulo,
    t.due_at as start_at,
    t.due_at as end_at,     -- tarefa não tem hora de fim; front trata por dia
    null::text as local,
    case
      when t.processo_judicial_id is not null then 'judicial'
      when t.processo_admin_id is not null then 'admin'
      when t.titulo ~* 'judicial' then 'judicial'
      when t.titulo ~* 'inss' then 'admin'
      else null
    end as natureza
  from public.tarefas t
  join acesso a on a.id = t.caso_id
  where t.tipo = 'pericia'
    and t.status in ('a_fazer', 'fazendo')
    and t.due_at is not null
    and (
      (t.metadata->>'pericia_evento')::boolean is true
      or (
        t.metadata->>'pericia_evento' is null
        and t.titulo !~* '(acompanh|contatar|resultado|ligar|compareceu|agendamento de)'
      )
    )
  order by 5
$$;

revoke all on function public.pericias_do_caso(uuid) from public, anon;
grant execute on function public.pericias_do_caso(uuid) to authenticated;

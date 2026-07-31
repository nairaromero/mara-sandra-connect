-- Agenda de perícias do PARCEIRO.
--
-- O parceiro precisa ver as perícias agendadas dos casos dele (e só dele).
-- A agenda interna mescla duas fontes: agenda_eventos (tipo='pericia') e
-- tarefas tipo='pericia' ativas com due_at (migradas do TI / processador
-- INSS). RLS de ambas é só-interno; em vez de abrir as tabelas, esta função
-- SECURITY DEFINER devolve a união SANITIZADA (sem descrição/metadata
-- internos) filtrada por casos.parceiro_id = auth.uid().
--
-- Interno que chamar recebe lista vazia (não tem caso com parceiro_id dele).
--
-- Heurística "perícia em si" espelha ehPericiaEmSi() de agenda.tsx: flag
-- metadata.pericia_evento manda; sem flag, título de acompanhamento não conta.
--
-- Idempotente: create or replace.

create or replace function public.pericias_do_parceiro()
returns table (
  fonte text,
  id uuid,
  caso_id uuid,
  cliente_nome text,
  titulo text,
  start_at timestamptz,
  end_at timestamptz,
  local text
)
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
  select
    'evento'::text as fonte,
    e.id, e.caso_id, cl.nome, e.titulo, e.start_at, e.end_at, e.local
  from public.agenda_eventos e
  join public.casos c on c.id = e.caso_id and c.parceiro_id = auth.uid()
  left join public.clientes cl on cl.id = c.cliente_id
  where e.tipo = 'pericia'
    and e.restrito_a is null
  union all
  select
    'tarefa'::text as fonte,
    t.id, t.caso_id, cl.nome, t.titulo,
    t.due_at as start_at,
    t.due_at as end_at,     -- tarefa não tem hora de fim; front trata por dia
    null::text as local
  from public.tarefas t
  join public.casos c on c.id = t.caso_id and c.parceiro_id = auth.uid()
  left join public.clientes cl on cl.id = c.cliente_id
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
  order by 6
$$;

revoke all on function public.pericias_do_parceiro() from public, anon;
grant execute on function public.pericias_do_parceiro() to authenticated;

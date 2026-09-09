-- "Ver como parceiro" (admin, somente leitura): agenda_do_parceiro aceita um
-- p_parceiro_id opcional que SÓ admin pode usar.
--
-- Feedback da Naira (2026-09-02): admin (Naira/Mara) quer ver o lado do
-- parceiro na produção — kanban de Tarefas + Agenda — sem senha e sem derrubar
-- a sessão de ninguém.
--
-- Segurança: p_parceiro_id só surte efeito quando is_admin(); qualquer outro
-- (parceiro comum, interno não-admin, cron) cai no próprio auth.uid() — nunca
-- enxerga o parceiro alheio. Chamadas existentes (sem o arg) não mudam.
--
-- Assinatura passa de (p_desde) para (p_desde, p_parceiro_id); o overload
-- antigo é dropado antes (senão a chamada sem-arg vira ambígua). Corpo partido
-- da definição vigente (migration_tarefas_parceiro_correcoes); a única mudança
-- é o alvo do filtro parceiro. Idempotente.

drop function if exists public.agenda_do_parceiro(timestamptz);

create or replace function public.agenda_do_parceiro(
  p_desde timestamptz default null,
  p_parceiro_id uuid default null
)
returns table (
  fonte text,
  id uuid,
  caso_id uuid,
  tipo text,
  fase text,
  cliente_nome text,
  titulo text,
  start_at timestamptz,
  end_at timestamptz,
  local text,
  natureza text
)
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
  select
    'evento'::text as fonte,
    e.id, e.caso_id, e.tipo, c.fase::text, cl.nome, e.titulo, e.start_at, e.end_at, e.local,
    case
      when e.tipo = 'audiencia' then 'judicial'
      when e.processo_judicial_id is not null then 'judicial'
      when e.processo_admin_id is not null then 'admin'
      when e.titulo ~* 'judicial' then 'judicial'
      when e.titulo ~* 'inss' then 'admin'
      else null
    end as natureza
  from public.agenda_eventos e
  join public.casos c
    on c.id = e.caso_id
   and c.parceiro_id = (
     case when p_parceiro_id is not null and public.is_admin()
          then p_parceiro_id else auth.uid() end
   )
  left join public.clientes cl on cl.id = c.cliente_id
  where e.tipo in ('pericia', 'audiencia')
    and e.restrito_a is null
    and (p_desde is null or e.end_at >= p_desde)
  union all
  select
    'tarefa'::text as fonte,
    t.id, t.caso_id, 'pericia'::text as tipo, c.fase::text, cl.nome, t.titulo,
    t.due_at as start_at,
    t.due_at as end_at,
    null::text as local,
    case
      when t.processo_judicial_id is not null then 'judicial'
      when t.processo_admin_id is not null then 'admin'
      when t.titulo ~* 'judicial' then 'judicial'
      when t.titulo ~* 'inss' then 'admin'
      else null
    end as natureza
  from public.tarefas t
  join public.casos c
    on c.id = t.caso_id
   and c.parceiro_id = (
     case when p_parceiro_id is not null and public.is_admin()
          then p_parceiro_id else auth.uid() end
   )
  left join public.clientes cl on cl.id = c.cliente_id
  where t.tipo = 'pericia'
    and t.status in ('a_fazer', 'fazendo')
    and t.due_at is not null
    and (p_desde is null or t.due_at >= p_desde)
    and (
      (t.metadata->>'pericia_evento')::boolean is true
      or (
        t.metadata->>'pericia_evento' is null
        and t.titulo !~* '(acompanh|contatar|resultado|ligar|compareceu|agendamento de)'
      )
    )
  order by 8
$$;

revoke all on function public.agenda_do_parceiro(timestamptz, uuid) from public, anon;
grant execute on function public.agenda_do_parceiro(timestamptz, uuid) to authenticated;

comment on function public.agenda_do_parceiro(timestamptz, uuid) is
  'Agenda sanitizada do parceiro (perícias + audiências). p_desde corta por data; p_parceiro_id só surte efeito para is_admin() (Ver como parceiro), senão usa auth.uid(). SECURITY DEFINER.';

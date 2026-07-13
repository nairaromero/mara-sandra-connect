-- ============================================================================
-- CRM Comercial — fase 2: agendamento integrado à agenda + conversão em cliente.
-- Aplicada em 2026-07-13 (projeto llugytkdsfsrciavhrfw).
--
-- 1) `leads` ganha rastreio da consulta agendada e do cliente criado no handoff.
-- 2) `agenda_eventos` ganha visibilidade restrita opcional: `restrito_a` NULL
--    mantém o comportamento atual (todo interno vê); com UUIDs, só quem está
--    na lista vê/edita/apaga o evento. Usado pela consulta do comercial, que
--    só o vendedor e um convidado escolhido devem enxergar.
-- ============================================================================

alter table public.leads
  add column if not exists consulta_em timestamptz,
  add column if not exists agenda_evento_id uuid references public.agenda_eventos(id) on delete set null,
  add column if not exists cliente_id uuid references public.clientes(id) on delete set null;

comment on column public.leads.consulta_em is 'Data/hora da consulta agendada (espelho do evento na agenda).';
comment on column public.leads.cliente_id is 'Cliente criado a partir deste lead no handoff.';

alter table public.agenda_eventos
  add column if not exists restrito_a uuid[];

comment on column public.agenda_eventos.restrito_a is
  'NULL = visível pra toda a equipe interna (padrão). Com UUIDs, só os usuários listados veem/editam o evento.';

drop policy if exists "agenda_eventos_select_interno" on public.agenda_eventos;
create policy "agenda_eventos_select_interno"
  on public.agenda_eventos for select
  using (
    exists (select 1 from public.usuarios u where u.id = auth.uid() and u.tipo = 'interno')
    and (restrito_a is null or auth.uid() = any(restrito_a))
  );

drop policy if exists "agenda_eventos_update_interno" on public.agenda_eventos;
create policy "agenda_eventos_update_interno"
  on public.agenda_eventos for update
  using (
    exists (select 1 from public.usuarios u where u.id = auth.uid() and u.tipo = 'interno')
    and (restrito_a is null or auth.uid() = any(restrito_a))
  );

drop policy if exists "agenda_eventos_delete_interno" on public.agenda_eventos;
create policy "agenda_eventos_delete_interno"
  on public.agenda_eventos for delete
  using (
    exists (select 1 from public.usuarios u where u.id = auth.uid() and u.tipo = 'interno')
    and (restrito_a is null or auth.uid() = any(restrito_a))
  );

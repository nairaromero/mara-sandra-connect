-- =============================================================================
-- Migration: agenda_eventos
--
-- MVP 4 do plano em planning/SUBSTITUIR_TRAMITACAO.md.
-- Por enquanto a UI só cria/edita PERÍCIAS, mas o schema já suporta
-- audiência/reunião/interno (acrescentar tipos depois é trivial).
--
-- DECISÕES:
--   - start_at/end_at obrigatórios; eventos sem hora exata (tipo "dia
--     todo") podem usar 00:00–23:59 do dia OU duas datas iguais.
--   - Vínculo opcional a caso E processo (admin XOR judicial). Espelha
--     o que tarefas/andamentos já fazem.
--   - gcal_event_id / gcal_calendar_id ficam vazios até a usuária ligar
--     o Google Calendar (chunk 2). Quando o sync rodar, eles guardam
--     a referência do evento criado lá.
--   - RLS: só interno vê/mexe nesta fase. Parceiro fica fora.
--
-- Depende de: public.casos, public.processos_admin, public.processos_judiciais,
--             public.usuarios. Idempotente.
-- =============================================================================

create table if not exists public.agenda_eventos (
  id                    uuid primary key default gen_random_uuid(),
  caso_id               uuid references public.casos(id) on delete set null,
  processo_admin_id     uuid references public.processos_admin(id) on delete set null,
  processo_judicial_id  uuid references public.processos_judiciais(id) on delete set null,
  responsavel_id        uuid references public.usuarios(id) on delete set null,

  tipo                  text not null check (tipo in ('pericia','audiencia','reuniao','interno')),
  titulo                text not null check (length(trim(titulo)) > 0),
  descricao             text,

  start_at              timestamptz not null,
  end_at                timestamptz not null,
  local                 text,
  participantes         jsonb not null default '[]'::jsonb,
  metadata              jsonb not null default '{}'::jsonb,

  -- Google Calendar (preenchido pelo sync — chunk 2)
  gcal_event_id         text,
  gcal_calendar_id      text,
  gcal_synced_at        timestamptz,

  created_by            uuid references public.usuarios(id) on delete set null,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

-- Mutual exclusion: processo só pode ser admin OU judicial, nunca ambos.
do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.agenda_eventos'::regclass
       and conname = 'agenda_eventos_processo_unico'
  ) then
    alter table public.agenda_eventos
      add constraint agenda_eventos_processo_unico
      check (processo_admin_id is null or processo_judicial_id is null);
  end if;
end$$;

-- end_at deve ser >= start_at.
do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.agenda_eventos'::regclass
       and conname = 'agenda_eventos_intervalo_valido'
  ) then
    alter table public.agenda_eventos
      add constraint agenda_eventos_intervalo_valido
      check (end_at >= start_at);
  end if;
end$$;

create index if not exists idx_agenda_eventos_start_at
  on public.agenda_eventos (start_at);

create index if not exists idx_agenda_eventos_responsavel_start
  on public.agenda_eventos (responsavel_id, start_at);

create index if not exists idx_agenda_eventos_caso
  on public.agenda_eventos (caso_id) where caso_id is not null;

create index if not exists idx_agenda_eventos_gcal
  on public.agenda_eventos (gcal_event_id) where gcal_event_id is not null;

-- Trigger updated_at
create or replace function public._agenda_eventos_touch()
returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end;
$$;
drop trigger if exists trg_agenda_eventos_touch on public.agenda_eventos;
create trigger trg_agenda_eventos_touch
  before update on public.agenda_eventos
  for each row execute function public._agenda_eventos_touch();

-- RLS — só interno
alter table public.agenda_eventos enable row level security;
grant select, insert, update, delete on public.agenda_eventos to service_role;

drop policy if exists "agenda_eventos_select_interno" on public.agenda_eventos;
create policy "agenda_eventos_select_interno"
  on public.agenda_eventos for select
  using (exists (select 1 from public.usuarios u where u.id = auth.uid() and u.tipo = 'interno'));

drop policy if exists "agenda_eventos_insert_interno" on public.agenda_eventos;
create policy "agenda_eventos_insert_interno"
  on public.agenda_eventos for insert
  with check (exists (select 1 from public.usuarios u where u.id = auth.uid() and u.tipo = 'interno'));

drop policy if exists "agenda_eventos_update_interno" on public.agenda_eventos;
create policy "agenda_eventos_update_interno"
  on public.agenda_eventos for update
  using (exists (select 1 from public.usuarios u where u.id = auth.uid() and u.tipo = 'interno'));

drop policy if exists "agenda_eventos_delete_interno" on public.agenda_eventos;
create policy "agenda_eventos_delete_interno"
  on public.agenda_eventos for delete
  using (exists (select 1 from public.usuarios u where u.id = auth.uid() and u.tipo = 'interno'));

comment on table public.agenda_eventos is
  'Eventos da agenda do escritório (perícias, audiências, reuniões). Pode ser sincronizado com Google Calendar via gcal_event_id (preenchido pelo edge function gcal-event-push).';

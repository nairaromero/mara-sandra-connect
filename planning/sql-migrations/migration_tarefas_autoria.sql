-- =============================================================================
-- migration_tarefas_autoria.sql  (2026-08-19)
--
-- Rastro de QUEM mexeu na tarefa (pedido da Naira):
--   - quem criou:              tarefas.created_by (já existia, mas a UI nunca
--                              preenchia → trigger BEFORE INSERT agora usa auth.uid())
--   - quem fez / arquivou:     tarefas.status_alterado_por / status_alterado_em
--                              (preenchidos pelo trigger sempre que `status` muda;
--                              "arquivar" = mover pra feito ou cancelado)
--   - quem excluiu:            tabela tarefas_excluidas (cópia da linha + autor),
--                              alimentada por trigger AFTER DELETE.
--
-- auth.uid() é NULL quando quem mexe é service_role (edge functions, cron,
-- n8n): nesses casos o autor fica NULL e a UI mostra "sistema".
--
-- Idempotente.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Colunas de autoria da última mudança de status
-- ---------------------------------------------------------------------------
alter table public.tarefas
  add column if not exists status_alterado_por uuid references public.usuarios(id) on delete set null,
  add column if not exists status_alterado_em  timestamptz;

comment on column public.tarefas.status_alterado_por is
  'Quem fez a última mudança de status (feito/cancelado/a_fazer/fazendo). NULL = sistema (service_role) ou anterior a esta migration.';
comment on column public.tarefas.status_alterado_em is
  'Quando o status mudou pela última vez.';

-- ---------------------------------------------------------------------------
-- 2. Trigger BEFORE UPDATE: além de updated_at/completed_at, grava autoria
--    da mudança de status.
-- ---------------------------------------------------------------------------
create or replace function public._tarefas_touch_timestamps()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  if new.status = 'feito' and old.status <> 'feito' then
    new.completed_at := now();
  elsif new.status <> 'feito' then
    new.completed_at := null;
  end if;
  if new.status is distinct from old.status then
    new.status_alterado_em  := now();
    -- auth.uid() = null sob service_role → "sistema".
    new.status_alterado_por := auth.uid();
  end if;
  return new;
end;
$$;

drop trigger if exists trg_tarefas_touch_timestamps on public.tarefas;
create trigger trg_tarefas_touch_timestamps
  before update on public.tarefas
  for each row
  execute function public._tarefas_touch_timestamps();

-- ---------------------------------------------------------------------------
-- 3. Trigger BEFORE INSERT: created_by = quem está logado (se o chamador não
--    mandou explicitamente). Edge functions com service_role continuam NULL.
-- ---------------------------------------------------------------------------
create or replace function public._tarefas_set_created_by()
returns trigger
language plpgsql
as $$
begin
  if new.created_by is null then
    new.created_by := auth.uid();
  end if;
  return new;
end;
$$;

drop trigger if exists trg_tarefas_set_created_by on public.tarefas;
create trigger trg_tarefas_set_created_by
  before insert on public.tarefas
  for each row
  execute function public._tarefas_set_created_by();

-- ---------------------------------------------------------------------------
-- 4. Log de exclusões
-- ---------------------------------------------------------------------------
create table if not exists public.tarefas_excluidas (
  id              uuid primary key default gen_random_uuid(),
  tarefa_id       uuid not null,
  -- sem FK: o caso pode sumir depois (ou a exclusão ser o cascade do caso).
  caso_id         uuid,
  titulo          text not null,
  status          text not null,
  tipo            text,
  due_at          timestamptz,
  responsavel_id  uuid references public.usuarios(id) on delete set null,
  created_by      uuid references public.usuarios(id) on delete set null,
  created_at      timestamptz,
  -- cópia integral da linha na hora da exclusão (pra restaurar na mão se precisar)
  dados           jsonb not null,
  excluida_por    uuid references public.usuarios(id) on delete set null,
  excluida_em     timestamptz not null default now()
);

comment on table public.tarefas_excluidas is
  'Log de tarefas excluídas (trigger AFTER DELETE em tarefas). excluida_por NULL = sistema/cascade sem usuário logado.';

create index if not exists idx_tarefas_excluidas_caso on public.tarefas_excluidas (caso_id, excluida_em desc);
create index if not exists idx_tarefas_excluidas_em   on public.tarefas_excluidas (excluida_em desc);

alter table public.tarefas_excluidas enable row level security;

-- Interno lê; ninguém escreve pelo front (só o trigger, SECURITY DEFINER).
drop policy if exists tarefas_excluidas_select_interno on public.tarefas_excluidas;
create policy tarefas_excluidas_select_interno on public.tarefas_excluidas
  for select to authenticated
  using (public.is_interno());

grant select on public.tarefas_excluidas to authenticated;

create or replace function public._tarefas_log_exclusao()
returns trigger
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
begin
  insert into public.tarefas_excluidas
    (tarefa_id, caso_id, titulo, status, tipo, due_at, responsavel_id,
     created_by, created_at, dados, excluida_por, excluida_em)
  values
    (old.id, old.caso_id, old.titulo, old.status, old.tipo, old.due_at, old.responsavel_id,
     old.created_by, old.created_at, to_jsonb(old), auth.uid(), now());
  return old;
end;
$$;

drop trigger if exists trg_tarefas_log_exclusao on public.tarefas;
create trigger trg_tarefas_log_exclusao
  after delete on public.tarefas
  for each row
  execute function public._tarefas_log_exclusao();

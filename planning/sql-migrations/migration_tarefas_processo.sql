-- =============================================================================
-- Migration: tarefas ganham processo_admin_id e processo_judicial_id
--
-- CONTEXTO: hoje a tarefa só linka com `caso_id`. Mas o caso pode ter
-- múltiplos `processos_admin` (requerimentos no INSS) e `processos_judiciais`.
-- Audiência, perícia, prazos processuais — todos são de um processo
-- específico, não do caso "em geral". Espelha o que `andamentos` já tem.
--
-- DECISÕES:
--   - Ambos nullable: tarefa pode ser do caso (sem processo específico)
--     ou de um processo. Nunca dos dois ao mesmo tempo.
--   - on delete set null: se o processo é deletado, a tarefa não some — só
--     perde o vínculo.
--   - Index parcial em cada FK para queries "tarefas deste processo".
--
-- Depende de: migration_tarefas.sql, processos_admin, processos_judiciais.
-- Idempotente.
-- =============================================================================

alter table public.tarefas
  add column if not exists processo_admin_id uuid
    references public.processos_admin(id) on delete set null;

alter table public.tarefas
  add column if not exists processo_judicial_id uuid
    references public.processos_judiciais(id) on delete set null;

-- Garante mutual exclusion. Idempotente: só cria se ainda não existe.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.tarefas'::regclass
      and conname = 'tarefas_processo_unico'
  ) then
    alter table public.tarefas
      add constraint tarefas_processo_unico
      check (processo_admin_id is null or processo_judicial_id is null);
  end if;
end$$;

create index if not exists idx_tarefas_processo_admin
  on public.tarefas (processo_admin_id)
  where processo_admin_id is not null;

create index if not exists idx_tarefas_processo_judicial
  on public.tarefas (processo_judicial_id)
  where processo_judicial_id is not null;

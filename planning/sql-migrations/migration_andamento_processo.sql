-- =============================================================================
-- Migration: vinculo de andamento a processo (admin OU judicial)
-- + indice de dedup para notas importadas do Tramitacao Inteligente
--
-- Rodar no Supabase Studio: SQL Editor > New query > colar e Run.
-- Idempotente: pode rodar varias vezes sem dano.
-- =============================================================================

-- 1) Coluna processo_admin_id (FK opcional para processos_admin)
alter table public.andamentos
  add column if not exists processo_admin_id uuid
  references public.processos_admin(id)
  on delete set null;

-- 2) Coluna processo_judicial_id (FK opcional para processos_judiciais)
alter table public.andamentos
  add column if not exists processo_judicial_id uuid
  references public.processos_judiciais(id)
  on delete set null;

-- 3) Constraint: andamento pode apontar para UM tipo de processo (ou nenhum),
--    nunca os dois ao mesmo tempo.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'andamentos_processo_unico'
  ) then
    alter table public.andamentos
      add constraint andamentos_processo_unico
      check (processo_admin_id is null or processo_judicial_id is null);
  end if;
end$$;

-- 4) Indices para queries por processo (ex.: "listar andamentos do processo X")
create index if not exists idx_andamentos_processo_admin
  on public.andamentos (processo_admin_id)
  where processo_admin_id is not null;

create index if not exists idx_andamentos_processo_judicial
  on public.andamentos (processo_judicial_id)
  where processo_judicial_id is not null;

-- 5) Indice parcial para dedup de notas vindas do TI
--    (metadata->>'ti_nota_id' guarda o id integer da nota no TI)
--    Permite checar rapido "essa nota ja foi importada?" sem full scan.
create index if not exists idx_andamentos_ti_nota_id
  on public.andamentos ((metadata->>'ti_nota_id'))
  where origem = 'tramitacao';

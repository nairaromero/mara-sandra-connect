-- =============================================================================
-- Migration: hierarquia (cadeia de origem) + unicidade global de processos
--
-- Objetivos:
--   1) Permitir vincular um processo a um "pai" (processo de origem), podendo
--      cruzar tipos (admin <-> judicial). parent_id NULL = processo principal.
--   2) Classificar cada no da cadeia por etapa (lista fixa na aplicacao).
--   3) Impedir cadastro de numero de processo/requerimento duplicado em todo o
--      sistema (unicidade global, ignorando formatacao).
--
-- Rodar no Supabase Studio: SQL Editor > New query > colar e Run.
-- Idempotente: pode rodar varias vezes sem dano.
--
-- IMPORTANTE: os indices unicos (passo 4) FALHAM se ja existirem duplicados nos
-- dados atuais. RODE PRIMEIRO as queries de diagnostico do passo 0 e limpe os
-- duplicados antes de criar os indices.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 0) DIAGNOSTICO (rode isolado primeiro; nao altera nada)
--    Lista numeros repetidos depois de normalizar (so digitos). Se retornar
--    linhas, resolva os duplicados antes de seguir para o passo 4.
-- -----------------------------------------------------------------------------
-- Administrativos duplicados:
--   select regexp_replace(coalesce(numero_requerimento,''), '\D', '', 'g') as num,
--          count(*), array_agg(id) as ids
--   from public.processos_admin
--   where coalesce(numero_requerimento,'') <> ''
--   group by 1 having count(*) > 1;
--
-- Judiciais duplicados:
--   select regexp_replace(coalesce(numero_processo,''), '\D', '', 'g') as num,
--          count(*), array_agg(id) as ids
--   from public.processos_judiciais
--   where coalesce(numero_processo,'') <> ''
--   group by 1 having count(*) > 1;

-- -----------------------------------------------------------------------------
-- 1) Colunas de hierarquia em processos_admin
-- -----------------------------------------------------------------------------
alter table public.processos_admin
  add column if not exists parent_id uuid,
  add column if not exists parent_tipo text,
  add column if not exists etapa_tipo text;

-- -----------------------------------------------------------------------------
-- 2) Colunas de hierarquia em processos_judiciais
-- -----------------------------------------------------------------------------
alter table public.processos_judiciais
  add column if not exists parent_id uuid,
  add column if not exists parent_tipo text,
  add column if not exists etapa_tipo text;

-- -----------------------------------------------------------------------------
-- 3) Constraints de coerencia de parent_tipo
--    parent_tipo so pode ser 'admin' ou 'judicial', e tem que andar junto com
--    parent_id (os dois preenchidos ou os dois nulos).
-- -----------------------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'processos_admin_parent_tipo_chk'
  ) then
    alter table public.processos_admin
      add constraint processos_admin_parent_tipo_chk
      check (
        (parent_id is null and parent_tipo is null)
        or (parent_id is not null and parent_tipo in ('admin', 'judicial'))
      );
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'processos_judiciais_parent_tipo_chk'
  ) then
    alter table public.processos_judiciais
      add constraint processos_judiciais_parent_tipo_chk
      check (
        (parent_id is null and parent_tipo is null)
        or (parent_id is not null and parent_tipo in ('admin', 'judicial'))
      );
  end if;
end$$;

-- Indices para montar a arvore (buscar filhos de um processo)
create index if not exists idx_processos_admin_parent
  on public.processos_admin (parent_id)
  where parent_id is not null;

create index if not exists idx_processos_judiciais_parent
  on public.processos_judiciais (parent_id)
  where parent_id is not null;

-- -----------------------------------------------------------------------------
-- 4) Unicidade global do numero (ignorando formatacao)
--    Coluna gerada normalizada (so digitos; vazio vira NULL) + indice unico
--    parcial. Assim "123.456" e "123456" colidem, e nulos/vazios nao bloqueiam.
--
--    ATENCAO: se o passo 0 acusou duplicados, estes CREATE vao falhar. Limpe
--    antes.
-- -----------------------------------------------------------------------------
alter table public.processos_admin
  add column if not exists numero_req_normalizado text
  generated always as (
    nullif(regexp_replace(coalesce(numero_requerimento, ''), '\D', '', 'g'), '')
  ) stored;

alter table public.processos_judiciais
  add column if not exists numero_proc_normalizado text
  generated always as (
    nullif(regexp_replace(coalesce(numero_processo, ''), '\D', '', 'g'), '')
  ) stored;

create unique index if not exists uq_processos_admin_numero
  on public.processos_admin (numero_req_normalizado)
  where numero_req_normalizado is not null;

create unique index if not exists uq_processos_judiciais_numero
  on public.processos_judiciais (numero_proc_normalizado)
  where numero_proc_normalizado is not null;

-- =============================================================================
-- Fim. Resumo do que foi criado:
--   processos_admin / processos_judiciais:
--     + parent_id, parent_tipo, etapa_tipo        (hierarquia/cadeia)
--     + numero_req_normalizado / numero_proc_normalizado (gerada, dedup)
--     + indice unico parcial no numero normalizado (unicidade global)
--     + indice em parent_id (montar arvore)
--     + check de coerencia de parent_tipo
-- =============================================================================

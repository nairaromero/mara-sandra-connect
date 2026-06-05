-- Migration: oabs_monitoradas
--
-- Tabela de OABs que a integração DJE (Comunica API do CNJ / DJEN) monitora.
-- A edge function `sync-djen-publicacoes` lê as OABs ativas daqui e consulta
-- as publicações de cada uma, casando pelo número CNJ contra processos_judiciais.
--
-- Estratégia (ver planning/INTEGRACAO_DJE.md):
--   - tipo='escritorio'  -> OAB(s) do escritório (começa por aqui)
--   - tipo='parceiro'    -> OAB de cada parceiro indicador (futuro, no onboarding)
--
-- RLS: habilitado SEM policies de cliente — só a service_role (edge function)
-- acessa. UI de gestão de OABs é task futura; quando existir, adicionar policy
-- de SELECT/INSERT para usuários internos.

create table if not exists public.oabs_monitoradas (
  id          uuid primary key default gen_random_uuid(),
  numero      text not null,
  uf          text not null,
  tipo        text not null check (tipo in ('escritorio', 'parceiro')),
  -- parceiro é um registro em public.usuarios (não há tabela "parceiros")
  parceiro_id uuid references public.usuarios(id) on delete cascade,
  ativo       boolean not null default true,
  observacao  text,
  created_at  timestamptz not null default now(),

  -- numero só dígitos; uf 2 letras maiúsculas
  constraint oabs_monitoradas_numero_digits check (numero ~ '^[0-9]+$'),
  constraint oabs_monitoradas_uf_format     check (uf ~ '^[A-Z]{2}$'),

  -- coerência tipo <-> parceiro_id
  constraint oabs_monitoradas_parceiro_coerente check (
    (tipo = 'parceiro'   and parceiro_id is not null) or
    (tipo = 'escritorio' and parceiro_id is null)
  ),

  unique (numero, uf)
);

comment on table public.oabs_monitoradas is
  'OABs monitoradas pela integração DJE (Comunica API/DJEN). Ver planning/INTEGRACAO_DJE.md.';

create index if not exists oabs_monitoradas_ativo_idx
  on public.oabs_monitoradas (ativo) where ativo;

alter table public.oabs_monitoradas enable row level security;

-- Grants: a edge function usa service_role (bypassa RLS). authenticated só lê
-- (continua barrado por RLS até existir policy — UI de gestão é task futura).
-- Necessário porque a tabela foi criada via Management API (role postgres) e não
-- herdou os grants default do fluxo normal do Supabase.
grant select, insert, update, delete on public.oabs_monitoradas to service_role;
grant select on public.oabs_monitoradas to authenticated;

-- ----------------------------------------------------------------------------
-- SEED — OAB do escritório
-- ----------------------------------------------------------------------------
-- Preencher com a OAB real do escritório antes/depois de aplicar a migration.
-- Exemplo:
-- insert into public.oabs_monitoradas (numero, uf, tipo)
-- values ('123456', 'GO', 'escritorio')
-- on conflict (numero, uf) do nothing;

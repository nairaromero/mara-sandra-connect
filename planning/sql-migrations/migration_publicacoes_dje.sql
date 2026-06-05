-- Migration: publicacoes_dje
--
-- Armazena TODAS as publicações do DJE puxadas da Comunica API (vinculadas a um
-- processo cadastrado + órfãs sem processo). É a fonte da verdade da aba interna
-- "/publicacoes" (triagem da semana). As vinculadas TAMBÉM viram andamento no
-- caso (origem='djen') — esta tabela é o log de ingestão/triagem.
--
-- Ver planning/INTEGRACAO_DJE.md. Populada pela edge function sync-djen-publicacoes.
--
-- Acesso: ferramenta INTERNA. RLS permite SELECT só a usuários internos
-- (is_interno()). Parceiro NÃO lê esta tabela (vê suas atualizações via
-- andamentos do caso). service_role (edge function) escreve.

create table if not exists public.publicacoes_dje (
  id                   uuid primary key default gen_random_uuid(),
  djen_id              text not null unique,          -- id da comunicação na Comunica API (dedup)
  hash                 text,
  numero_processo      text,                          -- CNJ mascarado
  numero_normalizado   text,                          -- só dígitos (usado no match)
  sigla_tribunal       text,
  nome_orgao           text,
  tipo_comunicacao     text,
  tipo_documento       text,
  data_disponibilizacao date,
  texto                text,                           -- teor completo (HTML já limpo)
  oab_numero           text,
  oab_uf               text,
  status               text not null default 'sem_processo'
                         check (status in ('vinculada', 'sem_processo', 'ignorada')),
  caso_id              uuid references public.casos(id) on delete set null,
  processo_judicial_id uuid references public.processos_judiciais(id) on delete set null,
  andamento_id         uuid references public.andamentos(id) on delete set null,
  certidao_url         text,
  link                 text,
  created_at           timestamptz not null default now()
);

comment on table public.publicacoes_dje is
  'Log de ingestão/triagem das publicações do DJE (Comunica API/DJEN). Ferramenta interna. Ver planning/INTEGRACAO_DJE.md.';

create index if not exists publicacoes_dje_status_idx
  on public.publicacoes_dje (status);
create index if not exists publicacoes_dje_data_idx
  on public.publicacoes_dje (data_disponibilizacao desc);
create index if not exists publicacoes_dje_numnorm_idx
  on public.publicacoes_dje (numero_normalizado);

alter table public.publicacoes_dje enable row level security;

-- SELECT só para internos.
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname='public' and tablename='publicacoes_dje'
      and policyname='publicacoes_dje_interno_select'
  ) then
    create policy "publicacoes_dje_interno_select"
      on public.publicacoes_dje
      as permissive for select to authenticated
      using (public.is_interno());
  end if;
end$$;

-- Grants: edge function usa service_role (bypassa RLS). authenticated lê via RLS.
-- Necessário porque a tabela é criada via Management API (não herda grants default).
grant select, insert, update, delete on public.publicacoes_dje to service_role;
grant select on public.publicacoes_dje to authenticated;

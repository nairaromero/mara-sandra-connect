-- =============================================================================
-- Migration: central de notificacoes (novidades de sync) para usuarios internos
--
-- Alimentada pela edge function sync-ti-todos (e futuramente pelo sync agendado).
-- Tipos: 'andamento' (novos andamentos importados), 'cliente_ti' (cliente existe
-- no TI mas nao no app), 'tags' (tags do cliente mudaram), 'processo' (novo
-- processo detectado).
--
-- Rodar no SQL Editor do Supabase Studio (ou via CLI). Idempotente.
-- =============================================================================

create table if not exists public.notificacoes (
  id uuid primary key default gen_random_uuid(),
  tipo text not null check (tipo in ('andamento', 'cliente_ti', 'tags', 'processo')),
  titulo text not null,
  descricao text,
  caso_id uuid references public.casos(id) on delete cascade,
  cliente_id uuid references public.clientes(id) on delete cascade,
  metadata jsonb,
  lida boolean not null default false,
  created_at timestamptz not null default now()
);

-- Listagem do sino: nao lidas primeiro, mais recentes no topo.
create index if not exists idx_notificacoes_nao_lidas
  on public.notificacoes (lida, created_at desc);

-- Dedup de "novo cliente no TI": evita recriar alerta do mesmo CPF enquanto
-- nao lido. Indice parcial unico no cpf guardado em metadata.
create unique index if not exists uq_notificacoes_cliente_ti_cpf
  on public.notificacoes ((metadata->>'cpf'))
  where tipo = 'cliente_ti' and lida = false;

alter table public.notificacoes enable row level security;

-- Apenas internos enxergam/gerenciam notificacoes. A edge function usa service
-- role (bypassa RLS) para inserir.
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'notificacoes'
      and policyname = 'notificacoes_interno_all'
  ) then
    create policy "notificacoes_interno_all"
    on public.notificacoes
    as permissive
    for all
    to authenticated
    using (public.is_interno())
    with check (public.is_interno());
  end if;
end$$;

-- ============================================================================
-- CRM Comercial — fase 1: tabela `leads` (captação pública do site).
-- Aplicada em 2026-07-13 (projeto llugytkdsfsrciavhrfw).
--
-- O formulário da home (visitante anônimo, role `anon`) INSERE leads direto
-- via supabase-js. RLS é a fronteira: anon só insere, nunca lê/edita/apaga.
-- Equipe interna (is_interno()) gerencia tudo. A tabela já nasce com os campos
-- de etapa/timestamps que o módulo comercial (tela do Sebastião) vai usar.
-- ============================================================================

create table if not exists public.leads (
  id uuid primary key default gen_random_uuid(),
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),

  -- quem é
  tipo text not null check (tipo in ('cliente', 'parceiro')),
  nome text not null check (char_length(nome) between 2 and 200),
  whatsapp text not null check (char_length(whatsapp) between 8 and 30),

  -- campos do lead cliente (Canal A)
  situacao text check (situacao is null or situacao in (
    'aposentadoria', 'incapacidade', 'bpc_loas', 'pensao_morte',
    'salario_maternidade', 'revisao', 'planejamento', 'outro'
  )),
  inss_status text check (inss_status is null or inss_status in (
    'negado', 'em_analise', 'nao_pedi', 'nao_sei'
  )),

  -- campos do lead parceiro (advogado interessado)
  oab text check (oab is null or char_length(oab) <= 40),
  interesse text check (interesse is null or interesse in (
    'indicar_caso', 'conhecer_parceria', 'testar_demo'
  )),

  -- rastreio de origem (estudo de tráfego pago)
  origem text not null default 'site' check (char_length(origem) <= 40),
  utm_source text check (utm_source is null or char_length(utm_source) <= 120),
  utm_medium text check (utm_medium is null or char_length(utm_medium) <= 120),
  utm_campaign text check (utm_campaign is null or char_length(utm_campaign) <= 120),
  utm_content text check (utm_content is null or char_length(utm_content) <= 120),
  utm_term text check (utm_term is null or char_length(utm_term) <= 120),

  -- esteira do comercial (usada pela tela do Sebastião; o form só cria 'novo')
  etapa text not null default 'novo' check (etapa in (
    'novo', 'triagem', 'analise', 'agendar', 'agendado',
    'fechamento', 'handoff', 'fechado', 'sem_direito', 'perdido'
  )),
  primeiro_contato_em timestamptz,

  -- anotações internas (nunca visíveis ao anon)
  observacoes text
);

create index if not exists leads_etapa_idx on public.leads (etapa, criado_em desc);
create index if not exists leads_criado_em_idx on public.leads (criado_em desc);

alter table public.leads enable row level security;

-- Visitante anônimo (formulário público): SÓ insere, e só nas etapas/campos
-- de nascimento do lead. Sem select/update/delete — ninguém de fora lê leads.
drop policy if exists leads_anon_insert on public.leads;
create policy leads_anon_insert on public.leads
  for insert to anon
  with check (etapa = 'novo' and primeiro_contato_em is null and observacoes is null);

-- Usuário logado também pode enviar o formulário do site (ex.: parceiro logado
-- navegando na home) — mesma regra de nascimento.
drop policy if exists leads_authenticated_insert on public.leads;
create policy leads_authenticated_insert on public.leads
  for insert to authenticated
  with check (etapa = 'novo' and primeiro_contato_em is null and observacoes is null);

-- Equipe interna gerencia tudo (a tela do comercial vem na fase 2).
drop policy if exists leads_interno_all on public.leads;
create policy leads_interno_all on public.leads
  for all to authenticated
  using (public.is_interno())
  with check (public.is_interno());

-- Endurece grants: anon não ganha select/update/delete nem por descuido.
revoke all on public.leads from anon;
grant insert on public.leads to anon;
grant select, insert, update, delete on public.leads to authenticated;

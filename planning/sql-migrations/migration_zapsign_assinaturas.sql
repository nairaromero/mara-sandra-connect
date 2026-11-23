-- ============================================================================
-- #517 — Assinatura eletrônica pelo ZapSign
--
-- O que muda:
--   1. `escritorio_integracoes` aceita o tipo 'zapsign' (token da API cifrado,
--      como Legalmail e TI; `config.ambiente` = 'producao' | 'sandbox' e
--      `config.inbound_token` = segredo que o webhook do ZapSign manda de volta).
--   2. Tabela `assinaturas`: um envio de documento do caso para assinar. Guarda
--      o token do documento no ZapSign, o status, os signatários (com o link de
--      cada um) e, quando todos assinam, o documento assinado gravado no caso.
--
-- Quem escreve: SÓ as edge functions (`zapsign-enviar`, `zapsign-webhook`), com
-- service role. A tela só lê — por isso não há policy de escrita nem grant de
-- escrita para `authenticated` (e nada a declarar em src/lib/rbac/exigencias.ts
-- como tabela; a function `zapsign-enviar` é que entra lá).
--
-- Quem lê: a equipe interna do escritório ativo. O parceiro não vê: a linha
-- carrega o link de assinatura do cliente.
--
-- Espelho: `assinaturas` entra em EXCLUIR no scripts/espelho-staging.sh (o
-- link de assinatura é real; não sai de produção).
-- Idempotente.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1) Tipo 'zapsign' em escritorio_integracoes
-- ---------------------------------------------------------------------------
-- Só acrescenta 'zapsign' à lista que o banco JÁ tem: a lista de tipos cresce
-- a cada lote, e reescrevê-la daqui apagaria o que outro lote incluiu.
do $$
declare
  v_def text;
begin
  select pg_get_constraintdef(oid) into v_def
    from pg_constraint
   where conrelid = 'public.escritorio_integracoes'::regclass and conname = 'escritorio_integracoes_tipo_check';
  if v_def is null then
    raise exception 'escritorio_integracoes_tipo_check não existe: confira a tabela antes de rodar';
  end if;
  if position('zapsign' in v_def) > 0 then
    return;
  end if;
  if position('ARRAY[' in v_def) = 0 then
    raise exception 'escritorio_integracoes_tipo_check fora do formato esperado: %', v_def;
  end if;
  v_def := replace(v_def, 'ARRAY[', 'ARRAY[''zapsign''::text, ');
  alter table public.escritorio_integracoes drop constraint escritorio_integracoes_tipo_check;
  execute 'alter table public.escritorio_integracoes add constraint escritorio_integracoes_tipo_check ' || v_def;
end $$;

-- O segredo do webhook diz de qual escritório é a chamada: não pode se repetir.
create unique index if not exists escritorio_integracoes_zapsign_segredo_uk
  on public.escritorio_integracoes ((config->>'inbound_token'))
  where tipo = 'zapsign' and config->>'inbound_token' is not null;

-- ---------------------------------------------------------------------------
-- 2) Tabela
-- ---------------------------------------------------------------------------
create table if not exists public.assinaturas (
  id uuid primary key default gen_random_uuid(),
  escritorio_id uuid not null references public.escritorios (id),
  caso_id uuid not null references public.casos (id) on delete cascade,
  -- o arquivo que foi enviado; se alguém apagar o documento, o envio fica
  documento_id uuid references public.documentos (id) on delete set null,
  -- o PDF assinado, gravado no caso quando todos assinam
  documento_assinado_id uuid references public.documentos (id) on delete set null,
  nome text not null,
  -- token do documento no ZapSign; nulo só enquanto o envio está em curso
  zapsign_doc_token text unique,
  sandbox boolean not null default false,
  -- enviando  = linha criada, chamada ao ZapSign em curso
  -- enviado   = no ZapSign, ninguém abriu
  -- aberto    = alguém abriu o link ou já assinou, mas falta gente
  -- gravando  = todos assinaram; baixando o PDF (trava contra aviso repetido)
  -- assinado  = PDF assinado gravado no caso
  -- recusado  = um signatário recusou
  -- cancelado = documento excluído no ZapSign
  status text not null default 'enviando'
    check (status in ('enviando', 'enviado', 'aberto', 'gravando', 'assinado', 'recusado', 'cancelado')),
  -- [{ nome, papel, email, telefone, token, sign_url, status, assinado_em }]
  signatarios jsonb not null default '[]'::jsonb,
  enviado_por uuid references public.usuarios (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  assinado_em timestamptz
);

create index if not exists assinaturas_escritorio_idx on public.assinaturas (escritorio_id);
create index if not exists assinaturas_caso_idx on public.assinaturas (caso_id, created_at desc);
-- Um envio em curso por documento: duas pessoas enviando ao mesmo tempo não
-- gastam a cota duas vezes (a lista é a `EM_CURSO` de _shared/assinatura.ts).
create unique index if not exists assinaturas_um_em_curso_por_documento
  on public.assinaturas (documento_id)
  where documento_id is not null and status in ('enviando', 'enviado', 'aberto', 'gravando');

-- ---------------------------------------------------------------------------
-- 3) Escritório: herança e isolamento (molde da migration_rbac_02)
-- ---------------------------------------------------------------------------
drop trigger if exists aa_herdar_escritorio on public.assinaturas;
create trigger aa_herdar_escritorio
  before insert or update of escritorio_id, caso_id, documento_id, documento_assinado_id on public.assinaturas
  for each row execute function private.tg_herdar_escritorio('caso_id=casos', 'documento_id=documentos', 'documento_assinado_id=documentos');

drop trigger if exists ab_suporte_nao_escreve on public.assinaturas;
create trigger ab_suporte_nao_escreve
  before insert or update or delete on public.assinaturas
  for each statement execute function private.tg_suporte_nao_escreve();

alter table public.assinaturas enable row level security;

drop policy if exists isolamento_escritorio on public.assinaturas;
create policy isolamento_escritorio on public.assinaturas
  as restrictive for all to authenticated
  using (escritorio_id = (select private.escritorio_ativo()))
  with check (escritorio_id = (select private.escritorio_ativo()));

-- ---------------------------------------------------------------------------
-- 4) Quem alcança: equipe interna lê; ninguém escreve pela API REST
-- ---------------------------------------------------------------------------
drop policy if exists assinaturas_select on public.assinaturas;
create policy assinaturas_select on public.assinaturas
  for select to authenticated
  using ((select public.is_interno()));

revoke all on public.assinaturas from anon, authenticated;
grant select on public.assinaturas to authenticated;

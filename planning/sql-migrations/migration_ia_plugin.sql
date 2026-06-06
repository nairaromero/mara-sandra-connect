-- =============================================================================
-- Migration: Plugin de IA (CRUD por conversa) — Fase 0 (Fundacoes)
--
-- Cria as tabelas de base do "Assistente de IA":
--   - ia_integracoes : cofre BYOK por usuario (provider/modelo + chave cifrada)
--   - ia_acoes       : auditoria + fila de acoes pendentes (action_id)
--   - ia_tokens      : Personal Access Tokens da Superficie B (Claude/ChatGPT)
--
-- Seguranca embutida (ver planning/ia-seguranca.html):
--   - A chave de API NUNCA fica em claro: guardamos cipher+iv (AES-GCM, feito
--     na edge function com IA_MASTER_KEY). Aqui so guardamos texto base64 opaco.
--   - O frontend NUNCA seleciona as colunas cipher: usa a edge `ia-config`
--     (action=status), que devolve so o "hint" mascarado.
--   - RLS: cada usuario so ve/gerencia a propria linha. Interno pode ler tudo e
--     desativar (kill-switch).
--   - ia_acoes.argumentos passa por redacao na aplicacao (CPF mascarado, nunca
--     senha/api key).
--
-- Idempotente (IF NOT EXISTS / guards). Reaproveita is_interno() e
-- tg_set_updated_at() ja existentes no banco.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1) ia_integracoes — cofre BYOK por usuario
-- ---------------------------------------------------------------------------
create table if not exists public.ia_integracoes (
  usuario_id      uuid primary key references public.usuarios(id) on delete cascade,
  provider        text not null check (provider in ('anthropic', 'openai')),
  modelo          text not null,
  api_key_cipher  text not null,          -- base64 do ciphertext (AES-GCM)
  api_key_iv      text not null,          -- base64 do IV (12 bytes)
  api_key_hint    text,                   -- mascarado, seguro de exibir (ex.: sk-ant-...a1b2)
  ativo           boolean not null default false,
  criado_em       timestamptz not null default now(),
  atualizado_em   timestamptz not null default now()
);

alter table public.ia_integracoes enable row level security;

drop trigger if exists tg_ia_integracoes_updated_at on public.ia_integracoes;
create trigger tg_ia_integracoes_updated_at
  before update on public.ia_integracoes
  for each row execute function public.tg_set_updated_at();

-- SELECT: dono ou interno.
drop policy if exists "ia_integracoes_select" on public.ia_integracoes;
create policy "ia_integracoes_select"
  on public.ia_integracoes for select
  using (usuario_id = auth.uid() or public.is_interno());

-- INSERT: so a propria linha.
drop policy if exists "ia_integracoes_insert" on public.ia_integracoes;
create policy "ia_integracoes_insert"
  on public.ia_integracoes for insert
  with check (usuario_id = auth.uid());

-- UPDATE: dono (config) ou interno (kill-switch de ativo).
drop policy if exists "ia_integracoes_update" on public.ia_integracoes;
create policy "ia_integracoes_update"
  on public.ia_integracoes for update
  using (usuario_id = auth.uid() or public.is_interno())
  with check (usuario_id = auth.uid() or public.is_interno());

-- DELETE: dono ou interno.
drop policy if exists "ia_integracoes_delete" on public.ia_integracoes;
create policy "ia_integracoes_delete"
  on public.ia_integracoes for delete
  using (usuario_id = auth.uid() or public.is_interno());

-- ---------------------------------------------------------------------------
-- 2) ia_acoes — auditoria + fila de acoes pendentes
-- ---------------------------------------------------------------------------
create table if not exists public.ia_acoes (
  id          uuid primary key default gen_random_uuid(),
  action_id   uuid not null default gen_random_uuid(),  -- referencia do confirm (TOCTOU)
  usuario_id  uuid not null references public.usuarios(id) on delete cascade,
  superficie  text not null default 'app' check (superficie in ('app', 'mcp')),
  provider    text,
  modelo      text,
  tipo        text not null check (tipo in ('read', 'write')),
  ferramenta  text not null,
  argumentos  jsonb,                  -- JA REDIGIDO pela aplicacao (CPF mascarado)
  resultado   jsonb,
  status      text not null default 'aplicada'
              check (status in ('pendente', 'aplicada', 'cancelada', 'erro')),
  caso_id     uuid,
  expira_em   timestamptz,            -- so para status='pendente'
  tokens_in   integer,
  tokens_out  integer,
  created_at  timestamptz not null default now()
);

create index if not exists ia_acoes_usuario_idx   on public.ia_acoes (usuario_id, created_at desc);
create index if not exists ia_acoes_action_idx    on public.ia_acoes (action_id);
create index if not exists ia_acoes_pendente_idx  on public.ia_acoes (status) where status = 'pendente';

alter table public.ia_acoes enable row level security;

-- SELECT: dono ve o proprio; interno ve tudo. (Insert/update e via service_role.)
drop policy if exists "ia_acoes_select" on public.ia_acoes;
create policy "ia_acoes_select"
  on public.ia_acoes for select
  using (usuario_id = auth.uid() or public.is_interno());

-- ---------------------------------------------------------------------------
-- 3) ia_tokens — PATs da Superficie B (Claude/ChatGPT). Uso na Fase 3.
-- ---------------------------------------------------------------------------
create table if not exists public.ia_tokens (
  id           uuid primary key default gen_random_uuid(),
  usuario_id   uuid not null references public.usuarios(id) on delete cascade,
  nome         text not null,
  token_hash   text not null unique,     -- sha256(token) em hex; token nunca guardado
  prefixo      text not null,            -- primeiros chars, p/ identificar na UI
  escopo       text not null default 'completo' check (escopo in ('leitura', 'completo')),
  expira_em    timestamptz,
  ultimo_uso   timestamptz,
  revogado_em  timestamptz,
  criado_em    timestamptz not null default now()
);

create index if not exists ia_tokens_usuario_idx on public.ia_tokens (usuario_id);

alter table public.ia_tokens enable row level security;

-- SELECT/gerenciar: dono ou interno (kill-switch).
drop policy if exists "ia_tokens_select" on public.ia_tokens;
create policy "ia_tokens_select"
  on public.ia_tokens for select
  using (usuario_id = auth.uid() or public.is_interno());

drop policy if exists "ia_tokens_insert" on public.ia_tokens;
create policy "ia_tokens_insert"
  on public.ia_tokens for insert
  with check (usuario_id = auth.uid());

drop policy if exists "ia_tokens_update" on public.ia_tokens;
create policy "ia_tokens_update"
  on public.ia_tokens for update
  using (usuario_id = auth.uid() or public.is_interno())
  with check (usuario_id = auth.uid() or public.is_interno());

drop policy if exists "ia_tokens_delete" on public.ia_tokens;
create policy "ia_tokens_delete"
  on public.ia_tokens for delete
  using (usuario_id = auth.uid() or public.is_interno());

-- ---------------------------------------------------------------------------
-- 4) GRANTs (pegadinha conhecida: service_role precisa de grant explicito)
-- ---------------------------------------------------------------------------
grant select, insert, update, delete on public.ia_integracoes to authenticated, service_role;
grant select, insert, update, delete on public.ia_acoes       to authenticated, service_role;
grant select, insert, update, delete on public.ia_tokens      to authenticated, service_role;

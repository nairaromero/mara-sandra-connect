-- =============================================================================
-- Migration: usuario_gmail_oauth — token Gmail OAuth criptografado por usuária
--
-- Substitui o uso de GMAIL_REFRESH_TOKEN em env (frágil, manual, único)
-- por fluxo OAuth dentro do app: a usuária clica em "Conectar Gmail" em
-- Configurações, autoriza via Google, e o refresh_token vai cifrado pro banco.
--
-- A edge function `inss-email-processor` lê este registro, decifra o token e
-- segue. Inicialmente só a Naira conecta (o INSS manda e-mails pra ela).
--
-- Cripto: reaproveita IA_MASTER_KEY + helpers em supabase/functions/_shared/
-- crypto.ts (mesma cifragem AES-GCM usada para BYOK de IA).
--
-- RLS: a própria usuária vê/edita só o seu registro. Edge functions usam
-- service_role para ler/escrever em qualquer usuário.
-- =============================================================================

create table if not exists public.usuario_gmail_oauth (
  usuario_id        uuid primary key references public.usuarios(id) on delete cascade,
  email_conectado   text not null,
  refresh_cipher    text not null,                  -- AES-GCM ciphertext (base64)
  refresh_iv        text not null,                  -- AES-GCM IV (base64)
  scope             text not null default 'https://www.googleapis.com/auth/gmail.readonly',
  connected_at      timestamptz not null default now(),
  last_used_at      timestamptz,
  updated_at        timestamptz not null default now()
);

create or replace function public._usuario_gmail_oauth_touch()
returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end;
$$;

drop trigger if exists trg_usuario_gmail_oauth_touch on public.usuario_gmail_oauth;
create trigger trg_usuario_gmail_oauth_touch
  before update on public.usuario_gmail_oauth
  for each row execute function public._usuario_gmail_oauth_touch();

alter table public.usuario_gmail_oauth enable row level security;

grant select, insert, update, delete on public.usuario_gmail_oauth to service_role;

-- A usuária pode ler/apagar o próprio vínculo (mostra "conectado como X",
-- ou desconecta). Insert/update via edge function (service_role) — não
-- queremos UI escrevendo token direto.
drop policy if exists "usuario_gmail_oauth_self_select" on public.usuario_gmail_oauth;
create policy "usuario_gmail_oauth_self_select"
  on public.usuario_gmail_oauth
  for select
  using (usuario_id = auth.uid());

drop policy if exists "usuario_gmail_oauth_self_delete" on public.usuario_gmail_oauth;
create policy "usuario_gmail_oauth_self_delete"
  on public.usuario_gmail_oauth
  for delete
  using (usuario_id = auth.uid());

comment on table public.usuario_gmail_oauth is
  'Vínculo Gmail OAuth por usuária. refresh_token cifrado AES-GCM com IA_MASTER_KEY. Insert/update só via edge function (service_role).';

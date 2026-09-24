-- ============================================================================
-- RBAC 09 · Integrações por escritório (2026-09-23)
--
-- v1 do RBAC prendia INSS (Gmail), DJEN e WhatsApp ao escritório padrão.
-- Agora cada escritório tem as suas:
--   - usuario_gmail_oauth.escritorio_id: a caixa do INSS conectada pertence ao
--     escritório em que o admin estava ao conectar; o processador roda uma vez
--     por escritório com caixa. gmail_inss_status() diz ao admin qual caixa
--     está ativa no escritório dele (nunca o token).
--   - escritorio_integracoes: configuração por escritório e tipo (whatsapp,
--     legalmail, ti…). Segredo cifrado (crypto.ts) em colunas que o
--     authenticated NÃO consegue selecionar (grant por coluna); só a edge
--     function integracoes-escritorio grava.
--   - publicacoes_dje: djen_id único POR escritório (dois escritórios podem
--     monitorar a mesma OAB).
--   - whatsapp_enqueue_text / whatsapp_resolve_parceiro ganham p_escritorio_id:
--     a fila e o parceiro são do escritório da instância que recebeu a mensagem.
-- Idempotente.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Caixa do INSS por escritório
-- ---------------------------------------------------------------------------
alter table public.usuario_gmail_oauth
  add column if not exists escritorio_id uuid references public.escritorios (id) on delete cascade;

update public.usuario_gmail_oauth
   set escritorio_id = private.escritorio_padrao()
 where escritorio_id is null;

alter table public.usuario_gmail_oauth alter column escritorio_id set not null;
create index if not exists usuario_gmail_oauth_esc_idx on public.usuario_gmail_oauth (escritorio_id, connected_at desc);

-- Qual caixa está ativa no escritório ativo (a mais recente conectada), para
-- a tela de Integrações. Só quem gerencia integrações; nunca devolve o token.
create or replace function public.gmail_inss_status()
returns table (email_conectado text, connected_at timestamptz, last_used_at timestamptz,
               conectado_por text, e_minha boolean)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_esc uuid := private.escritorio_ativo();
begin
  if v_esc is null or not private.tem_permissao('integracoes:gerenciar', null) then
    raise exception 'só quem gerencia integrações vê a caixa do INSS' using errcode = '42501';
  end if;
  return query
  select g.email_conectado, g.connected_at, g.last_used_at, u.nome, g.usuario_id = auth.uid()
    from public.usuario_gmail_oauth g
    left join public.usuarios u on u.id = g.usuario_id
   where g.escritorio_id = v_esc
   order by g.connected_at desc
   limit 1;
end;
$$;
revoke execute on function public.gmail_inss_status() from public, anon;
grant execute on function public.gmail_inss_status() to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. Configuração de integrações por escritório
-- ---------------------------------------------------------------------------
create table if not exists public.escritorio_integracoes (
  escritorio_id      uuid not null references public.escritorios (id) on delete cascade,
  tipo               text not null check (tipo in ('whatsapp', 'legalmail', 'ti', 'djen')),
  ativo              boolean not null default true,
  -- o que NÃO é segredo: url, nome da instância, e-mail da caixa, token de entrada...
  config             jsonb not null default '{}'::jsonb,
  -- segredo cifrado com a master key das functions (crypto.ts); nunca sai pro navegador
  segredo_cipher     text,
  segredo_iv         text,
  segredo_definido_em timestamptz,
  atualizado_por     uuid references public.usuarios (id) on delete set null,
  updated_at         timestamptz not null default now(),
  primary key (escritorio_id, tipo)
);
create index if not exists escritorio_integracoes_instancia_idx
  on public.escritorio_integracoes ((config ->> 'instance')) where tipo = 'whatsapp';

alter table public.escritorio_integracoes enable row level security;

-- Leitura: só quem gerencia integrações, e só no escritório ativo. Escrita: só
-- a edge function (service role) — o segredo precisa ser cifrado antes.
drop policy if exists integracoes_ler on public.escritorio_integracoes;
create policy integracoes_ler on public.escritorio_integracoes
  for select to authenticated
  using (escritorio_id = (select private.escritorio_ativo())
         and (select private.tem_permissao('integracoes:gerenciar', null)));

revoke all on public.escritorio_integracoes from public, anon, authenticated;
grant select (escritorio_id, tipo, ativo, config, segredo_definido_em, updated_at)
  on public.escritorio_integracoes to authenticated;
grant all on public.escritorio_integracoes to service_role;

-- Sessão de suporte é somente leitura também aqui.
drop trigger if exists ab_suporte_nao_escreve on public.escritorio_integracoes;
create trigger ab_suporte_nao_escreve
  before insert or update or delete on public.escritorio_integracoes
  for each statement execute function private.tg_suporte_nao_escreve();

-- ---------------------------------------------------------------------------
-- 3. DJEN: publicação única por escritório
-- ---------------------------------------------------------------------------
alter table public.publicacoes_dje drop constraint if exists publicacoes_dje_djen_id_key;
create unique index if not exists publicacoes_dje_esc_djen_uk on public.publicacoes_dje (escritorio_id, djen_id);

-- ---------------------------------------------------------------------------
-- 4. WhatsApp: fila e parceiro do escritório da instância
-- ---------------------------------------------------------------------------
drop function if exists public.whatsapp_enqueue_text(text, text, text, uuid, uuid);
create or replace function public.whatsapp_enqueue_text(
  p_telefone text, p_tipo text, p_texto text, p_parceiro_id uuid default null, p_caso_id uuid default null,
  p_escritorio_id uuid default null) returns void
language plpgsql security definer set search_path = 'public' as $$
declare
  v_tel text := public.whatsapp_normalize_telefone(p_telefone);
  v_esc uuid := coalesce(p_escritorio_id, private.escritorio_ativo(), private.escritorio_padrao());
begin
  if v_tel is null or length(v_tel) < 10 or p_texto is null then
    return;
  end if;
  insert into public.whatsapp_outbox
    (telefone, parceiro_id, caso_id, tipo, texto, proxima_tentativa_at, escritorio_id)
  values
    (v_tel, p_parceiro_id, p_caso_id, p_tipo, p_texto, now(), v_esc);
end;
$$;
revoke execute on function public.whatsapp_enqueue_text(text, text, text, uuid, uuid, uuid) from public, anon;
grant execute on function public.whatsapp_enqueue_text(text, text, text, uuid, uuid, uuid) to authenticated, service_role;

drop function if exists public.whatsapp_resolve_parceiro(text, boolean);
create or replace function public.whatsapp_resolve_parceiro(p_ident text, p_via_lid boolean default false,
                                                            p_escritorio_id uuid default null)
returns table (parceiro_id uuid, nome text, telefone text)
language sql stable security definer set search_path = 'public' as $$
  (
    select u.id, u.nome, coalesce(m.telefone, u.telefone)
      from public.whatsapp_lid_map m
      join public.usuarios u on u.id = m.parceiro_id
     where p_via_lid
       and m.lid = regexp_replace(coalesce(p_ident,''), '\D', '', 'g')
       and coalesce(u.ativo, true)
       and (p_escritorio_id is null or exists (
             select 1 from public.membros mb
              where mb.usuario_id = u.id and mb.escritorio_id = p_escritorio_id and mb.status = 'ativo'))
     limit 1
  )
  union all
  (
    select u.id, u.nome, u.telefone
      from public.usuarios u
     where not p_via_lid
       and u.tipo = 'parceiro'
       and coalesce(u.ativo, true)
       and u.telefone is not null
       and public.whatsapp_canon_br(u.telefone) = public.whatsapp_canon_br(p_ident)
       and (p_escritorio_id is null or exists (
             select 1 from public.membros mb
              where mb.usuario_id = u.id and mb.escritorio_id = p_escritorio_id and mb.status = 'ativo'))
     order by u.created_at
     limit 1
  );
$$;
revoke execute on function public.whatsapp_resolve_parceiro(text, boolean, uuid) from public, anon;
grant execute on function public.whatsapp_resolve_parceiro(text, boolean, uuid) to authenticated, service_role;

notify pgrst, 'reload schema';

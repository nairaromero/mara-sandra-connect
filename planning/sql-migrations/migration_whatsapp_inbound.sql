-- =============================================================================
-- Migration: WhatsApp — entrada (Fase 2)
--
-- Adiciona o lado de ENTRADA (parceiro responde pelo WhatsApp). A lógica de
-- menu/máquina de estados roda na Edge Function `whatsapp-inbound` (service-role);
-- aqui ficam:
--   1. whatsapp_sessoes            — estado da conversa (1 linha por telefone).
--   2. whatsapp_mensagens          — log append-only (auditoria + DEDUPE + LGPD).
--   3. whatsapp_canon_br           — forma canônica BR (tolera 9º dígito) p/ casar telefone.
--   4. whatsapp_resolve_parceiro   — telefone -> parceiro (agnóstico de país).
--   5. whatsapp_enqueue_text       — enfileira RESPOSTA no MESMO outbox da Fase 1.
--   6. whatsapp_parceiro_add_comentario — INSERT autorizado (parceiro só comenta no caso dele).
--   7. whatsapp_mensagens_purge    — retenção LGPD (apaga conteúdo após N dias).
--
-- Decisões (2026-05-31): Edge Function direta protegida por token; escopo mínimo
-- (menu principal + menu do caso + adicionar comentário); sessão expira em 30 min;
-- tabela de log incluída p/ dedupe. Ver INTEGRACAO_WHATSAPP.md §5/§6/§7/§11.
--
-- Depende da migration da Fase 1 (whatsapp_outbox, whatsapp_normalize_telefone).
-- Idempotente.
-- =============================================================================

-- ----------------------------------------------------------------------------
-- 1. Sessão da conversa (máquina de estados). 1 linha por telefone.
-- ----------------------------------------------------------------------------
create table if not exists public.whatsapp_sessoes (
  telefone       text primary key,                 -- E.164 só dígitos (com DDI)
  parceiro_id    uuid references public.usuarios(id) on delete set null,
  estado         text not null default 'menu',     -- menu|escolhe_caso|menu_caso|comentar
  contexto       jsonb not null default '{}'::jsonb,-- { caso_id, lista:[uuid...] }
  atualizado_em  timestamptz not null default now(),
  expira_em      timestamptz                        -- vencida -> volta ao menu
);

alter table public.whatsapp_sessoes enable row level security;
-- Sem policies = nega anon/authenticated; service_role (Edge) ignora RLS.
-- ATENÇÃO: BYPASSRLS (do service_role) ignora as *policies*, mas NÃO concede
-- privilégio de tabela. A Edge faz I/O direto nesta tabela como service_role,
-- então precisa do GRANT explícito — senão todo insert/upsert toma
-- "permission denied" (e o cliente JS engole o erro silenciosamente).
grant select, insert, update, delete on public.whatsapp_sessoes to service_role;

-- ----------------------------------------------------------------------------
-- 2. Log de mensagens (entrada e saída). Serve auditoria, DEDUPE e LGPD.
-- ----------------------------------------------------------------------------
create table if not exists public.whatsapp_mensagens (
  id                   uuid primary key default gen_random_uuid(),
  telefone             text not null,
  direcao              text not null check (direcao in ('in','out')),
  tipo                 text,                          -- texto|image|menu|acao|...
  conteudo             text,
  evolution_message_id text,                          -- data.key.id (dedupe de entrada)
  parceiro_id          uuid references public.usuarios(id) on delete set null,
  created_at           timestamptz not null default now()
);

-- DEDUPE: um mesmo evento de entrada (mesmo message_id) só entra 1x.
create unique index if not exists uq_whatsapp_msg_evo_in
  on public.whatsapp_mensagens (evolution_message_id)
  where direcao = 'in' and evolution_message_id is not null;

create index if not exists idx_whatsapp_msg_tel_created
  on public.whatsapp_mensagens (telefone, created_at desc);

alter table public.whatsapp_mensagens enable row level security;
-- GRANT explícito p/ a Edge (service_role) — ver nota em whatsapp_sessoes acima.
grant select, insert, update, delete on public.whatsapp_mensagens to service_role;

-- ----------------------------------------------------------------------------
-- 3. Forma canônica BR — tolera a ambiguidade do 9º dígito (§6.1).
--    Para números +55 de celular (13 dígitos com o 9 após o DDD), remove o 9,
--    produzindo a forma de 12 dígitos. Para qualquer outro país/forma, devolve
--    só os dígitos sem alterar. Assim '5518999998888' e '551899998888' (e os
--    espanhóis +34, que não têm essa ambiguidade) casam de forma estável.
-- ----------------------------------------------------------------------------
create or replace function public.whatsapp_canon_br(p_tel text)
returns text
language sql
immutable
as $$
  with d as (select public.whatsapp_normalize_telefone(p_tel) as v)
  select case
    when d.v is null then null
    when left(d.v,2) = '55' and length(d.v) = 13 and substr(d.v,5,1) = '9'
      then '55' || substr(d.v,3,2) || substr(d.v,6)   -- 55 + DDD + 8 dígitos (sem o 9)
    else d.v
  end
  from d;
$$;

-- ----------------------------------------------------------------------------
-- 4.0 Mapa LID -> parceiro.
--    O WhatsApp migrou p/ "LID" (identificador anônimo, estável por contato) e
--    NÃO revela o telefone do remetente na ENTRADA. Como não dá p/ casar por
--    telefone nem enviar p/ um @lid, mantemos um mapa LID->parceiro. É populado
--    por: 'seed' (vínculo manual conhecido), 'codigo' (onboarding por código na
--    saída — futuro) ou 'admin' (UI). O telefone fica em cache p/ a resposta.
-- ----------------------------------------------------------------------------
create table if not exists public.whatsapp_lid_map (
  lid          text primary key,                 -- dígitos do @lid (sem sufixo)
  parceiro_id  uuid not null references public.usuarios(id) on delete cascade,
  telefone     text,                             -- telefone real (destino da resposta)
  origem       text default 'seed',              -- seed|codigo|admin
  criado_em    timestamptz not null default now()
);
alter table public.whatsapp_lid_map enable row level security;
grant select, insert, update, delete on public.whatsapp_lid_map to service_role;

-- ----------------------------------------------------------------------------
-- 4. Resolver de contato: identificador de ENTRADA -> parceiro ATIVO.
--    p_via_lid=true  -> p_ident é um LID; casa por whatsapp_lid_map.
--    p_via_lid=false -> p_ident é telefone; casa pela forma canônica BR.
--    Retorna no máximo 1 (id, nome, telefone-de-resposta).
-- ----------------------------------------------------------------------------
drop function if exists public.whatsapp_resolve_parceiro(text);

create or replace function public.whatsapp_resolve_parceiro(
  p_ident   text,
  p_via_lid boolean default false
)
returns table (parceiro_id uuid, nome text, telefone text)
language sql
stable
security definer
set search_path = public
as $$
  (
    select u.id, u.nome, coalesce(m.telefone, u.telefone)
      from public.whatsapp_lid_map m
      join public.usuarios u on u.id = m.parceiro_id
     where p_via_lid
       and m.lid = regexp_replace(coalesce(p_ident,''), '\D', '', 'g')
       and coalesce(u.ativo, true)
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
     order by u.created_at
     limit 1
  );
$$;

revoke all on function public.whatsapp_resolve_parceiro(text, boolean) from public, anon, authenticated;
grant execute on function public.whatsapp_resolve_parceiro(text, boolean) to service_role;

-- ----------------------------------------------------------------------------
-- 5. Enfileira uma RESPOSTA para um telefone (reusa o outbox da Fase 1).
--    Diferente de whatsapp_enqueue (que resolve telefone via parceiro_id), aqui
--    o destino já é conhecido (o próprio remetente). O poller n8n entrega.
-- ----------------------------------------------------------------------------
create or replace function public.whatsapp_enqueue_text(
  p_telefone    text,
  p_tipo        text,
  p_texto       text,
  p_parceiro_id uuid default null,
  p_caso_id     uuid default null
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tel text := public.whatsapp_normalize_telefone(p_telefone);
begin
  if v_tel is null or length(v_tel) < 10 or p_texto is null then
    return;
  end if;
  insert into public.whatsapp_outbox
    (telefone, parceiro_id, caso_id, tipo, texto, proxima_tentativa_at)
  values
    (v_tel, p_parceiro_id, p_caso_id, p_tipo, p_texto, now());
end;
$$;

revoke all on function public.whatsapp_enqueue_text(text, text, text, uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.whatsapp_enqueue_text(text, text, text, uuid, uuid) to service_role;

-- ----------------------------------------------------------------------------
-- 6. Parceiro adiciona comentário pelo WhatsApp — com AUTORIZAÇÃO.
--    A Edge roda service-role (fura RLS), então a checagem é REIMPLEMENTADA
--    aqui (§6.3): o caso precisa ser do próprio parceiro. Retorna o id do
--    comentário; levanta exceção se não for dono (a Edge trata e responde).
-- ----------------------------------------------------------------------------
create or replace function public.whatsapp_parceiro_add_comentario(
  p_parceiro_id uuid,
  p_caso_id     uuid,
  p_texto       text
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ok   boolean;
  v_id   uuid;
  v_txt  text := btrim(coalesce(p_texto, ''));
begin
  if v_txt = '' then
    raise exception 'texto vazio';
  end if;

  select exists(
    select 1 from public.casos c
     where c.id = p_caso_id and c.parceiro_id = p_parceiro_id
  ) into v_ok;

  if not v_ok then
    raise exception 'nao autorizado: caso % nao pertence ao parceiro %', p_caso_id, p_parceiro_id;
  end if;

  insert into public.comentarios (caso_id, parent_id, autor_id, texto)
  values (p_caso_id, null, p_parceiro_id, v_txt)
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function public.whatsapp_parceiro_add_comentario(uuid, uuid, text)
  from public, anon, authenticated;
grant execute on function public.whatsapp_parceiro_add_comentario(uuid, uuid, text) to service_role;

-- ----------------------------------------------------------------------------
-- 7. Retenção (LGPD): apaga o CONTEÚDO de mensagens antigas, mantendo metadados
--    (telefone, direção, message_id) para dedupe/auditoria. Default 90 dias.
-- ----------------------------------------------------------------------------
create or replace function public.whatsapp_mensagens_purge(p_dias int default 90)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_n int;
begin
  with upd as (
    update public.whatsapp_mensagens
       set conteudo = null
     where created_at < now() - make_interval(days => p_dias)
       and conteudo is not null
    returning 1
  )
  select count(*) into v_n from upd;
  return v_n;
end;
$$;

revoke all on function public.whatsapp_mensagens_purge(int) from public, anon, authenticated;
grant execute on function public.whatsapp_mensagens_purge(int) to service_role;

-- ----------------------------------------------------------------------------
-- 8. SEED de teste — vincula o LID do parceiro de teste (marido, +34 …4493) ao
--    seu cadastro. O WhatsApp não revela o telefone na entrada; capturamos o LID
--    '76901926351084' nos testes de 2026-05-31. Em produção este vínculo será
--    feito pelo onboarding por código (na saída). Idempotente; busca o parceiro
--    pelo telefone p/ não depender de UUID fixo.
-- ----------------------------------------------------------------------------
insert into public.whatsapp_lid_map (lid, parceiro_id, telefone, origem)
select '76901926351084', u.id, u.telefone, 'seed'
  from public.usuarios u
 where u.tipo = 'parceiro'
   and public.whatsapp_canon_br(u.telefone) = public.whatsapp_canon_br('34613784493')
 limit 1
on conflict (lid) do update
  set parceiro_id = excluded.parceiro_id,
      telefone    = excluded.telefone,
      origem      = excluded.origem;

-- =============================================================================
-- Migration: WhatsApp — saída (Fase 1)
--
-- Cria a fila de SAÍDA do WhatsApp (parceiro recebe avisos do escritório),
-- espelhando o padrão do outbox de webhooks (migration_webhooks.sql), porém:
--   - SEM HMAC (Evolution autentica por header `apikey`, configurado no n8n).
--   - Dispara por o parceiro TER TELEFONE, não por ter webhook assinado
--     (decisão 2026-05-31: fila dedicada e desacoplada — ver
--      INTEGRACAO_WHATSAPP.md §8/§11.2).
--
-- Peças:
--   1. whatsapp_outbox            — fila de mensagens a enviar.
--   2. whatsapp_normalize_telefone — só dígitos (E.164 sem '+').
--   3. whatsapp_enqueue           — resolve telefone do parceiro e enfileira.
--   4. whatsapp_claim_batch       — n8n reivindica um lote (marca 'enviando').
--   5. whatsapp_mark_result       — n8n grava sucesso/falha (backoff igual webhooks).
--   6. tg_whatsapp_comentario_novo — PRIMEIRO evento ligado: comentário do interno.
--   7. whatsapp_outbox_purge      — retenção LGPD (apaga texto de já enviados).
--
-- IMPORTANTE sobre o telefone (saída): o Evolution exige o número em formato
-- internacional só com dígitos, INCLUINDO o código do país (DDI). Ex.: Espanha
-- '34600112233', Brasil '5518999998888'. Garanta que `usuarios.telefone` do
-- parceiro de teste esteja salvo com o DDI (a máscara da UI pode não incluí-lo).
-- O 9º dígito BR só importa na ENTRADA (Fase 2), não aqui.
--
-- Idempotente.
-- =============================================================================

-- ----------------------------------------------------------------------------
-- 1. Fila de saída
-- ----------------------------------------------------------------------------
create table if not exists public.whatsapp_outbox (
  id                   uuid primary key default gen_random_uuid(),
  telefone             text not null,                    -- destino (só dígitos, com DDI)
  parceiro_id          uuid references public.usuarios(id) on delete set null,
  caso_id              uuid references public.casos(id)    on delete set null,
  tipo                 text not null,                    -- comentario.novo | andamento.novo | ...
  texto                text,                             -- corpo já renderizado
  midia_url            text,                             -- opcional (Fase 3)
  status               text not null default 'pendente', -- pendente|enviando|enviado|falhou
  tentativas           int  not null default 0,
  proxima_tentativa_at timestamptz default now(),
  ultima_tentativa_at  timestamptz,
  created_at           timestamptz not null default now(),
  enviado_at           timestamptz,
  http_status          int,
  erro                 text
);

-- Índice para o claim: pega só pendentes prontos para tentar, mais antigos primeiro.
create index if not exists idx_whatsapp_outbox_claim
  on public.whatsapp_outbox (proxima_tentativa_at nulls first, created_at)
  where status = 'pendente';

-- RLS: ninguém além do service_role (n8n) toca nesta fila.
alter table public.whatsapp_outbox enable row level security;
-- Sem policies = nega para anon/authenticated. service_role ignora RLS.

-- ----------------------------------------------------------------------------
-- 2. Normalização de telefone — só dígitos (E.164 sem o '+')
-- ----------------------------------------------------------------------------
create or replace function public.whatsapp_normalize_telefone(p_tel text)
returns text
language sql
immutable
as $$
  select nullif(regexp_replace(coalesce(p_tel, ''), '\D', '', 'g'), '');
$$;

-- ----------------------------------------------------------------------------
-- 3. Enfileira uma mensagem para o telefone do parceiro do caso.
--    Resolve o telefone aqui (ponto único do resolvedor — ver §9). Só enfileira
--    se o parceiro estiver ativo e tiver telefone utilizável.
-- ----------------------------------------------------------------------------
create or replace function public.whatsapp_enqueue(
  p_parceiro_id uuid,
  p_caso_id     uuid,
  p_tipo        text,
  p_texto       text,
  p_midia_url   text default null
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tel text;
begin
  if p_parceiro_id is null then
    return;  -- sem parceiro, não há para quem mandar
  end if;

  select public.whatsapp_normalize_telefone(u.telefone)
    into v_tel
    from public.usuarios u
   where u.id = p_parceiro_id
     and coalesce(u.ativo, true)
     and u.telefone is not null;

  -- número curto demais (sem DDI / inválido) → não enfileira
  if v_tel is null or length(v_tel) < 10 then
    return;
  end if;

  insert into public.whatsapp_outbox
    (telefone, parceiro_id, caso_id, tipo, texto, midia_url, proxima_tentativa_at)
  values
    (v_tel, p_parceiro_id, p_caso_id, p_tipo, p_texto, p_midia_url, now());
end;
$$;

revoke all on function public.whatsapp_enqueue(uuid, uuid, text, text, text)
  from public, anon, authenticated;

-- ----------------------------------------------------------------------------
-- 4. Reivindica um lote para o poller n8n (marca 'enviando', tentativas++).
--    Retorna os campos prontos para o sendText do Evolution.
-- ----------------------------------------------------------------------------
create or replace function public.whatsapp_claim_batch(p_limit int default 20)
returns table (
  outbox_id uuid,
  telefone  text,
  tipo      text,
  texto     text,
  midia_url text
)
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  with claimed as (
    select o.id
      from public.whatsapp_outbox o
     where o.status = 'pendente'
       and (o.proxima_tentativa_at is null or o.proxima_tentativa_at <= now())
     order by o.proxima_tentativa_at nulls first, o.created_at
       for update of o skip locked
     limit p_limit
  )
  update public.whatsapp_outbox o
     set status = 'enviando',
         tentativas = o.tentativas + 1,
         ultima_tentativa_at = now()
    from claimed c
   where o.id = c.id
  returning o.id, o.telefone, o.tipo, o.texto, o.midia_url;
end;
$$;

revoke all on function public.whatsapp_claim_batch(int) from public, anon, authenticated;
grant execute on function public.whatsapp_claim_batch(int) to service_role;

-- ----------------------------------------------------------------------------
-- 5. Marca resultado do envio (backoff: 1m/5m/30m/2h; 5ª falha → 'falhou').
--    tentativas já foi incrementado no claim.
-- ----------------------------------------------------------------------------
create or replace function public.whatsapp_mark_result(
  p_outbox_id   uuid,
  p_ok          boolean,
  p_http_status int  default null,
  p_erro        text default null
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tentativas int;
  v_atraso     interval;
begin
  if p_ok then
    update public.whatsapp_outbox
       set status = 'enviado',
           enviado_at = now(),
           http_status = p_http_status,
           erro = null
     where id = p_outbox_id;
    return;
  end if;

  select tentativas into v_tentativas
    from public.whatsapp_outbox where id = p_outbox_id;

  if v_tentativas >= 5 then
    update public.whatsapp_outbox
       set status = 'falhou', http_status = p_http_status, erro = p_erro
     where id = p_outbox_id;
    return;
  end if;

  v_atraso := case v_tentativas
    when 1 then interval '1 minute'
    when 2 then interval '5 minutes'
    when 3 then interval '30 minutes'
    else        interval '2 hours'
  end;

  update public.whatsapp_outbox
     set status = 'pendente',
         proxima_tentativa_at = now() + v_atraso,
         http_status = p_http_status,
         erro = p_erro
   where id = p_outbox_id;
end;
$$;

revoke all on function public.whatsapp_mark_result(uuid, boolean, int, text)
  from public, anon, authenticated;
grant execute on function public.whatsapp_mark_result(uuid, boolean, int, text) to service_role;

-- ----------------------------------------------------------------------------
-- 6. PRIMEIRO evento ligado: comentário NOVO do interno → avisa o parceiro.
--    Só dispara quando o AUTOR é interno (não avisa o parceiro do próprio
--    comentário dele). EXCEPTION WHEN OTHERS: um erro aqui NUNCA bloqueia o
--    INSERT do comentário (mesma regra dos tg_webhook_*).
-- ----------------------------------------------------------------------------
create or replace function public.tg_whatsapp_comentario_novo()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_autor_tipo  text;
  v_parceiro_id uuid;
  v_cliente     text;
  v_autor_nome  text;
  v_texto       text;
begin
  -- autor precisa ser interno
  select u.tipo, u.nome into v_autor_tipo, v_autor_nome
    from public.usuarios u where u.id = new.autor_id;
  if v_autor_tipo is distinct from 'interno' then
    return new;
  end if;

  -- resolve o parceiro do caso e o nome do cliente
  select c.parceiro_id, cl.nome
    into v_parceiro_id, v_cliente
    from public.casos c
    join public.clientes cl on cl.id = c.cliente_id
   where c.id = new.caso_id;

  if v_parceiro_id is null then
    return new;
  end if;

  -- corpo da mensagem (tom ajustável — INTEGRACAO_WHATSAPP.md §11.4)
  v_texto :=
    '💬 Novo comentário no caso de ' || coalesce(v_cliente, 'cliente') || ':' ||
    chr(10) || chr(10) ||
    new.texto ||
    chr(10) || chr(10) ||
    '— ' || coalesce(v_autor_nome, 'Escritório');

  perform public.whatsapp_enqueue(
    v_parceiro_id,
    new.caso_id,
    'comentario.novo',
    v_texto,
    null
  );

  return new;
exception when others then
  -- nunca derruba o INSERT do comentário por causa do aviso de WhatsApp
  return new;
end;
$$;

drop trigger if exists trg_whatsapp_comentario_novo on public.comentarios;
create trigger trg_whatsapp_comentario_novo
  after insert on public.comentarios
  for each row execute function public.tg_whatsapp_comentario_novo();

-- ----------------------------------------------------------------------------
-- 7. Retenção (LGPD): apaga o texto/mídia de mensagens já enviadas após N dias,
--    mantendo metadados para auditoria. Default 90 dias (igual webhooks).
--    Agendar via pg_cron ou job do n8n.
-- ----------------------------------------------------------------------------
create or replace function public.whatsapp_outbox_purge(p_dias int default 90)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_n int;
begin
  with upd as (
    update public.whatsapp_outbox
       set texto = null, midia_url = null
     where status in ('enviado', 'falhou')
       and coalesce(enviado_at, created_at) < now() - make_interval(days => p_dias)
       and (texto is not null or midia_url is not null)
    returning 1
  )
  select count(*) into v_n from upd;
  return v_n;
end;
$$;

revoke all on function public.whatsapp_outbox_purge(int) from public, anon, authenticated;
grant execute on function public.whatsapp_outbox_purge(int) to service_role;

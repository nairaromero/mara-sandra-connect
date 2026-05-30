-- ============================================================================
-- Aplicada em 2026-05-30 no projeto llugytkdsfsrciavhrfw (Mara Sandra Connect).
-- Webhooks granulares para o parceiro externo (padrao outbox transacional).
--
-- NOTA: a assinatura usa extensions.hmac (pgcrypto vive no schema `extensions`
-- no Supabase) qualificado explicitamente porque as funcoes rodam como
-- SECURITY DEFINER com `set search_path = public`. O segredo HMAC fica no
-- Supabase Vault (vault.decrypted_secrets), nao em coluna cifrada.
--
-- NOTA: todos os tg_webhook_* tem EXCEPTION WHEN OTHERS -> um erro no
-- enfileiramento jamais derruba o INSERT/UPDATE da tabela de dominio. Falhas
-- viram WARNING no log do Postgres, nunca rollback do core.
--
-- Arquitetura:
--   1. Triggers AFTER nas tabelas de dominio montam o payload JA MINIMIZADO
--      (com JOINs: nome do cliente, link do caso) e gravam em webhook_eventos.
--      A gravacao acontece na MESMA transacao da mudanca -> evento nunca se perde.
--   2. n8n consome webhook_eventos (Realtime ou poll de status='pendente'),
--      carrega o destino do parceiro, assina HMAC, entrega e marca status.
--   3. webhook_eventos tambem E o log de entrega (auditoria LGPD).
--
-- Decisoes refletidas:
--   - So enfileira para casos com parceiro_id.
--   - andamentos/documentos: so se visivel_parceiro = true.
--   - Payload contem allowlist de campos (senha MEU INSS, resultado_json,
--     comentarios internos NUNCA entram).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Config de destino por parceiro
-- ----------------------------------------------------------------------------
create table if not exists public.webhook_destinos (
  id              uuid primary key default gen_random_uuid(),
  parceiro_id     uuid not null references public.usuarios(id) on delete cascade,
  url             text not null,
  -- segredo do HMAC fica no Supabase Vault (cifrado com a chave-raiz gerenciada).
  -- Aqui guardamos so o id do segredo. NULL = destino ainda sem segredo (nao entrega).
  secret_id       uuid,
  eventos         text[] not null default '{}',  -- tipos assinados (ex.: {andamento.created, caso.status_changed})
  ativo           boolean not null default true,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists idx_webhook_destinos_parceiro
  on public.webhook_destinos (parceiro_id) where ativo;

-- Config nao-secreta (1 linha). base_url usado para montar link_caso nos payloads.
-- Em GUC (app.base_url) exigiria owner do database; tabela e editavel pela tela interna.
create table if not exists public.webhook_config (
  id        boolean primary key default true check (id),
  base_url  text not null default 'https://mara-sandra-connect.nairaromerovian.workers.dev'
);
insert into public.webhook_config (id) values (true) on conflict do nothing;

-- RLS: nenhuma policy -> anon/authenticated nao leem direto. webhook_base_url()
-- e SECURITY DEFINER e ignora RLS; a tela interna edita via service_role.
alter table public.webhook_config enable row level security;

create or replace function public.webhook_base_url()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select base_url from public.webhook_config where id;
$$;

-- ----------------------------------------------------------------------------
-- 2. Outbox + log de entrega
-- ----------------------------------------------------------------------------
create table if not exists public.webhook_eventos (
  id                uuid primary key default gen_random_uuid(),
  destino_id        uuid references public.webhook_destinos(id) on delete set null,
  parceiro_id       uuid not null,
  caso_id           uuid,
  tipo              text not null,            -- ex.: andamento.created
  payload           jsonb not null,           -- envelope completo, ja minimizado
  status            text not null default 'pendente'
                      check (status in ('pendente','enviando','enviado','falhou','descartado')),
  tentativas        int  not null default 0,
  proxima_tentativa_at timestamptz,
  ultima_tentativa_at  timestamptz,
  http_status       int,
  erro              text,
  occurred_at       timestamptz not null default now(),
  enviado_at        timestamptz,
  created_at        timestamptz not null default now()
);

create index if not exists idx_webhook_eventos_pendentes
  on public.webhook_eventos (proxima_tentativa_at)
  where status = 'pendente';

-- RLS: so service_role (n8n usa service key) e interno leem o log.
alter table public.webhook_destinos enable row level security;
alter table public.webhook_eventos  enable row level security;
-- (policies de SELECT para interno via is_interno() - definir junto com as demais)

-- ----------------------------------------------------------------------------
-- 3. Helper: enfileira um evento para o(s) destino(s) do parceiro
-- ----------------------------------------------------------------------------
create or replace function public.webhook_enqueue(
  p_parceiro_id uuid,
  p_caso_id     uuid,
  p_tipo        text,
  p_data        jsonb
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_destino  record;
  v_envelope jsonb;
begin
  if p_parceiro_id is null then
    return;  -- sem parceiro, nao notifica externo
  end if;

  for v_destino in
    select id, eventos
    from public.webhook_destinos
    where parceiro_id = p_parceiro_id and ativo
  loop
    -- so enfileira se o destino assinou este tipo de evento
    if not (p_tipo = any (v_destino.eventos)) then
      continue;
    end if;

    v_envelope := jsonb_build_object(
      'id',          'evt_' || gen_random_uuid()::text,
      'type',        p_tipo,
      'occurred_at', to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
      'api_version', '2026-05-30',
      'data',        p_data
    );

    insert into public.webhook_eventos
      (destino_id, parceiro_id, caso_id, tipo, payload, proxima_tentativa_at)
    values
      (v_destino.id, p_parceiro_id, p_caso_id, p_tipo, v_envelope, now());
  end loop;
end;
$$;

-- ----------------------------------------------------------------------------
-- 4. Helper: monta a referencia minima do cliente de um caso
-- ----------------------------------------------------------------------------
create or replace function public.webhook_cliente_ref(p_caso_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'id',   cl.id,
    'nome', cl.nome,
    'cpf',  cl.cpf            -- liberado: parceiro e co-controlador
  )
  from public.casos c
  join public.clientes cl on cl.id = c.cliente_id
  where c.id = p_caso_id;
$$;

-- ----------------------------------------------------------------------------
-- 5. Triggers de exemplo (os demais seguem a mesma estrutura)
-- ----------------------------------------------------------------------------

-- 5.1 andamento.created  (gate: visivel_parceiro = true)
create or replace function public.tg_webhook_andamento_created()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_parceiro uuid;
  v_data     jsonb;
begin
  if not new.visivel_parceiro then
    return new;
  end if;

  select parceiro_id into v_parceiro from public.casos where id = new.caso_id;
  if v_parceiro is null then
    return new;
  end if;

  v_data := jsonb_build_object(
    'andamento_id', new.id,
    'caso_id',      new.caso_id,
    'cliente',      public.webhook_cliente_ref(new.caso_id),
    'origem',       new.origem,
    'titulo',       new.titulo,
    'descricao',    new.descricao,
    'data_evento',  new.data_evento,
    'link_caso',    public.webhook_base_url() || '/casos/' || new.caso_id::text
  );

  perform public.webhook_enqueue(v_parceiro, new.caso_id, 'andamento.created', v_data);
  return new;
exception
  when others then
    raise warning 'webhook trigger % falhou: %', tg_name, sqlerrm;
    return new;
end;
$$;

drop trigger if exists trg_webhook_andamento_created on public.andamentos;
create trigger trg_webhook_andamento_created
  after insert on public.andamentos
  for each row execute function public.tg_webhook_andamento_created();

-- 5.2 caso.status_changed  (usa OLD/NEW para from/to)
create or replace function public.tg_webhook_caso_status()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_data jsonb;
begin
  if new.status is not distinct from old.status then
    return new;
  end if;
  if new.parceiro_id is null then
    return new;
  end if;

  v_data := jsonb_build_object(
    'caso_id',   new.id,
    'cliente',   public.webhook_cliente_ref(new.id),
    'status',    jsonb_build_object('from', old.status, 'to', new.status),
    'link_caso', public.webhook_base_url() || '/casos/' || new.id::text,
    'changed_at', now()
  );

  perform public.webhook_enqueue(new.parceiro_id, new.id, 'caso.status_changed', v_data);
  return new;
exception
  when others then
    raise warning 'webhook trigger % falhou: %', tg_name, sqlerrm;
    return new;
end;
$$;

drop trigger if exists trg_webhook_caso_status on public.casos;
create trigger trg_webhook_caso_status
  after update of status on public.casos
  for each row execute function public.tg_webhook_caso_status();

-- 5.3 repasse.status_changed
create or replace function public.tg_webhook_repasse_status()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_parceiro uuid;
  v_data     jsonb;
begin
  if new.status is not distinct from old.status then
    return new;
  end if;

  select parceiro_id into v_parceiro from public.casos where id = new.caso_id;
  if v_parceiro is null then
    return new;
  end if;

  v_data := jsonb_build_object(
    'repasse_id', new.id,
    'caso_id',    new.caso_id,
    'cliente',    public.webhook_cliente_ref(new.caso_id),
    'valor',      new.valor,
    'status',     jsonb_build_object('from', old.status, 'to', new.status),
    'changed_at', now()
  );

  perform public.webhook_enqueue(v_parceiro, new.caso_id, 'repasse.status_changed', v_data);
  return new;
exception
  when others then
    raise warning 'webhook trigger % falhou: %', tg_name, sqlerrm;
    return new;
end;
$$;

drop trigger if exists trg_webhook_repasse_status on public.repasses;
create trigger trg_webhook_repasse_status
  after update of status on public.repasses
  for each row execute function public.tg_webhook_repasse_status();

-- 5.4 caso.created
create or replace function public.tg_webhook_caso_created()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_data jsonb;
begin
  if new.parceiro_id is null then
    return new;
  end if;

  v_data := jsonb_build_object(
    'caso_id',        new.id,
    'cliente',        public.webhook_cliente_ref(new.id),
    'tipo_beneficio', new.tipo_beneficio,
    'fase',           new.fase,
    'status',         new.status,
    'link_caso',      public.webhook_base_url() || '/casos/' || new.id::text,
    'created_at',     new.created_at
  );

  perform public.webhook_enqueue(new.parceiro_id, new.id, 'caso.created', v_data);
  return new;
exception
  when others then
    raise warning 'webhook trigger % falhou: %', tg_name, sqlerrm;
    return new;
end;
$$;

drop trigger if exists trg_webhook_caso_created on public.casos;
create trigger trg_webhook_caso_created
  after insert on public.casos
  for each row execute function public.tg_webhook_caso_created();

-- 5.5 caso.fase_changed
create or replace function public.tg_webhook_caso_fase()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_data jsonb;
begin
  if new.fase is not distinct from old.fase or new.parceiro_id is null then
    return new;
  end if;

  v_data := jsonb_build_object(
    'caso_id',    new.id,
    'cliente',    public.webhook_cliente_ref(new.id),
    'fase',       jsonb_build_object('from', old.fase, 'to', new.fase),
    'link_caso',  public.webhook_base_url() || '/casos/' || new.id::text,
    'changed_at', now()
  );

  perform public.webhook_enqueue(new.parceiro_id, new.id, 'caso.fase_changed', v_data);
  return new;
exception
  when others then
    raise warning 'webhook trigger % falhou: %', tg_name, sqlerrm;
    return new;
end;
$$;

drop trigger if exists trg_webhook_caso_fase on public.casos;
create trigger trg_webhook_caso_fase
  after update of fase on public.casos
  for each row execute function public.tg_webhook_caso_fase();

-- 5.6 documento.uploaded  (gate: visivel_parceiro = true)
create or replace function public.tg_webhook_documento_uploaded()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_parceiro uuid;
  v_data     jsonb;
begin
  if not new.visivel_parceiro then
    return new;
  end if;

  select parceiro_id into v_parceiro from public.casos where id = new.caso_id;
  if v_parceiro is null then
    return new;
  end if;

  -- NAO inclui storage_path nem download_url por padrao (LGPD).
  v_data := jsonb_build_object(
    'documento_id', new.id,
    'caso_id',      new.caso_id,
    'cliente',      public.webhook_cliente_ref(new.caso_id),
    'tipo',         new.tipo,
    'nome_arquivo', new.nome_arquivo,
    'uploaded_at',  new.created_at
  );

  perform public.webhook_enqueue(v_parceiro, new.caso_id, 'documento.uploaded', v_data);
  return new;
exception
  when others then
    raise warning 'webhook trigger % falhou: %', tg_name, sqlerrm;
    return new;
end;
$$;

drop trigger if exists trg_webhook_documento_uploaded on public.documentos;
create trigger trg_webhook_documento_uploaded
  after insert on public.documentos
  for each row execute function public.tg_webhook_documento_uploaded();

-- 5.7 solicitacao_documento.created
create or replace function public.tg_webhook_solicitacao_created()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_parceiro uuid;
  v_data     jsonb;
begin
  select parceiro_id into v_parceiro from public.casos where id = new.caso_id;
  if v_parceiro is null then
    return new;
  end if;

  v_data := jsonb_build_object(
    'solicitacao_id',   new.id,
    'caso_id',          new.caso_id,
    'cliente',          public.webhook_cliente_ref(new.caso_id),
    'tipo',             new.tipo,
    'descricao',        new.descricao,
    'status',           new.status,
    'link_caso',        public.webhook_base_url() || '/casos/' || new.caso_id::text,
    'data_solicitacao', new.data_solicitacao
  );

  perform public.webhook_enqueue(v_parceiro, new.caso_id, 'solicitacao_documento.created', v_data);
  return new;
exception
  when others then
    raise warning 'webhook trigger % falhou: %', tg_name, sqlerrm;
    return new;
end;
$$;

drop trigger if exists trg_webhook_solicitacao_created on public.solicitacoes_documento;
create trigger trg_webhook_solicitacao_created
  after insert on public.solicitacoes_documento
  for each row execute function public.tg_webhook_solicitacao_created();

-- 5.8 solicitacao_documento.status_changed
create or replace function public.tg_webhook_solicitacao_status()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_parceiro uuid;
  v_data     jsonb;
begin
  if new.status is not distinct from old.status then
    return new;
  end if;

  select parceiro_id into v_parceiro from public.casos where id = new.caso_id;
  if v_parceiro is null then
    return new;
  end if;

  v_data := jsonb_build_object(
    'solicitacao_id', new.id,
    'caso_id',        new.caso_id,
    'cliente',        public.webhook_cliente_ref(new.caso_id),
    'tipo',           new.tipo,
    'status',         jsonb_build_object('from', old.status, 'to', new.status),
    'link_caso',      public.webhook_base_url() || '/casos/' || new.caso_id::text,
    'changed_at',     now()
  );

  perform public.webhook_enqueue(v_parceiro, new.caso_id, 'solicitacao_documento.status_changed', v_data);
  return new;
exception
  when others then
    raise warning 'webhook trigger % falhou: %', tg_name, sqlerrm;
    return new;
end;
$$;

drop trigger if exists trg_webhook_solicitacao_status on public.solicitacoes_documento;
create trigger trg_webhook_solicitacao_status
  after update of status on public.solicitacoes_documento
  for each row execute function public.tg_webhook_solicitacao_status();

-- 5.9 processo_admin.decisao  (decisao preenchida ou alterada)
create or replace function public.tg_webhook_processo_admin_decisao()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_parceiro uuid;
  v_data     jsonb;
begin
  if new.decisao is null or new.decisao is not distinct from old.decisao then
    return new;
  end if;

  select parceiro_id into v_parceiro from public.casos where id = new.caso_id;
  if v_parceiro is null then
    return new;
  end if;

  v_data := jsonb_build_object(
    'processo_admin_id',   new.id,
    'caso_id',             new.caso_id,
    'cliente',             public.webhook_cliente_ref(new.caso_id),
    'numero_requerimento', new.numero_requerimento,
    'decisao',             new.decisao,
    'data_decisao',        new.data_decisao,
    'link_caso',           public.webhook_base_url() || '/casos/' || new.caso_id::text
  );

  perform public.webhook_enqueue(v_parceiro, new.caso_id, 'processo_admin.decisao', v_data);
  return new;
exception
  when others then
    raise warning 'webhook trigger % falhou: %', tg_name, sqlerrm;
    return new;
end;
$$;

drop trigger if exists trg_webhook_processo_admin_decisao on public.processos_admin;
create trigger trg_webhook_processo_admin_decisao
  after update of decisao on public.processos_admin
  for each row execute function public.tg_webhook_processo_admin_decisao();

-- 5.10 processo_judicial.created
create or replace function public.tg_webhook_processo_judicial_created()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_parceiro uuid;
  v_data     jsonb;
begin
  select parceiro_id into v_parceiro from public.casos where id = new.caso_id;
  if v_parceiro is null then
    return new;
  end if;

  v_data := jsonb_build_object(
    'processo_judicial_id', new.id,
    'caso_id',              new.caso_id,
    'cliente',              public.webhook_cliente_ref(new.caso_id),
    'numero_processo',      new.numero_processo,
    'vara',                 new.vara,
    'comarca',              new.comarca,
    'uf',                   new.uf,
    'data_distribuicao',    new.data_distribuicao,
    'link_caso',            public.webhook_base_url() || '/casos/' || new.caso_id::text
  );

  perform public.webhook_enqueue(v_parceiro, new.caso_id, 'processo_judicial.created', v_data);
  return new;
exception
  when others then
    raise warning 'webhook trigger % falhou: %', tg_name, sqlerrm;
    return new;
end;
$$;

drop trigger if exists trg_webhook_processo_judicial_created on public.processos_judiciais;
create trigger trg_webhook_processo_judicial_created
  after insert on public.processos_judiciais
  for each row execute function public.tg_webhook_processo_judicial_created();

-- 5.11 analise_tecnica.disponivel  (so resumo_parceiro; nunca resultado_json/custos)
create or replace function public.tg_webhook_analise_disponivel()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_parceiro uuid;
  v_data     jsonb;
begin
  if new.resumo_parceiro is null then
    return new;  -- so notifica quando ha resumo voltado ao parceiro
  end if;

  select parceiro_id into v_parceiro from public.casos where id = new.caso_id;
  if v_parceiro is null then
    return new;
  end if;

  v_data := jsonb_build_object(
    'analise_id',            new.id,
    'caso_id',               new.caso_id,
    'cliente',               public.webhook_cliente_ref(new.caso_id),
    'versao',                new.versao,
    'beneficio_recomendado', new.beneficio_recomendado,
    'resumo_parceiro',       new.resumo_parceiro,
    'link_caso',             public.webhook_base_url() || '/casos/' || new.caso_id::text,
    'created_at',            new.created_at
  );

  perform public.webhook_enqueue(v_parceiro, new.caso_id, 'analise_tecnica.disponivel', v_data);
  return new;
exception
  when others then
    raise warning 'webhook trigger % falhou: %', tg_name, sqlerrm;
    return new;
end;
$$;

drop trigger if exists trg_webhook_analise_disponivel on public.analises_tecnicas;
create trigger trg_webhook_analise_disponivel
  after insert on public.analises_tecnicas
  for each row execute function public.tg_webhook_analise_disponivel();

-- ----------------------------------------------------------------------------
-- 6. Segredo HMAC no Supabase Vault.
--    O Vault cifra com a chave-raiz gerenciada pela Supabase (fora do alcance
--    do role postgres). webhook_destinos guarda so o secret_id. O segredo em
--    texto so e lido (via vault.decrypted_secrets) dentro de webhook_claim_batch,
--    para assinar. O n8n recebe a assinatura pronta, nunca o segredo.
-- ----------------------------------------------------------------------------
create or replace function public.set_webhook_secret(p_destino_id uuid, p_secret text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_secret_id uuid;
begin
  select secret_id into v_secret_id from public.webhook_destinos where id = p_destino_id;
  if v_secret_id is null then
    v_secret_id := vault.create_secret(
      p_secret,
      'webhook_destino_' || p_destino_id::text,
      'Segredo HMAC do destino de webhook ' || p_destino_id::text
    );
    update public.webhook_destinos
       set secret_id = v_secret_id, updated_at = now()
     where id = p_destino_id;
  else
    perform vault.update_secret(v_secret_id, p_secret);
    update public.webhook_destinos set updated_at = now() where id = p_destino_id;
  end if;
end;
$$;

revoke all on function public.set_webhook_secret(uuid, text) from public, anon, authenticated;
grant execute on function public.set_webhook_secret(uuid, text) to service_role;

-- ----------------------------------------------------------------------------
-- 6.1 Claim atomico + assinatura no banco
--     O n8n chama isto a cada ciclo. Retorna entregas JA ASSINADAS e prontas
--     para POST. Usa FOR UPDATE SKIP LOCKED para nunca entregar em dobro mesmo
--     com execucoes concorrentes do n8n.
--
--     String assinada: timestamp || '.' || body, onde body = payload::text
--     (exatamente os bytes que devem ser enviados no corpo do POST).
-- ----------------------------------------------------------------------------
create or replace function public.webhook_claim_batch(p_limit int default 20)
returns table (
  evento_id   uuid,
  delivery_id text,
  tipo        text,
  url         text,
  ts          text,
  signature   text,
  body        text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now_epoch text := extract(epoch from now())::bigint::text;
begin
  return query
  with claimed as (
    select e.id
    from public.webhook_eventos e
    join public.webhook_destinos d on d.id = e.destino_id and d.ativo
    where e.status = 'pendente'
      and (e.proxima_tentativa_at is null or e.proxima_tentativa_at <= now())
    order by e.proxima_tentativa_at nulls first, e.created_at
    for update of e skip locked
    limit p_limit
  )
  update public.webhook_eventos e
     set status = 'enviando',
         tentativas = e.tentativas + 1,
         ultima_tentativa_at = now()
    from claimed c, public.webhook_destinos d, vault.decrypted_secrets ds
   where e.id = c.id
     and d.id = e.destino_id
     and ds.id = d.secret_id
  returning
    e.id,
    e.payload->>'id',
    e.tipo,
    d.url,
    v_now_epoch,
    'sha256=' || encode(
      extensions.hmac(v_now_epoch || '.' || e.payload::text,
           ds.decrypted_secret,
           'sha256'),
      'hex'),
    e.payload::text;
end;
$$;

revoke all on function public.webhook_claim_batch(int) from public, anon, authenticated;
grant execute on function public.webhook_claim_batch(int) to service_role;

-- ----------------------------------------------------------------------------
-- 6.2 Marca resultado da entrega (com backoff exponencial)
--     tentativas ja foi incrementado no claim. Backoff por numero de tentativas:
--       1 -> 1min, 2 -> 5min, 3 -> 30min, 4 -> 2h. Na 5a falha -> 'falhou'.
-- ----------------------------------------------------------------------------
create or replace function public.webhook_mark_result(
  p_evento_id   uuid,
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
    update public.webhook_eventos
       set status = 'enviado',
           enviado_at = now(),
           http_status = p_http_status,
           erro = null
     where id = p_evento_id;
    return;
  end if;

  select tentativas into v_tentativas
    from public.webhook_eventos where id = p_evento_id;

  if v_tentativas >= 5 then
    update public.webhook_eventos
       set status = 'falhou', http_status = p_http_status, erro = p_erro
     where id = p_evento_id;
    return;
  end if;

  v_atraso := case v_tentativas
    when 1 then interval '1 minute'
    when 2 then interval '5 minutes'
    when 3 then interval '30 minutes'
    else        interval '2 hours'
  end;

  update public.webhook_eventos
     set status = 'pendente',
         proxima_tentativa_at = now() + v_atraso,
         http_status = p_http_status,
         erro = p_erro
   where id = p_evento_id;
end;
$$;

revoke all on function public.webhook_mark_result(uuid, boolean, int, text) from public, anon, authenticated;
grant execute on function public.webhook_mark_result(uuid, boolean, int, text) to service_role;

-- ----------------------------------------------------------------------------
-- 7. Retencao (LGPD): apaga o payload (dados pessoais) dos eventos ja entregues
--    apos N dias, mantendo os metadados para auditoria. Default 90 dias.
--    Agendar via pg_cron ou job do n8n.
-- ----------------------------------------------------------------------------
create or replace function public.webhook_purge_payloads(p_dias int default 90)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_n int;
begin
  update public.webhook_eventos
     set payload = '{"purgado": true}'::jsonb
   where created_at < now() - make_interval(days => p_dias)
     and payload <> '{"purgado": true}'::jsonb;
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

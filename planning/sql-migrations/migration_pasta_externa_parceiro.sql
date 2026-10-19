-- =============================================================================
-- Migration: a pasta que o parceiro manda por link (card #434)
--
-- Decisão da Naira (2026-10-18): tem parceiro que não anexa nada no caso — ele
-- manda um link do OneDrive (ou do Google de outra conta) com acesso só àquela
-- pasta. Hoje esse link vive no WhatsApp e o caso parece vazio.
--
-- Passa a viver no caso: aparece no topo da aba Documentos, o parceiro mesmo
-- cola o dele no portal, e a tarefa de organizar diz "o parceiro não juntou
-- documentos, mas deixou um link". Um link por caso é o normal; a tabela aceita
-- vários porque às vezes vem a pasta do cliente e a de um processo antigo.
--
-- SEM integração com a Microsoft: quem organiza baixa de lá e sobe aqui, como
-- já faz hoje. O link é um atalho, não uma sincronização.
--
-- Idempotente. Local primeiro; staging e produção só com aval.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1) A tabela
-- ---------------------------------------------------------------------------
create table if not exists public.caso_pastas_externas (
  id             uuid primary key default gen_random_uuid(),
  escritorio_id  uuid not null references public.escritorios (id),
  caso_id        uuid not null references public.casos (id) on delete cascade,
  -- Só http(s): o campo é colado à mão e um "C:\Users\…" aqui não serve a
  -- ninguém. O check não valida o acesso — isso só se descobre abrindo.
  url            text not null check (url ~* '^https?://[^[:space:]]+$'),
  rotulo         text,
  criado_por     uuid references public.usuarios (id),
  created_at     timestamptz not null default now(),
  atualizado_por uuid references public.usuarios (id),
  atualizado_em  timestamptz
);

-- O mesmo link colado duas vezes (parceiro reenvia, a equipe cola junto) é o
-- mesmo link — não duplica a linha.
create unique index if not exists caso_pastas_externas_caso_url_idx
  on public.caso_pastas_externas (caso_id, url);
create index if not exists caso_pastas_externas_escritorio_idx
  on public.caso_pastas_externas (escritorio_id);

-- ---------------------------------------------------------------------------
-- 2) Escritório: herança e isolamento (molde da migration_rbac_02)
-- ---------------------------------------------------------------------------
drop trigger if exists aa_herdar_escritorio on public.caso_pastas_externas;
create trigger aa_herdar_escritorio
  before insert or update of escritorio_id, caso_id on public.caso_pastas_externas
  for each row execute function private.tg_herdar_escritorio('caso_id=casos');

-- Suporte da plataforma lê, não escreve (mesmo gatilho das outras tabelas).
drop trigger if exists ab_suporte_nao_escreve on public.caso_pastas_externas;
create trigger ab_suporte_nao_escreve
  before insert or update or delete on public.caso_pastas_externas
  for each statement execute function private.tg_suporte_nao_escreve();

alter table public.caso_pastas_externas enable row level security;

drop policy if exists isolamento_escritorio on public.caso_pastas_externas;
create policy isolamento_escritorio on public.caso_pastas_externas
  as restrictive for all to authenticated
  using (escritorio_id = (select private.escritorio_ativo()))
  with check (escritorio_id = (select private.escritorio_ativo()));

-- ---------------------------------------------------------------------------
-- 3) Quem alcança
--
-- Mesma divisão de `documentos`: a equipe interna vê e mexe em tudo do
-- escritório; o parceiro só nos casos que ele indicou. A permissão é
-- `casos:editar` (o parceiro tem no escopo `indicados`) — a policy restritiva
-- `perm_*` é o que o espelho em src/lib/rbac/exigencias.ts declara.
--
-- O parceiro só mexe no que ELE colou: o link que a equipe pôs no caso dele
-- não é dele para apagar.
-- ---------------------------------------------------------------------------
drop policy if exists pastas_externas_select on public.caso_pastas_externas;
create policy pastas_externas_select on public.caso_pastas_externas
  for select to authenticated
  using ((select public.is_interno()) or public.caso_do_parceiro(caso_id));

drop policy if exists pastas_externas_insert on public.caso_pastas_externas;
create policy pastas_externas_insert on public.caso_pastas_externas
  for insert to authenticated
  with check ((select public.is_interno()) or public.caso_do_parceiro(caso_id));

drop policy if exists pastas_externas_update on public.caso_pastas_externas;
create policy pastas_externas_update on public.caso_pastas_externas
  for update to authenticated
  using (
    (select public.is_interno())
    or (public.caso_do_parceiro(caso_id) and criado_por = (select auth.uid()))
  )
  with check (
    (select public.is_interno())
    or (public.caso_do_parceiro(caso_id) and criado_por = (select auth.uid()))
  );

drop policy if exists pastas_externas_delete on public.caso_pastas_externas;
create policy pastas_externas_delete on public.caso_pastas_externas
  for delete to authenticated
  using (
    (select public.is_interno())
    or (public.caso_do_parceiro(caso_id) and criado_por = (select auth.uid()))
  );

drop policy if exists perm_casos_editar_insert on public.caso_pastas_externas;
create policy perm_casos_editar_insert on public.caso_pastas_externas
  as restrictive for insert to authenticated
  with check ((select private.tem_permissao('casos:editar', null)));

drop policy if exists perm_casos_editar_update on public.caso_pastas_externas;
create policy perm_casos_editar_update on public.caso_pastas_externas
  as restrictive for update to authenticated
  using ((select private.tem_permissao('casos:editar', null)))
  with check ((select private.tem_permissao('casos:editar', null)));

drop policy if exists perm_casos_editar_delete on public.caso_pastas_externas;
create policy perm_casos_editar_delete on public.caso_pastas_externas
  as restrictive for delete to authenticated
  using ((select private.tem_permissao('casos:editar', null)));

grant select, insert, update, delete on public.caso_pastas_externas to authenticated;
revoke all on public.caso_pastas_externas from anon;

-- ---------------------------------------------------------------------------
-- 4) Rastro no caso
--
-- Link colado é evento do caso: entra na linha do tempo (visível para o
-- parceiro, que é quem costuma colar) e fica com autor e data. O andamento é
-- escrito pelo gatilho porque o parceiro NÃO escreve em `andamentos` — e não é
-- para passar a escrever.
-- ---------------------------------------------------------------------------
create or replace function public._pasta_externa_rastro()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_quem text;
begin
  if tg_op = 'UPDATE' then
    NEW.atualizado_em  := now();
    NEW.atualizado_por := auth.uid();
    return NEW;
  end if;

  select coalesce(u.nome, u.email) into v_quem
    from public.usuarios u where u.id = auth.uid();

  insert into public.andamentos (
    caso_id, origem, titulo, descricao, data_evento, criado_por, visivel_parceiro, metadata
  )
  values (
    NEW.caso_id, 'sistema',
    'Pasta de documentos por link',
    coalesce(nullif(trim(NEW.rotulo), '') || ': ', '') || NEW.url
      || coalesce(chr(10) || 'Informada por ' || v_quem || '.', ''),
    now(), auth.uid(), true,
    jsonb_build_object('pasta_externa_id', NEW.id, 'url', NEW.url)
  );

  return NEW;
exception
  when others then
    -- O rastro não pode derrubar o link: sem ele a pasta continua perdida.
    raise warning 'gatilho % falhou: %', tg_name, sqlerrm;
    return NEW;
end;
$$;

revoke all on function public._pasta_externa_rastro() from public;
revoke all on function public._pasta_externa_rastro() from anon;

drop trigger if exists trg_pasta_externa_atualizada on public.caso_pastas_externas;
create trigger trg_pasta_externa_atualizada
  before update on public.caso_pastas_externas
  for each row execute function public._pasta_externa_rastro();

drop trigger if exists trg_pasta_externa_rastro on public.caso_pastas_externas;
create trigger trg_pasta_externa_rastro
  after insert on public.caso_pastas_externas
  for each row execute function public._pasta_externa_rastro();

-- ---------------------------------------------------------------------------
-- 5) Caso de parceiro com documento junto não abre DUAS tarefas
--
-- Conserto de regressão da própria #434: `_documento_parceiro_cria_tarefa`
-- segurava a tarefa de "Analisar documentos juntados pelo parceiro" quando o
-- caso acabava de nascer com a análise inicial. Como agora o caso do parceiro
-- nasce com a ORGANIZAÇÃO (etapa `organizacao_documentos`), a janela de 10
-- minutos deixou de casar e o parceiro que subia os documentos na criação do
-- caso ganhava a tarefa velha em cima da nova.
--
-- Reescrita a partir do `pg_get_functiondef` de PRODUÇÃO (2026-10-18); o que
-- muda está marcado com "-- #434".
-- ---------------------------------------------------------------------------
create or replace function public._documento_parceiro_cria_tarefa()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_tipo          text;
  v_parceiro_nome text;
  v_cliente_nome  text;
  v_tarefa_id     uuid;
  v_ids           uuid[];
begin
  if NEW.uploaded_by is null or NEW.caso_id is null then
    return NEW;
  end if;

  -- Documento de CUMPRIMENTO DE SOLICITAÇÃO: o fluxo de solicitação já cria
  -- a tarefa certa ("Cumprir Exigência …" nos templates de exigência,
  -- "Analisar documento recebido …" nas avulsas). Sem tarefa duplicada.
  if NEW.solicitacao_id is not null then
    return NEW;
  end if;

  select u.tipo, coalesce(u.nome, u.email, 'parceiro')
    into v_tipo, v_parceiro_nome
    from public.usuarios u
   where u.id = NEW.uploaded_by;

  if v_tipo is distinct from 'parceiro' then
    return NEW;
  end if;

  -- Docs subidos junto com a criação do caso já são cobertos pela tarefa que
  -- nasce com o caso (janela de 10 minutos): hoje a ORGANIZAÇÃO dos documentos
  -- (#434) e, nos casos antigos, a análise inicial.
  if exists (
    select 1
      from public.tarefas t
     where t.caso_id = NEW.caso_id
       and t.status in ('a_fazer', 'fazendo')
       and t.metadata->>'etapa' in ('organizacao_documentos', 'analise_inicial_parceiro')  -- #434
       and t.created_at > NEW.created_at - interval '10 minutes'
  ) then
    return NEW;
  end if;

  -- Caso que JÁ está na fila de organização (a conferência está aberta, mesmo
  -- que o documento tenha chegado depois): quem organiza vê o arquivo novo na
  -- própria conferência — não precisa de uma segunda tarefa para o mesmo lote.
  if exists (                                                                              -- #434
    select 1
      from public.tarefas t
     where t.caso_id = NEW.caso_id
       and t.status in ('a_fazer', 'fazendo')
       and (t.metadata->>'organizacao_documentos')::boolean is true
  ) then
    return NEW;
  end if;

  -- Tarefa agrupada aberta pro mesmo caso + mesmo parceiro?
  select t.id,
         coalesce(
           array(select x::uuid from jsonb_array_elements_text(t.metadata->'documento_ids') x),
           '{}'::uuid[]
         )
    into v_tarefa_id, v_ids
    from public.tarefas t
   where t.caso_id = NEW.caso_id
     and t.status = 'a_fazer'
     and (t.metadata->>'analise_documento_parceiro')::boolean is true
     and t.metadata->>'origem_parceiro_id' = NEW.uploaded_by::text
   order by t.created_at desc
   limit 1
   for update;

  if v_tarefa_id is not null then
    if not (NEW.id = any(v_ids)) then
      v_ids := v_ids || NEW.id;
    end if;
    update public.tarefas
       set metadata  = metadata || jsonb_build_object('documento_ids', to_jsonb(v_ids)),
           descricao = public._analise_docs_parceiro_descricao(v_parceiro_nome, v_ids)
     where id = v_tarefa_id;
    return NEW;
  end if;

  select cl.nome
    into v_cliente_nome
    from public.casos c
    join public.clientes cl on cl.id = c.cliente_id
   where c.id = NEW.caso_id;

  v_ids := array[NEW.id];

  insert into public.tarefas (
    caso_id, tipo, prioridade, status,
    titulo, descricao, due_at, origem, metadata
  )
  values (
    NEW.caso_id, 'interna', 2, 'a_fazer',
    format('Analisar documentos juntados pelo parceiro - %s',
           coalesce(v_cliente_nome, '(sem nome)')),
    public._analise_docs_parceiro_descricao(v_parceiro_nome, v_ids),
    NEW.created_at + interval '1 day',
    'manual',
    jsonb_build_object(
      'analise_documento_parceiro', true,
      'origem_parceiro_id', NEW.uploaded_by,
      'documento_ids', to_jsonb(v_ids)
    )
  );

  return NEW;
exception
  when others then
    -- Nunca derrubar o upload do parceiro por causa da tarefa.
    raise warning 'trigger % falhou: %', tg_name, sqlerrm;
    return NEW;
end;
$function$;

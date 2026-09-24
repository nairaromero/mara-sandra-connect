-- migration_rbac_02_escritorio_id.sql
--
-- RBAC multi-tenant, passo 2 de 5: `escritorio_id` em toda tabela de domínio
-- (planning/MULTI_TENANT_RBAC.md, Fase 3 — expand → enforce).
--
-- Gerada a partir do CATÁLOGO, não de uma lista escrita à mão: tabela nova que
-- nascer em `public` entra sozinha na próxima rodada, e a conferência do fim
-- acusa qualquer uma que tenha ficado de fora.
--
--   1. coluna com DEFAULT CONSTANTE = escritório 1. É só metadado: não reescreve
--      a tabela e NÃO dispara os 53 gatilhos de negócio (um UPDATE de backfill
--      dispararia webhooks, notificações e tarefas automáticas);
--   2. gatilho `aa_herdar_escritorio` (BEFORE INSERT/UPDATE): o filho herda do
--      pai; a raiz recebe o escritório ativo de quem grava; o sistema (sem
--      pessoa e sem pai) cai no escritório padrão. `escritorio_id` não muda
--      depois de gravado, e não pode discordar do pai;
--   3. tira o default, NOT NULL, FK para `escritorios`, índice;
--   4. o MESMO gatilho valida o pai em todo INSERT e em todo UPDATE das colunas
--      de pai: o filho não consegue apontar para o pai de outro escritório —
--      nem com service role ou SECURITY DEFINER, que ignoram RLS (gatilho vale
--      para todos). `unique (escritorio_id, id)` nos pais fica pronto para o dia
--      em que as FKs puderem ser compostas.
--
--      DESVIO DO PLANO (§4.2 pedia FK composta), decidido em 22/09 com a suíte
--      E2E na mão: o PostgREST não resolve embed por NOME DE COLUNA
--      (`cliente:cliente_id(...)`, ~35 usos no front e nas edge functions) sobre
--      FK composta, e manter a simples AO LADO da composta deixa ambíguo todo
--      embed por nome de tabela (`casos(..., clientes(nome))`). As duas formas
--      quebram telas inteiras. A FK composta volta quando os embeds forem
--      migrados para hint (`clientes!casos_cliente_id_fkey`).
--   5. unicidade de negócio por escritório (CPF, etiqueta, template, tipo de
--      benefício, OAB, número de processo, chave de IA compartilhada).
--
-- FICAM GLOBAIS de propósito: usuarios (identidade), aceites_termos,
-- usuario_gmail_oauth, app_config, webhook_config (URL base do sistema) e as
-- tabelas do modelo de acesso. As chaves de dedup EXTERNAS (djen_id,
-- ti_nota_id, evolution_message_id, origem_ref) também: enquanto as
-- integrações forem de um escritório só (o padrão), global é o certo — viram
-- por escritório junto com as integrações (Fase 6 do plano).
--
-- Idempotente.

-- ---------------------------------------------------------------------------
-- 0. Quais tabelas são de domínio
-- ---------------------------------------------------------------------------
create or replace function private.tabelas_de_dominio() returns setof regclass
language sql stable set search_path = '' as $$
  select c.oid::regclass
    from pg_catalog.pg_class c
   where c.relnamespace = 'public'::regnamespace
     and c.relkind = 'r'
     and c.relname not in (
       'usuarios', 'aceites_termos', 'usuario_gmail_oauth', 'app_config', 'webhook_config',
       'escritorios', 'escritorio_config', 'permissoes', 'papeis', 'papel_permissoes', 'membros',
       'plataforma_staff', 'acessos_suporte', 'auditoria')  -- mesma lista da migration_rbac_05
   order by c.relname
$$;

-- ---------------------------------------------------------------------------
-- 1. Gatilho de herança
-- ---------------------------------------------------------------------------
-- TG_ARGV = lista de 'coluna=tabela_pai', na ordem de prioridade. Pai em
-- `usuarios` é candidato FRACO: só decide quando a pessoa tem um vínculo só e
-- ninguém mais decidiu.
create or replace function private.tg_herdar_escritorio() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_linha jsonb;
  v_antes jsonb;
  v_arg   text;
  v_col   text;
  v_tab   text;
  v_val   text;
  v_pai   uuid;
  v_forte uuid;
  v_fraco uuid;
begin
  if tg_op = 'UPDATE' then
    if new.escritorio_id is distinct from old.escritorio_id then
      raise exception 'escritorio_id não pode ser alterado (%.%)', tg_table_schema, tg_table_name
        using errcode = '42501';
    end if;
    -- Pai trocado depois de gravado: tem que ser do mesmo escritório.
    v_linha := to_jsonb(new);
    v_antes := to_jsonb(old);
    foreach v_arg in array coalesce(tg_argv, '{}'::text[]) loop
      v_col := split_part(v_arg, '=', 1);
      v_tab := split_part(v_arg, '=', 2);
      v_val := v_linha ->> v_col;
      continue when v_tab = 'usuarios' or v_val is null or v_val is not distinct from (v_antes ->> v_col);
      execute format('select escritorio_id from public.%I where id = $1', v_tab)
         into v_pai using v_val::uuid;
      if v_pai is not null and v_pai <> new.escritorio_id then
        raise exception '%: % aponta para outro escritório', tg_table_name, v_col
          using errcode = '42501';
      end if;
    end loop;
    return new;
  end if;

  v_linha := to_jsonb(new);
  -- Tabela-raiz não tem pai: TG_ARGV vem NULO (não vazio), e FOREACH não aceita nulo.
  foreach v_arg in array coalesce(tg_argv, '{}'::text[]) loop
    v_col := split_part(v_arg, '=', 1);
    v_tab := split_part(v_arg, '=', 2);
    v_val := v_linha ->> v_col;
    continue when v_val is null;

    if v_tab = 'usuarios' then
      if v_fraco is null then
        select case when count(*) = 1 then (array_agg(m.escritorio_id))[1] end
          into v_fraco
          from public.membros m
         where m.usuario_id = v_val::uuid and m.status <> 'desativado';
      end if;
    else
      execute format('select escritorio_id from public.%I where id = $1', v_tab)
         into v_pai using v_val::uuid;
      if v_pai is not null then
        if v_forte is null then
          v_forte := v_pai;
        elsif v_forte <> v_pai then
          raise exception '%: % aponta para outro escritório', tg_table_name, v_col
            using errcode = '42501';
        end if;
      end if;
    end if;
  end loop;

  if v_forte is not null then
    if new.escritorio_id is not null and new.escritorio_id <> v_forte then
      raise exception '%: escritorio_id informado não é o do registro pai', tg_table_name
        using errcode = '42501';
    end if;
    new.escritorio_id := v_forte;
    return new;
  end if;

  new.escritorio_id := coalesce(
    new.escritorio_id,
    private.escritorio_ativo(),
    v_fraco,
    case when auth.uid() is null then private.escritorio_padrao() end);

  if new.escritorio_id is null then
    raise exception '%: não foi possível determinar o escritório deste registro', tg_table_name
      using errcode = '42501';
  end if;
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. Coluna, gatilho, NOT NULL, FK e índice — por tabela
-- ---------------------------------------------------------------------------
do $$
declare
  t        regclass;
  v_nome   text;
  v_esc1   uuid := private.escritorio_padrao();
  v_args   text;
  v_cols   text;
  v_tem    boolean;
begin
  if v_esc1 is null then
    raise exception 'escritório padrão não existe — rode migration_rbac_01 antes';
  end if;
  perform set_config('lock_timeout', '5s', true);

  -- 2a. coluna com default constante (todas antes dos gatilhos: o pai precisa
  --     ter a coluna quando o gatilho do filho for consultado)
  for t in select private.tabelas_de_dominio() loop
    v_nome := (select relname from pg_class where oid = t);
    select exists (select 1 from pg_attribute where attrelid = t and attname = 'escritorio_id' and not attisdropped)
      into v_tem;
    if not v_tem then
      execute format('alter table %s add column escritorio_id uuid default %L', t, v_esc1);
    end if;
  end loop;

  -- 2b. gatilho de herança, com os pais lidos das FKs de cada tabela
  for t in select private.tabelas_de_dominio() loop
    v_nome := (select relname from pg_class where oid = t);

    select string_agg(quote_literal(a.attname || '=' || cf.relname), ', '
             order by (cf.relname = 'usuarios'),                       -- fracos por último
                      (a.attname <> 'caso_id'), (a.attname <> 'cliente_id'), a.attname)
      into v_args
      from pg_constraint k
      join pg_class cf on cf.oid = k.confrelid
      -- a coluna do pai: a única da FK simples, ou a que NÃO é escritorio_id na
      -- composta (depois do passo 3 as FKs entre tabelas de domínio são compostas)
      join pg_attribute a on a.attrelid = k.conrelid and a.attnum = any (k.conkey)
                         and a.attname <> 'escritorio_id'
     where k.conrelid = t
       and k.contype = 'f'
       and array_length(k.conkey, 1) <= 2
       and cf.relname <> 'escritorios'
       and cf.relnamespace = 'public'::regnamespace
       and cf.oid <> t                                                  -- auto-referência herda do mesmo caso
       and (
         cf.oid in (select private.tabelas_de_dominio())
         or (cf.relname = 'usuarios' and a.attname in ('usuario_id', 'parceiro_id', 'destinatario_id'))
       );

    -- caso_id sem FK declarada (tarefas_excluidas, acessos_documento, ia_acoes…)
    if exists (select 1 from pg_attribute where attrelid = t and attname = 'caso_id' and not attisdropped)
       and coalesce(v_args, '') not like '%''caso_id=casos''%' then
      v_args := concat_ws(', ', quote_literal('caso_id=casos'), v_args);
    end if;

    -- colunas de pai (fortes) desta tabela: o UPDATE delas revalida o escritório
    select string_agg(distinct quote_ident(split_part(trim(both '''' from x), '=', 1)), ', ')
      into v_cols
      from unnest(string_to_array(coalesce(v_args, ''), ', ')) x
     where x <> '' and split_part(trim(both '''' from x), '=', 2) <> 'usuarios';

    execute format('drop trigger if exists aa_herdar_escritorio on %s', t);
    execute format(
      'create trigger aa_herdar_escritorio before insert or update of %s on %s
         for each row execute function private.tg_herdar_escritorio(%s)',
      concat_ws(', ', 'escritorio_id', v_cols), t, coalesce(v_args, ''));
  end loop;

  -- 2c. enforce
  for t in select private.tabelas_de_dominio() loop
    v_nome := (select relname from pg_class where oid = t);
    execute format('alter table %s alter column escritorio_id drop default', t);

    if exists (select 1 from pg_attribute where attrelid = t and attname = 'escritorio_id' and not attnotnull) then
      execute format('alter table %s add constraint %I check (escritorio_id is not null) not valid', t, v_nome || '_esc_nn');
      execute format('alter table %s validate constraint %I', t, v_nome || '_esc_nn');
      execute format('alter table %s alter column escritorio_id set not null', t);
      execute format('alter table %s drop constraint %I', t, v_nome || '_esc_nn');
    end if;

    if not exists (select 1 from pg_constraint where conrelid = t and conname = v_nome || '_escritorio_fk') then
      execute format('alter table %s add constraint %I foreign key (escritorio_id) references public.escritorios (id) not valid',
                     t, v_nome || '_escritorio_fk');
      execute format('alter table %s validate constraint %I', t, v_nome || '_escritorio_fk');
    end if;

    execute format('create index if not exists %I on %s (escritorio_id)', v_nome || '_escritorio_idx', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 3. unique (escritorio_id, id) nos pais (as FKs seguem simples — ver cabeçalho)
-- ---------------------------------------------------------------------------
do $$
declare
  k       record;
  v_acao  text;
begin
  perform set_config('lock_timeout', '5s', true);

  -- pais = toda tabela de domínio referenciada por outra tabela de domínio
  for k in
    select distinct cf.oid::regclass as pai, cf.relname as pai_nome
      from pg_constraint c
      join pg_class cf on cf.oid = c.confrelid
     where c.contype = 'f'
       and c.conrelid  in (select private.tabelas_de_dominio())
       and c.confrelid in (select private.tabelas_de_dominio())
  loop
    if not exists (select 1 from pg_constraint where conrelid = k.pai and conname = k.pai_nome || '_esc_id_uk') then
      execute format('alter table %s add constraint %I unique (escritorio_id, id)', k.pai, k.pai_nome || '_esc_id_uk');
    end if;
  end loop;

  -- Rodada anterior desta migration (22/09) chegou a trocar as FKs simples por
  -- compostas: desfaz, com o mesmo nome e a mesma ação.
  for k in
    select c.conrelid::regclass as filho, c.conname, c.confrelid::regclass as pai, a.attname as coluna, c.confdeltype
      from pg_constraint c
      join pg_attribute a on a.attrelid = c.conrelid and a.attnum = any (c.conkey) and a.attname <> 'escritorio_id'
     where c.contype = 'f' and array_length(c.conkey, 1) = 2
       and c.conrelid  in (select private.tabelas_de_dominio())
       and c.confrelid in (select private.tabelas_de_dominio())
  loop
    v_acao := case k.confdeltype when 'c' then 'on delete cascade' when 'n' then 'on delete set null'
                                 when 'r' then 'on delete restrict' else '' end;
    execute format('alter table %s drop constraint %I', k.filho, k.conname);
    execute format('alter table %s add constraint %I foreign key (%I) references %s (id) %s not valid',
                   k.filho, k.conname, k.coluna, k.pai, v_acao);
    execute format('alter table %s validate constraint %I', k.filho, k.conname);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 4. Unicidade de negócio por escritório (a nova nasce antes de a antiga sair)
-- ---------------------------------------------------------------------------
do $$
begin
  perform set_config('lock_timeout', '5s', true);

  create unique index if not exists clientes_esc_cpf_key on public.clientes (escritorio_id, cpf);
  alter table public.clientes drop constraint if exists clientes_cpf_key;

  if not exists (select 1 from pg_constraint where conname = 'etiquetas_esc_nome_key') then
    alter table public.etiquetas add constraint etiquetas_esc_nome_key unique (escritorio_id, nome);
  end if;
  alter table public.etiquetas drop constraint if exists etiquetas_nome_key;

  if not exists (select 1 from pg_constraint where conname = 'tarefa_templates_esc_nome_key') then
    alter table public.tarefa_templates add constraint tarefa_templates_esc_nome_key unique (escritorio_id, nome);
  end if;
  alter table public.tarefa_templates drop constraint if exists tarefa_templates_nome_key;

  if not exists (select 1 from pg_constraint where conname = 'tipos_beneficio_esc_nome_key') then
    alter table public.tipos_beneficio add constraint tipos_beneficio_esc_nome_key unique (escritorio_id, nome);
  end if;
  alter table public.tipos_beneficio drop constraint if exists tipos_beneficio_nome_key;

  if not exists (select 1 from pg_constraint where conname = 'oabs_monitoradas_esc_numero_uf_key') then
    alter table public.oabs_monitoradas add constraint oabs_monitoradas_esc_numero_uf_key unique (escritorio_id, numero, uf);
  end if;
  alter table public.oabs_monitoradas drop constraint if exists oabs_monitoradas_numero_uf_key;

  if not exists (select 1 from pg_constraint where conname = 'contratos_parceria_esc_usuario_versao_key') then
    alter table public.contratos_parceria
      add constraint contratos_parceria_esc_usuario_versao_key unique (escritorio_id, usuario_id, versao);
  end if;
  alter table public.contratos_parceria drop constraint if exists contratos_parceria_usuario_id_versao_key;

  create unique index if not exists uq_processos_admin_esc_numero
    on public.processos_admin (escritorio_id, numero_req_normalizado) where numero_req_normalizado is not null;
  drop index if exists public.uq_processos_admin_numero;

  create unique index if not exists uq_processos_judiciais_esc_numero
    on public.processos_judiciais (escritorio_id, numero_proc_normalizado) where numero_proc_normalizado is not null;
  drop index if exists public.uq_processos_judiciais_numero;

  create unique index if not exists ia_integracoes_esc_uma_compartilhada
    on public.ia_integracoes (escritorio_id) where compartilhada;
  drop index if exists public.ia_integracoes_uma_compartilhada;

  create unique index if not exists uq_notificacoes_esc_cliente_ti_cpf
    on public.notificacoes (escritorio_id, (metadata ->> 'cpf')) where tipo = 'cliente_ti' and lida = false;
  drop index if exists public.uq_notificacoes_cliente_ti_cpf;
end $$;

-- `_clientes_sync_tags_para_etiquetas` faz upsert de etiqueta por nome: o alvo
-- do ON CONFLICT acompanha a unicidade nova. Reescrita a partir do que está no
-- banco (o gatilho de herança já preencheu escritorio_id quando o conflito é
-- avaliado).
do $$
declare
  v_def text;
begin
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p
   where p.pronamespace = 'public'::regnamespace and p.proname = '_clientes_sync_tags_para_etiquetas';
  if v_def is null then
    raise notice '_clientes_sync_tags_para_etiquetas não existe — nada a fazer';
  elsif position('on conflict (escritorio_id, nome)' in v_def) > 0 then
    raise notice '_clientes_sync_tags_para_etiquetas já usa a unicidade por escritório';
  elsif position('on conflict (nome)' in v_def) = 0 then
    raise warning '_clientes_sync_tags_para_etiquetas não tem o ON CONFLICT esperado; conferir à mão';
  else
    execute replace(v_def, 'on conflict (nome)', 'on conflict (escritorio_id, nome)');
    raise notice '_clientes_sync_tags_para_etiquetas passou a usar (escritorio_id, nome)';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- O PostgREST precisa reler as relações.
notify pgrst, 'reload schema';

-- ---------------------------------------------------------------------------
-- Conferência (portão da Fase 3)
-- ---------------------------------------------------------------------------
do $$
declare
  t      regclass;
  v_n    bigint;
  v_erro text := '';
begin
  for t in select private.tabelas_de_dominio() loop
    execute format('select count(*) from %s where escritorio_id is null', t) into v_n;
    if v_n > 0 then v_erro := v_erro || format(' %s:%s nulos;', t, v_n); end if;
  end loop;
  if v_erro <> '' then
    raise exception 'escritorio_id nulo:%', v_erro;
  end if;
end $$;

select
  (select count(*) from private.tabelas_de_dominio()) as tabelas_de_dominio,
  (select count(*) from pg_attribute a
    where a.attname = 'escritorio_id' and a.attnotnull and not a.attisdropped
      and a.attrelid in (select private.tabelas_de_dominio())) as com_escritorio_id_not_null,
  (select count(*) from pg_trigger where tgname = 'aa_herdar_escritorio') as gatilhos_de_heranca,
  (select count(*) from pg_constraint c where c.contype = 'f' and array_length(c.conkey, 1) = 2
      and c.conrelid in (select private.tabelas_de_dominio())) as fks_compostas_tem_que_ser_0,
  (select count(*) from pg_trigger t where t.tgname = 'aa_herdar_escritorio' and t.tgnargs > 0) as gatilhos_que_validam_pai,
  (select count(*) from pg_constraint where conname like '%\_esc\_id\_uk') as pais_com_unique;

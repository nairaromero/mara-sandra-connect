-- =============================================================================
-- migration_analise_dono_e_avisar_cliente.sql  (2026-09-03)
--
-- Três pedidos da Naira, todos sobre tarefa que nascia órfã ou não nascia:
--
--  1. Tarefa "Cliente novo - Analisar" criada pelo trigger (caso indicado por
--     parceiro) nascia SEM responsável — só o formulário /casos/novo atribuía,
--     e ele só roda quando quem cadastra é interno. Quando o próprio parceiro
--     cadastrava, a tarefa ficava sem dono e fora de "Minhas tarefas" (14 assim
--     em produção). Agora o dono padrão é a Mara.
--
--  2. Perícia/audiência em caso SEM parceiro indicador não gerava tarefa
--     nenhuma (os triggers de aviso saíam calados quando não havia a quem
--     avisar). Ou seja: ninguém era lembrado de avisar o CLIENTE. Agora nasce
--     "Avisar o cliente da perícia/audiência", com o mesmo texto de referência
--     (sem a linha de confirmação, que é conversa de parceiro).
--
--  3. (front-end, fora deste arquivo) importação por Excel passa a criar a
--     tarefa de análise também quando a linha não traz parceiro.
--
-- Idempotente: só CREATE OR REPLACE FUNCTION. As funções abaixo partem do
-- pg_get_functiondef da PRODUÇÃO (2026-09-03), não de migration antiga.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Dono padrão das tarefas que nascem sem ninguém escolhido.
--    Um lugar só: trocar a pessoa aqui muda todos os pontos de uso.
-- -----------------------------------------------------------------------------
create or replace function public.responsavel_padrao_analise()
returns uuid
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
  select u.id
    from public.usuarios u
   where u.tipo = 'interno'
     and u.ativo is true
     and lower(u.email) = 'marasandra.adv@gmail.com'
   limit 1;
$$;

comment on function public.responsavel_padrao_analise() is
  'Responsável padrão (Mara) das tarefas que nascem sem dono escolhido — '
  'análise de cliente novo e avisos. Naira, 2026-09-03.';

-- Só quem está logado precisa disso; sem o revoke o grant default de
-- CREATE FUNCTION deixa até o anon ler o id da Mara.
revoke all on function public.responsavel_padrao_analise() from public;
-- O default privileges do Supabase dá execute pro anon em toda função nova;
-- esta só interessa a quem está logado.
revoke all on function public.responsavel_padrao_analise() from anon;
grant execute on function public.responsavel_padrao_analise() to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 2. Tarefa de análise do caso indicado por parceiro nasce COM dono.
--    (o formulário /casos/novo continua sobrescrevendo com quem o interno
--     escolher na tela)
-- -----------------------------------------------------------------------------
create or replace function public._caso_novo_parceiro_cria_tarefa()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_parceiro_nome text;
  v_cliente_nome text;
begin
  if NEW.parceiro_id is null then
    return NEW;
  end if;

  select coalesce(u.nome, u.email, 'parceiro')
    into v_parceiro_nome
    from public.usuarios u
   where u.id = NEW.parceiro_id;

  select c.nome
    into v_cliente_nome
    from public.clientes c
   where c.id = NEW.cliente_id;

  insert into public.tarefas (
    caso_id, responsavel_id, tipo, prioridade, status,
    titulo, descricao, due_at, origem, metadata
  )
  values (
    NEW.id,
    -- Sem dono a tarefa some de "Minhas tarefas" de todo mundo.
    public.responsavel_padrao_analise(),
    'interna', 2, 'a_fazer',
    format(
      'Cliente novo - Parceiro %s - Analisar',
      coalesce(v_parceiro_nome, 'parceiro')
    ),
    format(
      'Caso %s indicado pelo parceiro %s. Revisar dados, documentos e definir próximos passos.',
      coalesce(v_cliente_nome, '(sem nome)'),
      coalesce(v_parceiro_nome, '(sem nome)')
    ),
    NEW.created_at + interval '1 day',
    'manual',
    jsonb_build_object(
      'origem_caso_id', NEW.id,
      'origem_parceiro_id', NEW.parceiro_id,
      'etapa', 'analise_inicial_parceiro'
    )
  );

  return NEW;
end;
$function$;

-- -----------------------------------------------------------------------------
-- 3. Perícia/audiência agendada na AGENDA: sem parceiro, avisa o cliente.
-- -----------------------------------------------------------------------------
create or replace function public.tg_rascunho_pericia_evento()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_parceiro uuid;
  v_cliente  text;
  v_servico  text;
  v_natureza text;
  v_processo text;
  v_texto    text;
  v_rotulo   text;
  v_aviso    text;
begin
  if new.tipo not in ('pericia', 'audiencia') then return new; end if;
  if new.caso_id is null then return new; end if;
  if new.restrito_a is not null then return new; end if;
  if coalesce(new.metadata->>'aviso_direto', '') = 'true' then return new; end if;

  select c.parceiro_id, cl.nome, c.tipo_beneficio
    into v_parceiro, v_cliente, v_servico
    from public.casos c
    join public.clientes cl on cl.id = c.cliente_id
   where c.id = new.caso_id;

  if new.processo_judicial_id is not null then
    select numero_processo into v_processo
      from public.processos_judiciais where id = new.processo_judicial_id;
  end if;

  if new.tipo = 'pericia' then
    v_natureza := case
      when new.processo_judicial_id is not null then 'judicial'
      when new.processo_admin_id is not null then 'admin'
      when new.titulo ~* 'judicial' then 'judicial'
      else 'admin' end;
    v_texto := public.pericia_draft_texto(
      v_natureza, v_cliente, v_servico, v_processo, new.start_at, new.local, null);
    v_rotulo := 'perícia';
    v_aviso  := 'pericia_aviso';
  else
    v_texto := public.audiencia_draft_texto(v_cliente, new.start_at, new.local);
    v_rotulo := 'audiência';
    v_aviso  := 'audiencia_aviso';
  end if;

  -- Cliente interno do escritório: não há parceiro pra receber o aviso, mas o
  -- CLIENTE precisa saber do mesmo jeito. Tarefa de contato direto, com o
  -- texto de referência sem a linha de confirmação (essa é pro parceiro).
  if v_parceiro is null then
    insert into public.tarefas
      (caso_id, responsavel_id, tipo, status, prioridade, titulo, descricao,
       due_at, origem, origem_ref, processo_admin_id, processo_judicial_id, metadata)
    select
      new.caso_id,
      coalesce(new.created_by, new.responsavel_id, public.responsavel_padrao_analise()),
      'contato_cliente', 'a_fazer', 1,
      'Avisar o cliente da ' || v_rotulo || ' - ' || coalesce(v_cliente, 'cliente'),
      'Caso sem parceiro indicador (cliente interno do escritório): fale com o ' ||
      'cliente e confirme que ele está ciente. Texto de referência:' ||
      E'\n\n' || regexp_replace(v_texto, E'\n*✅[^\n]*', '', 'g'),
      now(),
      'manual',
      'evento:' || new.id::text,
      new.processo_admin_id,
      new.processo_judicial_id,
      jsonb_build_object(
        'avisar_cliente', jsonb_build_object(
          'tipo_aviso', v_aviso,
          'evento_id', new.id
        )
      )
    where not exists (
      select 1 from public.tarefas t
       where t.origem_ref = 'evento:' || new.id::text
    );
    return new;
  end if;

  insert into public.tarefas
    (caso_id, responsavel_id, tipo, status, prioridade, titulo, descricao,
     due_at, origem, origem_ref, processo_admin_id, processo_judicial_id, metadata)
  select
    new.caso_id,
    coalesce(new.created_by, new.responsavel_id, public.responsavel_padrao_analise()),
    'contato_cliente', 'a_fazer', 1,
    'Enviar aviso da ' || v_rotulo || ' ao parceiro - ' || coalesce(v_cliente, 'cliente'),
    'Revisar o texto e enviar pelo botão aqui na tarefa. O parceiro recebe como comentário do caso, por e-mail.',
    now(),
    'enviar_aviso',
    'evento:' || new.id::text,
    new.processo_admin_id,
    new.processo_judicial_id,
    jsonb_build_object(
      'enviar_aviso', jsonb_build_object(
        'tipo_aviso', v_aviso,
        'evento_id', new.id,
        'texto', v_texto
      )
    )
  where not exists (
    select 1 from public.tarefas t
     where t.origem = 'enviar_aviso' and t.origem_ref = 'evento:' || new.id::text
  );

  return new;
exception when others then
  raise warning 'tg_rascunho_pericia_evento falhou (evento %): % / %',
    new.id, SQLSTATE, SQLERRM;
  return new;
end;
$function$;

-- -----------------------------------------------------------------------------
-- 4. Perícia/audiência detectada em ANDAMENTO (publicação): mesma regra.
-- -----------------------------------------------------------------------------
create or replace function public.tg_rascunho_pericia_andamento()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_texto_busca text;
  v_parceiro    uuid;
  v_cliente     text;
  v_servico     text;
  v_natureza    text;
  v_processo    text;
  v_texto       text;
  v_rotulo      text;
  v_aviso       text;
begin
  if new.caso_id is null then return new; end if;
  if new.metadata->>'etapa' = 'pericia_agendada' then return new; end if;
  -- Andamento nascido do próprio fluxo de aviso: não morder o rabo.
  if new.metadata ? 'tipo_aviso' then return new; end if;
  if new.data_evento is not null and new.data_evento < (now() - interval '30 days') then
    return new;
  end if;

  v_texto_busca := coalesce(new.titulo, '') || ' ' || coalesce(new.descricao, '');

  if v_texto_busca ~* 'per[ií]cia'
     and v_texto_busca ~* '(marcad|agendad|reagendad|remarcad|designad)' then
    v_rotulo := 'perícia';
    v_aviso  := 'pericia_aviso';
  elsif v_texto_busca ~* 'audi[eê]nci'
     and v_texto_busca ~* '(marcad|agendad|designad|redesignad|pautad)' then
    v_rotulo := 'audiência';
    v_aviso  := 'audiencia_aviso';
  else
    return new;
  end if;

  select c.parceiro_id, cl.nome, c.tipo_beneficio
    into v_parceiro, v_cliente, v_servico
    from public.casos c
    join public.clientes cl on cl.id = c.cliente_id
   where c.id = new.caso_id;

  -- Dedup APENAS por andamento (origem_ref, no insert abaixo). O anti-spam
  -- por caso inteiro engolia uma SEGUNDA perícia publicada com a primeira
  -- tarefa ainda aberta (review #6) — tarefa a mais é chateação; perícia
  -- engolida é prejuízo.

  if new.processo_judicial_id is not null then
    select numero_processo into v_processo
      from public.processos_judiciais where id = new.processo_judicial_id;
  end if;

  if v_aviso = 'pericia_aviso' then
    v_natureza := case
      when new.processo_judicial_id is not null then 'judicial'
      when new.processo_admin_id is not null then 'admin'
      when v_texto_busca ~* 'judicial' then 'judicial'
      else 'admin' end;
    -- Publicação não traz data/local estruturados: o texto sai com lacunas
    -- (_____) e quem envia completa lendo a publicação.
    v_texto := public.pericia_draft_texto(
      v_natureza, v_cliente, v_servico, v_processo, null, null, null);
  else
    v_texto := public.audiencia_draft_texto(v_cliente, null, null);
  end if;

  -- Sem parceiro: avisa o cliente direto (antes não nascia tarefa nenhuma).
  if v_parceiro is null then
    insert into public.tarefas
      (caso_id, responsavel_id, tipo, status, prioridade, titulo, descricao,
       due_at, origem, origem_ref, processo_admin_id, processo_judicial_id, metadata)
    select
      new.caso_id,
      public.responsavel_padrao_analise(),
      'contato_cliente', 'a_fazer', 1,
      'Avisar o cliente da ' || v_rotulo || ' - ' || coalesce(v_cliente, 'cliente'),
      'Detectado no andamento: "' || left(coalesce(new.titulo, ''), 120) || '". ' ||
      'Caso sem parceiro indicador (cliente interno do escritório): confirme a ' ||
      'data/local na publicação e fale com o cliente. Texto de referência:' ||
      E'\n\n' || regexp_replace(v_texto, E'\n*✅[^\n]*', '', 'g'),
      now(),
      'manual',
      'andamento:' || new.id::text,
      new.processo_admin_id,
      new.processo_judicial_id,
      jsonb_build_object(
        'avisar_cliente', jsonb_build_object(
          'tipo_aviso', v_aviso,
          'origem_andamento_id', new.id
        )
      )
    where not exists (
      select 1 from public.tarefas t
       where t.origem_ref = 'andamento:' || new.id::text
    );
    return new;
  end if;

  insert into public.tarefas
    (caso_id, responsavel_id, tipo, status, prioridade, titulo, descricao,
     due_at, origem, origem_ref, processo_admin_id, processo_judicial_id, metadata)
  select
    new.caso_id,
    public.responsavel_padrao_analise(),
    'contato_cliente', 'a_fazer', 1,
    'Enviar aviso da ' || v_rotulo || ' ao parceiro - ' || coalesce(v_cliente, 'cliente'),
    'Detectado no andamento: "' || left(coalesce(new.titulo, ''), 120) || '". ' ||
    'Complete as lacunas do texto com a data/local da publicação e envie pelo botão aqui na tarefa.',
    now(),
    'enviar_aviso',
    'andamento:' || new.id::text,
    new.processo_admin_id,
    new.processo_judicial_id,
    jsonb_build_object(
      'enviar_aviso', jsonb_build_object(
        'tipo_aviso', v_aviso,
        'evento_id', null,
        'texto', v_texto,
        'origem_andamento_id', new.id
      )
    )
  where not exists (
    select 1 from public.tarefas t
     where t.origem = 'enviar_aviso' and t.origem_ref = 'andamento:' || new.id::text
  );

  return new;
exception when others then
  raise warning 'tg_rascunho_pericia_andamento falhou (andamento %): % / %',
    new.id, SQLSTATE, SQLERRM;
  return new;
end;
$function$;

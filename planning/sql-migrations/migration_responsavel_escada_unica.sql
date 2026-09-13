-- =============================================================================
-- Migration: uma escada só decide o dono da tarefa (achados 1, 2 e 3 da
-- revisão de 2026-09-10).
--
-- O lote de setembro ficou com DUAS mecânicas resolvendo a mesma pergunta:
--   * migration_analise_dono_e_avisar_cliente (PR #225) fixa a Mara em 3
--     pontos de inserção, chamando public.responsavel_padrao_analise();
--   * migration_responsavel_automatico_tarefas (PR #227) resolve pela escada
--     (quem pediu -> dono do caso -> dono de fato -> app_config -> padrão),
--     mas SÓ quando responsavel_id chega nulo.
-- Como os 3 pontos da #225 mandam valor preenchido, a rede pula e eles nunca
-- consultam a escada. Efeito prático: definir "Responsável pelo caso" ou
-- apontar app_config.tarefa_analise_responsavel_id NÃO valia para tarefa de
-- perícia/audiência nem para "Cliente novo - Analisar". Só 4 dos 7 caminhos
-- automáticos respeitavam o dono do caso.
--
-- Aqui os 3 passam a chamar public.responsavel_tarefa_caso(...). Onde havia
-- palpite local (o created_by do evento de agenda), ele vira o argumento
-- p_preferido — a escada valida que é interno ativo antes de aceitar, coisa
-- que o coalesce cru não fazia.
--
-- Também nesta migration:
--
--  2. responsavel_tarefa_caso é SECURITY DEFINER e estava SEM revoke: o grant
--     default do Supabase deixava anon executá-la via PostgREST e ler o UUID
--     de quem cuida de um caso (ou, sem argumento, o do padrão do escritório),
--     ignorando RLS. A função irmã responsavel_padrao_analise() já tinha esse
--     revoke desde a #225 — aqui a proteção fica igual nas duas. Os triggers
--     não se importam: são SECURITY DEFINER e rodam como o dono.
--
--  3. O exception handler de _tarefas_set_responsavel devolvia NEW sem
--     preencher nada, então qualquer falha na escada ressuscitava a tarefa
--     órfã em silêncio — o bug que este lote inteiro veio matar, de volta com
--     um warning que ninguém lê. Agora o handler tem chão: cai no admin
--     padrão. Se ATÉ isso falhar, aí sim desiste (bloco aninhado) — nunca
--     derrubar o insert.
--
-- E extrai public.admin_ativo_padrao(): a regra "primeiro admin interno
-- ativo, ignorando conta sintética" estava escrita duas vezes (na escada e,
-- desde a #229, no fallback do DJE). Aqui vira função única e a escada passa
-- a chamá-la. O _dje_triagem_responsavel fica com a cópia dele por ora — é da
-- #229, ainda pendente de produção, e reescrevê-la daqui criaria disputa de
-- ordem entre as duas migrations.
--
-- ORDEM EM PRODUÇÃO (importa): esta migration precisa rodar DEPOIS de
--   1) migration_analise_dono_e_avisar_cliente.sql   (cria as 3 funções)
--   2) migration_responsavel_automatico_tarefas.sql  (cria a escada)
--   3) migration_responsavel_tarefa_ultima_rede.sql  (último degrau)
-- Rodar fora de ordem não corrompe nada, mas re-rodar as anteriores DEPOIS
-- desta desfaz o conserto — o guard abaixo falha cedo e explica.
--
-- Corpo das 3 funções gerado a partir do pg_get_functiondef do STAGING
-- (a produção ainda tem as versões pré-#225, que este lote vai substituir):
--   _caso_novo_parceiro_cria_tarefa  4ef749d9207a606c7ec5bbf4d63dc7bc
--   tg_rascunho_pericia_evento       a3db23b57dc7a865080bbc4bd6d5a311
--   tg_rascunho_pericia_andamento    7f09b9907fa3c36ec250d9ca424f0345
-- Muda SÓ a linha do responsável em cada insert (5 no total).
--
-- Idempotente.
-- =============================================================================

do $guard$
begin
  if to_regprocedure('public.responsavel_tarefa_caso(uuid, uuid)') is null then
    raise exception 'Rode antes migration_responsavel_automatico_tarefas.sql (+ ultima_rede): public.responsavel_tarefa_caso nao existe neste banco.';
  end if;
end
$guard$;

-- ---------------------------------------------------------------------------
-- 0) A regra do admin padrão, num lugar só.
-- ---------------------------------------------------------------------------
create or replace function public.admin_ativo_padrao()
returns uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  -- Contas sintéticas fora: '[' ordena antes de qualquer letra, então sem o
  -- filtro o staging escolhe '[E2E] Admin' (foi assim que o fallback do DJE
  -- ficou apontando pra conta de teste até a #229).
  select u.id
    from public.usuarios u
   where u.ativo is true
     and u.eh_admin is true
     and u.tipo = 'interno'
     and lower(u.email) not like 'e2e+%'
   order by u.nome
   limit 1;
$$;

comment on function public.admin_ativo_padrao() is
  'Primeiro admin interno ativo por nome, ignorando contas sintéticas (e2e+%). Última rede de quem assume tarefa quando nada mais resolve.';

revoke all on function public.admin_ativo_padrao() from public;
revoke all on function public.admin_ativo_padrao() from anon;
grant execute on function public.admin_ativo_padrao() to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 1) A escada passa a usar o helper no último degrau + fecha o anon.
--    Corpo do pg_get_functiondef do staging (e5b3fbb3510d6ea869b2f639d17ea3ab);
--    muda só o degrau 6, que vira a chamada única.
-- ---------------------------------------------------------------------------
create or replace function public.responsavel_tarefa_caso(
  p_caso_id   uuid,
  p_preferido uuid default null
)
returns uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(
    -- 1) palpite de quem chamou (quem pediu o documento, quem criou o evento)
    (select u.id from public.usuarios u
      where u.id = p_preferido and u.ativo is true and u.tipo = 'interno'),
    -- 2) dono explícito do caso
    (select u.id
       from public.casos c
       join public.usuarios u on u.id = c.responsavel_id
      where c.id = p_caso_id and u.ativo is true),
    -- 3) dono de fato: quem carrega mais tarefa aberta nesse caso; empate
    --    (inclusive todo mundo com zero aberta) decide pela mais recente.
    (select t.responsavel_id
       from public.tarefas t
       join public.usuarios u on u.id = t.responsavel_id
      where t.caso_id = p_caso_id
        and u.ativo is true
        and u.tipo = 'interno'
      group by t.responsavel_id
      order by count(*) filter (where t.status in ('a_fazer', 'fazendo')) desc,
               max(t.created_at) desc
      limit 1),
    -- 4) override configurável, pra trocar o padrão sem migration
    (select u.id
       from public.app_config c
       join public.usuarios u on u.id::text = c.valor
      where c.chave = 'tarefa_analise_responsavel_id'
        and u.ativo is true),
    -- 5) padrão do escritório (hoje a Mara, por e-mail, exigindo ativo)
    public.responsavel_padrao_analise(),
    -- 6) última rede — nunca NULL, nunca conta sintética
    public.admin_ativo_padrao()
  );
$$;

comment on function public.responsavel_tarefa_caso(uuid, uuid) is
  'Resolve o responsável de uma tarefa nova: preferido -> dono do caso -> dono de fato -> app_config tarefa_analise_responsavel_id -> responsavel_padrao_analise() -> admin_ativo_padrao(). Nunca devolve NULL.';

-- SECURITY DEFINER + grant default do Supabase = anon lia UUID de interno via
-- PostgREST, ignorando RLS. Mesma proteção que responsavel_padrao_analise()
-- já tinha. Os triggers rodam como o dono e não dependem destes grants.
revoke all on function public.responsavel_tarefa_caso(uuid, uuid) from public;
revoke all on function public.responsavel_tarefa_caso(uuid, uuid) from anon;
grant execute on function public.responsavel_tarefa_caso(uuid, uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2) A rede ganha chão: falha na escada não devolve mais tarefa órfã.
--    Corpo do staging (ed571f16fef4b35c64b942a401ad1334); muda só o handler.
-- ---------------------------------------------------------------------------
create or replace function public._tarefas_set_responsavel()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_preferido uuid;
  v_solic     uuid;
begin
  if NEW.responsavel_id is not null then
    return NEW;
  end if;

  -- Tarefa que nasceu de uma solicitação de documento: quem pediu confere.
  v_solic := nullif(NEW.metadata->>'origem_solicitacao_documento_id', '')::uuid;
  if v_solic is not null then
    select coalesce(s.responsavel_id, s.solicitado_por)
      into v_preferido
      from public.solicitacoes_documento s
     where s.id = v_solic;
  end if;

  -- Tarefa sem caso é tarefa de escritório: fica com quem criou (se for
  -- interno). Sem isso ela cairia no padrão do escritório, que não tem nada
  -- a ver com o assunto.
  if NEW.caso_id is null then
    v_preferido := coalesce(v_preferido, NEW.created_by);
  end if;

  NEW.responsavel_id := public.responsavel_tarefa_caso(NEW.caso_id, v_preferido);
  return NEW;
exception when others then
  -- Antes o handler devolvia NEW com responsavel_id NULL: qualquer falha na
  -- escada (função renomeada, grant mudado, metadata com uuid inválido)
  -- ressuscitava a tarefa órfã em silêncio. Agora tem chão.
  raise warning '_tarefas_set_responsavel falhou (caso %): % / % — caindo no admin padrão',
    NEW.caso_id, SQLSTATE, SQLERRM;
  begin
    NEW.responsavel_id := public.admin_ativo_padrao();
  exception when others then
    -- Nem o chão respondeu. Uma tarefa sem dono é ruim; um insert que explode
    -- é pior — deixa passar e o warning acima fica no log.
    null;
  end;
  return NEW;
end;
$function$;

-- ---------------------------------------------------------------------------
-- 3) Os três pontos que furavam a escada.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._caso_novo_parceiro_cria_tarefa()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
    -- Pela escada: caso recém-criado não tem dono nem histórico, então
    -- cai no override de configuração e só depois no padrão. Antes
    -- chamava o padrão direto e o override não valia aqui.
    public.responsavel_tarefa_caso(NEW.id),
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

CREATE OR REPLACE FUNCTION public.tg_rascunho_pericia_andamento()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
      public.responsavel_tarefa_caso(new.caso_id),
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
    public.responsavel_tarefa_caso(new.caso_id),
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

CREATE OR REPLACE FUNCTION public.tg_rascunho_pericia_evento()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
      public.responsavel_tarefa_caso(new.caso_id, coalesce(new.created_by, new.responsavel_id)),
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
    public.responsavel_tarefa_caso(new.caso_id, coalesce(new.created_by, new.responsavel_id)),
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

-- =============================================================================
-- Migration: responsável e processo da solicitação valem também na EDIÇÃO
-- (card #357, segunda parte)
--
-- Pedido da Naira (2026-09-18): "editar solicitação poderia também ser possível
-- alterar o processo e o responsável, sendo este último quando eu coloco que a
-- responsabilidade será do interno".
--
-- O que faltava no banco:
--   1. `_solicitacao_interna_cria_tarefa` só rodava no INSERT. Trocar a origem
--      para 'interna' pela tela de edição não abria a tarefa "Providenciar
--      documentos" — e trocar o responsável não movia a tarefa já aberta.
--   2. `_solicitacao_cumprida_parceiro_cria_tarefa` criava a tarefa "Analisar
--      documento recebido" SEM dono, ignorando o responsável escolhido no
--      pedido externo.
--   3. As duas tarefas nasciam sem processo, então caíam na coluna errada de
--      quem agrupa por frente (card #357).
--
-- Ambas as funções foram reescritas a partir do `pg_get_functiondef` do banco
-- (local == produção, conferido em 2026-09-18); as mudanças estão marcadas com
-- "-- #357".
--
-- Idempotente. Local primeiro, depois staging, só então produção com aval.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1) Solicitação interna: cria, REATRIBUI e cancela a tarefa de providenciar
-- ---------------------------------------------------------------------------
create or replace function public._solicitacao_interna_cria_tarefa()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_cliente text;
  v_docs    text;
  v_tarefa  uuid;
  v_status  text;
begin
  -- #357: a origem pode mudar na edição. Se saiu de 'interna', a tarefa de
  -- providenciar perdeu o sentido (o pedido virou do parceiro) — cancela a que
  -- estiver aberta em vez de deixar tarefa órfã na fila de alguém.
  if TG_OP = 'UPDATE'
     and OLD.origem is not distinct from 'interna'
     and NEW.origem is distinct from 'interna' then
    update public.tarefas t
       set status = 'cancelado'
     where t.origem_ref = 'solicitacao:' || NEW.id::text
       and (t.metadata->>'providenciar_documento')::boolean is true
       and t.status = 'a_fazer';
    return NEW;
  end if;

  if NEW.origem is distinct from 'interna' then return NEW; end if;
  if NEW.responsavel_id is null then return NEW; end if;
  if NEW.caso_id is null then return NEW; end if;
  -- #357: pedido já resolvido não reabre tarefa na edição.
  if coalesce(NEW.status, 'pendente') <> 'pendente' then return NEW; end if;

  -- #357: se a tarefa já existe, a edição só REATRIBUI (e acompanha o processo
  -- escolhido). Sem isso, trocar o responsável na tela não movia nada. Uma
  -- tarefa cancelada por ida-e-volta de origem volta a 'a_fazer'; uma já
  -- concluída fica como está — o pedido foi providenciado.
  select t.id, t.status into v_tarefa, v_status
    from public.tarefas t
   where t.origem_ref = 'solicitacao:' || NEW.id::text
     and (t.metadata->>'providenciar_documento')::boolean is true
   order by (t.status = 'a_fazer') desc, t.created_at desc
   limit 1;

  if v_tarefa is not null then
    if v_status = 'feito' then return NEW; end if;
    update public.tarefas
       set responsavel_id       = NEW.responsavel_id,
           processo_admin_id    = NEW.processo_admin_id,
           processo_judicial_id = NEW.processo_judicial_id,
           status               = 'a_fazer'
     where id = v_tarefa;
    return NEW;
  end if;

  select cl.nome into v_cliente
    from public.casos c
    join public.clientes cl on cl.id = c.cliente_id
   where c.id = NEW.caso_id;

  -- Lista dos documentos pedidos (multi-tipos) ou o tipo único legado.
  if NEW.tipos is not null and jsonb_typeof(NEW.tipos) = 'array'
     and jsonb_array_length(NEW.tipos) > 0 then
    select string_agg(coalesce(x->>'label', x->>'tipo'), ', ')
      into v_docs
      from jsonb_array_elements(NEW.tipos) x;
  else
    v_docs := initcap(replace(coalesce(NEW.tipo::text, 'documento'), '_', ' '));
  end if;

  insert into public.tarefas (
    caso_id, responsavel_id, tipo, prioridade, status,
    titulo, descricao, due_at, origem, origem_ref, metadata,
    processo_admin_id, processo_judicial_id            -- #357
  )
  select
    NEW.caso_id, NEW.responsavel_id, 'interna', 2, 'a_fazer',
    'Providenciar documentos - ' || coalesce(v_cliente, 'cliente'),
    'Solicitação interna: ' || v_docs || '.'
      || coalesce(chr(10) || 'Observação: ' || nullif(NEW.descricao, ''), '')
      || chr(10) || 'Ao marcar a solicitação como atendida, esta tarefa se conclui sozinha.',
    now() + interval '1 day',
    'manual',
    'solicitacao:' || NEW.id::text,
    jsonb_build_object(
      'origem_solicitacao_documento_id', NEW.id,
      'providenciar_documento', true
    ),
    NEW.processo_admin_id, NEW.processo_judicial_id    -- #357
  where not exists (
    select 1 from public.tarefas t
     where t.origem_ref = 'solicitacao:' || NEW.id::text
       and (t.metadata->>'providenciar_documento')::boolean is true
  );

  return NEW;
exception when others then
  raise warning '_solicitacao_interna_cria_tarefa falhou (solic %): % / %',
    NEW.id, SQLSTATE, SQLERRM;
  return NEW;
end;
$function$;

-- #357: passa a rodar também na edição (era só INSERT). A lista de colunas
-- evita rodar em todo cumprimento de solicitação.
drop trigger if exists trg_solicitacao_interna_tarefa on public.solicitacoes_documento;
create trigger trg_solicitacao_interna_tarefa
  after insert or update of origem, responsavel_id, processo_admin_id, processo_judicial_id
  on public.solicitacoes_documento
  for each row execute function public._solicitacao_interna_cria_tarefa();

-- ---------------------------------------------------------------------------
-- 2) Documento que volta do parceiro: a análise abre no nome escolhido
-- ---------------------------------------------------------------------------
create or replace function public._solicitacao_cumprida_parceiro_cria_tarefa()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_eh_parceiro boolean;
  v_parceiro_nome text;
  v_tipo_label text;
  v_cliente text;
begin
  -- Só transição para 'atendido'.
  if NEW.status is distinct from 'atendido' or OLD.status is not distinct from NEW.status then
    return NEW;
  end if;

  -- Solicitações de template de exigência ficam com o trigger antigo.
  if NEW.origem is not null and NEW.origem like 'template:%' then
    return NEW;
  end if;

  -- Pedido de troca de senha do Meu INSS (card #305): não tem documento a
  -- analisar — a tarefa "Senha do Meu INSS alterada" nasce no cumprimento.
  if NEW.tipo::text = 'senha_meu_inss' then
    return NEW;
  end if;

  -- Só quando quem atualizou é parceiro.
  select (u.tipo = 'parceiro'), u.nome
    into v_eh_parceiro, v_parceiro_nome
    from public.usuarios u
   where u.id = auth.uid();

  if not coalesce(v_eh_parceiro, false) then
    return NEW;
  end if;

  -- Evita duplicar se a mesma solicitação for re-cumprida com análise aberta.
  if exists (
    select 1 from public.tarefas t
     where t.status = 'a_fazer'
       and t.metadata->>'origem_solicitacao_documento_id' = NEW.id::text
       and (t.metadata->>'analise_solicitacao')::boolean is true
  ) then
    return NEW;
  end if;

  -- Pedido de vários documentos: lista os labels; senão, o tipo único.
  if NEW.tipos is not null and jsonb_typeof(NEW.tipos) = 'array'
     and jsonb_array_length(NEW.tipos) > 0 then
    select string_agg(coalesce(x->>'label', x->>'tipo'), ', ')
      into v_tipo_label
      from jsonb_array_elements(NEW.tipos) x;
  else
    v_tipo_label := initcap(replace(coalesce(NEW.tipo::text, 'documento'), '_', ' '));
  end if;

  select cl.nome into v_cliente
    from public.casos c
    join public.clientes cl on cl.id = c.cliente_id
   where c.id = NEW.caso_id;

  insert into public.tarefas (
    caso_id, tipo, prioridade, status,
    titulo, descricao, due_at, origem, metadata,
    responsavel_id,                                   -- #357
    processo_admin_id, processo_judicial_id           -- #357
  )
  values (
    NEW.caso_id, 'interna', 2, 'a_fazer',
    'Analisar documento recebido - ' || coalesce(v_cliente, 'cliente'),
    format(
      'O parceiro %s cumpriu a solicitação de "%s". Conferir o documento enviado e validar.',
      coalesce(v_parceiro_nome, '(sem nome)'), v_tipo_label
    ),
    now(),
    'manual',
    jsonb_build_object(
      'origem_solicitacao_documento_id', NEW.id,
      'documento_id', NEW.documento_id,
      'analise_solicitacao', true
    ),
    -- #357: quem foi escolhido em "quem analisa quando voltar"; null mantém o
    -- comportamento antigo (tarefa sem dono, a equipe distribui).
    NEW.responsavel_id,
    NEW.processo_admin_id, NEW.processo_judicial_id
  );

  return NEW;
end;
$function$;

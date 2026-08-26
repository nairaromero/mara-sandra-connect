-- =============================================================================
-- Migration: solicitação INTERNA com responsável → tarefa pra pessoa
-- (pedido da Naira, 2026-08-26).
--
-- "Quem vai providenciar? Interna" agora escolhe alguém da equipe
-- (solicitacoes_documento.responsavel_id) e o banco abre a tarefa
-- "Providenciar documentos - <cliente>" pra essa pessoa. Quando a
-- solicitação for atendida (ou dispensada), a tarefa fecha sozinha —
-- mesmo padrão da "Aguardando documentos" das exigências.
--
-- Idempotente. SÓ STAGING até a Naira validar o lote.
-- =============================================================================

alter table public.solicitacoes_documento
  add column if not exists responsavel_id uuid references public.usuarios(id);

-- ---------------------------------------------------------------------------
-- 1) Criou solicitação interna com responsável → tarefa de providenciar.
-- ---------------------------------------------------------------------------
create or replace function public._solicitacao_interna_cria_tarefa()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_cliente text;
  v_docs    text;
begin
  if NEW.origem is distinct from 'interna' then return NEW; end if;
  if NEW.responsavel_id is null then return NEW; end if;
  if NEW.caso_id is null then return NEW; end if;

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
    titulo, descricao, due_at, origem, origem_ref, metadata
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
    )
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
$$;

drop trigger if exists trg_solicitacao_interna_tarefa on public.solicitacoes_documento;
create trigger trg_solicitacao_interna_tarefa
  after insert on public.solicitacoes_documento
  for each row execute function public._solicitacao_interna_cria_tarefa();

-- ---------------------------------------------------------------------------
-- 2) Solicitação saiu de pendente (atendida/dispensada) → tarefa fecha.
-- ---------------------------------------------------------------------------
create or replace function public._solicitacao_resolvida_fecha_providenciar()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if NEW.status in ('atendido', 'dispensado')
     and OLD.status is distinct from NEW.status then
    update public.tarefas
       set status = 'feito',
           updated_at = now(),
           completed_at = coalesce(completed_at, now())
     where origem_ref = 'solicitacao:' || NEW.id::text
       and (metadata->>'providenciar_documento')::boolean is true
       and status in ('a_fazer', 'fazendo');
  end if;
  return NEW;
exception when others then
  raise warning '_solicitacao_resolvida_fecha_providenciar falhou (solic %): % / %',
    NEW.id, SQLSTATE, SQLERRM;
  return NEW;
end;
$$;

drop trigger if exists trg_solicitacao_resolvida_fecha_providenciar
  on public.solicitacoes_documento;
create trigger trg_solicitacao_resolvida_fecha_providenciar
  after update of status on public.solicitacoes_documento
  for each row execute function public._solicitacao_resolvida_fecha_providenciar();

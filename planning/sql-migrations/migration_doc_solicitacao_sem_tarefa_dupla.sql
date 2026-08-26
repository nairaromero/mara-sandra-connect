-- =============================================================================
-- Migration: documento de cumprimento de solicitação NÃO gera a tarefa
-- "Analisar documentos juntados pelo parceiro" (feedback da Naira, 2026-08-26).
--
-- O parceiro cumpria uma exigência e nasciam DUAS tarefas: a certa ("Cumprir
-- Exigência INSS/Judicial - <cliente>", do trigger de solicitação) e a
-- genérica de upload ("Analisar documentos juntados…", do trigger de
-- documentos, que não sabia de solicitações). O mesmo acontecia na
-- solicitação avulsa (duplicava com "Analisar documento recebido…").
--
-- Guard novo: documento com solicitacao_id preenchido (vínculo criado pela
-- migration_solicitacao_multiplos_docs) é do fluxo de solicitação — o
-- trigger de upload pula. Upload avulso do parceiro segue criando/agrupando
-- a tarefa como sempre.
--
-- DEPENDE do front multi-documentos (grava solicitacao_id) — sobe pra
-- produção JUNTO com ele, nunca antes. Corpo parte do pg_get_functiondef
-- da produção em 2026-08-26 (idêntico ao do staging, md5 conferido); muda
-- SÓ o guard novo.
--
-- Idempotente.
-- =============================================================================

create or replace function public._documento_parceiro_cria_tarefa()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
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

  -- Docs subidos junto com a criação do caso já são cobertos pela tarefa
  -- "Cliente novo - Parceiro X - Analisar" (janela de 10 minutos).
  if exists (
    select 1
      from public.tarefas t
     where t.caso_id = NEW.caso_id
       and t.status in ('a_fazer', 'fazendo')
       and t.metadata->>'etapa' = 'analise_inicial_parceiro'
       and t.created_at > NEW.created_at - interval '10 minutes'
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
$$;

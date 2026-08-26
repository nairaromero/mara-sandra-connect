-- =============================================================================
-- Migration: UMA solicitação pode pedir VÁRIOS documentos
-- (feedback da Naira, 2026-08-26 — a 1ª versão criava N solicitações
-- separadas e ela quer um pedido só com a lista).
--
-- Modelo: coluna `tipos` jsonb = lista [{tipo, label}] (label já resolvido
-- pelo front — inclui o nome customizado quando tipo=outro). NULL = pedido
-- antigo de um documento só (continua lendo a coluna `tipo`). A coluna
-- `tipo` legada permanece com o PRIMEIRO da lista, então triggers, e-mail,
-- exports e RLS antigos seguem funcionando sem tocar em nada.
--
-- Trigger de análise (_solicitacao_cumprida_parceiro_cria_tarefa): descrição
-- lista todos os documentos pedidos quando houver `tipos`. Corpo parte do
-- estado atual do staging (= migration_titulos_tarefas_cliente, ainda não
-- aplicada em produção); muda SÓ o rótulo dos tipos.
--
-- Idempotente. SÓ STAGING até a Naira validar o lote.
-- =============================================================================

alter table public.solicitacoes_documento
  add column if not exists tipos jsonb;

create or replace function public._solicitacao_cumprida_parceiro_cria_tarefa()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
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
    titulo, descricao, due_at, origem, metadata
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
    )
  );

  return NEW;
end;
$$;

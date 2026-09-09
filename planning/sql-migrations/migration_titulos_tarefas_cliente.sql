-- =============================================================================
-- Migration: títulos das tarefas de documento levam o NOME DO CLIENTE
-- (pedido da Naira, 2026-08-26).
--
--   - Solicitação avulsa cumprida pelo parceiro:
--       "Analisar documento recebido - <cliente>"
--       (o tipo do documento continua na descrição)
--   - Solicitação de template de exigência atendida:
--       "Cumprir Exigência INSS - <cliente>"
--       "Cumprir Exigência Judicial - <cliente>"
--       (antes: "Documento entregue — cumprir exigência no INSS" /
--        "— juntar aos autos (exigência judicial)")
--
-- Corpos partem do pg_get_functiondef da PRODUÇÃO em 2026-08-26 (regra da
-- casa): _solicitacao_atendida_cria_tarefa como deixou a
-- migration_fix_review_lote_agosto (verificada por hash nos dois bancos);
-- _solicitacao_cumprida_parceiro_cria_tarefa como deixou a
-- migration_tarefa_analise_solicitacao_parceiro. Muda SÓ: busca do nome do
-- cliente + os títulos. Descrições, metadata, dedup e o fechamento da
-- "Aguardando documentos" ficam idênticos.
--
-- Idempotente.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1) Exigência (template INSS/Judicial) atendida.
-- ---------------------------------------------------------------------------
create or replace function public._solicitacao_atendida_cria_tarefa()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_tipo_label text;
  v_template   text;
  v_judicial   boolean;
  v_cliente    text;
begin
  if (OLD.status is distinct from NEW.status) and NEW.status = 'atendido'
     and NEW.origem is not null and NEW.origem like 'template:%' then

    v_tipo_label := coalesce(NEW.tipo::text, 'documento');
    v_template   := split_part(NEW.origem, ':', 2);
    v_judicial   := (v_template = 'exigencia_judicial');

    select cl.nome into v_cliente
      from public.casos c
      join public.clientes cl on cl.id = c.cliente_id
     where c.id = NEW.caso_id;

    -- 1) Andamento visível ao parceiro: avisa que recebemos.
    insert into public.andamentos (
      caso_id, origem, titulo, descricao, data_evento, visivel_parceiro, metadata
    )
    values (
      NEW.caso_id, 'interno',
      case when v_judicial
           then 'Documento entregue pelo Parceiro — iremos juntar aos autos'
           else 'Documento entregue pelo Parceiro — iremos cumprir a exigência' end,
      'Recebemos o documento "' || v_tipo_label || '" entregue pelo parceiro. ' ||
      case when v_judicial
           then 'Iremos peticionar a juntada no processo e informaremos em breve.'
           else 'Iremos cumprir a exigência no INSS e informaremos em breve.' end,
      now(), true,
      jsonb_build_object(
        'origem_solicitacao_documento_id', NEW.id,
        'origem_template', NEW.origem,
        'etapa', 'documento_recebido'
      )
    );

    -- 2) Tarefa pro interno — título com o nome do cliente; INSS leva o
    --    checklist de cumprimento (cumprimento_exigencia=true).
    insert into public.tarefas (
      caso_id, tipo, prioridade, status,
      titulo, descricao, due_at, origem, metadata
    )
    values (
      NEW.caso_id, 'interna', 1, 'a_fazer',
      case when v_judicial
           then 'Cumprir Exigência Judicial - ' || coalesce(v_cliente, 'cliente')
           else 'Cumprir Exigência INSS - ' || coalesce(v_cliente, 'cliente') end,
      format(
        case when v_judicial
             then 'O parceiro entregou o documento "%s" solicitado. Peticionar a juntada no processo o quanto antes.'
             else 'O parceiro entregou o documento "%s" solicitado. Cumprir a exigência no Meu INSS o quanto antes.' end,
        v_tipo_label
      ),
      now(),
      'manual',
      jsonb_build_object(
        'origem_solicitacao_documento_id', NEW.id,
        'origem_template', NEW.origem,
        'template_aplicado', v_template
      ) || case when v_judicial then '{}'::jsonb
                else jsonb_build_object('cumprimento_exigencia', true) end
    );

    -- 3) Fecha a "Aguardando documentos…" do mesmo caso/template.
    update public.tarefas
       set status = 'feito',
           updated_at = now(),
           completed_at = coalesce(completed_at, now())
     where caso_id = NEW.caso_id
       and status = 'a_fazer'
       and metadata->>'template_aplicado' = v_template
       and titulo ilike 'Aguardando documentos%';
  end if;
  return NEW;
end;
$$;

-- ---------------------------------------------------------------------------
-- 2) Solicitação avulsa cumprida pelo parceiro → tarefa de análise.
-- ---------------------------------------------------------------------------
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

  v_tipo_label := initcap(replace(coalesce(NEW.tipo::text, 'documento'), '_', ' '));

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

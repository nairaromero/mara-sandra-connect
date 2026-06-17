-- migration_trigger_cumprimento_andamento.sql
--
-- Expande o trigger _solicitacao_atendida_cria_tarefa pra também:
--  - Criar andamento visível ao parceiro "Documento entregue pelo Parceiro
--    - Iremos cumprir a Exigência e informaremos em breve" (notifica
--    parceiro por e-mail via notify-novo-andamento, igual aos outros).
--  - Adicionar metadata.cumprimento_exigencia=true na tarefa "Documento
--    entregue" pra o frontend renderizar o checklist "Exigência Cumprida".
--  - Adicionar metadata.template_aplicado=<template> pra facilitar match
--    com a tarefa FATAL ao concluir.
--
-- Idempotente.

CREATE OR REPLACE FUNCTION public._solicitacao_atendida_cria_tarefa()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
declare
  v_tipo_label text;
  v_template text;
  v_andamento_id uuid;
begin
  if (OLD.status is distinct from NEW.status) and NEW.status = 'atendido'
     and NEW.origem is not null and NEW.origem like 'template:%' then

    v_tipo_label := coalesce(NEW.tipo::text, 'documento');
    v_template := split_part(NEW.origem, ':', 2);

    -- 1) Andamento visível ao parceiro: avisa que recebemos.
    insert into public.andamentos (
      caso_id, origem, titulo, descricao,
      data_evento, visivel_parceiro, metadata
    )
    values (
      NEW.caso_id, 'interno',
      'Documento entregue pelo Parceiro — iremos cumprir a exigência',
      'Recebemos o documento "' || v_tipo_label || '" entregue pelo parceiro. ' ||
      'Iremos cumprir a exigência no INSS e informaremos em breve.',
      now(), true,
      jsonb_build_object(
        'origem_solicitacao_documento_id', NEW.id,
        'origem_template', NEW.origem,
        'etapa', 'documento_recebido'
      )
    )
    returning id into v_andamento_id;

    -- Notifica parceiro por e-mail (fire-and-forget via http extension não
    -- está disponível; ficará pra o handler do app processar a fila ou via
    -- listener de andamentos). O trigger só cria o registro.

    -- 2) Tarefa pra interno cumprir exigência no INSS — com flag
    -- cumprimento_exigencia=true pra UI renderizar checklist.
    insert into public.tarefas (
      caso_id, tipo, prioridade, status,
      titulo, descricao, due_at, origem, metadata
    )
    values (
      NEW.caso_id, 'interna', 1, 'a_fazer',
      'Documento entregue — cumprir exigência no INSS',
      format(
        'O parceiro entregou o documento "%s" solicitado. Cumprir a exigência no Meu INSS o quanto antes.',
        v_tipo_label
      ),
      now(),
      'manual',
      jsonb_build_object(
        'origem_solicitacao_documento_id', NEW.id,
        'origem_template', NEW.origem,
        'template_aplicado', v_template,
        'cumprimento_exigencia', true
      )
    );

    -- 3) Fecha a "Aguardando documentos do parceiro" do mesmo caso/template
    update public.tarefas
    set status = 'feito',
        updated_at = now()
    where caso_id = NEW.caso_id
      and status = 'a_fazer'
      and metadata->>'template_aplicado' = v_template
      and titulo ilike 'Aguardando documentos%';
  end if;
  return NEW;
end;
$function$;

-- migration_fechar_aguardando_documentos.sql
--
-- Quando solicitação de documento vai pra 'atendido', além de criar a
-- tarefa "Documento entregue — cumprir exigência no INSS" (já fazia),
-- agora também marca como 'feito' a tarefa "Aguardando documentos do
-- parceiro" daquele mesmo caso e template — ela vira redundante assim
-- que o parceiro entrega.
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
begin
  if (OLD.status is distinct from NEW.status) and NEW.status = 'atendido'
     and NEW.origem is not null and NEW.origem like 'template:%' then

    v_tipo_label := coalesce(NEW.tipo::text, 'documento');
    v_template := split_part(NEW.origem, ':', 2);  -- ex: 'exigencia'

    -- 1) Cria tarefa pra interno cumprir exigência no INSS
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
        'origem_template', NEW.origem
      )
    );

    -- 2) Fecha a "Aguardando documentos do parceiro" do mesmo caso/template
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

-- Tarefas independentes POR PROCESSO (#397, Mara 25/09).
--
-- "O requerimento 1 não pode atrapalhar as tarefas do requerimento 2, nem os
-- requerimentos o processo judicial": nada que fecha/conclui tarefa pode
-- alcançar a tarefa de OUTRO processo do mesmo caso.
--
--   1. _solicitacao_atendida_cria_tarefa: o documento entregue fecha só o
--      "Aguardando documentos" da mesma exigência (mesmo processo), e o
--      andamento "Documento entregue" cai no processo dela. Conserta também
--      o que o robô do e-mail INSS cria: ele grava `metadata.template`, e o
--      fechamento só olhava `template_aplicado` — o Aguardando dele nunca
--      fechava.
--   2. tg_pericia_aviso_enviado: o aviso da perícia conclui só o "Avisar
--      cliente da perícia" do mesmo processo.
--
-- Corpo de cada função = pg_get_functiondef do STAGING (cópia local de
-- 25/09) + só os filtros acima. Antes de produção: conferir que o corpo de
-- produção é o mesmo (hash staging × prod).
--
-- Idempotente.

CREATE OR REPLACE FUNCTION public._solicitacao_atendida_cria_tarefa()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
      caso_id, origem, titulo, descricao, data_evento, visivel_parceiro, metadata,
      processo_admin_id, processo_judicial_id                  -- #397: no processo da exigência
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
      ),
      NEW.processo_admin_id, NEW.processo_judicial_id
    );

    -- 2) Tarefa pro interno — título com o nome do cliente; INSS leva o
    --    checklist de cumprimento (cumprimento_exigencia=true).
    insert into public.tarefas (
      caso_id, tipo, prioridade, status,
      titulo, descricao, due_at, origem, metadata,
      responsavel_id,                                   -- #357
      processo_admin_id, processo_judicial_id           -- #357
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
                else jsonb_build_object('cumprimento_exigencia', true) end,
      -- #357: quem foi escolhido no pedido ("quem cuida quando o documento
      -- voltar") assume também o cumprimento da exigência. Null = escada de
      -- sempre (`_tarefas_set_responsavel`).
      NEW.responsavel_id,
      NEW.processo_admin_id, NEW.processo_judicial_id
    );

    -- 3) Fecha a "Aguardando documentos…" DESTA exigência: mesmo caso,
    --    template e PROCESSO (#397 — a exigência de um requerimento não fecha
    --    a de outro nem a do judicial). O robô do e-mail INSS grava
    --    metadata.template, a tela metadata.template_aplicado: vale qualquer um.
    update public.tarefas
       set status = 'feito',
           updated_at = now(),
           completed_at = coalesce(completed_at, now())
     where caso_id = NEW.caso_id
       and status = 'a_fazer'
       and coalesce(metadata->>'template_aplicado', metadata->>'template') = v_template
       and processo_admin_id is not distinct from NEW.processo_admin_id
       and processo_judicial_id is not distinct from NEW.processo_judicial_id
       and titulo ilike 'Aguardando documentos%';
  end if;
  return NEW;
end;
$function$;

CREATE OR REPLACE FUNCTION public.tg_pericia_aviso_enviado()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_ev      record;
  v_cliente text;
  v_quando  text;
  v_rotulo  text;
begin
  if TG_OP = 'UPDATE' then
    if not (old.rascunho is true and new.rascunho is false) then return new; end if;
  else
    if new.rascunho is not false then return new; end if;
  end if;
  if new.evento_id is null then return new; end if;
  if new.tipo_aviso not in
     ('pericia_aviso', 'pericia_lembrete', 'audiencia_aviso', 'audiencia_lembrete')
  then return new; end if;

  select e.id, e.start_at, e.local, e.caso_id, e.tipo,
         e.processo_admin_id, e.processo_judicial_id
    into v_ev
    from public.agenda_eventos e
   where e.id = new.evento_id;
  if not found or v_ev.tipo not in ('pericia', 'audiencia') then return new; end if;

  select cl.nome into v_cliente
    from public.casos c join public.clientes cl on cl.id = c.cliente_id
   where c.id = v_ev.caso_id;

  v_quando := to_char(v_ev.start_at at time zone 'America/Sao_Paulo', 'DD/MM/YYYY " às " HH24:MI');
  v_rotulo := case when v_ev.tipo = 'audiencia' then 'audiência' else 'perícia' end;

  insert into public.andamentos
    (caso_id, origem, titulo, descricao, data_evento, criado_por,
     visivel_parceiro, processo_admin_id, processo_judicial_id, metadata)
  values (
    v_ev.caso_id,
    'interno',
    case when new.tipo_aviso like '%_aviso'
         then 'Parceiro comunicado da ' || v_rotulo
         else 'Parceiro lembrado da ' || v_rotulo end,
    case when new.tipo_aviso like '%_aviso'
         then 'O parceiro foi comunicado da ' || v_rotulo || ' de ' || coalesce(v_cliente, 'cliente')
         else 'Enviado lembrete ao parceiro sobre a ' || v_rotulo || ' de ' || coalesce(v_cliente, 'cliente') end
      || ' marcada para ' || v_quando
      || coalesce(' — ' || nullif(btrim(v_ev.local), ''), '') || '.',
    now(),
    new.autor_id,
    true,
    v_ev.processo_admin_id,
    v_ev.processo_judicial_id,
    jsonb_build_object('evento_id', v_ev.id, 'tipo_aviso', new.tipo_aviso)
  );

  -- Legado: só o aviso de PERÍCIA conclui "Avisar cliente da perícia" —
  -- audiencia_aviso fechava tarefa dos outros (review #5).
  if new.tipo_aviso = 'pericia_aviso' then
    -- #397: só a do MESMO processo da perícia (a de outro processo segue).
    update public.tarefas
       set status = 'feito', completed_at = coalesce(completed_at, now())
     where caso_id = v_ev.caso_id
       and status in ('a_fazer', 'fazendo')
       and processo_admin_id is not distinct from v_ev.processo_admin_id
       and processo_judicial_id is not distinct from v_ev.processo_judicial_id
       and titulo ilike 'Avisar cliente da perícia%';
  end if;

  return new;
exception when others then
  raise warning 'tg_pericia_aviso_enviado falhou (comentario %): % / %',
    new.id, SQLSTATE, SQLERRM;
  return new;
end;
$function$;

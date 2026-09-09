-- =============================================================================
-- Migration: correções do code review do lote de agosto (2026-08-25).
--
-- #1 TRIGGER DE EXIGÊNCIA — o rewrite de 2026-08-24 partiu da migration de
--    junho (pipeline) e não da função VIVA, que tinha evoluído em
--    migration_trigger_cumprimento_andamento. Restaura os 3 comportamentos
--    perdidos, mantendo a variação INSS × judicial de ontem:
--      1) andamento visível ao parceiro "Documento entregue pelo Parceiro…";
--      2) metadata.cumprimento_exigencia=true + template_aplicado na tarefa
--         (o checklist "Exigência Cumprida" da UI depende disso);
--      3) fechamento da "Aguardando documentos…" do mesmo caso/template.
--    Lição registrada: função de banco se reescreve a partir de
--    pg_get_functiondef da produção, nunca do arquivo mais antigo.
--
-- #5 AVISO DE AUDIÊNCIA — tg_pericia_aviso_enviado concluía a tarefa legada
--    "Avisar cliente da perícia%" pra QUALQUER '%_aviso' (audiência
--    inclusive). Agora só pericia_aviso conclui.
--
-- (#6, o anti-spam que engolia 2ª perícia publicada, é corrigido direto na
--  migration_pericia_por_publicacao_djen.sql — aquela é só do staging até o
--  lote judicial ser aprovado; este arquivo aqui vai pros DOIS bancos.)
--
-- Idempotente.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- #1 Trigger de exigência completo (3 comportamentos + INSS × judicial)
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
begin
  if (OLD.status is distinct from NEW.status) and NEW.status = 'atendido'
     and NEW.origem is not null and NEW.origem like 'template:%' then

    v_tipo_label := coalesce(NEW.tipo::text, 'documento');
    v_template   := split_part(NEW.origem, ':', 2);
    v_judicial   := (v_template = 'exigencia_judicial');

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

    -- 2) Tarefa pro interno — INSS leva o checklist de cumprimento
    --    (cumprimento_exigencia=true); judicial é peticionar a juntada.
    insert into public.tarefas (
      caso_id, tipo, prioridade, status,
      titulo, descricao, due_at, origem, metadata
    )
    values (
      NEW.caso_id, 'interna', 1, 'a_fazer',
      case when v_judicial
           then 'Documento entregue — juntar aos autos (exigência judicial)'
           else 'Documento entregue — cumprir exigência no INSS' end,
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
-- #5 Só o aviso de PERÍCIA conclui a tarefa legada "Avisar cliente da perícia"
-- ---------------------------------------------------------------------------
create or replace function public.tg_pericia_aviso_enviado()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
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
    update public.tarefas
       set status = 'feito', completed_at = coalesce(completed_at, now())
     where caso_id = v_ev.caso_id
       and status in ('a_fazer', 'fazendo')
       and titulo ilike 'Avisar cliente da perícia%';
  end if;

  return new;
exception when others then
  raise warning 'tg_pericia_aviso_enviado falhou (comentario %): % / %',
    new.id, SQLSTATE, SQLERRM;
  return new;
end;
$$;

-- Perícia: corrige o loop de realimentação que gerava um segundo rascunho
-- idêntico ao aviso, e a tarefa de lembrete que nunca baixava.
--
-- O QUE ACONTECIA (caso ISAEL SEBASTIAO DOS SANTOS, 10/08/2026 04:39):
--
--   1. Equipe envia o rascunho de aviso (tipo_aviso='pericia_aviso').
--   2. tg_pericia_aviso_enviado cria o andamento
--      "Parceiro comunicado da perícia ... marcada para 13/08/2026".
--   3. tg_rascunho_pericia_andamento vê "perícia" + "marcada" nesse andamento
--      e cria OUTRO rascunho — indistinguível do primeiro na fila "A enviar",
--      só que com evento_id=null e tipo_aviso=null.
--   4. A equipe envia esse segundo rascunho achando que é o lembrete. Como
--      evento_id é null, tg_pericia_aviso_enviado sai no primeiro if: nenhum
--      andamento, nenhuma tarefa baixada. O parceiro recebe e-mail repetido.
--
--   O mesmo vale pro andamento "Parceiro lembrado da perícia ... marcada
--   para ...", que dispararia a duplicata de novo no fluxo do lembrete.
--
-- CORREÇÕES:
--   1. O gatilho por palavra-chave ignora andamentos que o próprio fluxo de
--      aviso gerou (metadata tem 'tipo_aviso').
--   2. Enviar o lembrete baixa a tarefa "Lembrar parceiro da perícia".
--
-- Idempotente.

-- ---------------------------------------------------------------------------
-- 1) Gatilho por palavra-chave: não morder o próprio rabo
-- ---------------------------------------------------------------------------
-- Mantém tudo que já existia (djen/datajud, etapa=pericia_agendada, import
-- antigo) e acrescenta a blindagem por 'tipo_aviso'. Vale pra pericia_aviso e
-- pericia_lembrete de uma vez só — e pra qualquer tipo_aviso futuro, que por
-- definição é andamento gerado pelo sistema, não fato novo do processo.
create or replace function public.tg_rascunho_pericia_andamento()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_texto_busca text;
  v_cliente     text;
  v_servico     text;
  v_natureza    text;
  v_ref         text;
  v_texto       text;
begin
  if new.caso_id is null then return new; end if;
  if new.origem in ('djen', 'datajud') then return new; end if;
  if new.metadata->>'etapa' = 'pericia_agendada' then return new; end if;
  -- Andamento nascido do envio de aviso/lembrete de perícia: é consequência do
  -- rascunho, não motivo pra criar outro. Sem isso, enviar o aviso gera um
  -- rascunho novo, que ao ser enviado gera outro andamento, e assim por diante.
  if new.metadata ? 'tipo_aviso' then return new; end if;
  if new.data_evento is not null and new.data_evento < (now() - interval '30 days') then
    return new;
  end if;

  v_texto_busca := coalesce(new.titulo, '') || ' ' || coalesce(new.descricao, '');
  if not (v_texto_busca ~* 'per[ií]cia'
          and v_texto_busca ~* '(marcad|agendad|reagendad|remarcad|designad)') then
    return new;
  end if;

  select cl.nome, c.tipo_beneficio
    into v_cliente, v_servico
    from public.casos c
    join public.clientes cl on cl.id = c.cliente_id
   where c.id = new.caso_id;

  v_natureza := case
    when new.processo_judicial_id is not null then 'judicial'
    when new.processo_admin_id is not null then 'admin'
    when v_texto_busca ~* 'judicial' then 'judicial'
    else 'admin' end;

  v_ref := coalesce(new.titulo, '') ||
    case when new.descricao is not null and new.descricao <> new.titulo
         then chr(10) || left(new.descricao, 400) else '' end;

  v_texto := public.pericia_draft_texto(
    v_natureza, v_cliente, v_servico, null, null, null, null
  );
  if btrim(v_ref) <> '' then
    v_texto := v_texto || chr(10) || chr(10) ||
      '— Referência (andamento): ' || v_ref;
  end if;

  -- tipo_aviso fica null de propósito: este rascunho não tem evento de agenda
  -- por trás, então tg_pericia_aviso_enviado não age sobre ele. Marcar como
  -- 'pericia_aviso' faria a UI prometer um pós-envio que não vai acontecer.
  insert into public.comentarios (caso_id, autor_id, texto, rascunho, andamento_id)
  values (new.caso_id, null, v_texto, true, new.id)
  on conflict (andamento_id) do nothing;

  return new;
exception when others then
  return new;
end;
$function$;

-- ---------------------------------------------------------------------------
-- 2) Enviar o lembrete baixa a tarefa "Lembrar parceiro da perícia"
-- ---------------------------------------------------------------------------
-- Antes, o `return new` do lembrete vinha logo depois do andamento, então a
-- tarefa criada no primeiro aviso ficava aberta pra sempre. Agora cada aviso
-- baixa a sua tarefa correspondente; só a criação da tarefa de lembrete segue
-- exclusiva do primeiro aviso.
create or replace function public.tg_pericia_aviso_enviado()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
declare
  v_ev        record;
  v_cliente   text;
  v_quando    text;
  v_data_lemb date;
  v_resp      uuid;
begin
  -- So no instante em que o rascunho vira comentario de verdade.
  if not (old.rascunho is true and new.rascunho is false) then return new; end if;
  if new.evento_id is null then return new; end if;
  if new.tipo_aviso not in ('pericia_aviso', 'pericia_lembrete') then return new; end if;

  select e.id, e.start_at, e.local, e.caso_id, e.tipo,
         e.processo_admin_id, e.processo_judicial_id
    into v_ev
    from public.agenda_eventos e
   where e.id = new.evento_id;
  if not found or v_ev.tipo is distinct from 'pericia' then return new; end if;

  select cl.nome into v_cliente
    from public.casos c join public.clientes cl on cl.id = c.cliente_id
   where c.id = v_ev.caso_id;

  v_quando := to_char(v_ev.start_at at time zone 'America/Sao_Paulo', 'DD/MM/YYYY " às " HH24:MI');

  -- Andamento (visivel ao parceiro nos dois casos, decisao da Naira).
  -- metadata.tipo_aviso é o que impede tg_rascunho_pericia_andamento de gerar
  -- um rascunho novo a partir deste andamento.
  insert into public.andamentos
    (caso_id, origem, titulo, descricao, data_evento, criado_por,
     visivel_parceiro, processo_admin_id, processo_judicial_id, metadata)
  values (
    v_ev.caso_id,
    'interno',
    case when new.tipo_aviso = 'pericia_aviso'
         then 'Parceiro comunicado da perícia'
         else 'Parceiro lembrado da perícia' end,
    case when new.tipo_aviso = 'pericia_aviso'
         then 'O parceiro foi comunicado da perícia de ' || coalesce(v_cliente, 'cliente')
         else 'Enviado lembrete ao parceiro sobre a perícia de ' || coalesce(v_cliente, 'cliente') end
      || ' marcada para ' || v_quando
      || coalesce(' — ' || nullif(btrim(v_ev.local), ''), '') || '.',
    now(),
    new.autor_id,
    true,
    v_ev.processo_admin_id,
    v_ev.processo_judicial_id,
    jsonb_build_object('evento_id', v_ev.id, 'tipo_aviso', new.tipo_aviso)
  );

  -- Lembrete enviado: a tarefa "Lembrar parceiro da perícia" cumpriu seu papel.
  -- Casada por origem_ref (evento), não por título, pra não baixar a tarefa de
  -- outra perícia do mesmo caso.
  if new.tipo_aviso = 'pericia_lembrete' then
    update public.tarefas
       set status = 'feito', completed_at = coalesce(completed_at, now())
     where caso_id = v_ev.caso_id
       and status in ('a_fazer', 'fazendo')
       and origem = 'pericia_lembrete'
       and origem_ref = 'evento:' || v_ev.id::text;
    return new;
  end if;

  -- Daqui pra baixo, só o primeiro aviso.

  -- "Avisar cliente da pericia" cumpriu seu papel: some da lista ativa.
  update public.tarefas
     set status = 'feito', completed_at = coalesce(completed_at, now())
   where caso_id = v_ev.caso_id
     and status in ('a_fazer', 'fazendo')
     and titulo ilike 'Avisar cliente da perícia%'
  returning responsavel_id into v_resp;

  -- Tarefa de lembrete, com prazo na sexta anterior a pericia.
  v_data_lemb := public.pericia_data_lembrete(v_ev.start_at);

  insert into public.tarefas
    (caso_id, responsavel_id, tipo, status, prioridade, titulo, descricao,
     due_at, origem, origem_ref, metadata)
  select
    v_ev.caso_id,
    coalesce(v_resp, new.autor_id),
    'contato_cliente',
    'a_fazer',
    1,
    'Lembrar parceiro da perícia - ' || coalesce(v_cliente, 'cliente'),
    'Enviar lembrete ao parceiro sobre a perícia de ' || v_quando
      || '. O rascunho aparece sozinho na fila "A enviar" nesta data.',
    (v_data_lemb + time '09:00') at time zone 'America/Sao_Paulo',
    'pericia_lembrete',
    'evento:' || v_ev.id::text,
    jsonb_build_object('evento_id', v_ev.id, 'pericia_em', v_ev.start_at)
  where not exists (
    select 1 from public.tarefas t
     where t.origem = 'pericia_lembrete'
       and t.origem_ref = 'evento:' || v_ev.id::text
  );

  return new;
exception when others then
  -- Nunca derrubar o envio do comentario por causa do pos-processamento —
  -- mas deixar rastro, senao uma falha aqui vira silencio absoluto (foi o
  -- que aconteceu com a check constraint de tarefas.origem no 1o teste).
  raise warning 'tg_pericia_aviso_enviado falhou (comentario %): % / %',
    new.id, SQLSTATE, SQLERRM;
  return new;
end;
$function$;

-- =============================================================================
-- Migration: comunicação de perícia/audiência SEM a fila /a-enviar
-- (reunião de agosto/2026 + decisão da Naira em 2026-08-24).
--
-- ANTES: evento de perícia criado → comentário-RASCUNHO na fila /a-enviar →
-- equipe abre a página, revisa e envia → trigger cria andamento + tarefa de
-- lembrete → job diário cria OUTRO rascunho de lembrete na fila → equipe envia.
-- A fila virou passo extra e vivia esquecida (rascunho errado já foi enviado).
--
-- AGORA:
--   1. AVISO ao agendar: quem agenda revisa o texto NO PRÓPRIO formulário e o
--      aviso sai na hora (comentário direto + e-mail). O evento ganha
--      metadata.aviso_direto=true.
--   2. Evento criado por fora da UI (sync, RPC) ou com o aviso desmarcado:
--      nasce uma TAREFA "Enviar aviso ao parceiro" com o texto padrão no
--      metadata — o envio acontece por um botão dentro da própria tarefa.
--   3. Publicação/andamento com "perícia marcada" ou "audiência designada":
--      idem — TAREFA com texto pronto, não mais rascunho na fila.
--   4. LEMBRETE: automático. O job diário envia sozinho (comentário direto +
--      e-mail via pg_net). Perícia: na última sexta antes; audiência: na
--      véspera. Sem tarefa humana de lembrete.
--   5. Templates novos: pericia_judicial e audiencia_judicial; o
--      pericia_parceiro (ADM) perde o item "Avisar cliente" (aviso é
--      automático) e o título do evento ganha "INSS" (natureza explícita).
--
-- O e-mail do job diário usa app_config.edge_base_url — SEEDAR POR AMBIENTE
-- após aplicar (o arquivo é o mesmo nos dois):
--   staging: insert into app_config values ('edge_base_url',
--     'https://alhqbpbekmxpoibrrnbi.supabase.co/functions/v1')
--     on conflict (chave) do update set valor = excluded.valor;
--   prod:    idem com llugytkdsfsrciavhrfw.
--
-- Idempotente.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 0. Config por ambiente (URL das edge functions pro pg_net)
-- ---------------------------------------------------------------------------
create table if not exists public.app_config (
  chave text primary key,
  valor text not null
);
alter table public.app_config enable row level security;
-- Sem policies: só funções SECURITY DEFINER leem.

-- ---------------------------------------------------------------------------
-- 1. tarefas.origem aceita 'enviar_aviso'
-- ---------------------------------------------------------------------------
alter table public.tarefas drop constraint if exists tarefas_origem_check;
alter table public.tarefas add constraint tarefas_origem_check
  check (origem = any (array[
    'manual', 'template', 'sync_inss_email', 'sync_djen', 'sync_legalmail',
    'migracao_ti', 'ia', 'pericia_lembrete', 'pericia_acompanhamento',
    'implementacao_acompanhamento', 'enviar_aviso'
  ]));

-- ---------------------------------------------------------------------------
-- 2. Textos padrão de AUDIÊNCIA (espelham os de perícia)
-- ---------------------------------------------------------------------------
create or replace function public.audiencia_draft_texto(
  p_cliente text, p_quando timestamptz, p_local text
) returns text
language plpgsql
immutable
set search_path = public, pg_temp
as $$
declare
  v_data text;
  v_hora text;
  v_dow  int;
  v_dia  text;
begin
  if p_quando is not null then
    v_dow := extract(dow from (p_quando at time zone 'America/Sao_Paulo'))::int;
    v_dia := case v_dow
      when 0 then 'domingo'       when 1 then 'segunda-feira'
      when 2 then 'terça-feira'   when 3 then 'quarta-feira'
      when 4 then 'quinta-feira'  when 5 then 'sexta-feira'
      when 6 then 'sábado' end;
    v_data := to_char(p_quando at time zone 'America/Sao_Paulo', 'DD/MM/YYYY')
              || ' (' || v_dia || ')';
    v_hora := to_char(p_quando at time zone 'America/Sao_Paulo', 'HH24:MI');
  else
    v_data := '_____';
    v_hora := '_____';
  end if;

  return
    '⚖️ AUDIÊNCIA MARCADA' || chr(10) || chr(10) ||
    '👤 Cliente: ' || coalesce(nullif(btrim(p_cliente), ''), '_____') || chr(10) || chr(10) ||
    '📅 Data: '    || v_data || chr(10) ||
    '⏰ Horário: ' || v_hora || chr(10) ||
    '📍 Local: '   || coalesce(nullif(btrim(p_local), ''), '_____') || chr(10) || chr(10) ||
    '📌 Orientações ao cliente:' || chr(10) ||
    '• Chegar com 30 min de antecedência' || chr(10) ||
    '• Levar documento oficial com foto' || chr(10) ||
    '• Vestir-se adequadamente para o ato' || chr(10) ||
    '• Se houver testemunhas, elas também devem chegar com antecedência' || chr(10) || chr(10) ||
    '✅ Favor confirmar que o cliente está ciente e comparecerá.';
end;
$$;

create or replace function public.audiencia_lembrete_texto(
  p_cliente text, p_quando timestamptz, p_local text
) returns text
language plpgsql
immutable
set search_path = public, pg_temp
as $$
declare
  v_data text;
  v_hora text;
begin
  if p_quando is not null then
    v_data := to_char(p_quando at time zone 'America/Sao_Paulo', 'DD/MM/YYYY');
    v_hora := to_char(p_quando at time zone 'America/Sao_Paulo', 'HH24:MI');
  else
    v_data := '_____';
    v_hora := '_____';
  end if;

  return
    '🔔 LEMBRETE — AUDIÊNCIA' || chr(10) || chr(10) ||
    'Passando pra lembrar da audiência que se aproxima.' || chr(10) || chr(10) ||
    '👤 Cliente: ' || coalesce(nullif(btrim(p_cliente), ''), '_____') || chr(10) ||
    '📅 Data: '    || v_data || chr(10) ||
    '⏰ Horário: ' || v_hora || chr(10) ||
    '📍 Local: '   || coalesce(nullif(btrim(p_local), ''), '_____') || chr(10) || chr(10) ||
    '📌 Reforçar com o cliente: chegar com 30 min de antecedência, levar ' ||
    'documento com foto e avisar as testemunhas (se houver).' || chr(10) || chr(10) ||
    '✅ Favor confirmar que o cliente está ciente e comparecerá.';
end;
$$;

-- Véspera da audiência (Brasília); nunca no passado.
create or replace function public.audiencia_data_lembrete(p_quando timestamptz)
returns date
language sql
stable
set search_path = public, pg_temp
as $$
  select greatest(
    ((p_quando at time zone 'America/Sao_Paulo')::date - 1),
    (now() at time zone 'America/Sao_Paulo')::date
  );
$$;

-- ---------------------------------------------------------------------------
-- 3. Templates
-- ---------------------------------------------------------------------------
-- 3a. Perícia ADM: sem o item "Avisar cliente" (o aviso agora é automático no
--     agendamento) e com "INSS" no título do evento (natureza explícita).
update public.tarefa_templates
   set rotulo = 'Perícia INSS',
       itens = '[
     {
       "destino": "agenda",
       "tipo": "pericia",
       "titulo": "Perícia INSS - {nome_cliente}",
       "descricao": "Perícia médica do INSS.",
       "duracao_min": 60
     },
     {
       "destino": "tarefa",
       "tipo": "contato_cliente",
       "titulo": "Confirmar comparecimento na perícia - {nome_cliente}",
       "descricao": "Confirmar com o parceiro indicador se o cliente compareceu à perícia e como foi o atendimento.",
       "prioridade": 2,
       "due_relative_to": "agenda",
       "offset_dias": 1,
       "meta": {"confirmar_comparecimento": true},
       "executor_email": "nairaromerovian@gmail.com",
       "interessados_emails": ["marasandra.adv@gmail.com"]
     },
     {
       "destino": "tarefa",
       "tipo": "contato_cliente",
       "titulo": "Conferir resultado da perícia - {nome_cliente}",
       "descricao": "Conferir se o resultado da perícia saiu. Se ainda não saiu, use o botão para reagendar a próxima conferência em 10 dias.",
       "prioridade": 2,
       "due_relative_to": "agenda",
       "offset_dias": 10,
       "meta": {"acompanhamento_pericia": true},
       "executor_email": "nairaromerovian@gmail.com",
       "interessados_emails": ["marasandra.adv@gmail.com"]
     }
   ]'::jsonb,
       updated_at = now()
 where nome = 'pericia_parceiro';

-- 3b. Perícia Judicial ("Judicial" no título garante a natureza; melhor ainda
--     é vincular o processo judicial ao agendar).
insert into public.tarefa_templates (nome, rotulo, gatilho, descricao, itens, oculto_na_ui)
values (
  'pericia_judicial',
  'Perícia Judicial',
  'pericia_judicial',
  'Perícia determinada pelo juízo: aviso automático ao parceiro no agendamento, lembrete automático na sexta anterior, comparecimento D+1 e conferência do laudo de 10 em 10 dias.',
  '[
    {
      "destino": "agenda",
      "tipo": "pericia",
      "titulo": "Perícia Judicial - {nome_cliente}",
      "descricao": "Perícia judicial determinada pelo juízo.",
      "duracao_min": 60
    },
    {
      "destino": "tarefa",
      "tipo": "contato_cliente",
      "titulo": "Confirmar comparecimento na perícia judicial - {nome_cliente}",
      "descricao": "Confirmar com o parceiro indicador se o cliente compareceu à perícia judicial e como foi o atendimento.",
      "prioridade": 2,
      "due_relative_to": "agenda",
      "offset_dias": 1,
      "meta": {"confirmar_comparecimento": true}
    },
    {
      "destino": "tarefa",
      "tipo": "contato_cliente",
      "titulo": "Conferir laudo da perícia judicial - {nome_cliente}",
      "descricao": "Conferir se o laudo saiu nos autos. Se ainda não saiu, use o botão para reagendar a próxima conferência em 10 dias. Quando sair, comunicar o parceiro.",
      "prioridade": 2,
      "due_relative_to": "agenda",
      "offset_dias": 10,
      "meta": {"acompanhamento_pericia": true}
    }
  ]'::jsonb,
  false
)
on conflict (nome) do update set
  rotulo = excluded.rotulo,
  gatilho = excluded.gatilho,
  descricao = excluded.descricao,
  itens = excluded.itens,
  -- re-rodar em producao NAO pode desocultar template escondido de proposito
  -- (review #7): preserva o oculto_na_ui que o ambiente ja tem.
  oculto_na_ui = tarefa_templates.oculto_na_ui,
  updated_at = now();

-- 3c. Audiência Judicial (preparação D-3, registro D+1, ata/sentença D+10;
--     aviso e lembrete de véspera são automáticos, sem tarefa humana).
insert into public.tarefa_templates (nome, rotulo, gatilho, descricao, itens, oculto_na_ui)
values (
  'audiencia_judicial',
  'Audiência Judicial',
  'audiencia_judicial',
  'Audiência marcada: aviso automático ao parceiro no agendamento, lembrete automático na véspera, preparação D-3, registro do ato D+1 e acompanhamento de ata/sentença.',
  '[
    {
      "destino": "agenda",
      "tipo": "audiencia",
      "titulo": "Audiência - {nome_cliente}",
      "descricao": "Audiência judicial.",
      "duracao_min": 60
    },
    {
      "destino": "tarefa",
      "tipo": "interna",
      "titulo": "Preparar audiência - {nome_cliente}",
      "descricao": "Revisar o processo, separar documentos e provas, alinhar com o parceiro a preparação do cliente (e testemunhas, se houver).",
      "prioridade": 1,
      "due_relative_to": "agenda",
      "offset_dias": -3
    },
    {
      "destino": "tarefa",
      "tipo": "contato_cliente",
      "titulo": "Registrar como foi a audiência - {nome_cliente}",
      "descricao": "Registrar o que aconteceu na audiência (acordo? instrução? sentença em audiência?), o que ficou pendente, e comunicar o parceiro.",
      "prioridade": 1,
      "due_relative_to": "agenda",
      "offset_dias": 1
    },
    {
      "destino": "tarefa",
      "tipo": "contato_cliente",
      "titulo": "Acompanhar ata/sentença da audiência - {nome_cliente}",
      "descricao": "Conferir se a ata e a sentença/decisão saíram nos autos. Se ainda não saíram, empurre o prazo em +10 dias. Quando sair, comunicar o parceiro.",
      "prioridade": 2,
      "due_relative_to": "agenda",
      "offset_dias": 10
    }
  ]'::jsonb,
  false
)
on conflict (nome) do update set
  rotulo = excluded.rotulo,
  gatilho = excluded.gatilho,
  descricao = excluded.descricao,
  itens = excluded.itens,
  -- re-rodar em producao NAO pode desocultar template escondido de proposito
  -- (review #7): preserva o oculto_na_ui que o ambiente ja tem.
  oculto_na_ui = tarefa_templates.oculto_na_ui,
  updated_at = now();

-- ---------------------------------------------------------------------------
-- 4. Envio do aviso/lembrete (comentário sai) → andamento visível ao parceiro
--    Agora dispara também no INSERT direto (rascunho=false) e cobre audiência.
--    NÃO cria mais a tarefa humana de lembrete: o lembrete é automático (§6).
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

  -- Legado: se ainda existir a antiga tarefa "Avisar cliente da perícia",
  -- o envio do aviso a conclui (templates novos não a criam mais).
  if new.tipo_aviso like '%_aviso' then
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

drop trigger if exists trg_pericia_aviso_enviado on public.comentarios;
create trigger trg_pericia_aviso_enviado
  after insert or update on public.comentarios
  for each row execute function public.tg_pericia_aviso_enviado();

-- ---------------------------------------------------------------------------
-- 5. Evento criado SEM aviso direto → TAREFA "Enviar aviso ao parceiro"
--    (substitui o rascunho na fila; cobre perícia E audiência)
-- ---------------------------------------------------------------------------
create or replace function public.tg_rascunho_pericia_evento()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_parceiro uuid;
  v_cliente  text;
  v_servico  text;
  v_natureza text;
  v_texto    text;
  v_rotulo   text;
  v_aviso    text;
begin
  if new.tipo not in ('pericia', 'audiencia') then return new; end if;
  if new.caso_id is null then return new; end if;
  if new.restrito_a is not null then return new; end if;
  -- A UI que envia o aviso na hora marca o evento; aí não precisa de tarefa.
  if coalesce(new.metadata->>'aviso_direto', '') = 'true' then return new; end if;

  select c.parceiro_id, cl.nome, c.tipo_beneficio
    into v_parceiro, v_cliente, v_servico
    from public.casos c
    join public.clientes cl on cl.id = c.cliente_id
   where c.id = new.caso_id;
  if v_parceiro is null then return new; end if;

  if new.tipo = 'pericia' then
    v_natureza := case
      when new.processo_judicial_id is not null then 'judicial'
      when new.processo_admin_id is not null then 'admin'
      when new.titulo ~* 'judicial' then 'judicial'
      else 'admin' end;
    v_texto := public.pericia_draft_texto(
      v_natureza, v_cliente, v_servico, null, new.start_at, new.local, null);
    v_rotulo := 'perícia';
    v_aviso  := 'pericia_aviso';
  else
    v_texto := public.audiencia_draft_texto(v_cliente, new.start_at, new.local);
    v_rotulo := 'audiência';
    v_aviso  := 'audiencia_aviso';
  end if;

  insert into public.tarefas
    (caso_id, responsavel_id, tipo, status, prioridade, titulo, descricao,
     due_at, origem, origem_ref, processo_admin_id, processo_judicial_id, metadata)
  select
    new.caso_id,
    coalesce(new.created_by, new.responsavel_id),
    'contato_cliente', 'a_fazer', 1,
    'Enviar aviso da ' || v_rotulo || ' ao parceiro - ' || coalesce(v_cliente, 'cliente'),
    'Revisar o texto e enviar pelo botão aqui na tarefa. O parceiro recebe como comentário do caso, por e-mail.',
    now(),
    'enviar_aviso',
    'evento:' || new.id::text,
    new.processo_admin_id,
    new.processo_judicial_id,
    jsonb_build_object(
      'enviar_aviso', jsonb_build_object(
        'tipo_aviso', v_aviso,
        'evento_id', new.id,
        'texto', v_texto
      )
    )
  where not exists (
    select 1 from public.tarefas t
     where t.origem = 'enviar_aviso' and t.origem_ref = 'evento:' || new.id::text
  );

  return new;
exception when others then
  raise warning 'tg_rascunho_pericia_evento falhou (evento %): % / %',
    new.id, SQLSTATE, SQLERRM;
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. Publicação/andamento com perícia marcada OU audiência designada →
--    TAREFA "Enviar aviso" (não mais rascunho na fila)
-- ---------------------------------------------------------------------------
create or replace function public.tg_rascunho_pericia_andamento()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_texto_busca text;
  v_parceiro    uuid;
  v_cliente     text;
  v_servico     text;
  v_natureza    text;
  v_texto       text;
  v_rotulo      text;
  v_aviso       text;
begin
  if new.caso_id is null then return new; end if;
  if new.origem in ('djen', 'datajud') then return new; end if;
  if new.metadata->>'etapa' = 'pericia_agendada' then return new; end if;
  -- Andamento nascido do próprio fluxo de aviso: não morder o rabo.
  if new.metadata ? 'tipo_aviso' then return new; end if;
  if new.data_evento is not null and new.data_evento < (now() - interval '30 days') then
    return new;
  end if;

  v_texto_busca := coalesce(new.titulo, '') || ' ' || coalesce(new.descricao, '');

  if v_texto_busca ~* 'per[ií]cia'
     and v_texto_busca ~* '(marcad|agendad|reagendad|remarcad|designad)' then
    v_rotulo := 'perícia';
    v_aviso  := 'pericia_aviso';
  elsif v_texto_busca ~* 'audi[eê]nci'
     and v_texto_busca ~* '(marcad|agendad|designad|redesignad|pautad)' then
    v_rotulo := 'audiência';
    v_aviso  := 'audiencia_aviso';
  else
    return new;
  end if;

  select c.parceiro_id, cl.nome, c.tipo_beneficio
    into v_parceiro, v_cliente, v_servico
    from public.casos c
    join public.clientes cl on cl.id = c.cliente_id
   where c.id = new.caso_id;
  if v_parceiro is null then return new; end if;

  if v_aviso = 'pericia_aviso' then
    v_natureza := case
      when new.processo_judicial_id is not null then 'judicial'
      when new.processo_admin_id is not null then 'admin'
      when v_texto_busca ~* 'judicial' then 'judicial'
      else 'admin' end;
    -- Publicação não traz data/local estruturados: o texto sai com lacunas
    -- (_____) e quem envia completa lendo a publicação.
    v_texto := public.pericia_draft_texto(
      v_natureza, v_cliente, v_servico, null, null, null, null);
  else
    v_texto := public.audiencia_draft_texto(v_cliente, null, null);
  end if;

  insert into public.tarefas
    (caso_id, tipo, status, prioridade, titulo, descricao,
     due_at, origem, origem_ref, processo_admin_id, processo_judicial_id, metadata)
  select
    new.caso_id,
    'contato_cliente', 'a_fazer', 1,
    'Enviar aviso da ' || v_rotulo || ' ao parceiro - ' || coalesce(v_cliente, 'cliente'),
    'Detectado no andamento: "' || left(coalesce(new.titulo, ''), 120) || '". ' ||
    'Complete as lacunas do texto com a data/local da publicação e envie pelo botão aqui na tarefa.',
    now(),
    'enviar_aviso',
    'andamento:' || new.id::text,
    new.processo_admin_id,
    new.processo_judicial_id,
    jsonb_build_object(
      'enviar_aviso', jsonb_build_object(
        'tipo_aviso', v_aviso,
        'evento_id', null,
        'texto', v_texto,
        'origem_andamento_id', new.id
      )
    )
  where not exists (
    select 1 from public.tarefas t
     where t.origem = 'enviar_aviso' and t.origem_ref = 'andamento:' || new.id::text
  );

  return new;
exception when others then
  raise warning 'tg_rascunho_pericia_andamento falhou (andamento %): % / %',
    new.id, SQLSTATE, SQLERRM;
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- 7. Lembrete AUTOMÁTICO (job diário): envia comentário + e-mail via pg_net
-- ---------------------------------------------------------------------------
create or replace function public.enviar_lembretes_evento()
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  r        record;
  v_texto  text;
  v_natureza text;
  v_id     uuid;
  v_url    text;
  v_n      int := 0;
begin
  select valor into v_url from public.app_config where chave = 'edge_base_url';

  for r in
    select e.id as evento_id, e.caso_id, e.tipo, e.start_at, e.local, e.titulo,
           e.processo_admin_id, e.processo_judicial_id,
           cl.nome as cliente, c.tipo_beneficio as servico
      from public.agenda_eventos e
      join public.casos c    on c.id = e.caso_id
      join public.clientes cl on cl.id = c.cliente_id
     where e.tipo in ('pericia', 'audiencia')
       and c.parceiro_id is not null
       and e.start_at > now()
       and case when e.tipo = 'pericia'
                then public.pericia_data_lembrete(e.start_at)
                else public.audiencia_data_lembrete(e.start_at) end
             <= (now() at time zone 'America/Sao_Paulo')::date
       -- o aviso já tem que ter saído (comentário enviado deste evento)
       and exists (
         select 1 from public.comentarios a
          where a.evento_id = e.id
            and a.tipo_aviso in ('pericia_aviso', 'audiencia_aviso')
            and a.rascunho = false
       )
       -- e o lembrete ainda não pode existir
       and not exists (
         select 1 from public.comentarios l
          where l.evento_id = e.id
            and l.tipo_aviso in ('pericia_lembrete', 'audiencia_lembrete')
       )
  loop
    if r.tipo = 'pericia' then
      v_natureza := case
        when r.processo_judicial_id is not null then 'judicial'
        when r.processo_admin_id is not null then 'admin'
        when r.titulo ~* 'judicial' then 'judicial'
        else 'admin' end;
      v_texto := public.pericia_lembrete_texto(
        v_natureza, r.cliente, r.servico, null, r.start_at, r.local, null);
    else
      v_texto := public.audiencia_lembrete_texto(r.cliente, r.start_at, r.local);
    end if;

    -- Comentário já ENVIADO (rascunho=false): o trigger do §4 registra o
    -- andamento "Parceiro lembrado…"; o e-mail sai pelo pg_net logo abaixo.
    insert into public.comentarios
      (caso_id, autor_id, texto, rascunho, evento_id, tipo_aviso)
    values (
      r.caso_id, null, v_texto, false, r.evento_id,
      case when r.tipo = 'pericia' then 'pericia_lembrete' else 'audiencia_lembrete' end
    )
    on conflict do nothing
    returning id into v_id;

    if v_id is not null and v_url is not null
       and exists (select 1 from pg_extension where extname = 'pg_net') then
      perform net.http_post(
        url := v_url || '/notify-novo-comentario',
        headers := '{"Content-Type": "application/json", "x-region": "sa-east-1"}'::jsonb,
        body := jsonb_build_object('comentario_id', v_id),
        timeout_milliseconds := 30000
      );
    elsif v_url is null then
      raise warning 'app_config.edge_base_url ausente — lembrete % sem e-mail', v_id;
    end if;

    v_n := v_n + 1;
  end loop;

  return v_n;
end;
$$;

comment on function public.enviar_lembretes_evento() is
  'Lembrete automático de perícia (sexta anterior) e audiência (véspera): comentário direto ao parceiro + e-mail via pg_net. Roda na rotina diária; idempotente.';

-- A rotina diária passa a usar o envio direto.
create or replace function public.rotina_diaria_pericia()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_lembretes int;
  v_etiquetas int;
  v_alertas   int;
begin
  v_lembretes := public.enviar_lembretes_evento();
  v_etiquetas := public.trocar_etiqueta_pos_pericia();
  v_alertas   := public.criar_alertas_escalonamento_pericia();
  return jsonb_build_object(
    'lembretes_enviados', v_lembretes,
    'etiquetas_trocadas', v_etiquetas,
    'alertas_escalonamento', v_alertas
  );
end;
$$;

drop function if exists public.criar_rascunhos_lembrete_pericia();

-- ---------------------------------------------------------------------------
-- 8. Transição: o que estava pendente na fila vira tarefa; tarefas humanas de
--    lembrete são canceladas (o lembrete agora é automático)
-- ---------------------------------------------------------------------------
insert into public.tarefas
  (caso_id, tipo, status, prioridade, titulo, descricao, due_at,
   origem, origem_ref, metadata)
select
  co.caso_id,
  'contato_cliente', 'a_fazer', 1,
  'Enviar aviso ao parceiro - ' || coalesce(cl.nome, 'cliente'),
  'Rascunho migrado da antiga fila "A enviar". Revise o texto e envie pelo botão aqui na tarefa.',
  now(),
  'enviar_aviso',
  'rascunho:' || co.id::text,
  jsonb_build_object(
    'enviar_aviso', jsonb_build_object(
      'tipo_aviso', coalesce(co.tipo_aviso, 'pericia_aviso'),
      'evento_id', co.evento_id,
      'texto', co.texto
    )
  )
from public.comentarios co
join public.casos c    on c.id = co.caso_id
join public.clientes cl on cl.id = c.cliente_id
where co.rascunho = true
  and not exists (
    select 1 from public.tarefas t
     where t.origem = 'enviar_aviso' and t.origem_ref = 'rascunho:' || co.id::text
  );

delete from public.comentarios where rascunho = true;

update public.tarefas
   set status = 'cancelado',
       metadata = coalesce(metadata, '{}'::jsonb)
         || jsonb_build_object('cancelado_motivo', 'lembrete passou a ser automático (2026-08-24)')
 where origem = 'pericia_lembrete'
   and status in ('a_fazer', 'fazendo');

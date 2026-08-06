-- migration_pericia_lembrete_sexta.sql
--
-- Fecha o ciclo de comunicacao da pericia com o parceiro:
--
--   1. Perícia agendada  -> rascunho de AVISO na fila /a-enviar (ja existia).
--   2. Equipe envia      -> agora tambem:
--        - marca "Avisar cliente da pericia" como feita;
--        - cria a tarefa de LEMBRETE, com prazo na ultima sexta ANTES da
--          pericia (se essa sexta ja passou, prazo = hoje);
--        - grava andamento "Parceiro comunicado da pericia", visivel ao
--          parceiro.
--   3. Chegando a data do lembrete, um job diario cria o rascunho de LEMBRETE
--      na fila /a-enviar.
--   4. Equipe envia o lembrete -> grava andamento "Parceiro lembrado da
--      pericia", tambem visivel ao parceiro.
--
-- Decisoes tomadas com a Naira (2026-08-06):
--   - o rascunho do lembrete nasce SO na data, pra fila nao ficar entulhada
--     de coisa que so se envia dali a semanas;
--   - pericia marcada em cima da hora (sem sexta no meio) -> lembrete pra hoje;
--   - "Avisar cliente" e concluida, nao excluida (preserva o historico);
--   - os dois andamentos sao visiveis ao parceiro.
--
-- Idempotente.

-- ---------------------------------------------------------------------------
-- 1. Distinguir AVISO de LEMBRETE no mesmo evento
-- ---------------------------------------------------------------------------
-- comentarios.evento_id era UNIQUE, o que permitia so um comentario por
-- evento de pericia. Agora sao dois (aviso + lembrete), entao a unicidade
-- passa a ser por (evento, tipo de aviso).
alter table public.comentarios
  add column if not exists tipo_aviso text;

comment on column public.comentarios.tipo_aviso is
  'pericia_aviso | pericia_lembrete. NULL para comentario comum.';

update public.comentarios
   set tipo_aviso = 'pericia_aviso'
 where evento_id is not null and tipo_aviso is null;

drop index if exists public.comentarios_evento_uniq;

create unique index if not exists comentarios_evento_tipo_uniq
  on public.comentarios (evento_id, coalesce(tipo_aviso, ''))
  where evento_id is not null;

-- ---------------------------------------------------------------------------
-- 1b. tarefas.origem aceita 'pericia_lembrete'
-- ---------------------------------------------------------------------------
-- Sem isso o insert da tarefa de lembrete viola tarefas_origem_check e, como o
-- trigger inteiro e um bloco com EXCEPTION, TUDO que ele fez antes (andamento +
-- conclusao da tarefa "Avisar cliente") some junto no rollback.
alter table public.tarefas drop constraint if exists tarefas_origem_check;
alter table public.tarefas add constraint tarefas_origem_check
  check (origem = any (array[
    'manual', 'template', 'sync_inss_email', 'sync_djen', 'sync_legalmail',
    'migracao_ti', 'ia', 'pericia_lembrete'
  ]));

-- ---------------------------------------------------------------------------
-- 2. Data do lembrete: ultima sexta ANTES da pericia
-- ---------------------------------------------------------------------------
create or replace function public.pericia_data_lembrete(p_quando timestamptz)
returns date
language sql
stable
set search_path = public, pg_temp
as $$
  -- Ex.: pericia quinta 06/08 -> sexta 31/07. Pericia numa sexta -> a sexta
  -- anterior (7 dias antes), nunca o proprio dia. Se essa sexta ja passou
  -- (pericia marcada em cima da hora), cai pra hoje, pra nao nascer vencida.
  select greatest(
    (
      (p_quando at time zone 'America/Sao_Paulo')::date
      - (((extract(dow from (p_quando at time zone 'America/Sao_Paulo'))::int - 5 + 7) % 7)
         + case when extract(dow from (p_quando at time zone 'America/Sao_Paulo'))::int = 5
                then 7 else 0 end)
    ),
    (now() at time zone 'America/Sao_Paulo')::date
  );
$$;

comment on function public.pericia_data_lembrete(timestamptz) is
  'Ultima sexta-feira antes da pericia (horario de Brasilia); nunca no passado.';

-- ---------------------------------------------------------------------------
-- 3. Texto do lembrete
-- ---------------------------------------------------------------------------
create or replace function public.pericia_lembrete_texto(
  p_natureza text, p_cliente text, p_servico text, p_protocolo text,
  p_quando timestamptz, p_local text, p_endereco text
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
    '🔔 LEMBRETE — ' ||
      case when p_natureza = 'judicial' then 'PERÍCIA JUDICIAL' else 'PERÍCIA INSS' end
      || chr(10) || chr(10) ||
    'Passando pra lembrar da perícia que se aproxima.' || chr(10) || chr(10) ||
    '👤 Cliente: '  || coalesce(nullif(btrim(p_cliente), ''), '_____') || chr(10) ||
    '🩺 Serviço: '  || coalesce(nullif(btrim(p_servico), ''), '_____') || chr(10) ||
    '🔢 Protocolo: '|| coalesce(nullif(btrim(p_protocolo), ''), '_____') || chr(10) || chr(10) ||
    '📅 Data: '     || v_data || chr(10) ||
    '⏰ Horário: '  || v_hora || chr(10) || chr(10) ||
    '📍 Local: '    || coalesce(nullif(btrim(p_local), ''), '_____') || chr(10) ||
    '🗺️ Endereço: '|| coalesce(nullif(btrim(p_endereco), ''), '_____') || chr(10) || chr(10) ||
    '📌 Reforçar com o cliente:' || chr(10) ||
    '• Chegar com 25 min de antecedência' || chr(10) ||
    '• Levar documento oficial com foto' || chr(10) ||
    '• Levar TODOS os laudos, exames, atestados e receitas (originais)' || chr(10) || chr(10) ||
    '✅ Favor confirmar que o cliente está ciente e comparecerá.';
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. O rascunho de AVISO passa a se identificar como tal
-- ---------------------------------------------------------------------------
create or replace function public.tg_rascunho_pericia_evento()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_parceiro  uuid;
  v_cliente   text;
  v_servico   text;
  v_natureza  text;
  v_texto     text;
begin
  if new.tipo is distinct from 'pericia' then return new; end if;
  if new.caso_id is null then return new; end if;
  if new.restrito_a is not null then return new; end if;

  select c.parceiro_id, cl.nome, c.tipo_beneficio
    into v_parceiro, v_cliente, v_servico
    from public.casos c
    join public.clientes cl on cl.id = c.cliente_id
   where c.id = new.caso_id;

  if v_parceiro is null then return new; end if;

  v_natureza := case
    when new.processo_judicial_id is not null then 'judicial'
    when new.processo_admin_id is not null then 'admin'
    when new.titulo ~* 'judicial' then 'judicial'
    else 'admin' end;

  v_texto := public.pericia_draft_texto(
    v_natureza, v_cliente, v_servico, null, new.start_at, new.local, null
  );

  insert into public.comentarios (caso_id, autor_id, texto, rascunho, evento_id, tipo_aviso)
  values (new.caso_id, null, v_texto, true, new.id, 'pericia_aviso')
  on conflict do nothing;

  return new;
exception when others then
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. Ao ENVIAR o aviso/lembrete: andamento + tarefas
-- ---------------------------------------------------------------------------
create or replace function public.tg_pericia_aviso_enviado()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
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

  -- O resto so vale pro primeiro aviso.
  if new.tipo_aviso <> 'pericia_aviso' then return new; end if;

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
$$;

drop trigger if exists trg_pericia_aviso_enviado on public.comentarios;
create trigger trg_pericia_aviso_enviado
  after update on public.comentarios
  for each row execute function public.tg_pericia_aviso_enviado();

-- ---------------------------------------------------------------------------
-- 6. Job diario: cria o rascunho do LEMBRETE quando chega a data
-- ---------------------------------------------------------------------------
create or replace function public.criar_rascunhos_lembrete_pericia()
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  r       record;
  v_texto text;
  v_natureza text;
  v_n     int := 0;
begin
  for r in
    select e.id as evento_id, e.caso_id, e.start_at, e.local,
           e.processo_admin_id, e.processo_judicial_id, e.titulo,
           cl.nome as cliente, c.tipo_beneficio as servico
      from public.agenda_eventos e
      join public.casos c    on c.id = e.caso_id
      join public.clientes cl on cl.id = c.cliente_id
     where e.tipo = 'pericia'
       and c.parceiro_id is not null
       and e.start_at > now()
       and public.pericia_data_lembrete(e.start_at)
             <= (now() at time zone 'America/Sao_Paulo')::date
       -- o primeiro aviso ja tem que ter saido
       and exists (
         select 1 from public.comentarios a
          where a.evento_id = e.id
            and a.tipo_aviso = 'pericia_aviso'
            and a.rascunho = false
       )
       -- e o lembrete ainda nao pode existir
       and not exists (
         select 1 from public.comentarios l
          where l.evento_id = e.id
            and l.tipo_aviso = 'pericia_lembrete'
       )
  loop
    v_natureza := case
      when r.processo_judicial_id is not null then 'judicial'
      when r.processo_admin_id is not null then 'admin'
      when r.titulo ~* 'judicial' then 'judicial'
      else 'admin' end;

    v_texto := public.pericia_lembrete_texto(
      v_natureza, r.cliente, r.servico, null, r.start_at, r.local, null
    );

    insert into public.comentarios
      (caso_id, autor_id, texto, rascunho, evento_id, tipo_aviso)
    values (r.caso_id, null, v_texto, true, r.evento_id, 'pericia_lembrete')
    on conflict do nothing;

    v_n := v_n + 1;
  end loop;

  return v_n;
end;
$$;

comment on function public.criar_rascunhos_lembrete_pericia() is
  'Materializa os rascunhos de lembrete de pericia cuja data chegou. Roda no cron diario; pode ser chamada a mao sem risco (idempotente).';

-- Agenda: todo dia 08:00 em Brasilia (11:00 UTC).
-- Condicional porque so producao tem pg_cron; em staging a funcao existe e
-- pode ser chamada a mao, mas nao ha job.
do $agenda$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    if exists (select 1 from cron.job where jobname = 'lembrete-pericia-diario') then
      perform cron.unschedule('lembrete-pericia-diario');
    end if;
    perform cron.schedule(
      'lembrete-pericia-diario',
      '0 11 * * *',
      'select public.criar_rascunhos_lembrete_pericia();'
    );
  else
    raise notice 'pg_cron ausente — job do lembrete NAO agendado neste ambiente.';
  end if;
end
$agenda$;

-- ---------------------------------------------------------------------------
-- 7. Backfill: pericias futuras cujo aviso JA foi enviado antes deste trigger
-- ---------------------------------------------------------------------------
-- Sem isso, quem ja tinha perícia comunicada ficaria sem lembrete — o trigger
-- so pega envios daqui pra frente. Additivo e idempotente (o not exists
-- protege). Nao mexe na tarefa "Avisar cliente": se ela ainda estiver aberta
-- nesses casos, quem decide e a equipe, nao um backfill.
insert into public.tarefas
  (caso_id, responsavel_id, tipo, status, prioridade, titulo, descricao,
   due_at, origem, origem_ref, metadata)
select
  e.caso_id,
  (select t.responsavel_id from public.tarefas t
    where t.caso_id = e.caso_id and t.titulo ilike 'Avisar cliente da perícia%'
    order by t.created_at desc limit 1),
  'contato_cliente', 'a_fazer', 1,
  'Lembrar parceiro da perícia - ' || cl.nome,
  'Enviar lembrete ao parceiro sobre a perícia de '
    || to_char(e.start_at at time zone 'America/Sao_Paulo', 'DD/MM/YYYY " às " HH24:MI')
    || '. O rascunho aparece sozinho na fila "A enviar" nesta data.',
  (public.pericia_data_lembrete(e.start_at) + time '09:00') at time zone 'America/Sao_Paulo',
  'pericia_lembrete',
  'evento:' || e.id::text,
  jsonb_build_object('evento_id', e.id, 'pericia_em', e.start_at, 'backfill', true)
from public.agenda_eventos e
join public.casos c    on c.id = e.caso_id
join public.clientes cl on cl.id = c.cliente_id
where e.tipo = 'pericia'
  and c.parceiro_id is not null
  and e.start_at > now()
  and exists (
    select 1 from public.comentarios a
     where a.evento_id = e.id and a.tipo_aviso = 'pericia_aviso' and a.rascunho = false
  )
  and not exists (
    select 1 from public.tarefas t
     where t.origem = 'pericia_lembrete' and t.origem_ref = 'evento:' || e.id::text
  );

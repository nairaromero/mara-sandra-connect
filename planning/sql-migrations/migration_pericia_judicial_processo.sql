-- =============================================================================
-- Migration: perícia judicial fala em PROCESSO, não em protocolo
-- (feedback do teste da Naira, 2026-08-24).
--
-- 1) pericia_draft_texto / pericia_lembrete_texto: quando natureza='judicial',
--    a linha "🔢 Protocolo:" vira "⚖️ Processo:" — e o valor é o número do
--    processo judicial.
-- 2) tg_rascunho_pericia_evento (tarefa "Enviar aviso") e
--    enviar_lembretes_evento (lembrete automático): quando o evento tem
--    processo judicial vinculado, o número entra no texto.
--
-- Idempotente.
-- =============================================================================

create or replace function public.pericia_draft_texto(
  p_natureza text, p_cliente text, p_servico text, p_protocolo text,
  p_quando timestamptz, p_local text, p_endereco text
) returns text
language plpgsql
immutable
set search_path = public, pg_temp
as $$
declare
  v_head text;
  v_ref  text;
  v_data text;
  v_hora text;
  v_dow  int;
  v_dia  text;
begin
  v_head := case when p_natureza = 'judicial'
                 then 'PERÍCIA JUDICIAL AGENDADA'
                 else 'PERÍCIA INSS AGENDADA' end;
  v_ref := case when p_natureza = 'judicial'
                then '⚖️ Processo: '
                else '🔢 Protocolo: ' end;

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
    '📋 ' || v_head || chr(10) || chr(10) ||
    '👤 Cliente: '  || coalesce(nullif(btrim(p_cliente), ''), '_____') || chr(10) ||
    '🩺 Serviço: '  || coalesce(nullif(btrim(p_servico), ''), '_____') || chr(10) ||
    v_ref           || coalesce(nullif(btrim(p_protocolo), ''), '_____') || chr(10) || chr(10) ||
    '📅 Data: '     || v_data || chr(10) ||
    '⏰ Horário: '  || v_hora || chr(10) || chr(10) ||
    '📍 Local: '    || coalesce(nullif(btrim(p_local), ''), '_____') || chr(10) ||
    '🗺️ Endereço: '|| coalesce(nullif(btrim(p_endereco), ''), '_____') || chr(10) || chr(10) ||
    '📌 Orientações ao cliente:' || chr(10) ||
    '• Chegar com 25 min de antecedência' || chr(10) ||
    '• Levar documento oficial com foto' || chr(10) ||
    '• Levar TODOS os laudos, exames, atestados e receitas (originais)' || chr(10) || chr(10) ||
    '✅ Favor confirmar o recebimento e a ciência do cliente.';
end;
$$;

create or replace function public.pericia_lembrete_texto(
  p_natureza text, p_cliente text, p_servico text, p_protocolo text,
  p_quando timestamptz, p_local text, p_endereco text
) returns text
language plpgsql
immutable
set search_path = public, pg_temp
as $$
declare
  v_ref  text;
  v_data text;
  v_hora text;
  v_dow  int;
  v_dia  text;
begin
  v_ref := case when p_natureza = 'judicial'
                then '⚖️ Processo: '
                else '🔢 Protocolo: ' end;

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
    v_ref           || coalesce(nullif(btrim(p_protocolo), ''), '_____') || chr(10) || chr(10) ||
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

-- Tarefa "Enviar aviso" (evento criado sem aviso direto): número do processo
-- entra no texto quando houver.
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
  v_processo text;
  v_texto    text;
  v_rotulo   text;
  v_aviso    text;
begin
  if new.tipo not in ('pericia', 'audiencia') then return new; end if;
  if new.caso_id is null then return new; end if;
  if new.restrito_a is not null then return new; end if;
  if coalesce(new.metadata->>'aviso_direto', '') = 'true' then return new; end if;

  select c.parceiro_id, cl.nome, c.tipo_beneficio
    into v_parceiro, v_cliente, v_servico
    from public.casos c
    join public.clientes cl on cl.id = c.cliente_id
   where c.id = new.caso_id;
  if v_parceiro is null then return new; end if;

  if new.processo_judicial_id is not null then
    select numero_processo into v_processo
      from public.processos_judiciais where id = new.processo_judicial_id;
  end if;

  if new.tipo = 'pericia' then
    v_natureza := case
      when new.processo_judicial_id is not null then 'judicial'
      when new.processo_admin_id is not null then 'admin'
      when new.titulo ~* 'judicial' then 'judicial'
      else 'admin' end;
    v_texto := public.pericia_draft_texto(
      v_natureza, v_cliente, v_servico, v_processo, new.start_at, new.local, null);
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

-- Lembrete automático: idem.
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
           pj.numero_processo,
           cl.nome as cliente, c.tipo_beneficio as servico
      from public.agenda_eventos e
      join public.casos c    on c.id = e.caso_id
      join public.clientes cl on cl.id = c.cliente_id
      left join public.processos_judiciais pj on pj.id = e.processo_judicial_id
     where e.tipo in ('pericia', 'audiencia')
       and c.parceiro_id is not null
       and e.start_at > now()
       and case when e.tipo = 'pericia'
                then public.pericia_data_lembrete(e.start_at)
                else public.audiencia_data_lembrete(e.start_at) end
             <= (now() at time zone 'America/Sao_Paulo')::date
       and exists (
         select 1 from public.comentarios a
          where a.evento_id = e.id
            and a.tipo_aviso in ('pericia_aviso', 'audiencia_aviso')
            and a.rascunho = false
       )
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
        v_natureza, r.cliente, r.servico, r.numero_processo, r.start_at, r.local, null);
    else
      v_texto := public.audiencia_lembrete_texto(r.cliente, r.start_at, r.local);
    end if;

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

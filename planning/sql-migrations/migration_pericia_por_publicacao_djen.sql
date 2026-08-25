-- =============================================================================
-- Migration: perícia/audiência detectada TAMBÉM nas publicações do DJEN.
--
-- O gatilho por palavra-chave (andamento com "perícia marcada/designada…" →
-- tarefa "Enviar aviso ao parceiro") EXCLUÍA origem djen/datajud — herança da
-- época em que a triagem por IA cuidaria das fontes judiciais (está desligada
-- desde 06/08). Resultado: publicação do DJEN designando perícia não gerava
-- nada. A Naira pediu o teste do fluxo e o buraco apareceu (2026-08-24).
--
-- Agora:
--   - djen/datajud entram no jogo (o regex é específico; o dedup por
--     andamento e a checagem de parceiro seguram o ruído);
--   - publicação com processo judicial vinculado carrega o Nº DO PROCESSO
--     no texto do aviso (⚖️ Processo: …);
--   - anti-spam: se o caso já tem tarefa ABERTA de enviar o mesmo tipo de
--     aviso, republicações não criam outra.
--
-- Idempotente.
-- =============================================================================

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
  v_processo    text;
  v_texto       text;
  v_rotulo      text;
  v_aviso       text;
begin
  if new.caso_id is null then return new; end if;
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

  -- Dedup APENAS por andamento (origem_ref, no insert abaixo). O anti-spam
  -- por caso inteiro engolia uma SEGUNDA perícia publicada com a primeira
  -- tarefa ainda aberta (review #6) — tarefa a mais é chateação; perícia
  -- engolida é prejuízo.

  if new.processo_judicial_id is not null then
    select numero_processo into v_processo
      from public.processos_judiciais where id = new.processo_judicial_id;
  end if;

  if v_aviso = 'pericia_aviso' then
    v_natureza := case
      when new.processo_judicial_id is not null then 'judicial'
      when new.processo_admin_id is not null then 'admin'
      when v_texto_busca ~* 'judicial' then 'judicial'
      else 'admin' end;
    -- Publicação não traz data/local estruturados: o texto sai com lacunas
    -- (_____) e quem envia completa lendo a publicação.
    v_texto := public.pericia_draft_texto(
      v_natureza, v_cliente, v_servico, v_processo, null, null, null);
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

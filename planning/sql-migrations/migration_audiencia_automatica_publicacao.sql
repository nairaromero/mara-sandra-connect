-- =============================================================================
-- Migration: audiência nasce SOZINHA quando a publicação chega
-- (decisões da Naira, 2026-09-13).
--
-- ANTES: publicação/andamento com "audiência designada" → tarefa "Enviar aviso
-- da audiência ao parceiro" com o texto CHEIO DE LACUNAS (_____). Alguém tinha
-- que ler a publicação, criar o evento na agenda à mão e completar o texto —
-- e nas 5 audiências de produção, nenhuma teve aviso enviado.
--
-- AGORA:
--   1. O gatilho trg_audiencia_publicacao_ler (AFTER INSERT em andamentos) manda
--      o andamento pra edge function ler-audiencia-publicacao (pg_net, assíncrono).
--   2. A edge lê a publicação com a IA DO ESCRITÓRIO (chave compartilhada) e
--      chama public.aplicar_audiencia_da_publicacao(andamento, leitura).
--   3. Com data e hora de audiência futura:
--        - cria o evento na agenda (processo e responsável do caso);
--        - cria as tarefas do template audiencia_judicial (preparar D-3, que
--          recua pra sexta; registrar D+1; ata D+10) — itens lidos do template;
--        - a tarefa de aviso ao parceiro fica com o texto COMPLETO (data, hora,
--          local) + o link da publicação, ligada ao evento. A equipe confere e
--          envia (não sai sozinho).
--      Caso sem parceiro: a tarefa "Avisar o cliente" ganha os mesmos dados.
--   4. Sem data/hora, "data a ser marcada", termo de audiência, dispensa ou
--      leitura que falhou → a tarefa vira "Conferir audiência" (sem evento, sem
--      data inventada), com o motivo e o link.
--   5. Publicação repetida da mesma audiência (intimação de cada parte,
--      certidão, DJEN + DataJud): reaproveita o evento — nada duplica na
--      agenda — e abre a tarefa "Analisar publicação repetida" (pedido da
--      Naira): alguém confere se é só repetição ou se mudou local, link da sala
--      ou houve redesignação. Vale nas duas ordens, pelo MESMO processo:
--        - sem data chegou antes ("Conferir audiência") e a data chega depois →
--          a conferência vira análise, apontando as duas publicações;
--        - a data chegou antes (evento na agenda) e depois chega uma sem data
--          (DataJud, certidão) → análise, e não uma conferência solta.
--      Nada é excluído calado.
--
-- DESLIGADO POR PADRÃO: app_config.audiencia_leitura_auto = 'true' liga por
-- ambiente (e é o botão de emergência). Sem a chave, tudo segue como antes.
--
-- Depende de (rodar antes, nesta ordem, no ambiente):
--   migration_responsavel_escada_unica.sql  (public.responsavel_tarefa_caso)
--   migration_comunicacao_eventos_direta.sql (template audiencia_judicial,
--     audiencia_draft_texto, app_config.edge_base_url)
--
-- O gatilho de aviso existente (tg_rascunho_pericia_andamento) NÃO é
-- reescrito: ele continua criando a tarefa de aviso na hora (nada se perde se
-- a edge falhar) e esta migration só completa/converte essa tarefa depois.
--
-- Idempotente.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 0. Chave liga/desliga por ambiente (desligada até alguém ligar)
-- ---------------------------------------------------------------------------
insert into public.app_config (chave, valor)
values ('audiencia_leitura_auto', 'false')
on conflict (chave) do nothing;

-- ---------------------------------------------------------------------------
-- 0b. Botões nas tarefas do template (Naira, 2026-09-13): "Preparar audiência"
--     ganha "Cliente instruído"; "Acompanhar ata/sentença" ganha "Sentença
--     ainda não saiu" / "Sentença saiu". A marca vai no meta do item (vira
--     metadata da tarefa). Só acrescenta a chave — ordem dos itens e
--     oculto_na_ui ficam como estão. O front também reconhece tarefa antiga
--     pelo título dentro do template (acaoAudiencia), caso esta marca se perca
--     num re-run da migration que semeou o template.
-- ---------------------------------------------------------------------------
update public.tarefa_templates t
   set itens = (
         select jsonb_agg(
                  case
                    when e.i->>'titulo' like 'Preparar audiência%' then
                      e.i || jsonb_build_object('meta',
                        coalesce(e.i->'meta', '{}'::jsonb) || '{"preparar_audiencia": true}'::jsonb)
                    when e.i->>'titulo' like 'Acompanhar ata/sentença%' then
                      e.i || jsonb_build_object('meta',
                        coalesce(e.i->'meta', '{}'::jsonb) || '{"acompanhar_sentenca_audiencia": true}'::jsonb)
                    else e.i
                  end
                  order by e.ord)
           from jsonb_array_elements(t.itens) with ordinality as e(i, ord)
       ),
       updated_at = now()
 where t.nome = 'audiencia_judicial'
   and not (t.itens @> '[{"meta": {"preparar_audiencia": true}}]'::jsonb
            and t.itens @> '[{"meta": {"acompanhar_sentenca_audiencia": true}}]'::jsonb);

-- ---------------------------------------------------------------------------
-- 1. Fora do fim de semana, no calendário de Brasília (par do
--    foraDoFimDeSemanaBR do front): recua pra sexta ou avança pra segunda,
--    mantendo o horário. Brasil sem horário de verão: somar dias é seguro.
-- ---------------------------------------------------------------------------
create or replace function public._fora_do_fim_de_semana_br(p_quando timestamptz, p_recua boolean)
returns timestamptz
language sql
stable
set search_path to 'public', 'pg_temp'
as $function$
  select case extract(dow from (p_quando at time zone 'America/Sao_Paulo'))::int
           when 6 then p_quando + case when p_recua then interval '-1 day' else interval '2 days' end
           when 0 then p_quando + case when p_recua then interval '-2 days' else interval '1 day' end
           else p_quando
         end;
$function$;

-- ---------------------------------------------------------------------------
-- 2. Aplica a leitura de uma publicação de audiência.
--
-- p_leitura (vem da edge; os testes E2E chamam direto):
--   { "designacao": bool, "data": "AAAA-MM-DD"|null, "hora": "HH:MM"|null,
--     "local": text|null, "link_sala": text|null, "tipo_audiencia": text|null,
--     "motivo": text|null, "erro": text|null }
--
-- Devolve { status: agendada | reaproveitada | repetida | conferir | ignorada |
--           ja_processada | sem_caso, evento_id }.
-- ---------------------------------------------------------------------------
create or replace function public.aplicar_audiencia_da_publicacao(
  p_andamento_id uuid,
  p_leitura jsonb
)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_and        record;
  v_aviso_id   uuid;
  v_aviso_st   text;
  v_aviso_meta jsonb;
  v_cliente    text;
  v_parceiro   uuid;
  v_numero     text;
  v_padm       uuid;
  v_pjud       uuid;
  v_designa    boolean;
  v_data       date;
  v_hora       time;
  v_inicio     timestamptz;
  v_local      text;
  v_link       text;
  v_motivo     text;
  v_tpl        jsonb;
  v_ag_item    jsonb;
  v_item       jsonb;
  v_offset     int;
  v_due        timestamptz;
  v_resp       uuid;
  v_ev_id      uuid;
  v_outra      timestamptz;
  v_reusou     boolean := false;
  v_duplicada  boolean := false;
  v_ev_local   text;
  v_analise    text;
  v_texto      text;
  v_quando_br  text;
  v_status     text;
begin
  select a.id, a.caso_id, a.processo_admin_id, a.processo_judicial_id,
         a.titulo, a.descricao, a.data_evento,
         coalesce(a.metadata, '{}'::jsonb) as metadata
    into v_and
    from public.andamentos a
   where a.id = p_andamento_id
     for update;
  if not found then
    raise exception 'andamento % não encontrado', p_andamento_id;
  end if;
  if v_and.caso_id is null then
    return jsonb_build_object('status', 'sem_caso');
  end if;
  -- Idempotente: a mesma publicação nunca é aplicada duas vezes.
  if v_and.metadata ? 'audiencia_leitura' then
    -- status por ÚLTIMO: no || a direita vence, e o status gravado ('agendada')
    -- apagaria o 'ja_processada'.
    return jsonb_build_object(
             'status_anterior', v_and.metadata->'audiencia_leitura'->>'status',
             'evento_id', v_and.metadata->'audiencia_leitura'->'evento_id')
           || jsonb_build_object('status', 'ja_processada');
  end if;

  -- Leitura malformada vale como "sem data" — nunca como data inventada.
  begin
    v_designa := coalesce((p_leitura->>'designacao')::boolean, false);
    v_data := nullif(btrim(p_leitura->>'data'), '')::date;
    v_hora := nullif(btrim(p_leitura->>'hora'), '')::time;
  exception when others then
    v_designa := false;
    v_data := null;
    v_hora := null;
  end;

  select c.parceiro_id, cl.nome
    into v_parceiro, v_cliente
    from public.casos c
    join public.clientes cl on cl.id = c.cliente_id
   where c.id = v_and.caso_id;

  -- Evento só aceita UMA natureza de processo; audiência é judicial.
  v_pjud := v_and.processo_judicial_id;
  v_padm := case when v_pjud is null then v_and.processo_admin_id end;
  if v_pjud is not null then
    select numero_processo into v_numero from public.processos_judiciais where id = v_pjud;
  end if;

  v_link := coalesce(nullif(btrim(v_and.metadata->>'link'), ''),
                     nullif(btrim(v_and.metadata->>'certidao_url'), ''));
  v_local := nullif(concat_ws(' — ',
                     nullif(btrim(p_leitura->>'local'), ''),
                     nullif(btrim(p_leitura->>'link_sala'), '')), '');

  -- A tarefa que o gatilho de aviso criou pra este andamento (se criou: o
  -- regex dele é mais estreito que o deste fluxo — "DESIGNO audiência" não
  -- passava lá).
  select t.id, t.status, coalesce(t.metadata, '{}'::jsonb)
    into v_aviso_id, v_aviso_st, v_aviso_meta
    from public.tarefas t
   where t.origem_ref = 'andamento:' || v_and.id::text
     and (t.metadata ? 'enviar_aviso' or t.metadata ? 'avisar_cliente')
   order by t.created_at
   limit 1;

  if v_designa and v_data is not null and v_hora is not null then
    v_inicio := (v_data + v_hora) at time zone 'America/Sao_Paulo';
  end if;

  -- =========================================================================
  -- A) Sem audiência futura com data e hora → conferência
  -- =========================================================================
  if v_inicio is null or v_inicio <= now() then
    v_motivo := case
      when nullif(btrim(p_leitura->>'erro'), '') is not null then
        'A leitura automática da publicação falhou (' || left(p_leitura->>'erro', 160) || ').'
      when not v_designa then
        'A leitura indica que a publicação não designa audiência futura'
        || coalesce(' (' || nullif(btrim(p_leitura->>'motivo'), '') || ')', '') || '.'
      when v_data is null or v_hora is null then
        'A publicação não traz a data e o horário da audiência'
        || coalesce(' (' || nullif(btrim(p_leitura->>'motivo'), '') || ')', '') || '.'
      else
        'A data lida (' || to_char(v_inicio at time zone 'America/Sao_Paulo', 'DD/MM/YYYY HH24:MI')
        || ') já passou.'
    end;

    -- Já existe audiência futura agendada NESTE processo: a publicação sem data
    -- quase sempre é a mesma audiência (DataJud depois do DJEN, certidão,
    -- cancelamento) — vira análise de publicação repetida, não conferência.
    if v_pjud is not null then
      select e.id, e.start_at, e.local
        into v_ev_id, v_outra, v_ev_local
        from public.agenda_eventos e
       where e.caso_id = v_and.caso_id
         and e.processo_judicial_id = v_pjud
         and e.tipo = 'audiencia'
         and e.start_at > now()
         and e.concluido_em is null
       order by e.start_at
       limit 1;
    end if;

    if v_ev_id is not null and (v_aviso_id is not null or v_designa) then
      v_analise := 'Chegou outra publicação sobre audiência deste processo, sem data e horário aproveitáveis ('
        || rtrim(v_motivo, '.') || '). A audiência de '
        || to_char(v_outra at time zone 'America/Sao_Paulo', 'DD/MM/YYYY "às" HH24:MI')
        || coalesce(' (' || v_ev_local || ')', '')
        || ' já está na agenda. Confira se é a mesma audiência, se foi cancelada ou redesignada,'
        || ' ou se é uma nova — nesse caso, agende pela Agenda.'
        || coalesce(E'\n\nPublicação: ' || v_link, '');
      if v_aviso_id is not null and v_aviso_st = 'a_fazer' then
        update public.tarefas
           set titulo = 'Analisar publicação repetida - ' || coalesce(v_cliente, 'cliente'),
               tipo = 'interna',
               prioridade = 2,
               descricao = v_analise,
               metadata = (v_aviso_meta - 'enviar_aviso' - 'avisar_cliente')
                 || jsonb_build_object('analisar_publicacao_repetida', jsonb_build_object(
                      'evento_id', v_ev_id,
                      'origem_andamento_id', v_and.id,
                      'link_publicacao', v_link,
                      'motivo', v_motivo))
         where id = v_aviso_id;
      elsif v_aviso_id is null then
        insert into public.tarefas
          (caso_id, responsavel_id, tipo, status, prioridade, titulo, descricao,
           due_at, origem, origem_ref, processo_admin_id, processo_judicial_id, metadata)
        values
          (v_and.caso_id, public.responsavel_tarefa_caso(v_and.caso_id, null),
           'interna', 'a_fazer', 2,
           'Analisar publicação repetida - ' || coalesce(v_cliente, 'cliente'),
           v_analise, now(), 'enviar_aviso', 'andamento:' || v_and.id::text, v_padm, v_pjud,
           jsonb_build_object('analisar_publicacao_repetida', jsonb_build_object(
             'evento_id', v_ev_id,
             'origem_andamento_id', v_and.id,
             'link_publicacao', v_link,
             'motivo', v_motivo)))
        on conflict do nothing;
      end if;
      v_status := 'repetida';
    elsif v_aviso_id is not null and v_aviso_st = 'a_fazer' then
      update public.tarefas
         set titulo = 'Conferir audiência - ' || coalesce(v_cliente, 'cliente'),
             tipo = 'interna',
             descricao = v_motivo
               || ' Leia a publicação; se houver audiência, agende pela Agenda (o aviso ao parceiro nasce lá).'
               || coalesce(E'\n\nPublicação: ' || v_link, ''),
             metadata = (v_aviso_meta - 'enviar_aviso' - 'avisar_cliente')
               || jsonb_build_object('conferir_audiencia', jsonb_build_object(
                    'motivo', v_motivo,
                    'origem_andamento_id', v_and.id,
                    'link_publicacao', v_link))
       where id = v_aviso_id;
      v_status := 'conferir';
    elsif v_aviso_id is null and v_designa then
      -- A IA viu designação mas sem data: não havia tarefa (regex estreito do
      -- gatilho antigo) — cria a conferência pra não passar batido.
      insert into public.tarefas
        (caso_id, responsavel_id, tipo, status, prioridade, titulo, descricao,
         due_at, origem, origem_ref, processo_admin_id, processo_judicial_id, metadata)
      values
        (v_and.caso_id, public.responsavel_tarefa_caso(v_and.caso_id, null),
         'interna', 'a_fazer', 1,
         'Conferir audiência - ' || coalesce(v_cliente, 'cliente'),
         v_motivo
           || ' Leia a publicação; se houver audiência, agende pela Agenda (o aviso ao parceiro nasce lá).'
           || coalesce(E'\n\nPublicação: ' || v_link, ''),
         now(), 'enviar_aviso', 'andamento:' || v_and.id::text, v_padm, v_pjud,
         jsonb_build_object('conferir_audiencia', jsonb_build_object(
           'motivo', v_motivo,
           'origem_andamento_id', v_and.id,
           'link_publicacao', v_link)))
      on conflict do nothing;
      v_status := 'conferir';
    else
      v_status := 'ignorada';
    end if;

  -- =========================================================================
  -- B) Audiência futura com data e hora → evento + tarefas + aviso completo
  -- =========================================================================
  else
    v_resp := public.responsavel_tarefa_caso(v_and.caso_id, null);
    select t.itens into v_tpl
      from public.tarefa_templates t
     where t.nome = 'audiencia_judicial' and t.ativo;
    select i into v_ag_item
      from jsonb_array_elements(coalesce(v_tpl, '[]'::jsonb)) i
     where i->>'destino' = 'agenda'
     limit 1;

    -- Mesma audiência já na agenda (publicação repetida, ou alguém agendou à
    -- mão antes de a leitura terminar): reaproveita.
    select e.id into v_ev_id
      from public.agenda_eventos e
     where e.caso_id = v_and.caso_id
       and e.tipo = 'audiencia'
       and e.start_at = v_inicio
       and e.concluido_em is null
     order by e.created_at
     limit 1;

    if v_ev_id is not null then
      v_reusou := true;
      v_status := 'reaproveitada';
      select e.local into v_ev_local from public.agenda_eventos e where e.id = v_ev_id;
    else
      -- Outra audiência futura no caso? Pode ser redesignação — avisa na tarefa.
      select min(e.start_at) into v_outra
        from public.agenda_eventos e
       where e.caso_id = v_and.caso_id
         and e.tipo = 'audiencia'
         and e.start_at > now()
         and e.concluido_em is null;

      insert into public.agenda_eventos
        (caso_id, processo_admin_id, processo_judicial_id, responsavel_id, tipo,
         titulo, descricao, start_at, end_at, local, metadata)
      values
        (v_and.caso_id, v_padm, v_pjud, v_resp, 'audiencia',
         replace(coalesce(v_ag_item->>'titulo', 'Audiência - {nome_cliente}'),
                 '{nome_cliente}', coalesce(v_cliente, '')),
         concat_ws(E'\n',
           nullif(btrim(p_leitura->>'tipo_audiencia'), ''),
           'Agendada automaticamente a partir da publicação'
             || coalesce(' de ' || to_char(v_and.data_evento at time zone 'America/Sao_Paulo', 'DD/MM/YYYY'), '')
             || ' — confira com o texto oficial.',
           'Publicação: ' || v_link),
         v_inicio,
         v_inicio + make_interval(mins => coalesce((v_ag_item->>'duracao_min')::int, 60)),
         v_local,
         -- aviso_direto: o aviso deste evento é a tarefa do andamento (abaixo);
         -- sem a flag, o gatilho do evento criaria uma segunda.
         jsonb_build_object(
           'aviso_direto', true,
           'origem', 'publicacao',
           'origem_andamento_id', v_and.id,
           'leitura_publicacao', p_leitura))
      returning id into v_ev_id;

      -- Tarefas do template, prazos relativos à audiência.
      for v_item in
        select i from jsonb_array_elements(coalesce(v_tpl, '[]'::jsonb)) i
         where coalesce(i->>'destino', 'tarefa') = 'tarefa'
      loop
        v_offset := coalesce((v_item->>'offset_dias')::int, 0);
        if v_item->>'due_relative_to' = 'agenda' then
          -- Antes do evento recua pra sexta (preparação não pode encolher);
          -- no dia ou depois avança pra segunda.
          v_due := public._fora_do_fim_de_semana_br(
                     v_inicio + make_interval(days => v_offset), v_offset < 0);
        else
          v_due := public._fora_do_fim_de_semana_br(
                     now() + make_interval(days => v_offset), false);
        end if;
        insert into public.tarefas
          (caso_id, processo_admin_id, processo_judicial_id, responsavel_id, tipo,
           status, prioridade, titulo, descricao, due_at, origem, metadata)
        values
          (v_and.caso_id, v_padm, v_pjud, v_resp,
           coalesce(nullif(v_item->>'tipo', ''), 'interna'), 'a_fazer',
           coalesce((v_item->>'prioridade')::int, 3),
           replace(replace(v_item->>'titulo', '{nome_cliente}', coalesce(v_cliente, '')),
                   '{processo}', coalesce(v_numero, '')),
           nullif(replace(replace(coalesce(v_item->>'descricao', ''),
                   '{nome_cliente}', coalesce(v_cliente, '')), '{processo}', coalesce(v_numero, '')), ''),
           v_due, 'template',
           jsonb_build_object(
             'template_aplicado', 'audiencia_judicial',
             'aplicado_via', 'publicacao',
             'ancora_prazo', coalesce(v_item->>'due_relative_to', 'hoje'),
             'evento_id', v_ev_id,
             -- Nome antigo (vem da perícia), mesma função: data do evento na
             -- tarefa — chip "Audiência · dd/mm" e os botões usam.
             'pericia_em', v_inicio,
             'origem_andamento_id', v_and.id)
           || coalesce(v_item->'meta', '{}'::jsonb));
      end loop;
      v_status := 'agendada';

      -- Conferência aberta do MESMO processo (típico: DataJud chegou antes, sem
      -- data) vira análise de publicação repetida: alguém confere se as duas
      -- publicações são da mesma audiência. Processo nulo não casa nada.
      if v_pjud is not null then
        update public.tarefas t
           set titulo = 'Analisar publicação repetida - ' || coalesce(v_cliente, 'cliente'),
               prioridade = 2,
               descricao = 'Esta audiência já tinha chegado por outra publicação, sem data ('
                 || rtrim(coalesce(t.metadata->'conferir_audiencia'->>'motivo', 'sem data'), '.')
                 || '). Agora uma publicação do mesmo processo trouxe a data, e a audiência foi agendada automaticamente para '
                 || to_char(v_inicio at time zone 'America/Sao_Paulo', 'DD/MM/YYYY "às" HH24:MI')
                 || coalesce(' (' || v_local || ')', '')
                 || '. Confira se as duas publicações são da mesma audiência.'
                 || coalesce(E'\n\nPublicação sem data: ' || (t.metadata->'conferir_audiencia'->>'link_publicacao'), '')
                 || coalesce(E'\nPublicação com data: ' || v_link, ''),
               metadata = (t.metadata - 'conferir_audiencia')
                 || jsonb_build_object('analisar_publicacao_repetida', jsonb_build_object(
                      'evento_id', v_ev_id,
                      'origem_andamento_id', t.metadata->'conferir_audiencia'->'origem_andamento_id',
                      'link_publicacao', t.metadata->'conferir_audiencia'->'link_publicacao',
                      'andamento_com_data_id', v_and.id))
         where t.caso_id = v_and.caso_id
           and t.processo_judicial_id = v_pjud
           and t.status = 'a_fazer'
           and t.metadata ? 'conferir_audiencia'
           and t.origem_ref is distinct from 'andamento:' || v_and.id::text;
      end if;
    end if;

    v_quando_br := to_char(v_inicio at time zone 'America/Sao_Paulo', 'DD/MM/YYYY "às" HH24:MI');
    v_texto := public.audiencia_draft_texto(v_cliente, v_inicio, v_local)
               || coalesce(E'\n\n📄 Publicação: ' || v_link, '');

    -- Evento reaproveitado que JÁ tem aviso (tarefa de outra publicação, tarefa
    -- do próprio evento, ou aviso enviado): esta tarefa é repetida.
    if v_reusou then
      v_duplicada := exists (
          select 1 from public.tarefas t
           where t.id is distinct from v_aviso_id
             and (t.metadata->'enviar_aviso'->>'evento_id' = v_ev_id::text
                  or t.metadata->'avisar_cliente'->>'evento_id' = v_ev_id::text
                  or t.origem_ref = 'evento:' || v_ev_id::text))
        or exists (
          select 1 from public.comentarios c
           where c.evento_id = v_ev_id
             and c.tipo_aviso = 'audiencia_aviso'
             and c.rascunho = false);
    end if;

    if v_duplicada then
      v_status := 'repetida';
      v_analise := 'Chegou outra publicação da audiência de ' || v_quando_br
        || ', que já está na agenda e já tem aviso ao parceiro/cliente em andamento.'
        || ' Confira se é só repetição (intimação de outra parte, certidão, DataJud)'
        || ' ou se muda algo — local, link da sala, redesignação — e ajuste o evento'
        || ' e o aviso se precisar.'
        || case when v_local is not null and v_local is distinct from v_ev_local then
             E'\n\nLocal nesta publicação: ' || v_local
             || E'\nLocal na agenda: ' || coalesce(v_ev_local, '(vazio)')
           else '' end
        || coalesce(E'\n\nPublicação: ' || v_link, '');
    end if;

    if v_aviso_id is not null and v_aviso_st = 'a_fazer' then
      if v_duplicada then
        -- A tarefa de aviso desta publicação vira a análise: o aviso da
        -- audiência já existe em outro lugar, e mandar dois confunde o parceiro.
        update public.tarefas
           set titulo = 'Analisar publicação repetida - ' || coalesce(v_cliente, 'cliente'),
               tipo = 'interna',
               prioridade = 2,
               descricao = v_analise,
               metadata = (v_aviso_meta - 'enviar_aviso' - 'avisar_cliente')
                 || jsonb_build_object('analisar_publicacao_repetida', jsonb_build_object(
                      'evento_id', v_ev_id,
                      'origem_andamento_id', v_and.id,
                      'link_publicacao', v_link))
         where id = v_aviso_id;
      elsif v_aviso_meta ? 'enviar_aviso' then
        update public.tarefas
           set descricao = 'Audiência agendada automaticamente para ' || v_quando_br
                 || coalesce(' (' || v_local || ')', '')
                 || '. Confira com a publicação e envie o aviso pelo botão aqui na tarefa.'
                 || case when v_outra is not null then
                      E'\n\n⚠️ O caso já tinha audiência agendada em '
                      || to_char(v_outra at time zone 'America/Sao_Paulo', 'DD/MM/YYYY HH24:MI')
                      || ' — se esta for redesignação, exclua a antiga na Agenda.'
                    else '' end,
               metadata = v_aviso_meta || jsonb_build_object('enviar_aviso',
                 (v_aviso_meta->'enviar_aviso')
                 || jsonb_build_object('evento_id', v_ev_id, 'texto', v_texto))
         where id = v_aviso_id;
      else
        -- Caso sem parceiro: "Avisar o cliente" com os dados reais.
        update public.tarefas
           set descricao = 'Audiência agendada automaticamente para ' || v_quando_br
                 || '. Caso sem parceiro indicador: fale com o cliente e confirme que ele está ciente.'
                 || E' Texto de referência:\n\n'
                 || regexp_replace(v_texto, E'\n*✅[^\n]*', '', 'g'),
               metadata = v_aviso_meta || jsonb_build_object('avisar_cliente',
                 (v_aviso_meta->'avisar_cliente') || jsonb_build_object('evento_id', v_ev_id))
         where id = v_aviso_id;
      end if;
    elsif v_aviso_id is null and v_duplicada then
      insert into public.tarefas
        (caso_id, responsavel_id, tipo, status, prioridade, titulo, descricao,
         due_at, origem, origem_ref, processo_admin_id, processo_judicial_id, metadata)
      values
        (v_and.caso_id, v_resp, 'interna', 'a_fazer', 2,
         'Analisar publicação repetida - ' || coalesce(v_cliente, 'cliente'),
         v_analise, now(), 'enviar_aviso', 'andamento:' || v_and.id::text, v_padm, v_pjud,
         jsonb_build_object('analisar_publicacao_repetida', jsonb_build_object(
           'evento_id', v_ev_id,
           'origem_andamento_id', v_and.id,
           'link_publicacao', v_link)))
      on conflict do nothing;
    elsif v_aviso_id is null then
      -- Nenhuma tarefa de aviso existia (regex estreito do gatilho antigo):
      -- cria no mesmo formato dele, já completa.
      if v_parceiro is not null then
        insert into public.tarefas
          (caso_id, responsavel_id, tipo, status, prioridade, titulo, descricao,
           due_at, origem, origem_ref, processo_admin_id, processo_judicial_id, metadata)
        values
          (v_and.caso_id, v_resp, 'contato_cliente', 'a_fazer', 1,
           'Enviar aviso da audiência ao parceiro - ' || coalesce(v_cliente, 'cliente'),
           'Audiência agendada automaticamente para ' || v_quando_br
             || coalesce(' (' || v_local || ')', '')
             || '. Confira com a publicação e envie o aviso pelo botão aqui na tarefa.',
           now(), 'enviar_aviso', 'andamento:' || v_and.id::text, v_padm, v_pjud,
           jsonb_build_object('enviar_aviso', jsonb_build_object(
             'tipo_aviso', 'audiencia_aviso',
             'evento_id', v_ev_id,
             'texto', v_texto,
             'origem_andamento_id', v_and.id)))
        on conflict do nothing;
      else
        insert into public.tarefas
          (caso_id, responsavel_id, tipo, status, prioridade, titulo, descricao,
           due_at, origem, origem_ref, processo_admin_id, processo_judicial_id, metadata)
        values
          (v_and.caso_id, v_resp, 'contato_cliente', 'a_fazer', 1,
           'Avisar o cliente da audiência - ' || coalesce(v_cliente, 'cliente'),
           'Audiência agendada automaticamente para ' || v_quando_br
             || '. Caso sem parceiro indicador: fale com o cliente e confirme que ele está ciente.'
             || E' Texto de referência:\n\n'
             || regexp_replace(v_texto, E'\n*✅[^\n]*', '', 'g'),
           now(), 'manual', 'andamento:' || v_and.id::text, v_padm, v_pjud,
           jsonb_build_object('avisar_cliente', jsonb_build_object(
             'tipo_aviso', 'audiencia_aviso',
             'evento_id', v_ev_id,
             'origem_andamento_id', v_and.id)));
      end if;
    end if;
  end if;

  update public.andamentos
     set metadata = coalesce(metadata, '{}'::jsonb)
                    || jsonb_build_object('audiencia_leitura', jsonb_build_object(
                         'status', v_status,
                         'evento_id', v_ev_id,
                         'em', now(),
                         'leitura', p_leitura))
   where id = v_and.id;

  return jsonb_build_object('status', v_status, 'evento_id', v_ev_id);
end;
$function$;

-- Só a edge (service_role) aplica. Sem isto o grant default deixaria anon e
-- authenticated criarem evento/tarefa a partir de qualquer andamento.
revoke all on function public.aplicar_audiencia_da_publicacao(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.aplicar_audiencia_da_publicacao(uuid, jsonb) to service_role;
revoke all on function public._fora_do_fim_de_semana_br(timestamptz, boolean) from public, anon, authenticated;
grant execute on function public._fora_do_fim_de_semana_br(timestamptz, boolean) to service_role;

-- ---------------------------------------------------------------------------
-- 3. Gatilho: publicação de audiência → edge (assíncrono, pg_net)
-- ---------------------------------------------------------------------------
create or replace function public.tg_audiencia_publicacao_ler()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_texto  text;
  v_ligado text;
  v_url    text;
begin
  if new.caso_id is null then return new; end if;
  -- Só o que chega dos tribunais (DJEN, inclusive vínculo manual; DataJud).
  if new.origem not in ('djen', 'datajud') then return new; end if;
  if new.metadata ? 'tipo_aviso' then return new; end if;
  -- Backfill histórico não vira audiência (mesma janela dos outros gatilhos).
  if new.data_evento is not null and new.data_evento < (now() - interval '30 days') then
    return new;
  end if;

  v_texto := coalesce(new.titulo, '') || ' ' || coalesce(new.descricao, '');
  -- Mais largo que o do aviso: "DESIGNO/designa audiência" também passa. Falso
  -- positivo aqui só custa uma leitura — quem decide é a IA.
  if not (v_texto ~* 'audi[eê]nci'
          and v_texto ~* '(marcad|agendad|designad|redesignad|pautad|\mdesign[oa]\M)') then
    return new;
  end if;

  select valor into v_ligado from public.app_config where chave = 'audiencia_leitura_auto';
  if coalesce(v_ligado, 'false') <> 'true' then return new; end if;

  select valor into v_url from public.app_config where chave = 'edge_base_url';
  if v_url is null then
    raise warning 'tg_audiencia_publicacao_ler: app_config.edge_base_url ausente (andamento %)', new.id;
    return new;
  end if;

  perform net.http_post(
    url := v_url || '/ler-audiencia-publicacao',
    headers := '{"Content-Type": "application/json", "x-region": "sa-east-1"}'::jsonb,
    body := jsonb_build_object('andamento_id', new.id),
    timeout_milliseconds := 60000
  );
  return new;
exception when others then
  -- Nunca derrubar a entrada da publicação: a tarefa de aviso do gatilho
  -- antigo já garantiu que ela não passa batida.
  raise warning 'tg_audiencia_publicacao_ler falhou (andamento %): % / %',
    new.id, SQLSTATE, SQLERRM;
  return new;
end;
$function$;

drop trigger if exists trg_audiencia_publicacao_ler on public.andamentos;
create trigger trg_audiencia_publicacao_ler
  after insert on public.andamentos
  for each row execute function public.tg_audiencia_publicacao_ler();

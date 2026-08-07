-- migration_acompanhamento_pericia.sql
--
-- Acompanhamento do RESULTADO da pericia: checagem de 10 em 10 dias, com
-- escalonamento em 30/60/90 dias, e troca automatica da etiqueta.
--
-- Como fica o ciclo:
--
--   pericia agendada
--     -> (ja existia) "Avisar cliente", evento na agenda, "Confirmar
--        comparecimento" (+1 dia util)
--     -> NOVO: "Conferir resultado da pericia", primeira checagem em +10 dias
--
--   dia seguinte a pericia
--     -> etiqueta do cliente troca de PERICIA_AGENDADA_INSS para
--        AGUARDANDO_RESULTADO_DE_PERICIA
--
--   a cada checagem, a equipe abre a tarefa e responde:
--     "Ainda sem resultado" -> registra e reagenda +10 dias
--     "Resultado saiu"      -> encerra
--
--   em paralelo, contando da pericia:
--     30 dias sem resultado -> alerta "Fazer ouvidoria"
--     60 dias               -> alerta "Peticionar por mora"
--     90 dias               -> alerta "Ajuizar"
--
-- Os alertas nascem de job diario, NAO do clique: se ninguem clicar em nada,
-- o escalonamento acontece do mesmo jeito. E a diferenca entre um lembrete e
-- um controle de prazo.
--
-- Decisoes com a Naira (2026-08-07):
--   - o loop de 10 dias nao tem teto; encerra quando o resultado sai;
--   - as etiquetas passam a ser mantidas SO aqui (o escritorio parou de
--     sincronizar com o Tramitacao Inteligente; a ultima migracao esta sendo
--     feita a mao).
--
-- Idempotente.

-- ---------------------------------------------------------------------------
-- 1. origem nova pras tarefas deste fluxo
-- ---------------------------------------------------------------------------
alter table public.tarefas drop constraint if exists tarefas_origem_check;
alter table public.tarefas add constraint tarefas_origem_check
  check (origem = any (array[
    'manual', 'template', 'sync_inss_email', 'sync_djen', 'sync_legalmail',
    'migracao_ti', 'ia', 'pericia_lembrete', 'pericia_acompanhamento'
  ]));

-- ---------------------------------------------------------------------------
-- 2. Template: a tarefa de resultado vira a checagem recorrente
-- ---------------------------------------------------------------------------
-- Antes: "Verificar resultado da pericia", +7 dias, tarefa solta que morria
-- sozinha. Agora e a primeira volta do ciclo de 10 dias, marcada com
-- acompanhamento_pericia=true — e o componente no app usa essa marca pra
-- mostrar os botoes.
update public.tarefa_templates
   set itens = (
     select jsonb_agg(
       case
         when item->>'titulo' like 'Verificar resultado da perícia%'
           then item
                || jsonb_build_object(
                     'titulo', 'Conferir resultado da perícia - {nome_cliente}',
                     'descricao', 'Conferir se o resultado da perícia saiu. Se ainda não saiu, use o botão para reagendar a próxima conferência em 10 dias.',
                     'offset_dias', 10,
                     'meta', jsonb_build_object('acompanhamento_pericia', true)
                   )
         else item
       end
       order by ord
     )
     from jsonb_array_elements(itens) with ordinality as t(item, ord)
   )
 where nome = 'pericia_parceiro'
   and itens::text like '%Verificar resultado da perícia%';

-- ---------------------------------------------------------------------------
-- 3. Etiqueta: PERICIA_AGENDADA* -> AGUARDANDO_RESULTADO_DE_PERICIA
-- ---------------------------------------------------------------------------
-- clientes.tags e jsonb no formato [{id, name, color}, ...] — o formato que
-- veio do Tramitacao Inteligente. Trocamos preservando o formato, pra nao
-- quebrar quem le a etiqueta pelo nome.
create or replace function public.trocar_etiqueta_pos_pericia()
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  r      record;
  v_nova jsonb;
  v_n    int := 0;
begin
  -- Cor/id da etiqueta de destino: reaproveita a que ja existe em algum
  -- cliente; se ninguem tiver, cria uma entrada so com o nome.
  select to_jsonb(t) into v_nova
    from (
      select tag->>'id' as id, tag->>'name' as name, tag->>'color' as color
        from public.clientes c
        cross join lateral jsonb_array_elements(c.tags) as tag
       where tag->>'name' = 'AGUARDANDO_RESULTADO_DE_PERICIA'
       limit 1
    ) t;
  if v_nova is null then
    v_nova := jsonb_build_object('name', 'AGUARDANDO_RESULTADO_DE_PERICIA');
  end if;

  for r in
    select distinct c.id as cliente_id, c.tags
      from public.agenda_eventos e
      join public.casos k    on k.id = e.caso_id
      join public.clientes c on c.id = k.cliente_id
     where e.tipo = 'pericia'
       -- ja aconteceu (o dia seguinte a pericia)
       and e.start_at < now()
       -- e recente: nao mexe em pericia de meses atras
       and e.start_at > now() - interval '120 days'
       and exists (
         select 1 from jsonb_array_elements(c.tags) as tag
          where tag->>'name' in ('PERICIA_AGENDADA', 'PERICIA_AGENDADA_INSS')
       )
  loop
    update public.clientes
       set tags = (
         -- tira as de "agendada" e garante a de "aguardando resultado"
         select coalesce(jsonb_agg(tag), '[]'::jsonb) ||
                case when exists (
                  select 1 from jsonb_array_elements(r.tags) as t2
                   where t2->>'name' = 'AGUARDANDO_RESULTADO_DE_PERICIA'
                ) then '[]'::jsonb else jsonb_build_array(v_nova) end
           from jsonb_array_elements(r.tags) as tag
          where tag->>'name' not in ('PERICIA_AGENDADA', 'PERICIA_AGENDADA_INSS')
       )
     where id = r.cliente_id;
    v_n := v_n + 1;
  end loop;

  return v_n;
end;
$$;

comment on function public.trocar_etiqueta_pos_pericia() is
  'Troca PERICIA_AGENDADA(_INSS) por AGUARDANDO_RESULTADO_DE_PERICIA nos clientes cuja pericia ja ocorreu. Idempotente.';

-- ---------------------------------------------------------------------------
-- 4. Escalonamento: 30 -> ouvidoria, 60 -> peticionar, 90 -> ajuizar
-- ---------------------------------------------------------------------------
create or replace function public.criar_alertas_escalonamento_pericia()
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  r       record;
  et      record;
  v_dias  int;
  v_n     int := 0;
begin
  for r in
    select t.id as tarefa_id, t.caso_id, t.responsavel_id,
           t.processo_admin_id, t.processo_judicial_id,
           (t.metadata->>'pericia_em')::timestamptz as pericia_em,
           cl.nome as cliente
      from public.tarefas t
      join public.casos k     on k.id = t.caso_id
      join public.clientes cl on cl.id = k.cliente_id
     where t.origem in ('template', 'pericia_acompanhamento')
       and coalesce((t.metadata->>'acompanhamento_pericia')::boolean, false)
       and t.status in ('a_fazer', 'fazendo')
       and t.metadata->>'pericia_em' is not null
  loop
    v_dias := extract(day from (now() - r.pericia_em))::int;

    for et in
      select * from (values
        ('ouvidoria',    30, 'Fazer ouvidoria - ',    'Resultado da perícia não saiu em 30 dias. Abrir ouvidoria no INSS.'),
        ('peticionar',   60, 'Peticionar por mora - ','Resultado da perícia não saiu em 60 dias. Peticionar por mora administrativa.'),
        ('ajuizar',      90, 'Ajuizar - ',            'Resultado da perícia não saiu em 90 dias. Avaliar ajuizamento.')
      ) as x(chave, dias, titulo, descricao)
    loop
      continue when v_dias < et.dias;
      insert into public.tarefas
        (caso_id, responsavel_id, tipo, status, prioridade, titulo, descricao,
         due_at, origem, origem_ref, metadata,
         processo_admin_id, processo_judicial_id)
      select
        r.caso_id, r.responsavel_id, 'pos_protocolo', 'a_fazer', 1,
        et.titulo || r.cliente, et.descricao,
        now(), 'pericia_acompanhamento',
        'escalonamento:' || r.tarefa_id::text || ':' || et.chave,
        jsonb_build_object(
          'escalonamento_pericia', et.chave,
          'tarefa_origem', r.tarefa_id,
          'pericia_em', r.pericia_em,
          'dias_sem_resultado', v_dias
        ),
        r.processo_admin_id, r.processo_judicial_id
      where not exists (
        select 1 from public.tarefas x
         where x.origem = 'pericia_acompanhamento'
           and x.origem_ref = 'escalonamento:' || r.tarefa_id::text || ':' || et.chave
      );
      if found then v_n := v_n + 1; end if;
    end loop;
  end loop;

  return v_n;
end;
$$;

comment on function public.criar_alertas_escalonamento_pericia() is
  'Cria os alertas de ouvidoria (30d), peticionamento (60d) e ajuizamento (90d) para pericias sem resultado. Idempotente — dedup por origem_ref.';

-- ---------------------------------------------------------------------------
-- 5. Job diario unico, chamando as tres rotinas de pericia
-- ---------------------------------------------------------------------------
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
  v_lembretes := public.criar_rascunhos_lembrete_pericia();
  v_etiquetas := public.trocar_etiqueta_pos_pericia();
  v_alertas   := public.criar_alertas_escalonamento_pericia();
  return jsonb_build_object(
    'rascunhos_lembrete', v_lembretes,
    'etiquetas_trocadas', v_etiquetas,
    'alertas_escalonamento', v_alertas
  );
end;
$$;

do $agenda$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    if exists (select 1 from cron.job where jobname = 'lembrete-pericia-diario') then
      perform cron.unschedule('lembrete-pericia-diario');
    end if;
    if exists (select 1 from cron.job where jobname = 'rotina-pericia-diaria') then
      perform cron.unschedule('rotina-pericia-diaria');
    end if;
    perform cron.schedule(
      'rotina-pericia-diaria',
      '0 11 * * *',
      'select public.rotina_diaria_pericia();'
    );
  else
    raise notice 'pg_cron ausente — rotina de pericia NAO agendada neste ambiente.';
  end if;
end
$agenda$;

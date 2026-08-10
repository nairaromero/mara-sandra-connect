-- Acompanhamento de implementação do benefício concedido.
--
-- Benefício concedido não é benefício pago: entre a concessão e a implantação
-- em folha existe um vão que hoje ninguém vigia. Esta migration cria a 4ª
-- tarefa do template "Concedido", que fica voltando até alguém confirmar que
-- o benefício entrou em folha.
--
-- Cadência (dias ÚTEIS, sábado e domingo não contam — mesma convenção da
-- véspera do guichê; feriado não entra, o sistema não tem calendário deles):
--   processo ADMINISTRATIVO vinculado → confere a cada  5 dias úteis
--   processo JUDICIAL       vinculado → confere a cada 15 dias úteis
-- Quem define é o processo escolhido na tarefa (a tela já tem o seletor).
-- Sem processo vinculado, assume administrativo — o template nasce de e-mail
-- do INSS, que é sempre administrativo.
--
-- Escalonamento (dias CORRIDOS desde a concessão, uma tarefa nova por marco):
--   ADM      → 30d ouvidoria | 60d mora | 90d judicial
--   JUDICIAL → 60d petição de cumprimento | 120d execução
--
-- Idempotente.

-- ---------------------------------------------------------------------------
-- 1) Dias úteis
-- ---------------------------------------------------------------------------
create or replace function public.somar_dias_uteis(p_base date, p_n int)
returns date
 language plpgsql
 immutable
 set search_path to 'public', 'pg_temp'
as $function$
declare
  d date := p_base;
  i int := 0;
begin
  if p_n is null or p_n <= 0 then return p_base; end if;
  while i < p_n loop
    d := d + 1;
    -- 0 = domingo, 6 = sábado
    if extract(dow from d) not in (0, 6) then
      i := i + 1;
    end if;
  end loop;
  return d;
end;
$function$;

-- Cadência em dias úteis a partir do processo vinculado à tarefa.
create or replace function public.implementacao_cadencia(p_judicial boolean)
returns int
 language sql
 immutable
as $function$ select case when p_judicial then 15 else 5 end $function$;

-- ---------------------------------------------------------------------------
-- 2) origem nova nas tarefas de escalonamento
-- ---------------------------------------------------------------------------
-- A check constraint de origem já derrubou silenciosamente o escalonamento de
-- perícia uma vez; incluir a origem nova ANTES de qualquer insert que a use.
alter table public.tarefas drop constraint if exists tarefas_origem_check;
alter table public.tarefas add constraint tarefas_origem_check check (
  origem = any (array[
    'manual', 'template', 'sync_inss_email', 'sync_djen', 'sync_legalmail',
    'migracao_ti', 'ia', 'pericia_lembrete', 'pericia_acompanhamento',
    'implementacao_acompanhamento'
  ])
);

-- ---------------------------------------------------------------------------
-- 3) Prazo inicial da tarefa de acompanhamento
-- ---------------------------------------------------------------------------
-- O motor de template só sabe somar dias corridos (offset_dias), então o
-- primeiro vencimento é ajustado aqui pra dias úteis. Só no INSERT: nos
-- UPDATEs quem manda é o botão "Ainda não implementado", senão qualquer edição
-- da tarefa reiniciaria o relógio.
create or replace function public.tg_implementacao_due_inicial()
returns trigger
 language plpgsql
 set search_path to 'public', 'pg_temp'
as $function$
declare
  v_n int;
begin
  if not coalesce((new.metadata->>'acompanhamento_implementacao')::boolean, false) then
    return new;
  end if;

  v_n := public.implementacao_cadencia(new.processo_judicial_id is not null);
  new.due_at := (public.somar_dias_uteis((now() at time zone 'America/Sao_Paulo')::date, v_n)
                 + time '09:00') at time zone 'America/Sao_Paulo';

  -- Âncora do escalonamento. Guardada na criação porque a data de concessão é
  -- o que interessa contar, não o created_at de uma tarefa que pode ser
  -- recriada ou editada depois.
  if new.metadata->>'concedido_em' is null then
    new.metadata := coalesce(new.metadata, '{}'::jsonb)
                    || jsonb_build_object('concedido_em', now());
  end if;

  return new;
end;
$function$;

drop trigger if exists trg_implementacao_due_inicial on public.tarefas;
create trigger trg_implementacao_due_inicial
  before insert on public.tarefas
  for each row execute function public.tg_implementacao_due_inicial();

-- ---------------------------------------------------------------------------
-- 4) Item novo no template "Concedido"
-- ---------------------------------------------------------------------------
-- Acrescenta sem reescrever os 3 itens que já existem (analise de deferimento,
-- andamento pro parceiro, baixar PA) e sem duplicar se rodar de novo.
update public.tarefa_templates
   set itens = itens || jsonb_build_array(jsonb_build_object(
         'tipo', 'pos_protocolo',
         'titulo', 'Acompanhamento de implementação - {nome_cliente}',
         'descricao',
           'Benefício concedido (requerimento {protocolo}). Acompanhar até a implantação em folha.' ||
           chr(10) || chr(10) ||
           'Confira a cada 5 dias úteis quando o processo vinculado for administrativo, ' ||
           'ou a cada 15 dias úteis quando for judicial. Use os botões da tarefa para ' ||
           'registrar a conferência — o prazo se renova sozinho.',
         'prioridade', 1,
         'offset_dias', 0,
         'executor_email', 'nairaromerovian@gmail.com',
         'interessados_emails', jsonb_build_array('marasandra.adv@gmail.com'),
         'meta', jsonb_build_object('acompanhamento_implementacao', true)
       )),
       updated_at = now()
 where nome = 'concedido'
   and not exists (
     select 1 from jsonb_array_elements(itens) it
      where (it->'meta'->>'acompanhamento_implementacao')::boolean is true
   );

-- ---------------------------------------------------------------------------
-- 5) aplicar_template: carregar meta e não inventar tarefa de andamento
-- ---------------------------------------------------------------------------
-- A versão anterior ignorava 'meta' (a flag de acompanhamento se perdia quando
-- a equipe aplicava o template pela tela) e criava tarefa até pros itens com
-- destino != tarefa — o item de andamento do "Concedido" virava uma tarefa
-- fantasma chamada "Benefício Concedido — iremos analisar e repassar".
create or replace function public.aplicar_template(
  p_caso_id uuid,
  p_template text,
  p_origem text default 'template',
  p_origem_ref text default null,
  p_responsavel uuid default null
)
 returns setof uuid
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_tpl    public.tarefa_templates%rowtype;
  v_item   jsonb;
  v_id     uuid;
begin
  select * into v_tpl from public.tarefa_templates where nome = p_template and ativo = true;
  if not found then
    raise exception 'Template % não encontrado ou inativo', p_template;
  end if;

  for v_item in select * from jsonb_array_elements(v_tpl.itens) loop
    -- Itens com destino próprio (andamento, agenda, solicitação de documento)
    -- são tratados pela edge function do INSS, que tem o contexto do e-mail.
    -- Aqui eles são pulados em vez de virar tarefa.
    continue when coalesce(v_item->>'destino', 'tarefa') <> 'tarefa';

    insert into public.tarefas (
      caso_id, responsavel_id, tipo, prioridade, titulo, descricao,
      due_at, origem, origem_ref, created_by, metadata
    ) values (
      p_caso_id,
      coalesce(p_responsavel, (v_item->>'responsavel_id')::uuid),
      coalesce(v_item->>'tipo', 'interna'),
      coalesce((v_item->>'prioridade')::smallint, 2),
      v_item->>'titulo',
      v_item->>'descricao',
      case
        when v_item ? 'offset_dias' then
          (now() + ((v_item->>'offset_dias')::int || ' days')::interval)
        else null
      end,
      p_origem,
      p_origem_ref,
      auth.uid(),
      coalesce(v_item->'meta', '{}'::jsonb)
    )
    returning id into v_id;
    return next v_id;
  end loop;
end;
$function$;

-- ---------------------------------------------------------------------------
-- 6) Escalonamento por tempo sem implantação
-- ---------------------------------------------------------------------------
create or replace function public.criar_alertas_escalonamento_implementacao()
returns integer
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
declare
  r      record;
  et     record;
  v_dias int;
  v_n    int := 0;
begin
  for r in
    select t.id as tarefa_id, t.caso_id, t.responsavel_id,
           t.processo_admin_id, t.processo_judicial_id,
           coalesce((t.metadata->>'concedido_em')::timestamptz, t.created_at) as concedido_em,
           cl.nome as cliente
      from public.tarefas t
      join public.casos k     on k.id = t.caso_id
      join public.clientes cl on cl.id = k.cliente_id
     where coalesce((t.metadata->>'acompanhamento_implementacao')::boolean, false)
       and t.status in ('a_fazer', 'fazendo')
  loop
    v_dias := extract(day from (now() - r.concedido_em))::int;

    for et in
      select * from (
        select * from (values
          ('ouvidoria',  30, 'Fazer ouvidoria (implantação) - ',
           'Benefício concedido há 30 dias e ainda não implantado. Abrir ouvidoria no INSS (135).'),
          ('mora',       60, 'Peticionar por mora (implantação) - ',
           'Benefício concedido há 60 dias e ainda não implantado. Peticionar por mora administrativa.'),
          ('judicial',   90, 'Avaliar via judicial (implantação) - ',
           'Benefício concedido há 90 dias e ainda não implantado. Avaliar medida judicial.')
        ) as a(chave, dias, titulo, descricao)
        where r.processo_judicial_id is null
        union all
        select * from (values
          ('cumprimento', 60, 'Peticionar cumprimento de sentença - ',
           'Benefício deferido há 60 dias e ainda não implantado. Peticionar cumprimento de sentença.'),
          ('execucao',   120, 'Executar (implantação) - ',
           'Benefício deferido há 120 dias e ainda não implantado. Promover execução.')
        ) as b(chave, dias, titulo, descricao)
        where r.processo_judicial_id is not null
      ) marcos
    loop
      continue when v_dias < et.dias;

      insert into public.tarefas
        (caso_id, responsavel_id, tipo, status, prioridade, titulo, descricao,
         due_at, origem, origem_ref, metadata,
         processo_admin_id, processo_judicial_id)
      select
        r.caso_id, r.responsavel_id, 'pos_protocolo', 'a_fazer', 1,
        et.titulo || r.cliente, et.descricao,
        now(), 'implementacao_acompanhamento',
        'escalonamento_impl:' || r.tarefa_id::text || ':' || et.chave,
        jsonb_build_object(
          'escalonamento_implementacao', et.chave,
          'tarefa_origem', r.tarefa_id,
          'concedido_em', r.concedido_em,
          'dias_sem_implantacao', v_dias
        ),
        r.processo_admin_id, r.processo_judicial_id
      where not exists (
        select 1 from public.tarefas x
         where x.origem = 'implementacao_acompanhamento'
           and x.origem_ref = 'escalonamento_impl:' || r.tarefa_id::text || ':' || et.chave
      );
      if found then v_n := v_n + 1; end if;
    end loop;
  end loop;

  return v_n;
end;
$function$;

-- ---------------------------------------------------------------------------
-- 7) Rotina diária + agendamento
-- ---------------------------------------------------------------------------
create or replace function public.rotina_diaria_implementacao()
returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
declare
  v_alertas int;
begin
  v_alertas := public.criar_alertas_escalonamento_implementacao();
  return jsonb_build_object('alertas_escalonamento', v_alertas);
end;
$function$;

-- pg_cron só existe em produção; no staging a migration roda igual, só sem
-- agendar (a função continua chamável na mão pra testar).
do $$
begin
  if not exists (select 1 from pg_namespace where nspname = 'cron') then
    raise notice 'pg_cron ausente — job diario nao agendado neste ambiente';
    return;
  end if;
  if not exists (select 1 from cron.job where jobname = 'rotina-implementacao-diaria') then
    perform cron.schedule(
      'rotina-implementacao-diaria',
      '10 11 * * *',
      'select public.rotina_diaria_implementacao();'
    );
  end if;
end $$;

-- Correções da validação agressiva do kanban do parceiro (2026-09-01).
--
-- HIGH-2  : trava a escrita do parceiro em solicitacoes_documento a
--           pendente->atendido (+ comentario/anexo). Sem isto ele podia, via
--           API, estender o proprio prazo_at, silenciar lembretes e se
--           auto-dispensar (reproduzido no staging).
-- MEDIUM-3: marca o lembrete de forma ATOMICA (update condicional + FOUND),
--           senao dois runs concorrentes mandavam o mesmo e-mail 2x e gravavam
--           marcador duplicado (reproduzido no staging).
-- LOW-6   : agenda_do_parceiro() passa a devolver a FASE do caso e aceita um
--           corte de data opcional. O kanban deixa de buscar TODOS os casos so
--           pra mapear fase, e pede so o futuro; a Agenda (calendario) chama
--           sem corte e continua vendo o passado.
--
-- Idempotente: drop if exists / create or replace.

-- ---------------------------------------------------------------------------
-- HIGH-2: guard de escrita do parceiro
-- ---------------------------------------------------------------------------
-- A policy solicitacoes_parceiro_update (caso_do_parceiro) libera UPDATE da
-- linha inteira — RLS nao restringe COLUNA. Este trigger BEFORE UPDATE fecha
-- isso: quando quem escreve e um PARCEIRO autenticado (auth.uid() != null e
-- nao-interno), so passa a transicao pendente->atendido e as colunas do
-- cumprimento; o resto volta pro valor antigo.
--
-- Cron/edge (service_role) tem auth.uid() nulo -> passa direto (e como o job
-- de lembrete precisa escrever lembretes_enviados). Interno passa direto.

create or replace function public.tg_solicitacao_parceiro_guard()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  -- Sem contexto de usuario (cron, edge com service_role) ou interno: libera.
  if auth.uid() is null or public.is_interno() then
    return NEW;
  end if;

  -- Daqui pra baixo: parceiro autenticado. So pode CUMPRIR.
  if OLD.status is distinct from 'pendente' or NEW.status is distinct from 'atendido' then
    raise exception 'parceiro so pode marcar solicitacao pendente como atendida (status % -> %)',
      OLD.status, NEW.status
      using errcode = 'check_violation';
  end if;

  -- Colunas que o parceiro NAO controla: reverte pro valor antigo (blinda
  -- prazo_at, origem, tipo/tipos, descricao, vinculo e os marcadores).
  NEW.prazo_at           := OLD.prazo_at;
  NEW.lembretes_enviados := OLD.lembretes_enviados;
  NEW.origem             := OLD.origem;
  NEW.tipo               := OLD.tipo;
  NEW.tipos              := OLD.tipos;
  NEW.descricao          := OLD.descricao;
  NEW.caso_id            := OLD.caso_id;
  NEW.solicitado_por     := OLD.solicitado_por;
  NEW.responsavel_id     := OLD.responsavel_id;
  NEW.data_solicitacao   := OLD.data_solicitacao;

  return NEW;
end;
$$;

drop trigger if exists trg_solicitacao_parceiro_guard on public.solicitacoes_documento;
create trigger trg_solicitacao_parceiro_guard
  before update on public.solicitacoes_documento
  for each row execute function public.tg_solicitacao_parceiro_guard();

comment on function public.tg_solicitacao_parceiro_guard() is
  'BEFORE UPDATE: parceiro autenticado so pode cumprir (pendente->atendido) e anexar comentario/doc; demais colunas revertem. Cron/edge (auth.uid null) e interno passam.';

-- ---------------------------------------------------------------------------
-- MEDIUM-3: lembrete marcado de forma atomica (sem e-mail duplicado)
-- ---------------------------------------------------------------------------

create or replace function public.enviar_lembretes_solicitacao()
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  r        record;
  v_url    text;
  v_hoje   date := (now() at time zone 'America/Sao_Paulo')::date;
  v_dias   int;
  v_marca  text;
  v_hit    boolean;
  v_n      int := 0;
begin
  select valor into v_url from public.app_config where chave = 'edge_base_url';

  for r in
    select s.id, s.prazo_at, s.lembretes_enviados
      from public.solicitacoes_documento s
      join public.casos c on c.id = s.caso_id
     where s.status = 'pendente'
       and s.prazo_at is not null
       and s.origem <> 'interna'
       and c.parceiro_id is not null
  loop
    v_dias := (r.prazo_at at time zone 'America/Sao_Paulo')::date - v_hoje;

    v_marca := case
      when v_dias <= 0 then '0d'
      when v_dias <= 3 then '3d'
      when v_dias <= 7 then '7d'
      else null
    end;
    if v_marca is null then
      continue;
    end if;

    -- ATOMICO: so um vencedor marca. Se outro run (ou este ja rodou) marcou,
    -- o where nao casa, FOUND=false e nao ha e-mail — mata o duplo-envio.
    update public.solicitacoes_documento
       set lembretes_enviados = lembretes_enviados || to_jsonb(v_marca)
     where id = r.id
       and not (lembretes_enviados ? v_marca);
    get diagnostics v_hit = row_count;
    if v_hit is not true then
      continue;
    end if;

    if v_url is not null
       and exists (select 1 from pg_extension where extname = 'pg_net') then
      perform net.http_post(
        url := v_url || '/notify-solicitacao-doc',
        headers := '{"Content-Type": "application/json", "x-region": "sa-east-1"}'::jsonb,
        body := jsonb_build_object('solicitacao_id', r.id, 'lembrete', v_marca),
        timeout_milliseconds := 30000
      );
    elsif v_url is null then
      raise warning 'app_config.edge_base_url ausente — lembrete % da solicitacao % sem e-mail', v_marca, r.id;
    end if;

    v_n := v_n + 1;
  end loop;

  return v_n;
end;
$$;

comment on function public.enviar_lembretes_solicitacao() is
  'Lembrete por e-mail de solicitacao pendente com prazo_at (7d/3d/no dia). Marca ATOMICO (update condicional) -> sem e-mail duplicado sob concorrencia. Job diario; idempotente.';

-- ---------------------------------------------------------------------------
-- LOW-6: agenda_do_parceiro devolve fase + aceita corte de data opcional
-- ---------------------------------------------------------------------------
-- Zero-arg antigo tem que sair antes: manter os dois criaria ambiguidade no
-- resolve de agenda_do_parceiro().
drop function if exists public.agenda_do_parceiro();

create or replace function public.agenda_do_parceiro(p_desde timestamptz default null)
returns table (
  fonte text,
  id uuid,
  caso_id uuid,
  tipo text,        -- 'pericia' | 'audiencia'
  fase text,        -- fase do caso (analise|admin|judicial|finalizado)
  cliente_nome text,
  titulo text,
  start_at timestamptz,
  end_at timestamptz,
  local text,
  natureza text     -- 'judicial' | 'admin' | null
)
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
  select
    'evento'::text as fonte,
    e.id, e.caso_id, e.tipo, c.fase::text, cl.nome, e.titulo, e.start_at, e.end_at, e.local,
    case
      when e.tipo = 'audiencia' then 'judicial'
      when e.processo_judicial_id is not null then 'judicial'
      when e.processo_admin_id is not null then 'admin'
      when e.titulo ~* 'judicial' then 'judicial'
      when e.titulo ~* 'inss' then 'admin'
      else null
    end as natureza
  from public.agenda_eventos e
  join public.casos c on c.id = e.caso_id and c.parceiro_id = auth.uid()
  left join public.clientes cl on cl.id = c.cliente_id
  where e.tipo in ('pericia', 'audiencia')
    and e.restrito_a is null
    and (p_desde is null or e.end_at >= p_desde)
  union all
  select
    'tarefa'::text as fonte,
    t.id, t.caso_id, 'pericia'::text as tipo, c.fase::text, cl.nome, t.titulo,
    t.due_at as start_at,
    t.due_at as end_at,
    null::text as local,
    case
      when t.processo_judicial_id is not null then 'judicial'
      when t.processo_admin_id is not null then 'admin'
      when t.titulo ~* 'judicial' then 'judicial'
      when t.titulo ~* 'inss' then 'admin'
      else null
    end as natureza
  from public.tarefas t
  join public.casos c on c.id = t.caso_id and c.parceiro_id = auth.uid()
  left join public.clientes cl on cl.id = c.cliente_id
  where t.tipo = 'pericia'
    and t.status in ('a_fazer', 'fazendo')
    and t.due_at is not null
    and (p_desde is null or t.due_at >= p_desde)
    and (
      (t.metadata->>'pericia_evento')::boolean is true
      or (
        t.metadata->>'pericia_evento' is null
        and t.titulo !~* '(acompanh|contatar|resultado|ligar|compareceu|agendamento de)'
      )
    )
  order by 8
$$;

revoke all on function public.agenda_do_parceiro(timestamptz) from public, anon;
grant execute on function public.agenda_do_parceiro(timestamptz) to authenticated;

comment on function public.agenda_do_parceiro(timestamptz) is
  'Agenda sanitizada do parceiro (pericias + audiencias), com fase do caso. p_desde corta por data (kanban pede futuro; calendario chama sem corte). SECURITY DEFINER.';

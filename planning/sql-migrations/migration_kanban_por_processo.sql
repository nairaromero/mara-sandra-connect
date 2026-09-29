-- =============================================================================
-- Migration: o processo manda na coluna do kanban do parceiro (card #357)
--
-- Decisão da Naira (2026-09-18): a coluna do kanban vem do PROCESSO do item,
-- não da fase do caso. Um cliente que corre nas duas frentes aparece nas duas
-- colunas — hoje são 95 casos assim, e a fase única jogava todos em judicial.
--
-- O que entra aqui:
--   1. processo na solicitação de documento (é o que falta; tarefa e evento de
--      agenda já têm os dois campos);
--   2. `agenda_do_parceiro` devolve o processo do item, pra tela não precisar
--      adivinhar pela natureza/título;
--   3. a fase do caso vira RESUMO, mantida sozinha: requerimento PROTOCOLADO
--      -> 'admin'; ação ajuizada -> 'judicial'; precedência judicial > admin >
--      analise. Requerimento sem protocolo não promove (decisão da Naira).
--   4. caso 'finalizado' que recebe pedido novo REABRE, voltando pra frente do
--      processo do pedido.
--
-- Idempotente. Rodar SEMPRE no local primeiro (`--local`), depois staging, e
-- só então produção, com aval da Naira.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1) Processo na solicitação de documento
-- ---------------------------------------------------------------------------
alter table public.solicitacoes_documento
  add column if not exists processo_admin_id uuid references public.processos_admin(id) on delete set null,
  add column if not exists processo_judicial_id uuid references public.processos_judiciais(id) on delete set null;

-- Um pedido pertence a UMA frente (ou a nenhuma, quando o cliente ainda não
-- tem processo). Nunca às duas.
alter table public.solicitacoes_documento
  drop constraint if exists solicitacoes_documento_uma_frente;
alter table public.solicitacoes_documento
  add constraint solicitacoes_documento_uma_frente
  check (processo_admin_id is null or processo_judicial_id is null);

-- Frente de OUTRO caso não entra: sem isto, um bug de tela, um script ou a
-- ferramenta de IA pendura o pedido do cliente A no processo do cliente B, e
-- as tarefas dos gatilhos herdam esse processo (achado 5 da revisão do Yuri).
create or replace function public._solicitacao_processo_do_mesmo_caso()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if NEW.processo_admin_id is not null
     and not exists (
       select 1 from public.processos_admin pa
        where pa.id = NEW.processo_admin_id and pa.caso_id = NEW.caso_id
     ) then
    raise exception 'requerimento % não é do caso %', NEW.processo_admin_id, NEW.caso_id
      using errcode = 'check_violation';
  end if;

  if NEW.processo_judicial_id is not null
     and not exists (
       select 1 from public.processos_judiciais pj
        where pj.id = NEW.processo_judicial_id and pj.caso_id = NEW.caso_id
     ) then
    raise exception 'processo judicial % não é do caso %', NEW.processo_judicial_id, NEW.caso_id
      using errcode = 'check_violation';
  end if;

  return NEW;
end;
$$;

drop trigger if exists trg_solicitacao_processo_do_mesmo_caso on public.solicitacoes_documento;
create trigger trg_solicitacao_processo_do_mesmo_caso
  before insert or update of caso_id, processo_admin_id, processo_judicial_id
  on public.solicitacoes_documento
  for each row execute function public._solicitacao_processo_do_mesmo_caso();

create index if not exists idx_solicitacoes_processo_admin
  on public.solicitacoes_documento (processo_admin_id) where processo_admin_id is not null;
create index if not exists idx_solicitacoes_processo_judicial
  on public.solicitacoes_documento (processo_judicial_id) where processo_judicial_id is not null;

comment on column public.solicitacoes_documento.processo_admin_id is
  'Requerimento a que o pedido se refere. Define a coluna do kanban do parceiro (card #357).';
comment on column public.solicitacoes_documento.processo_judicial_id is
  'Processo judicial a que o pedido se refere. Define a coluna do kanban do parceiro (card #357).';

-- ---------------------------------------------------------------------------
-- 2) Fase do caso mantida sozinha (resumo)
--
-- `_caso_fase_pelo_processo` calcula a fase a partir dos processos do caso e
-- só AVANÇA: judicial > admin > analise. Quem corrigir à mão continua podendo
-- (a tela grava direto na coluna); o gatilho age quando um processo nasce ou
-- é protocolado. Apagar processo NÃO recalcula: como a fase só avança, não
-- haveria o que mudar (achado 11 da revisão do Yuri — antes o texto prometia
-- um gatilho de DELETE que nunca existiu).
-- ---------------------------------------------------------------------------
create or replace function public._fase_pelo_processo(p_caso_id uuid)
returns public.fase_caso
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select case
    when exists (select 1 from public.processos_judiciais pj where pj.caso_id = p_caso_id)
      then 'judicial'::public.fase_caso
    -- Requerimento só conta depois de protocolado (Naira, 2026-09-18).
    when exists (
      select 1 from public.processos_admin pa
       where pa.caso_id = p_caso_id and pa.data_protocolo is not null
    )
      then 'admin'::public.fase_caso
    else 'analise'::public.fase_caso
  end;
$$;

create or replace function public._caso_fase_pelo_processo()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_caso  uuid := coalesce(NEW.caso_id, OLD.caso_id);
  v_nova  public.fase_caso;
  v_atual public.fase_caso;
begin
  if v_caso is null then return coalesce(NEW, OLD); end if;

  select fase into v_atual from public.casos where id = v_caso;
  v_nova := public._fase_pelo_processo(v_caso);

  -- Só avança. 'finalizado' fica quieto aqui: quem reabre é o gatilho de
  -- pendência nova (item 3), não o cadastro de processo.
  if v_atual = 'finalizado' then return coalesce(NEW, OLD); end if;
  if v_atual = 'judicial' then return coalesce(NEW, OLD); end if;
  if v_atual = 'admin' and v_nova <> 'judicial' then return coalesce(NEW, OLD); end if;
  if v_nova = v_atual then return coalesce(NEW, OLD); end if;

  update public.casos set fase = v_nova where id = v_caso;
  return coalesce(NEW, OLD);
exception
  when others then
    -- Fase é resumo: erro aqui nunca pode derrubar o cadastro do processo.
    raise warning 'fase pelo processo falhou (caso %): %', v_caso, sqlerrm;
    return coalesce(NEW, OLD);
end;
$$;

drop trigger if exists trg_caso_fase_processo_admin on public.processos_admin;
create trigger trg_caso_fase_processo_admin
  after insert or update of data_protocolo, caso_id on public.processos_admin
  for each row execute function public._caso_fase_pelo_processo();

drop trigger if exists trg_caso_fase_processo_judicial on public.processos_judiciais;
create trigger trg_caso_fase_processo_judicial
  after insert or update of caso_id on public.processos_judiciais
  for each row execute function public._caso_fase_pelo_processo();

-- ---------------------------------------------------------------------------
-- 3) Caso finalizado que recebe pedido novo REABRE
--
-- Pedido = solicitação de documento, tarefa ou evento de agenda. Volta pra
-- frente do processo do pedido; sem processo, pros processos do caso.
-- ---------------------------------------------------------------------------
create or replace function public._reabre_caso_finalizado()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_fase public.fase_caso;
begin
  if NEW.caso_id is null then return NEW; end if;

  -- Reabrir é resposta a PEDIDO NOVO, não a qualquer linha que um robô grave.
  -- 14 funções do banco inserem tarefa sozinhas (alerta de escalonamento,
  -- triagem de DJE, os próprios gatilhos de solicitação): sem este filtro,
  -- qualquer uma delas ressuscitava o caso em silêncio — achado 6 da revisão
  -- do Yuri. Só tarefa de origem 'manual' (gente pedindo) reabre; as demais
  -- tabelas (solicitação, agenda) já são pedido por definição.
  if TG_TABLE_NAME = 'tarefas' and coalesce(NEW.origem, '') <> 'manual' then
    return NEW;
  end if;
  if (select fase from public.casos where id = NEW.caso_id) <> 'finalizado' then
    return NEW;
  end if;

  v_fase := case
    when NEW.processo_judicial_id is not null then 'judicial'::public.fase_caso
    when NEW.processo_admin_id is not null then 'admin'::public.fase_caso
    else public._fase_pelo_processo(NEW.caso_id)
  end;

  update public.casos set fase = v_fase where id = NEW.caso_id;
  return NEW;
exception
  when others then
    raise warning 'reabrir caso finalizado falhou (caso %): %', NEW.caso_id, sqlerrm;
    return NEW;
end;
$$;

drop trigger if exists trg_reabre_caso_solicitacao on public.solicitacoes_documento;
create trigger trg_reabre_caso_solicitacao
  after insert on public.solicitacoes_documento
  for each row execute function public._reabre_caso_finalizado();

drop trigger if exists trg_reabre_caso_tarefa on public.tarefas;
create trigger trg_reabre_caso_tarefa
  after insert on public.tarefas
  for each row execute function public._reabre_caso_finalizado();

drop trigger if exists trg_reabre_caso_evento on public.agenda_eventos;
create trigger trg_reabre_caso_evento
  after insert on public.agenda_eventos
  for each row execute function public._reabre_caso_finalizado();

-- ---------------------------------------------------------------------------
-- 4) agenda_do_parceiro devolve o processo do item
--
-- Reescrita a partir do pg_get_functiondef de PRODUÇÃO (2026-09-18); a única
-- mudança são as duas colunas novas no retorno (processo_admin_id e
-- processo_judicial_id). `natureza` fica como está, pra não quebrar quem já usa.
-- ---------------------------------------------------------------------------
drop function if exists public.agenda_do_parceiro(timestamptz, uuid);
create function public.agenda_do_parceiro(
  p_desde timestamptz default null,
  p_parceiro_id uuid default null
)
returns table(
  fonte text, id uuid, caso_id uuid, tipo text, fase text, cliente_nome text,
  titulo text, start_at timestamptz, end_at timestamptz, local text, natureza text,
  processo_admin_id uuid, processo_judicial_id uuid
)
language sql
stable
security definer
set search_path = public, pg_temp
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
    end as natureza,
    e.processo_admin_id,
    e.processo_judicial_id
  from public.agenda_eventos e
  join public.casos c
    on c.id = e.caso_id
   and c.parceiro_id = (
     case when p_parceiro_id is not null and public.is_admin()
          then p_parceiro_id else auth.uid() end
   )
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
    end as natureza,
    t.processo_admin_id,
    t.processo_judicial_id
  from public.tarefas t
  join public.casos c
    on c.id = t.caso_id
   and c.parceiro_id = (
     case when p_parceiro_id is not null and public.is_admin()
          then p_parceiro_id else auth.uid() end
   )
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
  -- `order by 8` = start_at. Estava na versão de produção e sumiu na primeira
  -- escrita desta migration (achado 3 da revisão do Yuri): sem ele a RPC
  -- devolve a ordem arbitrária do UNION ALL, e `agenda-pericias-parceiro.tsx`
  -- consome sem ordenar no cliente.
  order by 8;
$$;

-- Recriar a função RESSUSCITA o EXECUTE do PUBLIC (default do Postgres) e os
-- grants padrão do Supabase. Em produção (conferido em 2026-09-19) só
-- `authenticated` executa: anon e service_role estão negados. Reproduz isso
-- aqui, senão o deploy abriria a função pro anônimo sem ninguém notar —
-- conferir sempre com has_function_privilege, nunca pelo texto do proacl.
revoke all on function public.agenda_do_parceiro(timestamptz, uuid) from public;
revoke all on function public.agenda_do_parceiro(timestamptz, uuid) from anon;
revoke all on function public.agenda_do_parceiro(timestamptz, uuid) from service_role;
grant execute on function public.agenda_do_parceiro(timestamptz, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 5) O guard do parceiro cobre também as colunas novas
--
-- Reescrita a partir do `pg_get_functiondef` de PRODUÇÃO (2026-09-23); a única
-- mudança são as duas linhas marcadas. Sem elas o parceiro podia, no MESMO
-- update em que cumpre, escolher a frente do pedido — e
-- `_solicitacao_cumprida_parceiro_cria_tarefa` copia esse valor pra tarefa
-- interna que nasce. Achado 4 da revisão do Yuri no PR #391: é justamente o
-- campo que este lote torna autoritativo.
-- ---------------------------------------------------------------------------
create or replace function public.tg_solicitacao_parceiro_guard()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
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
  NEW.prazo_at             := OLD.prazo_at;
  NEW.lembretes_enviados   := OLD.lembretes_enviados;
  NEW.origem               := OLD.origem;
  NEW.tipo                 := OLD.tipo;
  NEW.tipos                := OLD.tipos;
  NEW.descricao            := OLD.descricao;
  NEW.caso_id              := OLD.caso_id;
  NEW.solicitado_por       := OLD.solicitado_por;
  NEW.responsavel_id       := OLD.responsavel_id;
  NEW.data_solicitacao     := OLD.data_solicitacao;
  NEW.processo_admin_id    := OLD.processo_admin_id;     -- #357
  NEW.processo_judicial_id := OLD.processo_judicial_id;  -- #357

  return NEW;
end;
$function$;

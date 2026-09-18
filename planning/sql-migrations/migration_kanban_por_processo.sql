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
-- (a tela grava direto na coluna); o gatilho só age quando um processo nasce,
-- é protocolado ou é apagado.
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
    );
$$;

grant execute on function public.agenda_do_parceiro(timestamptz, uuid) to authenticated;

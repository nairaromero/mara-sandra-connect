-- =============================================================================
-- Migration: radar em DOIS NÍVEIS + publicação ACIONÁVEL vira tarefa
-- (desenho aprovado pela Naira, 2026-08-31: critério (a) processo judicial
-- cadastrado = acompanhamento passivo; (b) TODOS os cinco gatilhos).
--
-- 1) casos_sem_proximo_passo() v2: caso órfão COM processo judicial vinculado
--    e movimento recente é "acompanhamento judicial" (neutro, sem alarme);
--    entra no alarme só se ficar MUDO por 90 dias (pulso). Órfão sem processo
--    judicial segue no alarme ("sem próximo passo").
--
-- 2) Publicação do DJEN/DataJud com conteúdo que EXIGE ação abre tarefa de
--    prazo automaticamente (o acompanhamento judicial é por EVENTO):
--      - proposta de acordo      → Manifestar sobre proposta de acordo (D+2 úteis)
--      - sentença                → Analisar sentença - decidir recurso  (D+2 úteis)
--      - laudo pericial          → Analisar laudo pericial              (D+3 úteis)
--      - RPV / precatório        → Verificar pagamento RPV/precatório   (D+5 úteis)
--      - intimação p/ manifestar → Manifestar nos autos                 (D+2 úteis)
--    Perícia marcada / audiência designada ficam com o gatilho irmão já
--    existente (tg_rascunho_pericia_andamento) — aqui a gente se recusa a
--    duplicar. Um gatilho por publicação: o mais específico vence.
--    Dedup por andamento (origem_ref). Due às 09:00 de Brasília.
--
-- Idempotente. SÓ STAGING até a Naira validar.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Helper: N dias úteis pra frente (sábado/domingo pulados; feriado não entra,
-- mesma convenção do fatalPorDiasUteis do front).
-- ---------------------------------------------------------------------------
create or replace function public._dia_util_apos(p_base date, p_uteis integer)
returns date
language plpgsql
immutable
as $$
declare
  d date := p_base;
  n int := 0;
begin
  while n < p_uteis loop
    d := d + 1;
    if extract(dow from d) not in (0, 6) then n := n + 1; end if;
  end loop;
  return d;
end;
$$;

-- ---------------------------------------------------------------------------
-- 1) Radar v2.
-- ---------------------------------------------------------------------------
drop function if exists public.casos_sem_proximo_passo();
create or replace function public.casos_sem_proximo_passo()
returns table (
  caso_id uuid,
  cliente_nome text,
  tipo_beneficio text,
  parado_desde timestamptz,
  dias_parado integer,
  em_acompanhamento_judicial boolean,
  dias_sem_movimento integer,
  motivo text  -- 'sem_proximo_passo' | 'judicial_mudo' | 'acompanhamento_judicial'
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select
    c.id as caso_id,
    cl.nome as cliente_nome,
    c.tipo_beneficio,
    sinal.ultimo as parado_desde,
    floor(extract(epoch from (now() - sinal.ultimo)) / 86400)::int as dias_parado,
    juri.tem as em_acompanhamento_judicial,
    mov.dias as dias_sem_movimento,
    case
      when not juri.tem then 'sem_proximo_passo'
      when mov.dias >= 90 then 'judicial_mudo'
      else 'acompanhamento_judicial'
    end as motivo
  from public.casos c
  join public.clientes cl on cl.id = c.cliente_id
  cross join lateral (
    select greatest(
      c.created_at,
      coalesce((select max(t.completed_at) from public.tarefas t
                 where t.caso_id = c.id and t.completed_at is not null), c.created_at),
      coalesce((select max(a.created_at) from public.andamentos a
                 where a.caso_id = c.id), c.created_at)
    ) as ultimo
  ) sinal
  cross join lateral (
    select exists (
      select 1 from public.processos_judiciais pj where pj.caso_id = c.id
    ) as tem
  ) juri
  cross join lateral (
    select floor(extract(epoch from (now() - coalesce(
      (select max(a.created_at) from public.andamentos a where a.caso_id = c.id),
      c.created_at
    ))) / 86400)::int as dias
  ) mov
  where public.is_interno()
    and c.status not in ('arquivado', 'concluido_exito', 'concluido_sem_exito')
    and not exists (
      select 1 from public.tarefas t
       where t.caso_id = c.id and t.status in ('a_fazer', 'fazendo')
    )
    and not exists (
      select 1 from public.agenda_eventos e
       where e.caso_id = c.id and e.start_at > now()
    )
  order by sinal.ultimo asc;
$$;

grant execute on function public.casos_sem_proximo_passo() to authenticated;

-- ---------------------------------------------------------------------------
-- 2) Publicação acionável → tarefa de prazo.
-- ---------------------------------------------------------------------------
create or replace function public.tg_publicacao_acionavel_cria_tarefa()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_texto    text;
  v_cliente  text;
  v_gatilho  text;
  v_titulo   text;
  v_uteis    int;
  v_due      timestamptz;
begin
  if NEW.caso_id is null then return NEW; end if;
  -- Só o que chega automaticamente dos tribunais.
  if NEW.origem not in ('djen', 'datajud') then return NEW; end if;
  -- Andamento nascido dos próprios fluxos de aviso: não morder o rabo.
  if NEW.metadata ? 'tipo_aviso' then return NEW; end if;
  if NEW.data_evento is not null and NEW.data_evento < (now() - interval '30 days') then
    return NEW;
  end if;

  v_texto := coalesce(NEW.titulo, '') || ' ' || coalesce(NEW.descricao, '');

  -- Perícia/audiência marcada: o gatilho irmão (tg_rascunho_pericia_andamento)
  -- já cria a tarefa de aviso — aqui não duplica.
  if (v_texto ~* 'per[ií]cia' and v_texto ~* '(marcad|agendad|reagendad|remarcad|designad)')
     or (v_texto ~* 'audi[eê]nci' and v_texto ~* '(marcad|agendad|designad|redesignad|pautad)') then
    return NEW;
  end if;

  -- Um gatilho por publicação; o mais específico vence.
  if v_texto ~* 'proposta de acordo' then
    v_gatilho := 'acordo';
    v_titulo  := 'Manifestar sobre proposta de acordo';
    v_uteis   := 2;
  elsif v_texto ~* 'senten[çc]a' then
    v_gatilho := 'sentenca';
    v_titulo  := 'Analisar sentença - decidir recurso';
    v_uteis   := 2;
  elsif v_texto ~* 'laudo' then
    v_gatilho := 'laudo';
    v_titulo  := 'Analisar laudo pericial';
    v_uteis   := 3;
  elsif v_texto ~* 'rpv|precat[óo]rio|requisi[çc][ãa]o de pequeno valor' then
    v_gatilho := 'rpv';
    v_titulo  := 'Verificar pagamento (RPV/precatório)';
    v_uteis   := 5;
  elsif v_texto ~* 'manifest' then
    v_gatilho := 'manifestacao';
    v_titulo  := 'Manifestar nos autos';
    v_uteis   := 2;
  else
    return NEW;
  end if;

  select cl.nome into v_cliente
    from public.casos c join public.clientes cl on cl.id = c.cliente_id
   where c.id = NEW.caso_id;

  v_due := (public._dia_util_apos((now() at time zone 'America/Sao_Paulo')::date, v_uteis)::timestamp
            + interval '9 hours') at time zone 'America/Sao_Paulo';

  insert into public.tarefas
    (caso_id, tipo, status, prioridade, titulo, descricao,
     due_at, origem, origem_ref, processo_admin_id, processo_judicial_id, metadata)
  select
    NEW.caso_id, 'prazo', 'a_fazer', 1,
    v_titulo || ' - ' || coalesce(v_cliente, 'cliente'),
    'Publicação detectada (' || v_gatilho || '): "'
      || left(coalesce(NEW.titulo, ''), 120) || '". Leia a publicação no caso, '
      || 'confira o prazo REAL nela e aja. O prazo desta tarefa ('
      || v_uteis || ' dias úteis) é só o lembrete de segurança.',
    v_due,
    'sync_djen',
    'andamento:' || NEW.id::text || ':acionavel',
    NEW.processo_admin_id,
    NEW.processo_judicial_id,
    jsonb_build_object(
      'publicacao_acionavel', v_gatilho,
      'origem_andamento_id', NEW.id
    )
  where not exists (
    select 1 from public.tarefas t
     where t.origem_ref = 'andamento:' || NEW.id::text || ':acionavel'
  );

  return NEW;
exception when others then
  raise warning 'tg_publicacao_acionavel_cria_tarefa falhou (andamento %): % / %',
    NEW.id, SQLSTATE, SQLERRM;
  return NEW;
end;
$$;

drop trigger if exists trg_publicacao_acionavel on public.andamentos;
create trigger trg_publicacao_acionavel
  after insert on public.andamentos
  for each row execute function public.tg_publicacao_acionavel_cria_tarefa();

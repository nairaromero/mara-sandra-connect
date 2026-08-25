-- =============================================================================
-- Migration: publicação ÓRFÃ do DJEN com perícia/audiência não passa mais batida
-- (pedido da Naira, 2026-08-25).
--
-- Contexto: publicação vinculada vira andamento e o andamento já dispara a
-- tarefa "Enviar aviso ao parceiro" (migration_pericia_por_publicacao_djen).
-- Mas 236 de 285 publicações estão 'sem_processo' (órfãs) — perícia designada
-- numa órfã morria calada.
--
-- Três peças:
--   1) Órfã nova citando perícia/audiência → tarefa de TRIAGEM pra responsável
--      (app_config 'dje_triagem_responsavel_id' = Naira; fallback: 1º admin
--      ativo): conferir na tela /publicacoes, vincular ao caso e repassar.
--   2) Publicação vira 'vinculada' → a tarefa de triagem fecha sozinha (o
--      vínculo cria o andamento, que dispara a tarefa de aviso — o bastão passa).
--   3) rematch_publicacoes_dje(): órfã cujo número casa com processo JÁ
--      cadastrado é vinculada automaticamente (mesmo shape do vínculo manual
--      de vincular_publicacao_dje, com metadata.vinculado_auto). Cron diário
--      10:30 UTC, meia hora depois da ingestão (10:00 UTC, agendador externo).
--
-- Retroativo nesta migration: só as tarefas de triagem das órfãs dos últimos
-- 30 dias com palavra-chave (4 em produção em 25/08). O lote do rematch roda
-- pela função/cron — em produção, na primeira execução do cron.
--
-- Idempotente.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Responsável pela triagem (Naira; o UUID vale nos dois bancos — o staging é
-- espelho e preserva ids). Trocar = update nesta chave.
-- ---------------------------------------------------------------------------
insert into public.app_config (chave, valor)
values ('dje_triagem_responsavel_id', 'e911d384-f1fb-48d6-a05f-2571a1bc3882')
on conflict (chave) do nothing;

-- ---------------------------------------------------------------------------
-- Helper: resolve o responsável (config → fallback 1º admin ativo).
-- ---------------------------------------------------------------------------
create or replace function public._dje_triagem_responsavel()
returns uuid
language sql
stable
set search_path = public, pg_temp
as $$
  select coalesce(
    (select u.id
       from public.app_config c
       join public.usuarios u on u.id::text = c.valor
      where c.chave = 'dje_triagem_responsavel_id'
        and u.ativo),
    (select id from public.usuarios
      where ativo and eh_admin
      order by nome limit 1)
  );
$$;

-- ---------------------------------------------------------------------------
-- 1) Órfã nova com perícia/audiência → tarefa de triagem.
-- ---------------------------------------------------------------------------
create or replace function public.tg_publicacao_dje_orfa_triagem()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_tipo   text;
  v_rotulo text;
begin
  if new.status <> 'sem_processo' then return new; end if;

  -- Mesmos regexes do gatilho de andamentos (tg_rascunho_pericia_andamento).
  if coalesce(new.texto, '') ~* 'per[ií]cia'
     and coalesce(new.texto, '') ~* '(marcad|agendad|reagendad|remarcad|designad)' then
    v_tipo := 'pericia';  v_rotulo := 'perícia';
  elsif coalesce(new.texto, '') ~* 'audi[eê]nci'
     and coalesce(new.texto, '') ~* '(marcad|agendad|designad|redesignad|pautad)' then
    v_tipo := 'audiencia'; v_rotulo := 'audiência';
  else
    return new;
  end if;

  insert into public.tarefas
    (caso_id, responsavel_id, tipo, status, prioridade, titulo, descricao,
     due_at, origem, origem_ref, metadata)
  select
    null,
    public._dje_triagem_responsavel(),
    'interna', 'a_fazer', 1,
    'Conferir publicação de ' || v_rotulo || ' SEM caso - '
      || coalesce(nullif(new.sigla_tribunal, ''), 'DJEN')
      || coalesce(' ' || nullif(new.numero_processo, ''), ''),
    'O DJEN publicou uma ' || v_rotulo || ' num processo que NÃO está no sistema. '
      || 'Abra a tela Publicações, vincule ao caso certo (ou cadastre o caso) e '
      || 'repasse ao responsável — ao vincular, a tarefa de aviso ao parceiro '
      || 'nasce sozinha e esta aqui se conclui.' || chr(10) || chr(10)
      || 'Processo: ' || coalesce(nullif(new.numero_processo, ''), '(sem número)') || chr(10)
      || 'Tribunal: ' || coalesce(nullif(new.sigla_tribunal, ''), '?')
      || coalesce(' — ' || nullif(new.nome_orgao, ''), '') || chr(10) || chr(10)
      || 'Trecho: ' || left(coalesce(new.texto, ''), 400),
    now(),
    'sync_djen',
    'publicacao_dje:' || new.id::text,
    jsonb_build_object('publicacao_dje_id', new.id, 'triagem_dje', v_tipo)
  where not exists (
    select 1 from public.tarefas t
     where t.origem = 'sync_djen'
       and t.origem_ref = 'publicacao_dje:' || new.id::text
  );

  return new;
exception when others then
  raise warning 'tg_publicacao_dje_orfa_triagem falhou (pub %): % / %',
    new.id, SQLSTATE, SQLERRM;
  return new;
end;
$$;

drop trigger if exists trg_publicacao_dje_orfa_triagem on public.publicacoes_dje;
create trigger trg_publicacao_dje_orfa_triagem
  after insert on public.publicacoes_dje
  for each row execute function public.tg_publicacao_dje_orfa_triagem();

-- ---------------------------------------------------------------------------
-- 2) Vinculou (manual ou automático) → triagem fecha sozinha.
-- ---------------------------------------------------------------------------
create or replace function public.tg_publicacao_dje_vinculada_fecha_triagem()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.status = 'vinculada' and old.status is distinct from new.status then
    update public.tarefas
       set status = 'feito',
           updated_at = now(),
           completed_at = coalesce(completed_at, now())
     where origem = 'sync_djen'
       and origem_ref = 'publicacao_dje:' || new.id::text
       and status in ('a_fazer', 'fazendo');
  end if;
  return new;
exception when others then
  raise warning 'tg_publicacao_dje_vinculada_fecha_triagem falhou (pub %): % / %',
    new.id, SQLSTATE, SQLERRM;
  return new;
end;
$$;

drop trigger if exists trg_publicacao_dje_vinculada_fecha_triagem on public.publicacoes_dje;
create trigger trg_publicacao_dje_vinculada_fecha_triagem
  after update of status on public.publicacoes_dje
  for each row execute function public.tg_publicacao_dje_vinculada_fecha_triagem();

-- ---------------------------------------------------------------------------
-- 3) Rematch automático: órfã cujo número casa com processo já cadastrado.
--    Mesmos passos do vincular_publicacao_dje, sem exigir usuário logado
--    (criado_por fica nulo; metadata marca vinculado_auto). O update de status
--    dispara o fechamento da triagem (item 2); o insert do andamento dispara a
--    tarefa de aviso quando for perícia/audiência (gatilho já existente).
-- ---------------------------------------------------------------------------
create or replace function public.rematch_publicacoes_dje()
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  r        record;
  v_and_id uuid;
  v_titulo text;
  v_n      int := 0;
begin
  for r in
    select p.id as pub_id, p.djen_id, p.hash, p.sigla_tribunal, p.nome_orgao,
           p.tipo_comunicacao, p.tipo_documento, p.link, p.certidao_url,
           p.numero_processo, p.texto, p.data_disponibilizacao,
           pj.id as proc_id, pj.caso_id
      from public.publicacoes_dje p
      cross join lateral (
        select pj.id, pj.caso_id
          from public.processos_judiciais pj
         where pj.caso_id is not null
           and coalesce(
                 pj.numero_proc_normalizado,
                 regexp_replace(coalesce(pj.numero_processo, ''), '\D', '', 'g')
               ) = coalesce(
                 nullif(p.numero_normalizado, ''),
                 regexp_replace(coalesce(p.numero_processo, ''), '\D', '', 'g')
               )
         order by pj.created_at desc
         limit 1
      ) pj
     where p.status = 'sem_processo'
       and coalesce(
             nullif(p.numero_normalizado, ''),
             regexp_replace(coalesce(p.numero_processo, ''), '\D', '', 'g')
           ) <> ''
  loop
    v_titulo := coalesce(nullif(r.tipo_comunicacao, ''), 'Publicação')
              || coalesce(' — ' || nullif(r.sigla_tribunal, ''), '');

    -- Reaproveita andamento existente do mesmo djen_id (paridade com o manual).
    select id into v_and_id
      from public.andamentos
     where origem = 'djen' and metadata->>'djen_id' = r.djen_id
     limit 1;

    if v_and_id is null then
      insert into public.andamentos (
        caso_id, origem, titulo, descricao, data_evento, criado_por,
        visivel_parceiro, processo_judicial_id, metadata
      ) values (
        r.caso_id, 'djen', v_titulo, coalesce(r.texto, v_titulo),
        coalesce(r.data_disponibilizacao::timestamptz, now()), null,
        true, r.proc_id,
        jsonb_build_object(
          'djen_id', r.djen_id,
          'hash', r.hash,
          'sigla_tribunal', r.sigla_tribunal,
          'nome_orgao', r.nome_orgao,
          'tipo_comunicacao', r.tipo_comunicacao,
          'tipo_documento', r.tipo_documento,
          'link', r.link,
          'certidao_url', r.certidao_url,
          'numero_processo', r.numero_processo,
          'vinculado_auto', true
        )
      ) returning id into v_and_id;
    end if;

    update public.publicacoes_dje
       set status = 'vinculada',
           caso_id = r.caso_id,
           processo_judicial_id = r.proc_id,
           andamento_id = v_and_id
     where id = r.pub_id;

    v_n := v_n + 1;
  end loop;

  return v_n;
end;
$$;

-- Cron diário, meia hora depois da ingestão externa das 10:00 UTC.
-- (pg_cron só existe em produção; no staging o rematch roda por chamada manual.)
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    if exists (select 1 from cron.job where jobname = 'msc-djen-rematch') then
      perform cron.unschedule('msc-djen-rematch');
    end if;
    perform cron.schedule(
      'msc-djen-rematch', '30 10 * * *',
      'select public.rematch_publicacoes_dje()'
    );
  else
    raise warning 'pg_cron ausente — msc-djen-rematch nao agendado (ok no staging)';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Retroativo: triagem pras órfãs recentes (30 dias) com palavra-chave que já
-- estão na base. Dedup por origem_ref — re-rodar não duplica.
-- ---------------------------------------------------------------------------
insert into public.tarefas
  (caso_id, responsavel_id, tipo, status, prioridade, titulo, descricao,
   due_at, origem, origem_ref, metadata)
select
  null,
  public._dje_triagem_responsavel(),
  'interna', 'a_fazer', 1,
  'Conferir publicação de '
    || case when p.texto ~* 'per[ií]cia' then 'perícia' else 'audiência' end
    || ' SEM caso - '
    || coalesce(nullif(p.sigla_tribunal, ''), 'DJEN')
    || coalesce(' ' || nullif(p.numero_processo, ''), ''),
  'O DJEN publicou uma '
    || case when p.texto ~* 'per[ií]cia' then 'perícia' else 'audiência' end
    || ' num processo que NÃO está no sistema. Abra a tela Publicações, vincule '
    || 'ao caso certo (ou cadastre o caso) e repasse ao responsável — ao '
    || 'vincular, a tarefa de aviso ao parceiro nasce sozinha e esta aqui se '
    || 'conclui.' || chr(10) || chr(10)
    || 'Processo: ' || coalesce(nullif(p.numero_processo, ''), '(sem número)') || chr(10)
    || 'Tribunal: ' || coalesce(nullif(p.sigla_tribunal, ''), '?')
    || coalesce(' — ' || nullif(p.nome_orgao, ''), '') || chr(10) || chr(10)
    || 'Trecho: ' || left(coalesce(p.texto, ''), 400),
  now(),
  'sync_djen',
  'publicacao_dje:' || p.id::text,
  jsonb_build_object(
    'publicacao_dje_id', p.id,
    'triagem_dje',
    case when p.texto ~* 'per[ií]cia' then 'pericia' else 'audiencia' end
  )
from public.publicacoes_dje p
where p.status = 'sem_processo'
  and p.created_at > now() - interval '30 days'
  and (
    (p.texto ~* 'per[ií]cia'
      and p.texto ~* '(marcad|agendad|reagendad|remarcad|designad)')
    or (p.texto ~* 'audi[eê]nci'
      and p.texto ~* '(marcad|agendad|designad|redesignad|pautad)')
  )
  and not exists (
    select 1 from public.tarefas t
     where t.origem = 'sync_djen'
       and t.origem_ref = 'publicacao_dje:' || p.id::text
  );

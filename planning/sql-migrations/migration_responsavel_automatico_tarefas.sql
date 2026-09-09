-- =============================================================================
-- Migration: nenhuma tarefa nasce sem responsável (pedido da Naira, 2026-09-09)
--
-- Sintoma que ela viu: parceiro sobe documentos pela aba do parceiro e a
-- tarefa "Analisar documentos juntados pelo parceiro" cai no balde
-- "Sem responsável" — some de "Minhas tarefas" de todo mundo e só aparece
-- pra quem for procurar. Em 09/09 eram 9 tarefas abertas assim, TODAS vindas
-- de gatilho automático.
--
-- Causa: 6 das 13 funções que criam tarefa fazem `insert into public.tarefas`
-- sem a coluna responsavel_id — justamente as automáticas, as que reagem a
-- coisa que chega de fora (documento de parceiro, solicitação cumprida,
-- exigência atendida, publicação acionável, caso novo, perícia). É a entrada
-- que ESCALA com o número de parceiros: 1 documento de parceiro em julho,
-- 61 em agosto, 41 nos 9 primeiros dias de setembro.
--
-- Remédio escolhido: em vez de remendar função por função (e brigar com os
-- PRs abertos que mexem nessas mesmas funções), UMA rede só —
-- trigger BEFORE INSERT em public.tarefas que preenche responsavel_id quando
-- vier nulo. Fecha o buraco pra todo caminho existente E pros futuros
-- (edge function, importação de planilha, RPC, front). Quem já manda o
-- responsável explicitamente não é tocado.
--
-- A escada de decisão (public.responsavel_tarefa_caso):
--   1. quem PEDIU o documento (solicitacoes_documento.solicitado_por) —
--      quem pediu é quem sabe conferir quando chega;
--   2. o dono do caso (casos.responsavel_id, coluna nova desta migration);
--   3. o dono DE FATO: quem tem mais tarefa aberta nesse caso (desempate
--      pela mais recente) — testado contra as órfãs de 09/09: acerta 5 de 8;
--   4. a chave app_config 'tarefa_analise_responsavel_id', se alguém quiser
--      trocar o padrão sem migration nova;
--   5. public.responsavel_padrao_analise() — hoje a Mara.
--
-- NÃO reescreve nenhuma função existente de propósito: os PRs #222..#226
-- mexem nessas funções e uma migration re-rodável desfazendo o trabalho
-- deles é exatamente o tipo de estrago que a checagem de regressão do
-- CLAUDE.md manda evitar.
--
-- Idempotente. SÓ STAGING até a Naira validar.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1) Dono do caso. Até agora não existia dono de caso no banco — só de
--    tarefa —, então toda tarefa automática nascia sem a quem herdar.
-- ---------------------------------------------------------------------------
alter table public.casos
  add column if not exists responsavel_id uuid
    references public.usuarios(id) on delete set null;

create index if not exists idx_casos_responsavel
  on public.casos (responsavel_id);

comment on column public.casos.responsavel_id is
  'Pessoa da equipe dona do caso. Toda tarefa automática do caso nasce pra ela (public.responsavel_tarefa_caso). Null = cai no dono de fato / padrão do escritório.';

-- ---------------------------------------------------------------------------
-- 2) Padrão do escritório. A função já existe no staging (PR #225); aqui só
--    é criada se faltar, com corpo IDÊNTICO, pra esta migration rodar em
--    produção sozinha e em qualquer ordem em relação ao #225.
-- ---------------------------------------------------------------------------
do $do$
begin
  if not exists (
    select 1 from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname = 'responsavel_padrao_analise'
  ) then
    execute $fn$
      create function public.responsavel_padrao_analise()
      returns uuid
      language sql
      stable
      security definer
      set search_path = public, pg_temp
      as $body$
        select u.id
          from public.usuarios u
         where u.tipo = 'interno'
           and u.ativo is true
           and lower(u.email) = 'marasandra.adv@gmail.com'
         limit 1;
      $body$;
    $fn$;
  end if;
end
$do$;

-- ---------------------------------------------------------------------------
-- 3) A escada. p_preferido = palpite de quem chamou (ex.: quem pediu o
--    documento); só vale se for interno ativo.
-- ---------------------------------------------------------------------------
create or replace function public.responsavel_tarefa_caso(
  p_caso_id   uuid,
  p_preferido uuid default null
)
returns uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(
    -- 1) palpite de quem chamou (quem pediu o documento)
    (select u.id from public.usuarios u
      where u.id = p_preferido and u.ativo is true and u.tipo = 'interno'),
    -- 2) dono explícito do caso
    (select u.id
       from public.casos c
       join public.usuarios u on u.id = c.responsavel_id
      where c.id = p_caso_id and u.ativo is true),
    -- 3) dono de fato: quem carrega mais tarefa aberta nesse caso; empate
    --    (inclusive todo mundo com zero aberta) decide pela mais recente.
    (select t.responsavel_id
       from public.tarefas t
       join public.usuarios u on u.id = t.responsavel_id
      where t.caso_id = p_caso_id
        and u.ativo is true
        and u.tipo = 'interno'
      group by t.responsavel_id
      order by count(*) filter (where t.status in ('a_fazer', 'fazendo')) desc,
               max(t.created_at) desc
      limit 1),
    -- 4) override configurável, pra trocar o padrão sem migration
    (select u.id
       from public.app_config c
       join public.usuarios u on u.id::text = c.valor
      where c.chave = 'tarefa_analise_responsavel_id'
        and u.ativo is true),
    -- 5) padrão do escritório
    public.responsavel_padrao_analise()
  );
$$;

comment on function public.responsavel_tarefa_caso(uuid, uuid) is
  'Resolve o responsável de uma tarefa nova: preferido -> dono do caso -> dono de fato -> app_config tarefa_analise_responsavel_id -> responsavel_padrao_analise().';

-- ---------------------------------------------------------------------------
-- 4) A rede. BEFORE INSERT em tarefas, só quando responsavel_id vier nulo.
--    Nome do trigger propositalmente depois de trg_tarefas_set_created_by na
--    ordem alfabética: os BEFORE do Postgres disparam nessa ordem, então
--    created_by já está preenchido quando este roda.
-- ---------------------------------------------------------------------------
create or replace function public._tarefas_set_responsavel()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_preferido uuid;
  v_solic     uuid;
begin
  if NEW.responsavel_id is not null then
    return NEW;
  end if;

  -- Tarefa que nasceu de uma solicitação de documento: quem pediu confere.
  v_solic := nullif(NEW.metadata->>'origem_solicitacao_documento_id', '')::uuid;
  if v_solic is not null then
    select coalesce(s.responsavel_id, s.solicitado_por)
      into v_preferido
      from public.solicitacoes_documento s
     where s.id = v_solic;
  end if;

  -- Tarefa sem caso é tarefa de escritório: fica com quem criou (se for
  -- interno). Sem isso ela cairia no padrão do escritório, que não tem nada
  -- a ver com o assunto.
  if NEW.caso_id is null then
    v_preferido := coalesce(v_preferido, NEW.created_by);
  end if;

  NEW.responsavel_id := public.responsavel_tarefa_caso(NEW.caso_id, v_preferido);
  return NEW;
exception when others then
  -- Uma tarefa sem dono é ruim; um insert que explode é pior.
  raise warning '_tarefas_set_responsavel falhou (caso %): % / %',
    NEW.caso_id, SQLSTATE, SQLERRM;
  return NEW;
end;
$$;

drop trigger if exists trg_tarefas_set_responsavel on public.tarefas;
create trigger trg_tarefas_set_responsavel
  before insert on public.tarefas
  for each row execute function public._tarefas_set_responsavel();

-- ---------------------------------------------------------------------------
-- 5) Backfill do dono do caso: só onde está nulo, a partir do dono de fato.
--    Re-rodar não sobrescreve escolha humana nenhuma.
-- ---------------------------------------------------------------------------
update public.casos c
   set responsavel_id = sub.resp
  from (
    select distinct on (t.caso_id) t.caso_id, t.responsavel_id as resp
      from public.tarefas t
      join public.usuarios u on u.id = t.responsavel_id
     where u.ativo is true and u.tipo = 'interno'
     group by t.caso_id, t.responsavel_id
     order by t.caso_id,
              count(*) filter (where t.status in ('a_fazer', 'fazendo')) desc,
              max(t.created_at) desc
  ) sub
 where sub.caso_id = c.id
   and c.responsavel_id is null;

-- ---------------------------------------------------------------------------
-- 6) Backfill das órfãs que já estão abertas. Idem: só preenche nulo.
-- ---------------------------------------------------------------------------
update public.tarefas t
   set responsavel_id = public.responsavel_tarefa_caso(
         t.caso_id,
         (select coalesce(s.responsavel_id, s.solicitado_por)
            from public.solicitacoes_documento s
           where s.id = nullif(t.metadata->>'origem_solicitacao_documento_id', '')::uuid)
       )
 where t.responsavel_id is null
   and t.status in ('a_fazer', 'fazendo')
   and t.caso_id is not null;

-- ---------------------------------------------------------------------------
-- 7) Blindagem: parceiro não escolhe quem, na equipe, cuida do caso.
--    A RLS de casos deixa o parceiro dar UPDATE no PRÓPRIO caso
--    (parceiro_id = auth.uid()), e responsavel_id agora ROTEIA TRABALHO —
--    então segue o mesmo padrão de tg_solicitacao_parceiro_guard e reverte a
--    coluna. Escopo de propósito só na coluna nova: fase/status/parceiro_id
--    também estão expostos hoje, mas fechar isso é outra decisão (pode
--    quebrar fluxo do parceiro) e merece PR próprio.
-- ---------------------------------------------------------------------------
create or replace function public.tg_casos_parceiro_guard()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  -- Sem contexto de usuário (cron, edge com service_role) ou interno: libera.
  if auth.uid() is null or public.is_interno() then
    return NEW;
  end if;
  NEW.responsavel_id := OLD.responsavel_id;
  return NEW;
end;
$$;

drop trigger if exists trg_casos_parceiro_guard on public.casos;
create trigger trg_casos_parceiro_guard
  before update on public.casos
  for each row execute function public.tg_casos_parceiro_guard();

comment on function public.tg_casos_parceiro_guard() is
  'BEFORE UPDATE em casos: parceiro autenticado não altera casos.responsavel_id (reverte pro valor antigo). Cron/edge (auth.uid null) e interno passam.';

-- Relógio de prazos do caso (#397): datas fixas, trava de adiamento e radar.
--
-- Pedido da Mara (23–25/09): uma advogada adiava a montagem da inicial à
-- vontade e o prazo do recurso ordinário se perdeu. A trava que existia
-- (adiar tarefa `prazo_fatal` pede justificativa) só vivia na tela e movia a
-- própria referência a cada adiamento.
--
-- Agora o prazo é do PROCESSO (Mara, 25/09: dois requerimentos indeferidos em
-- datas diferentes, cada um com o seu prazo; idem cada processo judicial),
-- contado da data do indeferimento (D). Um relógio aberto por processo
-- (administrativo ou judicial); análise sem processo vinculado fica num
-- relógio "do caso", à parte:
--
--   judicial  análise D+10 (Mara) → montagem D+20 (Bia) → revisão D+25 (Mara)
--             → protocolo D+30 (Bia). Limite D+40: só a Mara libera.
--   recurso   (a análise decidiu recurso ordinário) → protocolo até D+29
--             (fatal − 1). Limite D+30 = o fatal da lei.
--
-- As datas das etapas são calculadas UMA vez e não andam: atraso numa etapa
-- come o tempo da seguinte, nunca empurra o fim. Quem cria a tarefa (template
-- na tela, botão da corrente, e-mail do INSS) não precisa saber disso — o
-- gatilho BEFORE INSERT põe a data da etapa.
--
-- Trava (BEFORE UPDATE em tarefas, vale para qualquer caminho — tela, IA, API):
--   - antecipar é livre;
--   - adiar até a data planejada (D+30 / D+29) é livre no banco — a tela pede
--     justificativa e mostra quantos dias sai da etapa seguinte;
--   - nos 3 últimos dias antes da data planejada, só até AMANHÃ;
--   - depois da planejada: só com prorrogação aprovada pela Mara (RPC
--     `decidir_prorrogacao`), até o limite;
--   - cancelar tarefa travada, apagar o prazo dela ou excluí-la: só admin.
--   Admin e o sistema (sem pessoa: cron, edge) passam.
--
-- JANELAS (sem relógio de caso, respostas da Mara em 25/09): a tarefa nasce
-- vencendo AMANHÃ e pode ser empurrada até um teto (`metadata.teto_em`);
-- depois dele, quem está com a tarefa decide pelos botões dela.
--   - "Aguardando documentos do parceiro" das exigências INSS e judicial:
--     teto = fatal − 3 (o "enviar até" do parceiro; fim de semana recua pra
--     sexta). No teto: pedir dilação de prazo ou não.
--   - Análise de Deferimento: teto = criação + 10. Decide: está tudo certo
--     ou entrar com revisão (corrente do requerimento administrativo).
--
-- O relógio da entrada do caso → protocolo adm (15 dias, +15 com documento
-- pendente) entra depois, sobre esta mesma tabela (tipo novo).
--
-- Idempotente.

-- ---------------------------------------------------------------------------
-- 0. NB no processo administrativo (painel de datas do caso)
-- ---------------------------------------------------------------------------
alter table public.processos_admin add column if not exists numero_beneficio text;

-- Situação do processo judicial, marcada pela equipe (o painel sugere
-- "parece encerrado" a partir das movimentações do DataJud, mas quem decide
-- é a pessoa: "arquivado" às vezes é provisório).
alter table public.processos_judiciais
  add column if not exists situacao text not null default 'em_andamento',
  add column if not exists encerrado_em date;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'processos_judiciais_situacao_chk') then
    alter table public.processos_judiciais
      add constraint processos_judiciais_situacao_chk check (situacao in ('em_andamento', 'encerrado'));
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 1. Helpers de calendário de Brasília
-- ---------------------------------------------------------------------------
create or replace function private.dia_brt(p timestamptz) returns date
language sql immutable set search_path = '' as $$
  select (p at time zone 'America/Sao_Paulo')::date
$$;

-- Prazo de etapa vence às 18h (fim do expediente), como a corrente da montagem.
create or replace function private.fim_do_dia_brt(p date) returns timestamptz
language sql immutable set search_path = '' as $$
  select (p + time '18:00') at time zone 'America/Sao_Paulo'
$$;

-- Sábado/domingo recuam para a sexta (nunca avança: empurrar comeria a folga).
create or replace function private.recua_fim_de_semana(p date) returns date
language sql immutable set search_path = '' as $$
  select case extract(isodow from p)::int when 6 then p - 1 when 7 then p - 2 else p end
$$;

-- ---------------------------------------------------------------------------
-- 2. Tabelas
-- ---------------------------------------------------------------------------
create table if not exists public.relogios_prazo (
  id                uuid primary key default gen_random_uuid(),
  escritorio_id     uuid not null references public.escritorios (id),
  caso_id           uuid not null references public.casos (id) on delete cascade,
  processo_admin_id uuid references public.processos_admin (id) on delete set null,
  tipo              text not null check (tipo in ('judicial', 'recurso')),
  origem_em         date not null,
  -- Sem data do indeferimento informada: contou da criação da análise.
  origem_estimada   boolean not null default false,
  -- {"analise": "2026-09-30", "montagem": ..., "revisao": ..., "protocolo": ...}
  etapas            jsonb not null,
  planejado_em      date not null,
  limite_em         date not null,
  liberado_ate      date,
  status            text not null default 'aberto' check (status in ('aberto', 'concluido', 'encerrado')),
  concluido_em      timestamptz,
  created_by        uuid references public.usuarios (id),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  check (limite_em >= planejado_em)
);
-- Processo judicial: a contagem é por processo, administrativo ou judicial.
alter table public.relogios_prazo
  add column if not exists processo_judicial_id uuid references public.processos_judiciais (id) on delete set null;

-- Um relógio aberto por PROCESSO (nulos contam como "sem processo" = do caso).
drop index if exists public.relogios_prazo_um_aberto_por_caso;
create unique index if not exists relogios_prazo_um_aberto_por_processo
  on public.relogios_prazo (
    caso_id,
    coalesce(processo_admin_id, '00000000-0000-0000-0000-000000000000'::uuid),
    coalesce(processo_judicial_id, '00000000-0000-0000-0000-000000000000'::uuid))
  where status = 'aberto';
create index if not exists relogios_prazo_escritorio_idx on public.relogios_prazo (escritorio_id);

create table if not exists public.pedidos_prorrogacao (
  id             uuid primary key default gen_random_uuid(),
  escritorio_id  uuid not null references public.escritorios (id),
  caso_id        uuid not null references public.casos (id) on delete cascade,
  tarefa_id      uuid not null references public.tarefas (id) on delete cascade,
  relogio_id     uuid not null references public.relogios_prazo (id) on delete cascade,
  solicitante_id uuid references public.usuarios (id),
  due_anterior   timestamptz,
  ate            date not null,
  motivo         text not null check (length(btrim(motivo)) >= 10),
  status         text not null default 'pendente' check (status in ('pendente', 'aprovado', 'negado')),
  decidido_por   uuid references public.usuarios (id),
  decidido_em    timestamptz,
  observacao     text,
  created_at     timestamptz not null default now()
);
create unique index if not exists pedidos_prorrogacao_um_pendente
  on public.pedidos_prorrogacao (tarefa_id) where status = 'pendente';
create index if not exists pedidos_prorrogacao_escritorio_idx on public.pedidos_prorrogacao (escritorio_id);

-- Escritório: mesmo gatilho de herança das outras tabelas de domínio (o filho
-- herda do caso) e a policy restritiva de isolamento.
drop trigger if exists aa_herdar_escritorio on public.relogios_prazo;
create trigger aa_herdar_escritorio before insert or update of escritorio_id, caso_id, processo_admin_id, processo_judicial_id
  on public.relogios_prazo
  for each row execute function private.tg_herdar_escritorio(
    'caso_id=casos', 'processo_admin_id=processos_admin', 'processo_judicial_id=processos_judiciais');

drop trigger if exists aa_herdar_escritorio on public.pedidos_prorrogacao;
create trigger aa_herdar_escritorio before insert or update of escritorio_id, caso_id, tarefa_id, relogio_id
  on public.pedidos_prorrogacao
  for each row execute function private.tg_herdar_escritorio('caso_id=casos', 'tarefa_id=tarefas', 'relogio_id=relogios_prazo');

alter table public.relogios_prazo enable row level security;
alter table public.pedidos_prorrogacao enable row level security;

drop policy if exists isolamento_escritorio on public.relogios_prazo;
create policy isolamento_escritorio on public.relogios_prazo as restrictive for all to authenticated
  using (escritorio_id = (select private.escritorio_ativo()))
  with check (escritorio_id = (select private.escritorio_ativo()));
drop policy if exists isolamento_escritorio on public.pedidos_prorrogacao;
create policy isolamento_escritorio on public.pedidos_prorrogacao as restrictive for all to authenticated
  using (escritorio_id = (select private.escritorio_ativo()))
  with check (escritorio_id = (select private.escritorio_ativo()));

-- Leitura: equipe interna. Escrita: só pelos gatilhos e RPCs (security
-- definer); admin pode corrigir o relógio direto (data de origem errada).
drop policy if exists relogios_select_interno on public.relogios_prazo;
create policy relogios_select_interno on public.relogios_prazo for select to authenticated
  using ((select public.is_interno()));
drop policy if exists relogios_update_admin on public.relogios_prazo;
create policy relogios_update_admin on public.relogios_prazo for update to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));

drop policy if exists pedidos_select_interno on public.pedidos_prorrogacao;
create policy pedidos_select_interno on public.pedidos_prorrogacao for select to authenticated
  using ((select public.is_interno()));

grant select, update on public.relogios_prazo to authenticated;
grant select on public.pedidos_prorrogacao to authenticated;
revoke all on public.relogios_prazo, public.pedidos_prorrogacao from anon;

-- Suporte da plataforma lê, não escreve (mesmo gatilho das outras tabelas).
drop trigger if exists ab_suporte_nao_escreve on public.relogios_prazo;
create trigger ab_suporte_nao_escreve before insert or update or delete on public.relogios_prazo
  for each statement execute function private.tg_suporte_nao_escreve();
drop trigger if exists ab_suporte_nao_escreve on public.pedidos_prorrogacao;
create trigger ab_suporte_nao_escreve before insert or update or delete on public.pedidos_prorrogacao
  for each statement execute function private.tg_suporte_nao_escreve();

-- ---------------------------------------------------------------------------
-- 3. Datas das etapas
-- ---------------------------------------------------------------------------
-- ÚNICA tabela de dias do relógio: etapas, data planejada e limite saem daqui
-- (o radar também). Toda data que cai em sábado/domingo recua para a sexta,
-- como o resto do sistema (prazo do parceiro, FATAL da exigência judicial).
create or replace function private.relogio_dias(p_tipo text)
returns table (etapa text, dias integer, ordem integer)
language sql immutable set search_path = '' as $$
  select v.etapa, v.dias, v.ordem from (values
    ('judicial', 'analise', 10, 1), ('judicial', 'montagem', 20, 2),
    ('judicial', 'revisao', 25, 3), ('judicial', 'protocolo', 30, 4),
    ('recurso',  'analise', 10, 1), ('recurso',  'recurso',  29, 2)
  ) v(tipo, etapa, dias, ordem)
  where v.tipo = p_tipo
$$;

create or replace function public.relogio_etapas(p_tipo text, p_origem date) returns jsonb
language sql immutable set search_path = '' as $$
  select jsonb_object_agg(d.etapa, private.recua_fim_de_semana(p_origem + d.dias))
    from private.relogio_dias(p_tipo) d
$$;

-- Planejado = a data da última etapa (protocolo / recurso).
create or replace function private.relogio_planejado(p_tipo text, p_origem date) returns date
language sql immutable set search_path = '' as $$
  select private.recua_fim_de_semana(p_origem + d.dias)
    from private.relogio_dias(p_tipo) d
   order by d.ordem desc limit 1
$$;

-- Limite: judicial D+40 (só a Mara libera); recurso D+30, o fatal da lei.
create or replace function private.relogio_limite(p_tipo text, p_origem date) returns date
language sql immutable set search_path = '' as $$
  select private.recua_fim_de_semana(
    p_origem + case p_tipo when 'judicial' then 40 when 'recurso' then 30 end)
$$;

-- Dias que a etapa tinha no plano: data dela − data da etapa anterior.
create or replace function private.relogio_dias_previstos(p_etapas jsonb, p_origem date, p_etapa text)
returns integer
language sql immutable set search_path = '' as $$
  select ((p_etapas->>p_etapa)::date - coalesce(
            (select (p_etapas->>d2.etapa)::date
               from private.relogio_dias(
                      case when p_etapas ? 'recurso' then 'recurso' else 'judicial' end) d1
               join private.relogio_dias(
                      case when p_etapas ? 'recurso' then 'recurso' else 'judicial' end) d2
                 on d2.ordem = d1.ordem - 1
              where d1.etapa = p_etapa),
            p_origem))::integer
$$;

-- ---------------------------------------------------------------------------
-- 4. Gatilho de criação: põe a tarefa no relógio e a data da etapa
-- ---------------------------------------------------------------------------
create or replace function private.tg_tarefa_relogio_insert() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_meta   jsonb := coalesce(new.metadata, '{}'::jsonb);
  v_etapa  text;
  v_rel    public.relogios_prazo%rowtype;
  v_origem date;
  v_est    boolean := false;
  v_hoje   date := private.dia_brt(now());
  v_teto   date;
begin
  if new.caso_id is null then
    return new;
  end if;

  -- Janelas: vence amanhã, pode ir até o teto.
  if v_meta->>'aguardando_exigencia' = 'true' or v_meta->>'analise_deferimento' = 'true' then
    if v_meta->>'analise_deferimento' = 'true' then
      v_teto := private.recua_fim_de_semana(v_hoje + 10);
      new.metadata := v_meta || jsonb_build_object('teto_em', v_teto);
    else
      -- O fatal fica gravado: é dele que a decisão da dilação tira a data.
      v_origem := coalesce(nullif(v_meta->>'prazo_fatal_em', '')::date, v_hoje + 30);
      v_teto := private.recua_fim_de_semana(v_origem - 3);
      new.metadata := v_meta || jsonb_build_object('teto_em', v_teto, 'prazo_fatal_em', v_origem);
    end if;
    new.due_at := private.fim_do_dia_brt(least(v_hoje + 1, v_teto));
    return new;
  end if;

  v_etapa := case
    when v_meta->>'analise_indeferimento' = 'true' then 'analise'
    when v_meta->>'recurso_administrativo' = 'true' then 'recurso'
    when v_meta->>'montagem_inicial' = 'true'
         and coalesce(v_meta->>'montagem_requerimento', 'false') <> 'true'
         and coalesce(v_meta->>'etapa', 'montagem') in ('montagem', 'revisao', 'protocolo')
      then coalesce(v_meta->>'etapa', 'montagem')
  end;
  if v_etapa is null then
    return new;
  end if;

  -- O relógio da corrente: o que veio no metadata (a etapa anterior e os
  -- botões da análise passam o dela adiante); senão o aberto do MESMO
  -- processo (administrativo/judicial, ou nenhum = relógio do caso).
  if v_meta ? 'relogio_id' then
    select * into v_rel from public.relogios_prazo
     where id = (v_meta->>'relogio_id')::uuid and caso_id = new.caso_id and status = 'aberto';
  end if;
  if v_rel.id is null then
    select * into v_rel from public.relogios_prazo r
     where r.caso_id = new.caso_id and r.status = 'aberto'
       and r.processo_admin_id is not distinct from new.processo_admin_id
       and r.processo_judicial_id is not distinct from new.processo_judicial_id;
  end if;
  -- Etapa seguinte criada à mão sem processo (montagem aplicada pelo template):
  -- vale o relógio do caso só quando não há dúvida — um único aberto.
  if v_rel.id is null and v_etapa <> 'analise'
     and new.processo_admin_id is null and new.processo_judicial_id is null
     and (select count(*) from public.relogios_prazo r
           where r.caso_id = new.caso_id and r.status = 'aberto') = 1 then
    select * into v_rel from public.relogios_prazo r
     where r.caso_id = new.caso_id and r.status = 'aberto';
  end if;

  if v_etapa = 'analise' then
    v_origem := nullif(v_meta->>'data_indeferimento', '')::date;
    if v_origem is null and new.processo_admin_id is not null then
      select pa.data_decisao into v_origem from public.processos_admin pa
       where pa.id = new.processo_admin_id;
    end if;
    if v_origem is null then
      v_origem := private.dia_brt(now());
      v_est := true;
    end if;
    -- Relógio aberto de OUTRO indeferimento (corrente abandonada, protocolo
    -- nunca marcado) não pode capturar a análise nova com datas vencidas:
    -- encerra o antigo e abre um novo. Mesmo indeferimento (template
    -- reaplicado, e-mail repetido) continua no mesmo relógio. Sem data
    -- informada, só reaproveita se o antigo ainda tiver tarefa aberta.
    if v_rel.id is not null
       and ((not v_est and v_rel.origem_em <> v_origem)
            or (v_est and not exists (
                  select 1 from public.tarefas t
                   where t.status = 'a_fazer' and t.metadata->>'relogio_id' = v_rel.id::text))) then
      update public.relogios_prazo
         set status = 'encerrado', concluido_em = now(), updated_at = now()
       where id = v_rel.id;
      v_rel := null;
    end if;
  end if;

  if v_rel.id is null then
    -- Só a análise do indeferimento abre relógio. Montagem aplicada à mão sem
    -- análise (ou recurso sem relógio) segue a regra antiga.
    if v_etapa <> 'analise' then
      return new;
    end if;
    insert into public.relogios_prazo
      (caso_id, processo_admin_id, processo_judicial_id, tipo, origem_em, origem_estimada, etapas, planejado_em, limite_em, created_by)
    values
      (new.caso_id, new.processo_admin_id, new.processo_judicial_id, 'judicial', v_origem, v_est,
       public.relogio_etapas('judicial', v_origem),
       private.relogio_planejado('judicial', v_origem),
       private.relogio_limite('judicial', v_origem),
       auth.uid())
    returning * into v_rel;

    -- A data vira dado do processo (painel do caso), sem sobrescrever o que
    -- alguém já digitou lá.
    if not v_est and new.processo_admin_id is not null then
      update public.processos_admin
         set data_decisao = coalesce(data_decisao, v_origem),
             decisao      = coalesce(nullif(btrim(decisao), ''), 'Indeferido')
       where id = new.processo_admin_id;
    end if;
  elsif v_etapa = 'recurso' and v_rel.tipo <> 'recurso' then
    -- A análise decidiu recurso ordinário: o relógio passa a contar o fatal da lei.
    update public.relogios_prazo
       set tipo = 'recurso',
           etapas = public.relogio_etapas('recurso', origem_em),
           planejado_em = private.relogio_planejado('recurso', origem_em),
           limite_em = private.relogio_limite('recurso', origem_em),
           updated_at = now()
     where id = v_rel.id
    returning * into v_rel;
  end if;

  if not (v_rel.etapas ? v_etapa) then
    -- Etapa que não existe neste tipo de relógio (ex.: montagem judicial num
    -- caso que foi para recurso): não trava.
    return new;
  end if;

  new.due_at := private.fim_do_dia_brt((v_rel.etapas->>v_etapa)::date);
  new.metadata := v_meta || jsonb_build_object(
    'relogio_id', v_rel.id,
    'relogio_etapa', v_etapa,
    'prazo_fatal', true);
  return new;
end;
$$;

drop trigger if exists trg_tarefa_relogio_insert on public.tarefas;
create trigger trg_tarefa_relogio_insert before insert on public.tarefas
  for each row execute function private.tg_tarefa_relogio_insert();

-- ---------------------------------------------------------------------------
-- 5. Trava de adiamento
-- ---------------------------------------------------------------------------
create or replace function private.tg_tarefa_relogio_trava() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_rid  text := old.metadata->>'relogio_id';
  v_rel  public.relogios_prazo%rowtype;
  v_novo date;
  v_hoje date;
  v_teto date;
begin
  -- Janela (sem relógio): o teto não sai do metadata e ninguém além do admin
  -- (ou do sistema) passa dele.
  if v_rid is null and old.metadata ? 'teto_em' then
    if (new.metadata->>'teto_em') is distinct from (old.metadata->>'teto_em') then
      new.metadata := coalesce(new.metadata, '{}'::jsonb)
        || jsonb_build_object('teto_em', old.metadata->'teto_em');
    end if;
    if auth.uid() is null or public.is_admin() or new.status <> 'a_fazer'
       or new.due_at is null or new.due_at <= coalesce(old.due_at, new.due_at) then
      return new;
    end if;
    v_teto := (old.metadata->>'teto_em')::date;
    if private.dia_brt(new.due_at) > v_teto then
      raise exception 'Esta tarefa vai no máximo até %. A partir daí, decida pelos botões da tarefa.',
        to_char(v_teto, 'DD/MM/YYYY')
        using errcode = 'MSC04', hint = 'teto=' || v_teto;
    end if;
    return new;
  end if;

  if v_rid is null then
    return new;
  end if;

  -- O vínculo com o relógio não sai pela edição da tarefa (o metadata vem
  -- inteiro do front).
  if (new.metadata->>'relogio_id') is distinct from v_rid
     or (new.metadata->>'relogio_etapa') is distinct from (old.metadata->>'relogio_etapa') then
    new.metadata := coalesce(new.metadata, '{}'::jsonb) || jsonb_build_object(
      'relogio_id', old.metadata->'relogio_id',
      'relogio_etapa', old.metadata->'relogio_etapa',
      'prazo_fatal', true);
  end if;

  if auth.uid() is null or public.is_admin() then
    return new;
  end if;

  select * into v_rel from public.relogios_prazo where id = v_rid::uuid;
  if v_rel.id is null or v_rel.status <> 'aberto' then
    return new;
  end if;

  if new.status = 'cancelado' and old.status <> 'cancelado' then
    raise exception 'Tarefa com prazo travado só pode ser cancelada pela Mara.'
      using errcode = 'MSC03';
  end if;
  if new.due_at is null and old.due_at is not null then
    raise exception 'Tarefa com prazo travado não pode ficar sem data.'
      using errcode = 'MSC03';
  end if;
  if old.due_at is null or new.due_at <= old.due_at then
    return new;  -- antecipar é livre
  end if;

  v_novo := private.dia_brt(new.due_at);
  v_hoje := private.dia_brt(now());
  v_teto := greatest(v_rel.planejado_em, coalesce(v_rel.liberado_ate, v_rel.planejado_em));

  if v_novo > v_teto then
    raise exception 'O prazo deste caso vai até %. Para passar disso, peça prorrogação à Mara.',
      to_char(v_teto, 'DD/MM/YYYY')
      using errcode = 'MSC01',
            hint = 'teto=' || v_teto || ';limite=' || v_rel.limite_em;
  end if;

  -- Reta final (3 últimos dias antes da data planejada): só até amanhã.
  if v_novo > v_rel.planejado_em - 3 and v_novo <= v_rel.planejado_em and v_novo > v_hoje + 1 then
    raise exception 'Faltam 3 dias ou menos para o prazo do caso (%): só dá para adiar até amanhã.',
      to_char(v_rel.planejado_em, 'DD/MM/YYYY')
      using errcode = 'MSC02',
            hint = 'ate=' || (v_hoje + 1);
  end if;
  return new;
end;
$$;

drop trigger if exists trg_tarefa_relogio_trava on public.tarefas;
create trigger trg_tarefa_relogio_trava before update of due_at, status, metadata on public.tarefas
  for each row execute function private.tg_tarefa_relogio_trava();

-- Excluir tarefa travada: só admin (ou o sistema).
create or replace function private.tg_tarefa_relogio_delete() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if old.metadata ? 'relogio_id'
     and old.status = 'a_fazer'
     and auth.uid() is not null
     and not public.is_admin()
     and exists (select 1 from public.relogios_prazo r
                  where r.id = (old.metadata->>'relogio_id')::uuid and r.status = 'aberto') then
    raise exception 'Tarefa com prazo travado só pode ser excluída pela Mara.'
      using errcode = 'MSC03';
  end if;
  return old;
end;
$$;

drop trigger if exists trg_tarefa_relogio_delete on public.tarefas;
create trigger trg_tarefa_relogio_delete before delete on public.tarefas
  for each row execute function private.tg_tarefa_relogio_delete();

-- ---------------------------------------------------------------------------
-- 6. Fechamento do relógio
-- ---------------------------------------------------------------------------
--   protocolo judicial / recurso concluído → concluido;
--   análise concluída sem nenhuma tarefa seguinte aberta ("Não prosseguir")
--   → encerrado. (Ajuizar e Recurso criam a próxima ANTES de concluir a
--   análise; a corrente da montagem fecha a etapa antes de abrir a próxima,
--   por isso só a análise encerra.)
create or replace function private.tg_tarefa_relogio_fecha() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_rid   uuid := (new.metadata->>'relogio_id')::uuid;
  v_etapa text := new.metadata->>'relogio_etapa';
begin
  if v_rid is null or new.status = old.status or new.status not in ('feito', 'cancelado') then
    return null;
  end if;
  if v_etapa in ('protocolo', 'recurso') and new.status = 'feito' then
    update public.relogios_prazo
       set status = 'concluido', concluido_em = now(), updated_at = now()
     where id = v_rid and status = 'aberto';
  elsif v_etapa = 'analise'
        and not exists (select 1 from public.tarefas t
                         where t.id <> new.id and t.status = 'a_fazer'
                           and t.metadata->>'relogio_id' = v_rid::text) then
    update public.relogios_prazo
       set status = 'encerrado', concluido_em = now(), updated_at = now()
     where id = v_rid and status = 'aberto';
  end if;
  return null;
end;
$$;

drop trigger if exists trg_tarefa_relogio_fecha on public.tarefas;
create trigger trg_tarefa_relogio_fecha after update of status on public.tarefas
  for each row execute function private.tg_tarefa_relogio_fecha();

-- ---------------------------------------------------------------------------
-- 7. Pedido de prorrogação
-- ---------------------------------------------------------------------------
create or replace function public.pedir_prorrogacao(p_tarefa uuid, p_ate date, p_motivo text)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_tar public.tarefas%rowtype;
  v_rel public.relogios_prazo%rowtype;
  v_id  uuid;
begin
  perform private.exigir_no_escritorio('public.tarefas', p_tarefa);
  select * into v_tar from public.tarefas where id = p_tarefa;
  -- Mesma regra da policy de tarefas: escopo `todos`, ou `atribuidos` na
  -- tarefa de quem pede.
  if not (private.tem_permissao('tarefas:gerenciar', 'todos')
          or (private.tem_permissao('tarefas:gerenciar', 'atribuidos')
              and v_tar.responsavel_id = auth.uid())) then
    raise exception 'sem permissão' using errcode = '42501';
  end if;
  if v_tar.id is null or not (v_tar.metadata ? 'relogio_id') then
    raise exception 'Esta tarefa não tem prazo travado.' using errcode = 'P0001';
  end if;
  select * into v_rel from public.relogios_prazo where id = (v_tar.metadata->>'relogio_id')::uuid;
  if v_rel.id is null or v_rel.status <> 'aberto' then
    raise exception 'O prazo deste caso já foi encerrado.' using errcode = 'P0001';
  end if;
  if p_ate is null or p_ate <= private.dia_brt(v_tar.due_at) then
    raise exception 'Escolha uma data depois do prazo atual.' using errcode = 'P0001';
  end if;
  if p_ate > v_rel.limite_em then
    raise exception 'O limite deste caso é %: não dá para pedir depois disso.',
      to_char(v_rel.limite_em, 'DD/MM/YYYY') using errcode = 'P0001';
  end if;
  if length(btrim(coalesce(p_motivo, ''))) < 10 then
    raise exception 'Explique o motivo (pelo menos 10 caracteres).' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.pedidos_prorrogacao where tarefa_id = p_tarefa and status = 'pendente') then
    raise exception 'Já existe um pedido de prorrogação aguardando a Mara para esta tarefa.'
      using errcode = 'P0001';
  end if;

  insert into public.pedidos_prorrogacao
    (caso_id, tarefa_id, relogio_id, solicitante_id, due_anterior, ate, motivo)
  values
    (v_tar.caso_id, v_tar.id, v_rel.id, auth.uid(), v_tar.due_at, p_ate, btrim(p_motivo))
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.decidir_prorrogacao(p_pedido uuid, p_aprovar boolean, p_observacao text default null)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_ped public.pedidos_prorrogacao%rowtype;
  v_tar public.tarefas%rowtype;
  v_rel public.relogios_prazo%rowtype;
  v_sol text;
begin
  if not public.is_admin() then
    raise exception 'Só a Mara (admin) decide prorrogação.' using errcode = '42501';
  end if;
  perform private.exigir_no_escritorio('public.pedidos_prorrogacao', p_pedido);
  select * into v_ped from public.pedidos_prorrogacao where id = p_pedido for update;
  if v_ped.id is null or v_ped.status <> 'pendente' then
    raise exception 'Este pedido já foi decidido.' using errcode = 'P0001';
  end if;
  select * into v_tar from public.tarefas where id = v_ped.tarefa_id;
  select * into v_rel from public.relogios_prazo where id = v_ped.relogio_id;
  select nome into v_sol from public.usuarios where id = v_ped.solicitante_id;

  update public.pedidos_prorrogacao
     set status = case when p_aprovar then 'aprovado' else 'negado' end,
         decidido_por = auth.uid(), decidido_em = now(),
         observacao = nullif(btrim(coalesce(p_observacao, '')), '')
   where id = p_pedido;

  if p_aprovar then
    update public.relogios_prazo
       set liberado_ate = greatest(coalesce(liberado_ate, v_ped.ate), v_ped.ate), updated_at = now()
     where id = v_rel.id;
    update public.tarefas
       set due_at = private.fim_do_dia_brt(v_ped.ate), updated_at = now()
     where id = v_tar.id;
  end if;

  insert into public.andamentos
    (caso_id, processo_admin_id, processo_judicial_id, origem, titulo, descricao, data_evento, criado_por, visivel_parceiro, metadata)
  values
    (v_tar.caso_id, v_tar.processo_admin_id, v_tar.processo_judicial_id, 'interno',
     case when p_aprovar then 'Prorrogação aprovada — ' else 'Prorrogação negada — ' end || v_tar.titulo,
     'Pedido de ' || coalesce(v_sol, 'alguém da equipe') || ' para ' || to_char(v_ped.ate, 'DD/MM/YYYY') || '.' ||
       E'\n\nMotivo: ' || v_ped.motivo ||
       coalesce(E'\n\nObservação: ' || nullif(btrim(coalesce(p_observacao, '')), ''), ''),
     now(), auth.uid(), false,
     jsonb_build_object('prorrogacao_prazo', true, 'pedido_id', v_ped.id, 'tarefa_id', v_tar.id,
                        'aprovado', p_aprovar, 'ate', v_ped.ate));
end;
$$;

revoke all on function public.pedir_prorrogacao(uuid, date, text) from public, anon;
revoke all on function public.decidir_prorrogacao(uuid, boolean, text) from public, anon;
grant execute on function public.pedir_prorrogacao(uuid, date, text) to authenticated;
grant execute on function public.decidir_prorrogacao(uuid, boolean, text) to authenticated;
revoke all on function public.relogio_etapas(text, date) from anon;

-- ---------------------------------------------------------------------------
-- 8. Radar da Mara: relógios abertos, com o sinal de cada um
-- ---------------------------------------------------------------------------
-- security invoker: a RLS de relógios/tarefas vale (só interno, só o escritório).
-- O retorno ganhou a coluna do processo: CREATE OR REPLACE não troca colunas.
drop function if exists public.radar_prazos();
create or replace function public.radar_prazos()
returns table (
  relogio_id        uuid,
  caso_id           uuid,
  cliente_nome      text,
  processo_rotulo   text,
  tipo              text,
  origem_em         date,
  origem_estimada   boolean,
  planejado_em      date,
  limite_em         date,
  liberado_ate      date,
  dia_atual         integer,
  tarefa_id         uuid,
  tarefa_titulo     text,
  etapa             text,
  responsavel_nome  text,
  vence_em          date,
  dias_previstos    integer,
  dias_disponiveis  integer,
  sinal             text,
  pedidos_pendentes integer
)
language sql stable security invoker set search_path = '' as $$
  with abertos as (
    select r.*, private.dia_brt(now()) as hoje
      from public.relogios_prazo r
     where r.status = 'aberto'
  ),
  tarefa_atual as (
    select distinct on (t.metadata->>'relogio_id')
           (t.metadata->>'relogio_id')::uuid as relogio_id,
           t.id, t.titulo, t.metadata->>'relogio_etapa' as etapa, t.due_at, t.created_at, t.responsavel_id
      from public.tarefas t
     where t.status = 'a_fazer' and (t.metadata->>'relogio_id') is not null
     order by t.metadata->>'relogio_id', t.due_at
  )
  select a.id, a.caso_id, cl.nome,
         coalesce('Req. ' || pa.numero_requerimento, 'Proc. ' || pj.numero_processo),
         a.tipo, a.origem_em, a.origem_estimada,
         a.planejado_em, a.limite_em, a.liberado_ate,
         (a.hoje - a.origem_em)::integer,
         ta.id, ta.titulo, ta.etapa, u.nome,
         private.dia_brt(ta.due_at),
         private.relogio_dias_previstos(a.etapas, a.origem_em, ta.etapa),
         (private.dia_brt(ta.due_at) - private.dia_brt(ta.created_at))::integer,
         case
           when ta.id is null then 'sem_tarefa'
           when private.dia_brt(ta.due_at) < a.hoje then 'atrasada'
           when a.hoje >= a.planejado_em - 3 then 'reta_final'
           when (private.dia_brt(ta.due_at) - private.dia_brt(ta.created_at)) * 2 <
                private.relogio_dias_previstos(a.etapas, a.origem_em, ta.etapa)
             then 'espremida'
           else 'ok'
         end,
         (select count(*)::integer from public.pedidos_prorrogacao p
           where p.relogio_id = a.id and p.status = 'pendente')
    from abertos a
    left join tarefa_atual ta on ta.relogio_id = a.id
    left join public.casos c on c.id = a.caso_id
    left join public.clientes cl on cl.id = c.cliente_id
    left join public.usuarios u on u.id = ta.responsavel_id
    left join public.processos_admin pa on pa.id = a.processo_admin_id
    left join public.processos_judiciais pj on pj.id = a.processo_judicial_id
   order by a.planejado_em, a.origem_em
$$;

-- Tarefas abertas de relógio: o radar e o fechamento procuram por aqui.
create index if not exists tarefas_relogio_abertas_idx
  on public.tarefas ((metadata->>'relogio_id'))
  where status = 'a_fazer' and (metadata->>'relogio_id') is not null;

revoke all on function public.radar_prazos() from public, anon;
grant execute on function public.radar_prazos() to authenticated;

-- =============================================================================
-- Migration: Tarefas — fundação para substituir o Tramitação Inteligente
--
-- MVP 1 do plano em planning/SUBSTITUIR_TRAMITACAO.md.
--
-- O QUE: tabelas `tarefas` + `tarefa_templates` para o sistema próprio assumir
-- o que o TI faz hoje em tarefas, prazos e perícias. Foco desta migration:
-- a fundação de banco, idempotente, com RLS. UI vem em MVP 2; a edge function
-- `inss-email-processor` (porta da skill agente-inss) escreve aqui no MVP 1.
--
-- DECISÕES:
--   - `tipo` cobre prazo/perícia também (não há tabela separada — é tarefa
--     com semântica). Justificativa: kanban, "minhas hoje" e countdown
--     compartilham a mesma fonte; render diferencia por `tipo` + `due_at`.
--   - `origem` rastreia de onde a tarefa nasceu (manual, template, sync_inss
--     por e-mail, sync_djen, sync_legalmail). `origem_ref` guarda id do
--     e-mail / hash da publicação para deduplicar antes de criar.
--   - `lembretes` jsonb default: 3d / 1d / hoje (o cron-prazos-alerta varre).
--   - RLS: **apenas interno** vê e mexe (escritório). Parceiro NÃO enxerga
--     tarefa nesta fase — espelha o padrão atual em que o parceiro vê só os
--     andamentos visíveis. Quando tiver tarefa pública pro parceiro, abrir
--     coluna `visivel_parceiro` (já temos esse padrão em andamentos).
--   - Templates: receitas por gatilho ("indeferimento" → 1 tarefa de recurso
--     em 30d, etc.). `gatilho` é texto livre para evolução; consumidor
--     (RPC `aplicar_template`) bate por nome.
--
-- Depende de: public.casos, public.usuarios (já existentes).
-- Idempotente: tabelas/índices/policies com IF NOT EXISTS / DROP+CREATE.
-- =============================================================================


-- ----------------------------------------------------------------------------
-- 1. Tabela `tarefas`
-- ----------------------------------------------------------------------------
create table if not exists public.tarefas (
  id              uuid primary key default gen_random_uuid(),
  caso_id         uuid not null references public.casos(id) on delete cascade,
  responsavel_id  uuid references public.usuarios(id) on delete set null,
  tipo            text not null
                  check (tipo in ('interna','prazo','pericia','pos_protocolo','contato_cliente')),
  status          text not null default 'a_fazer'
                  check (status in ('a_fazer','fazendo','feito','cancelado')),
  prioridade      smallint not null default 2 check (prioridade between 1 and 4),
  titulo          text not null check (length(trim(titulo)) > 0),
  descricao       text,
  due_at          timestamptz,
  origem          text not null default 'manual'
                  check (origem in ('manual','template','sync_inss_email','sync_djen','sync_legalmail')),
  origem_ref      text,                                  -- id do e-mail, hash publicação, etc.
  lembretes       jsonb not null default '[{"offset":"3d"},{"offset":"1d"},{"offset":"0d"}]'::jsonb,
  gcal_event_id   text,                                  -- preenchido por gcal-sync-out (MVP 4)
  metadata        jsonb not null default '{}'::jsonb,
  created_by      uuid references public.usuarios(id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  completed_at    timestamptz
);

-- Dedup de tarefas criadas automaticamente por origem externa:
-- (origem, origem_ref) tem que ser único quando origem_ref existir.
create unique index if not exists uq_tarefas_origem_ref
  on public.tarefas (origem, origem_ref)
  where origem_ref is not null and origem <> 'manual';

create index if not exists idx_tarefas_responsavel_status_due
  on public.tarefas (responsavel_id, status, due_at);

create index if not exists idx_tarefas_caso_status
  on public.tarefas (caso_id, status);

create index if not exists idx_tarefas_due_at_abertas
  on public.tarefas (due_at)
  where status in ('a_fazer','fazendo') and due_at is not null;


-- ----------------------------------------------------------------------------
-- 2. Trigger updated_at + completed_at
-- ----------------------------------------------------------------------------
create or replace function public._tarefas_touch_timestamps()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  if new.status = 'feito' and old.status <> 'feito' then
    new.completed_at := now();
  elsif new.status <> 'feito' then
    new.completed_at := null;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_tarefas_touch_timestamps on public.tarefas;
create trigger trg_tarefas_touch_timestamps
  before update on public.tarefas
  for each row
  execute function public._tarefas_touch_timestamps();


-- ----------------------------------------------------------------------------
-- 3. Tabela `tarefa_templates`
--    Receitas que viram N tarefas via RPC aplicar_template(caso_id, template).
-- ----------------------------------------------------------------------------
create table if not exists public.tarefa_templates (
  id         uuid primary key default gen_random_uuid(),
  nome       text not null unique,
  gatilho    text not null,                              -- 'protocolo_admin','indeferimento','exigencia','pericia_marcada', etc.
  descricao  text,
  -- itens: array de {titulo, tipo, prioridade, offset_dias, responsavel_papel?}
  -- responsavel_papel: 'autor_acao','responsavel_caso','none' — resolvido em runtime
  itens      jsonb not null check (jsonb_typeof(itens) = 'array' and jsonb_array_length(itens) > 0),
  ativo      boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_tarefa_templates_gatilho_ativo
  on public.tarefa_templates (gatilho)
  where ativo = true;

create or replace function public._tarefa_templates_touch()
returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end;
$$;
drop trigger if exists trg_tarefa_templates_touch on public.tarefa_templates;
create trigger trg_tarefa_templates_touch
  before update on public.tarefa_templates
  for each row execute function public._tarefa_templates_touch();


-- ----------------------------------------------------------------------------
-- 4. RPC `aplicar_template` — cria as tarefas do template no caso.
--    Retorna os ids criados. Idempotência: deixar a cargo do chamador
--    (a edge function deduplica por origem/origem_ref).
--    SECURITY DEFINER: a edge function chama com service_role; quando chamada
--    pela UI (interno), as policies de tarefas validam o contexto.
-- ----------------------------------------------------------------------------
create or replace function public.aplicar_template(
  p_caso_id      uuid,
  p_template     text,                                   -- nome do template
  p_origem       text default 'template',
  p_origem_ref   text default null,
  p_responsavel  uuid default null
)
returns setof uuid
language plpgsql
security definer
set search_path = public
as $$
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
    insert into public.tarefas (
      caso_id, responsavel_id, tipo, prioridade, titulo, descricao,
      due_at, origem, origem_ref, created_by
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
      auth.uid()
    )
    returning id into v_id;
    return next v_id;
  end loop;
end;
$$;

revoke all on function public.aplicar_template(uuid, text, text, text, uuid) from public;
grant execute on function public.aplicar_template(uuid, text, text, text, uuid) to service_role, authenticated;


-- ----------------------------------------------------------------------------
-- 5. RLS — só interno
-- ----------------------------------------------------------------------------
alter table public.tarefas enable row level security;
alter table public.tarefa_templates enable row level security;

grant select, insert, update, delete on public.tarefas to service_role;
grant select, insert, update, delete on public.tarefa_templates to service_role;

-- TAREFAS: interno vê e mexe; parceiro não enxerga.
drop policy if exists "tarefas_select_interno" on public.tarefas;
create policy "tarefas_select_interno"
  on public.tarefas
  for select
  using (
    exists (select 1 from public.usuarios u where u.id = auth.uid() and u.tipo = 'interno')
  );

drop policy if exists "tarefas_insert_interno" on public.tarefas;
create policy "tarefas_insert_interno"
  on public.tarefas
  for insert
  with check (
    exists (select 1 from public.usuarios u where u.id = auth.uid() and u.tipo = 'interno')
  );

drop policy if exists "tarefas_update_interno" on public.tarefas;
create policy "tarefas_update_interno"
  on public.tarefas
  for update
  using (
    exists (select 1 from public.usuarios u where u.id = auth.uid() and u.tipo = 'interno')
  );

drop policy if exists "tarefas_delete_interno" on public.tarefas;
create policy "tarefas_delete_interno"
  on public.tarefas
  for delete
  using (
    exists (select 1 from public.usuarios u where u.id = auth.uid() and u.tipo = 'interno')
  );

-- TEMPLATES: interno read+write; parceiro nem lê.
drop policy if exists "tarefa_templates_select_interno" on public.tarefa_templates;
create policy "tarefa_templates_select_interno"
  on public.tarefa_templates
  for select
  using (
    exists (select 1 from public.usuarios u where u.id = auth.uid() and u.tipo = 'interno')
  );

drop policy if exists "tarefa_templates_write_interno" on public.tarefa_templates;
create policy "tarefa_templates_write_interno"
  on public.tarefa_templates
  for all
  using (
    exists (select 1 from public.usuarios u where u.id = auth.uid() and u.tipo = 'interno')
  )
  with check (
    exists (select 1 from public.usuarios u where u.id = auth.uid() and u.tipo = 'interno')
  );


-- ----------------------------------------------------------------------------
-- 6. Seed mínimo de templates do INSS (alinhado com a skill agente-inss).
--    Edição/expansão depois via UI (MVP 2). Idempotente via UNIQUE(nome).
-- ----------------------------------------------------------------------------
insert into public.tarefa_templates (nome, gatilho, descricao, itens) values
(
  'inss_exigencia',
  'exigencia',
  'Exigência do INSS — cumprir em até 30 dias corridos.',
  '[
    {"titulo":"Cumprir exigência do INSS","tipo":"prazo","prioridade":1,"offset_dias":25},
    {"titulo":"Contatar cliente para documentos da exigência","tipo":"contato_cliente","prioridade":1,"offset_dias":2}
  ]'::jsonb
),
(
  'inss_indeferimento',
  'indeferimento',
  'Indeferimento do INSS — analisar recurso em até 30 dias.',
  '[
    {"titulo":"Analisar viabilidade de recurso (indeferimento)","tipo":"interna","prioridade":1,"offset_dias":5},
    {"titulo":"Comunicar cliente sobre indeferimento","tipo":"contato_cliente","prioridade":1,"offset_dias":2},
    {"titulo":"Prazo para recurso administrativo","tipo":"prazo","prioridade":1,"offset_dias":28}
  ]'::jsonb
),
(
  'inss_pericia_marcada',
  'pericia_marcada',
  'Perícia marcada — preparar cliente e acompanhar.',
  '[
    {"titulo":"Avisar cliente sobre perícia","tipo":"contato_cliente","prioridade":1,"offset_dias":1},
    {"titulo":"Perícia médica","tipo":"pericia","prioridade":1}
  ]'::jsonb
),
(
  'inss_deferimento',
  'deferimento',
  'Deferimento do INSS — confirmar valores e comunicar cliente.',
  '[
    {"titulo":"Conferir RMI e atrasados (deferimento)","tipo":"interna","prioridade":2,"offset_dias":3},
    {"titulo":"Comunicar cliente sobre deferimento","tipo":"contato_cliente","prioridade":1,"offset_dias":1}
  ]'::jsonb
)
on conflict (nome) do update set
  gatilho   = excluded.gatilho,
  descricao = excluded.descricao,
  itens     = excluded.itens,
  updated_at = now();

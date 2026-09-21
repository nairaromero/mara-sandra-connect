-- migration_rbac_05_qg.sql
--
-- RBAC multi-tenant, passo 5 de 5: o QG DA PLATAFORMA (superadmin)
-- (planning/MULTI_TENANT_RBAC.md §4.6 — decisão de 21/09: o QG vê e gerencia a
-- OPERAÇÃO de todos os escritórios, não o conteúdo dos clientes).
--
--   plataforma_staff          lista nominal, fora de `membros`
--   acessos_suporte           conteúdo só com aprovação do escritório, prazo e registro
--   auditoria                 só INSERT; o escritório vê o que a plataforma fez nele
--   ops.execucoes / ops.metricas_diarias / ops.aprovacoes_plataforma
--   qg_*                      o que o QG lê e faz — cada função começa por
--                             private.exigir_staff('<permissão>')
--
-- PARA O QG NÃO VIRAR PORTA DOS FUNDOS:
--   * nenhuma policy de tabela de domínio conhece `plataforma_staff`. Staff sem
--     vínculo e sem suporte aprovado lê 0 linhas em toda tabela;
--   * as funções qg_* devolvem METADADOS e CONTAGENS — nunca cliente, caso,
--     documento ou publicação;
--   * suporte entra com a PRÓPRIA identidade, só leitura: um gatilho de
--     instrução barra INSERT/UPDATE/DELETE em toda tabela de domínio;
--   * eliminar escritório exige segunda pessoa (quem pede não aprova) e carência.
--
-- Desvio consciente do plano: as funções ficam em `public` com prefixo `qg_`
-- (e não num schema `plataforma` exposto), para não depender de configuração
-- do PostgREST em cada ambiente. O efeito é o mesmo: só funções, nenhuma tabela.
--
-- MFA: `app_config.qg_exigir_aal2 = 'true'` liga a exigência de AAL2 (produção).
--
-- Idempotente.

create schema if not exists ops;

-- ---------------------------------------------------------------------------
-- 1. Tabelas
-- ---------------------------------------------------------------------------
create table if not exists public.plataforma_staff (
  usuario_id  uuid primary key references public.usuarios (id) on delete cascade,
  papel       text not null check (papel in ('dono', 'operacao', 'suporte', 'leitura')),
  break_glass boolean not null default false,
  ativo       boolean not null default true,
  criado_por  uuid references public.usuarios (id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table if not exists public.acessos_suporte (
  id            uuid primary key default gen_random_uuid(),
  escritorio_id uuid not null references public.escritorios (id) on delete cascade,
  staff_id      uuid not null references public.usuarios (id) on delete cascade,
  motivo        text not null check (length(btrim(motivo)) >= 10),
  ticket        text,
  escopo        text not null default 'leitura' check (escopo in ('leitura')),
  horas         int  not null default 4 check (horas between 1 and 72),
  status        text not null default 'pendente'
                check (status in ('pendente', 'aprovado', 'recusado', 'encerrado')),
  break_glass   boolean not null default false,
  solicitado_em timestamptz not null default now(),
  respondido_por uuid references public.usuarios (id) on delete set null,
  respondido_em timestamptz,
  inicio        timestamptz,
  fim           timestamptz
);
create index if not exists acessos_suporte_staff_idx on public.acessos_suporte (staff_id, status, fim);
create index if not exists acessos_suporte_esc_idx on public.acessos_suporte (escritorio_id, status);

create table if not exists public.auditoria (
  id            bigint generated always as identity primary key,
  escritorio_id uuid references public.escritorios (id) on delete set null,
  ator_id       uuid,
  tipo_ator     text not null check (tipo_ator in ('membro', 'suporte', 'plataforma', 'sistema')),
  acao          text not null,
  recurso       text,
  recurso_id    text,
  detalhes      jsonb not null default '{}'::jsonb, -- referências e contagens, nunca conteúdo
  created_at    timestamptz not null default now()
);
create index if not exists auditoria_esc_idx on public.auditoria (escritorio_id, created_at desc);

create table if not exists ops.execucoes (
  id            bigint generated always as identity primary key,
  escritorio_id uuid,
  rotina        text not null,
  inicio        timestamptz not null default now(),
  fim           timestamptz,
  status        text not null default 'rodando' check (status in ('rodando', 'ok', 'falhou')),
  erro_codigo   text,                                 -- código, nunca a mensagem com dado
  contagens     jsonb not null default '{}'::jsonb
);
create index if not exists execucoes_rotina_idx on ops.execucoes (rotina, inicio desc);

create table if not exists ops.metricas_diarias (
  escritorio_id uuid not null,
  dia           date not null,
  metrica       text not null,
  valor         numeric not null,
  primary key (escritorio_id, dia, metrica)
);

create table if not exists ops.aprovacoes_plataforma (
  id           uuid primary key default gen_random_uuid(),
  acao         text not null check (acao in ('eliminar_escritorio')),
  escritorio_id uuid,
  alvo         jsonb not null default '{}'::jsonb,
  pedido_por   uuid not null,
  pedido_em    timestamptz not null default now(),
  aprovado_por uuid,
  aprovado_em  timestamptz,
  status       text not null default 'pendente' check (status in ('pendente', 'aprovada', 'cancelada', 'executada'))
);

-- Nada disso é tabela de domínio nem entra na API: só funções leem e escrevem.
alter table public.plataforma_staff enable row level security;
alter table public.acessos_suporte  enable row level security;
alter table public.auditoria        enable row level security;
revoke all on public.plataforma_staff, public.acessos_suporte, public.auditoria from anon, authenticated;
grant all on public.plataforma_staff, public.acessos_suporte, public.auditoria to service_role;
revoke all on schema ops from public, anon, authenticated;
revoke all on all tables in schema ops from public, anon, authenticated;
grant usage on schema ops to service_role;
grant all on all tables in schema ops to service_role;
grant usage on all sequences in schema ops to service_role;

-- O escritório lê a PRÓPRIA trilha (transparência).
grant select on public.auditoria to authenticated;
drop policy if exists auditoria_do_escritorio on public.auditoria;
create policy auditoria_do_escritorio on public.auditoria
  for select to authenticated
  using (escritorio_id = (select private.escritorio_ativo())
         and (select private.tem_permissao('auditoria:ler', null)));

-- `auditoria` tem escritorio_id mas não é de domínio (nulo = ação da plataforma
-- sem escritório): fica fora do gerador do passo 2.
create or replace function private.tabelas_de_dominio() returns setof regclass
language sql stable set search_path = '' as $$
  select c.oid::regclass
    from pg_catalog.pg_class c
   where c.relnamespace = 'public'::regnamespace
     and c.relkind = 'r'
     and c.relname not in (
       'usuarios', 'aceites_termos', 'usuario_gmail_oauth', 'app_config', 'webhook_config',
       'escritorios', 'escritorio_config', 'permissoes', 'papeis', 'papel_permissoes', 'membros',
       'plataforma_staff', 'acessos_suporte', 'auditoria')
   order by c.relname
$$;

-- ---------------------------------------------------------------------------
-- 2. Quem é staff e o que pode
-- ---------------------------------------------------------------------------
create or replace function private.staff_pode(p_usuario uuid, p_perm text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.plataforma_staff s
     where s.usuario_id = p_usuario and s.ativo
       and case p_perm
             when 'ver'                   then true
             when 'escritorios_gerenciar' then s.papel in ('dono', 'operacao')
             when 'escritorios_encerrar'  then s.papel = 'dono'
             when 'membros_operar'        then s.papel in ('dono', 'operacao')
             when 'suporte_solicitar'     then s.papel in ('dono', 'operacao', 'suporte')
             when 'break_glass'           then s.break_glass
             when 'cobranca'              then s.papel in ('dono', 'operacao')
             when 'staff_gerenciar'       then s.papel = 'dono'
             else false end)
$$;

create or replace function private.exigir_staff(p_perm text) returns uuid
language plpgsql stable security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null or not private.staff_pode(v_uid, p_perm) then
    raise exception 'acesso restrito à equipe da plataforma' using errcode = '42501';
  end if;
  if coalesce((select valor from public.app_config where chave = 'qg_exigir_aal2'), 'false') = 'true'
     and coalesce(auth.jwt() ->> 'aal', 'aal1') <> 'aal2' then
    raise exception 'o QG exige verificação em duas etapas (AAL2)' using errcode = '42501';
  end if;
  return v_uid;
end;
$$;

create or replace function private.auditar(p_escritorio uuid, p_tipo_ator text, p_acao text,
                                           p_recurso text default null, p_recurso_id text default null,
                                           p_detalhes jsonb default '{}'::jsonb) returns void
language sql security definer set search_path = '' as $$
  insert into public.auditoria (escritorio_id, ator_id, tipo_ator, acao, recurso, recurso_id, detalhes)
  values (p_escritorio, auth.uid(), p_tipo_ator, p_acao, p_recurso, p_recurso_id, coalesce(p_detalhes, '{}'::jsonb))
$$;

-- ---------------------------------------------------------------------------
-- 3. Suporte: entra no escritório ativo, com a própria identidade, só leitura
-- ---------------------------------------------------------------------------
create or replace function private.suporte_valido(p_usuario uuid, p_escritorio uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
      from public.acessos_suporte a
      join public.plataforma_staff s on s.usuario_id = a.staff_id and s.ativo
      join public.escritorios e on e.id = a.escritorio_id and e.status in ('ativo', 'suspenso')
     where a.staff_id = p_usuario and a.escritorio_id = p_escritorio
       and a.status = 'aprovado' and now() >= a.inicio and now() < a.fim)
$$;

create or replace function private.pode_entrar(p_usuario uuid, p_escritorio uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
      from public.membros m
      join public.escritorios e on e.id = m.escritorio_id
     where m.usuario_id = p_usuario and m.escritorio_id = p_escritorio
       and m.status = 'ativo' and e.status = 'ativo')
      or private.suporte_valido(p_usuario, p_escritorio)
$$;

-- Em sessão de suporte agora? (staff, sem vínculo ativo no escritório ativo.)
create or replace function private.em_suporte() returns boolean
language plpgsql stable security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_esc uuid;
begin
  if v_uid is null
     or not exists (select 1 from public.plataforma_staff where usuario_id = v_uid and ativo) then
    return false;
  end if;
  v_esc := private.escritorio_ativo();
  if v_esc is null then
    return false;
  end if;
  return not exists (select 1 from public.membros
                      where usuario_id = v_uid and escritorio_id = v_esc and status = 'ativo')
         and private.suporte_valido(v_uid, v_esc);
end;
$$;

-- O vínculo: membro ativo, ou — em suporte — leitura de advogado, sem ser admin.
create or replace function private.meu_vinculo()
returns table (membro_id uuid, escritorio_id uuid, papel_id uuid, papel text, tipo_acesso text)
language sql stable security definer set search_path = '' as $$
  select m.id, m.escritorio_id, p.id, p.chave, p.tipo_acesso
    from public.membros m
    join public.papeis p on p.id = m.papel_id
   where m.usuario_id = (select auth.uid())
     and m.status = 'ativo'
     and m.escritorio_id = (select private.escritorio_ativo())
  union all
  select null::uuid, (select private.escritorio_ativo()), p.id, 'suporte'::text, 'interno'::text
    from public.papeis p
   where p.escritorio_id is null and p.chave = 'advogado'
     and (select private.em_suporte())
$$;

create or replace function private.tg_suporte_nao_escreve() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if private.em_suporte() then
    raise exception 'sessão de suporte é somente leitura' using errcode = '42501';
  end if;
  return null;
end;
$$;

do $$
declare
  t regclass;
begin
  for t in select private.tabelas_de_dominio() loop
    execute format('drop trigger if exists ab_suporte_nao_escreve on %s', t);
    execute format('create trigger ab_suporte_nao_escreve before insert or update or delete on %s
                      for each statement execute function private.tg_suporte_nao_escreve()', t);
  end loop;
end $$;

revoke all on all functions in schema private from public, anon;
grant execute on all functions in schema private to authenticated, service_role;
revoke execute on function private.bloquear_login_se_sem_vinculo(uuid), private.auditar(uuid, text, text, text, text, jsonb)
  from authenticated;

-- ---------------------------------------------------------------------------
-- 4. QG — leitura (metadados e contagens)
-- ---------------------------------------------------------------------------
create or replace function public.qg_eu()
returns table (papel text, break_glass boolean, permissoes text[], exige_aal2 boolean, aal text)
language sql stable security definer set search_path = '' as $$
  select s.papel, s.break_glass,
         array(select p from unnest(array['ver','escritorios_gerenciar','escritorios_encerrar','membros_operar',
                                          'suporte_solicitar','break_glass','cobranca','staff_gerenciar']) p
                where private.staff_pode(s.usuario_id, p)),
         coalesce((select valor from public.app_config where chave = 'qg_exigir_aal2'), 'false') = 'true',
         coalesce(auth.jwt() ->> 'aal', 'aal1')
    from public.plataforma_staff s
   where s.usuario_id = auth.uid() and s.ativo
$$;

create or replace function public.qg_escritorios()
returns table (id uuid, slug text, nome text, cnpj text, status text, plano text, padrao_sistema boolean,
               criado_em timestamptz, suspenso_em timestamptz, suspenso_motivo text, encerrado_em timestamptz,
               membros_ativos int, admins int, admins_sem_mfa int, casos int, documentos int,
               tokens_mcp int, ultimo_acesso timestamptz, suporte_aberto int)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.exigir_staff('ver');
  return query
  select e.id, e.slug, e.nome, e.cnpj, e.status, e.plano, e.padrao_sistema,
         e.created_at, e.suspenso_em, e.suspenso_motivo, e.encerrado_em,
         (select count(*)::int from public.membros m where m.escritorio_id = e.id and m.status = 'ativo'),
         (select count(*)::int from public.membros m join public.papeis p on p.id = m.papel_id and p.chave = 'admin'
           where m.escritorio_id = e.id and m.status = 'ativo'),
         (select count(*)::int from public.membros m join public.papeis p on p.id = m.papel_id and p.chave = 'admin'
           where m.escritorio_id = e.id and m.status = 'ativo'
             and not exists (select 1 from auth.mfa_factors f where f.user_id = m.usuario_id and f.status = 'verified')),
         (select count(*)::int from public.casos c where c.escritorio_id = e.id),
         (select count(*)::int from public.documentos d where d.escritorio_id = e.id),
         (select count(*)::int from public.ia_tokens t where t.escritorio_id = e.id and t.revogado_em is null
             and (t.expira_em is null or t.expira_em > now())),
         (select max(a.last_sign_in_at) from public.membros m join auth.users a on a.id = m.usuario_id
           where m.escritorio_id = e.id),
         (select count(*)::int from public.acessos_suporte s where s.escritorio_id = e.id
             and (s.status = 'pendente' or (s.status = 'aprovado' and now() < s.fim)))
    from public.escritorios e
   order by e.padrao_sistema desc, e.nome;
end;
$$;

-- Quem USA o sistema (equipe e parceiros) — dado para operar o contrato. Os
-- clientes do escritório, as pessoas atendidas, nunca aparecem aqui.
create or replace function public.qg_membros(p_escritorio_id uuid)
returns table (usuario_id uuid, nome text, email text, papel text, papel_nome text, tipo_acesso text,
               status text, mfa boolean, ultimo_acesso timestamptz, desde timestamptz)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.exigir_staff('ver');
  return query
  select u.id, u.nome, u.email, p.chave, p.nome, p.tipo_acesso, m.status,
         exists (select 1 from auth.mfa_factors f where f.user_id = u.id and f.status = 'verified'),
         a.last_sign_in_at, m.created_at
    from public.membros m
    join public.usuarios u on u.id = m.usuario_id
    join public.papeis p on p.id = m.papel_id
    left join auth.users a on a.id = u.id
   where m.escritorio_id = p_escritorio_id
   order by p.ordem, u.nome;
end;
$$;

create or replace function public.qg_uso(p_escritorio_id uuid default null)
returns table (escritorio_id uuid, metrica text, valor numeric)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.exigir_staff('ver');
  return query
  with e as (select id from public.escritorios where p_escritorio_id is null or id = p_escritorio_id)
  select e.id, m.metrica, m.valor
    from e
    cross join lateral (values
      ('membros_ativos',  (select count(*) from public.membros x where x.escritorio_id = e.id and x.status = 'ativo')::numeric),
      ('clientes',        (select count(*) from public.clientes x where x.escritorio_id = e.id)::numeric),
      ('casos',           (select count(*) from public.casos x where x.escritorio_id = e.id)::numeric),
      ('casos_abertos',   (select count(*) from public.casos x where x.escritorio_id = e.id
                             and x.status::text not in ('arquivado','concluido_exito','concluido_sem_exito'))::numeric),
      ('documentos',      (select count(*) from public.documentos x where x.escritorio_id = e.id)::numeric),
      ('storage_bytes',   (select coalesce(sum((o.metadata ->> 'size')::bigint), 0)
                             from storage.objects o join public.casos c on c.id::text = split_part(o.name, '/', 1)
                            where o.bucket_id in ('documentos', 'cnis-uploads') and c.escritorio_id = e.id)::numeric),
      ('tarefas_abertas', (select count(*) from public.tarefas x where x.escritorio_id = e.id and x.status in ('a_fazer','fazendo'))::numeric),
      ('ia_chamadas_30d', (select count(*) from public.ia_acoes x where x.escritorio_id = e.id and x.created_at > now() - interval '30 days')::numeric),
      ('ia_tokens_30d',   (select coalesce(sum(coalesce(x.tokens_in,0) + coalesce(x.tokens_out,0)), 0) from public.ia_acoes x
                            where x.escritorio_id = e.id and x.created_at > now() - interval '30 days')::numeric),
      ('tokens_mcp',      (select count(*) from public.ia_tokens x where x.escritorio_id = e.id and x.revogado_em is null)::numeric),
      ('notificacoes_30d',(select count(*) from public.notificacoes x where x.escritorio_id = e.id and x.created_at > now() - interval '30 days')::numeric)
    ) as m(metrica, valor);
end;
$$;

create or replace function public.qg_saude()
returns table (grupo text, item text, escritorio_id uuid, estado text, quando timestamptz, detalhe text)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.exigir_staff('ver');

  -- rotinas registradas pelas edge functions (ops.execucoes): a última de cada
  return query
  select 'rotina'::text, x.rotina, x.escritorio_id,
         case when x.status = 'ok' then 'ok' when x.status = 'rodando' and x.inicio < now() - interval '30 minutes' then 'travada'
              else x.status end,
         coalesce(x.fim, x.inicio), x.erro_codigo
    from (select distinct on (rotina, ops.execucoes.escritorio_id) * from ops.execucoes
           order by rotina, ops.execucoes.escritorio_id, inicio desc) x;

  -- jobs do pg_cron (só onde existe: produção)
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    return query execute $q$
      select 'cron'::text, j.jobname::text, null::uuid,
             case when not j.active then 'desligado'
                  when d.status = 'succeeded' then 'ok'
                  when d.status is null then 'nunca rodou' else 'falhou' end,
             d.start_time, left(d.return_message, 60)
        from cron.job j
        left join lateral (select status, start_time, return_message from cron.job_run_details r
                            where r.jobid = j.jobid order by start_time desc limit 1) d on true
       order by j.jobname $q$;
  end if;

  -- filas por escritório: só contagens
  return query
  select 'fila'::text, 'webhooks pendentes'::text, w.escritorio_id,
         case when count(*) filter (where w.status = 'falhou') > 0 then 'falhou' else 'ok' end,
         max(w.created_at), count(*)::text || ' evento(s)'
    from public.webhook_eventos w
   where w.status in ('pendente', 'falhou')
   group by w.escritorio_id;

  return query
  select 'fila'::text, 'whatsapp na fila'::text, o.escritorio_id, 'ok'::text, max(o.created_at), count(*)::text || ' mensagem(ns)'
    from public.whatsapp_outbox o
   where o.status = 'pendente'
   group by o.escritorio_id;

  -- respostas do pg_net nas últimas 24 h
  if exists (select 1 from pg_class where relname = '_http_response' and relnamespace = 'net'::regnamespace) then
    return query execute $q$
      select 'rede'::text, 'chamadas do banco (24 h)'::text, null::uuid,
             case when count(*) filter (where status_code >= 400 or status_code is null) > 0 then 'falhou' else 'ok' end,
             max(created),
             count(*) filter (where status_code < 400)::text || ' ok · ' ||
             count(*) filter (where status_code >= 400 or status_code is null)::text || ' com erro'
        from net._http_response where created > now() - interval '24 hours' $q$;
  end if;
end;
$$;

create or replace function public.qg_auditoria(p_escritorio_id uuid default null, p_limite int default 100)
returns table (id bigint, escritorio_id uuid, escritorio_nome text, ator_nome text, tipo_ator text,
               acao text, recurso text, recurso_id text, detalhes jsonb, created_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.exigir_staff('ver');
  return query
  select a.id, a.escritorio_id, e.nome, u.nome, a.tipo_ator, a.acao, a.recurso, a.recurso_id, a.detalhes, a.created_at
    from public.auditoria a
    left join public.escritorios e on e.id = a.escritorio_id
    left join public.usuarios u on u.id = a.ator_id
   where a.tipo_ator in ('plataforma', 'suporte')
     and (p_escritorio_id is null or a.escritorio_id = p_escritorio_id)
   order by a.created_at desc
   limit least(greatest(p_limite, 1), 500);
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. QG — ciclo de vida do escritório
-- ---------------------------------------------------------------------------
-- A conta do primeiro admin é criada pela edge function `qg-escritorios`
-- (precisa da Admin API do Auth); esta função faz a parte do banco.
create or replace function public.qg_criar_escritorio(p_nome text, p_slug text, p_cnpj text default null,
                                                       p_plano text default 'padrao') returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_id    uuid;
  v_base  uuid := private.escritorio_padrao();
begin
  perform private.exigir_staff('escritorios_gerenciar');
  if coalesce(btrim(p_nome), '') = '' then
    raise exception 'informe o nome do escritório';
  end if;

  insert into public.escritorios (slug, nome, cnpj, plano, status)
  values (lower(btrim(p_slug)), btrim(p_nome), nullif(btrim(p_cnpj), ''), coalesce(nullif(btrim(p_plano), ''), 'padrao'), 'provisionando')
  returning id into v_id;
  insert into public.escritorio_config (escritorio_id) values (v_id);

  -- Conjunto padrão, sem nada do escritório de origem: tipos de benefício e
  -- templates (sem responsável fixo nem e-mail de executor).
  insert into public.tipos_beneficio (escritorio_id, nome, ativo, ordem)
  select v_id, t.nome, t.ativo, t.ordem from public.tipos_beneficio t where t.escritorio_id = v_base;

  insert into public.tarefa_templates (escritorio_id, nome, gatilho, descricao, itens, ativo, oculto_na_ui, rotulo)
  select v_id, t.nome, t.gatilho, t.descricao,
         (select jsonb_agg(i - 'responsavel_id' - 'executor_email' - 'executor_id') from jsonb_array_elements(t.itens) i),
         t.ativo, t.oculto_na_ui, t.rotulo
    from public.tarefa_templates t where t.escritorio_id = v_base;

  perform private.auditar(v_id, 'plataforma', 'escritorio.criar', 'escritorios', v_id::text,
                          jsonb_build_object('slug', lower(btrim(p_slug)), 'plano', p_plano));
  return v_id;
end;
$$;

-- Chamado pela edge function depois de criar a conta do primeiro admin.
create or replace function public.qg_vincular_primeiro_admin(p_escritorio_id uuid, p_usuario_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform private.exigir_staff('escritorios_gerenciar');
  insert into public.membros (escritorio_id, usuario_id, papel_id, status, convidado_por)
  select p_escritorio_id, p_usuario_id, p.id, 'ativo', auth.uid()
    from public.papeis p where p.escritorio_id is null and p.chave = 'admin'
  on conflict (escritorio_id, usuario_id) do update
     set status = 'ativo', papel_id = excluded.papel_id, desativado_em = null, updated_at = now();

  update public.escritorios set status = 'ativo', updated_at = now()
   where id = p_escritorio_id and status = 'provisionando';
  perform private.auditar(p_escritorio_id, 'plataforma', 'escritorio.primeiro_admin', 'usuarios', p_usuario_id::text);
end;
$$;

create or replace function public.qg_atualizar_escritorio(p_id uuid, p_patch jsonb) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform private.exigir_staff('escritorios_gerenciar');
  update public.escritorios e
     set nome    = coalesce(nullif(btrim(p_patch ->> 'nome'), ''), e.nome),
         slug    = coalesce(nullif(lower(btrim(p_patch ->> 'slug')), ''), e.slug),
         cnpj    = case when p_patch ? 'cnpj' then nullif(btrim(p_patch ->> 'cnpj'), '') else e.cnpj end,
         plano   = coalesce(nullif(btrim(p_patch ->> 'plano'), ''), e.plano),
         limites = case when p_patch ? 'limites' then p_patch -> 'limites' else e.limites end,
         flags   = case when p_patch ? 'flags' then p_patch -> 'flags' else e.flags end,
         contato_encarregado = case when p_patch ? 'contato_encarregado'
                                    then nullif(btrim(p_patch ->> 'contato_encarregado'), '') else e.contato_encarregado end,
         updated_at = now()
   where e.id = p_id;
  if not found then
    raise exception 'escritório não encontrado';
  end if;
  perform private.auditar(p_id, 'plataforma', 'escritorio.editar', 'escritorios', p_id::text,
                          jsonb_build_object('campos', (select jsonb_agg(k) from jsonb_object_keys(p_patch) k)));
end;
$$;

create or replace function public.qg_suspender_escritorio(p_id uuid, p_motivo text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform private.exigir_staff('escritorios_gerenciar');
  if length(btrim(coalesce(p_motivo, ''))) < 10 then
    raise exception 'informe o motivo da suspensão (o escritório é avisado)';
  end if;
  update public.escritorios
     set status = 'suspenso', suspenso_em = now(), suspenso_motivo = btrim(p_motivo), updated_at = now()
   where id = p_id and status = 'ativo' and not padrao_sistema;
  if not found then
    raise exception 'só dá para suspender escritório ativo (e nunca o escritório padrão do sistema)';
  end if;
  perform private.auditar(p_id, 'plataforma', 'escritorio.suspender', 'escritorios', p_id::text,
                          jsonb_build_object('motivo', btrim(p_motivo)));
end;
$$;

create or replace function public.qg_reativar_escritorio(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform private.exigir_staff('escritorios_gerenciar');
  update public.escritorios
     set status = 'ativo', suspenso_em = null, suspenso_motivo = null, updated_at = now()
   where id = p_id and status = 'suspenso';
  if not found then
    raise exception 'só dá para reativar escritório suspenso';
  end if;
  perform private.auditar(p_id, 'plataforma', 'escritorio.reativar', 'escritorios', p_id::text);
end;
$$;

-- Encerrar: o escritório sai do ar e começa a carência. Os dados ficam.
create or replace function public.qg_encerrar_escritorio(p_id uuid, p_motivo text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform private.exigir_staff('escritorios_encerrar');
  if length(btrim(coalesce(p_motivo, ''))) < 10 then
    raise exception 'informe o motivo do encerramento';
  end if;
  update public.escritorios
     set status = 'encerrado', encerrado_em = now(), suspenso_motivo = btrim(p_motivo), updated_at = now()
   where id = p_id and status in ('ativo', 'suspenso', 'provisionando') and not padrao_sistema;
  if not found then
    raise exception 'escritório não encontrado, já encerrado, ou é o escritório padrão do sistema';
  end if;
  perform private.auditar(p_id, 'plataforma', 'escritorio.encerrar', 'escritorios', p_id::text,
                          jsonb_build_object('motivo', btrim(p_motivo)));
end;
$$;

-- Eliminar: pedido de uma pessoa, aprovação de OUTRA, depois da carência.
create or replace function public.qg_pedir_eliminacao(p_id uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := private.exigir_staff('escritorios_encerrar');
  v_ap  uuid;
begin
  if not exists (select 1 from public.escritorios where id = p_id and status = 'encerrado') then
    raise exception 'só escritório encerrado pode ser eliminado';
  end if;
  select id into v_ap from ops.aprovacoes_plataforma
   where acao = 'eliminar_escritorio' and escritorio_id = p_id and status = 'pendente';
  if v_ap is not null then
    return v_ap;
  end if;
  insert into ops.aprovacoes_plataforma (acao, escritorio_id, pedido_por)
  values ('eliminar_escritorio', p_id, v_uid) returning id into v_ap;
  perform private.auditar(p_id, 'plataforma', 'escritorio.eliminacao_pedida', 'escritorios', p_id::text);
  return v_ap;
end;
$$;

create or replace function public.qg_aprovacoes()
returns table (id uuid, acao text, escritorio_id uuid, escritorio_nome text, pedido_por_nome text,
               pedido_em timestamptz, status text, posso_aprovar boolean, libera_em timestamptz)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_dias int := coalesce((select valor::int from public.app_config where chave = 'qg_carencia_dias'), 30);
begin
  perform private.exigir_staff('ver');
  return query
  select a.id, a.acao, a.escritorio_id, e.nome, u.nome, a.pedido_em, a.status,
         a.status = 'pendente' and a.pedido_por <> auth.uid() and private.staff_pode(auth.uid(), 'escritorios_encerrar'),
         e.encerrado_em + make_interval(days => v_dias)
    from ops.aprovacoes_plataforma a
    left join public.escritorios e on e.id = a.escritorio_id
    left join public.usuarios u on u.id = a.pedido_por
   order by a.pedido_em desc;
end;
$$;

-- Apaga tudo do escritório. Filhos antes dos pais: repete até zerar, deixando
-- para a volta seguinte o que ainda tem dependente.
create or replace function private.eliminar_dados_do_escritorio(p_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  t       regclass;
  v_n     bigint;
  v_total bigint := 0;
  v_resta bigint;
  v_volta int := 0;
begin
  if exists (select 1 from public.escritorios where id = p_id and (padrao_sistema or status <> 'encerrado')) then
    raise exception 'só escritório encerrado (e nunca o padrão) pode ser eliminado';
  end if;
  loop
    v_volta := v_volta + 1;
    v_resta := 0;
    for t in select private.tabelas_de_dominio() loop
      begin
        execute format('delete from %s where escritorio_id = $1', t) using p_id;
        get diagnostics v_n = row_count;
        v_total := v_total + v_n;
      exception when foreign_key_violation then
        null; -- ainda tem filho: fica para a próxima volta
      end;
      execute format('select count(*) from %s where escritorio_id = $1', t) into v_n using p_id;
      v_resta := v_resta + v_n;
    end loop;
    exit when v_resta = 0;
    if v_volta >= 12 then
      raise exception 'eliminação não convergiu: % linha(s) restantes', v_resta;
    end if;
  end loop;

  delete from public.membros where escritorio_id = p_id;
  delete from public.papeis where escritorio_id = p_id;
  delete from public.acessos_suporte where escritorio_id = p_id;
  delete from public.escritorio_config where escritorio_id = p_id;
  delete from public.escritorios where id = p_id;
  return jsonb_build_object('linhas_apagadas', v_total, 'voltas', v_volta);
end;
$$;
revoke all on function private.eliminar_dados_do_escritorio(uuid) from public, anon, authenticated;

create or replace function public.qg_aprovar_eliminacao(p_aprovacao_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid  uuid := private.exigir_staff('escritorios_encerrar');
  v_ap   ops.aprovacoes_plataforma%rowtype;
  v_esc  public.escritorios%rowtype;
  v_dias int := coalesce((select valor::int from public.app_config where chave = 'qg_carencia_dias'), 30);
  v_res  jsonb;
begin
  select * into v_ap from ops.aprovacoes_plataforma where id = p_aprovacao_id and status = 'pendente' for update;
  if not found then
    raise exception 'pedido não encontrado ou já resolvido';
  end if;
  if v_ap.pedido_por = v_uid then
    raise exception 'quem pede não aprova: a eliminação precisa de uma segunda pessoa' using errcode = '42501';
  end if;
  select * into v_esc from public.escritorios where id = v_ap.escritorio_id;
  if v_esc.encerrado_em + make_interval(days => v_dias) > now() then
    raise exception 'carência de % dia(s): liberado em %', v_dias,
      to_char(v_esc.encerrado_em + make_interval(days => v_dias), 'DD/MM/YYYY');
  end if;

  v_res := private.eliminar_dados_do_escritorio(v_ap.escritorio_id);
  update ops.aprovacoes_plataforma
     set status = 'executada', aprovado_por = v_uid, aprovado_em = now(),
         alvo = alvo || jsonb_build_object('escritorio', v_esc.nome, 'slug', v_esc.slug) || v_res
   where id = p_aprovacao_id;
  perform private.auditar(null, 'plataforma', 'escritorio.eliminar', 'escritorios', v_ap.escritorio_id::text,
                          v_res || jsonb_build_object('escritorio', v_esc.nome));
  return v_res;
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. QG — membros e staff
-- ---------------------------------------------------------------------------
create or replace function public.qg_desativar_membro(p_escritorio_id uuid, p_usuario_id uuid, p_motivo text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform private.exigir_staff('membros_operar');
  if length(btrim(coalesce(p_motivo, ''))) < 10 then
    raise exception 'informe o motivo (o escritório é avisado)';
  end if;
  update public.membros set status = 'desativado', desativado_em = now(), desativado_por = auth.uid(), updated_at = now()
   where escritorio_id = p_escritorio_id and usuario_id = p_usuario_id and status <> 'desativado';
  if not found then
    raise exception 'vínculo não encontrado ou já desativado';
  end if;
  perform private.bloquear_login_se_sem_vinculo(p_usuario_id);
  perform private.auditar(p_escritorio_id, 'plataforma', 'membro.desativar', 'usuarios', p_usuario_id::text,
                          jsonb_build_object('motivo', btrim(p_motivo)));
end;
$$;

create or replace function public.qg_trocar_titular(p_escritorio_id uuid, p_usuario_id uuid, p_motivo text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform private.exigir_staff('membros_operar');
  if length(btrim(coalesce(p_motivo, ''))) < 10 then
    raise exception 'informe o motivo (todos os admins do escritório são avisados)';
  end if;
  update public.membros m set papel_id = p.id, updated_at = now()
    from public.papeis p
   where p.escritorio_id is null and p.chave = 'admin'
     and m.escritorio_id = p_escritorio_id and m.usuario_id = p_usuario_id and m.status = 'ativo';
  if not found then
    raise exception 'a pessoa precisa ser membro ativo do escritório';
  end if;
  perform private.auditar(p_escritorio_id, 'plataforma', 'membro.trocar_titular', 'usuarios', p_usuario_id::text,
                          jsonb_build_object('motivo', btrim(p_motivo)));
end;
$$;

create or replace function public.qg_staff()
returns table (usuario_id uuid, nome text, email text, papel text, break_glass boolean, ativo boolean,
               mfa boolean, ultimo_acesso timestamptz)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.exigir_staff('ver');
  return query
  select u.id, u.nome, u.email, s.papel, s.break_glass, s.ativo,
         exists (select 1 from auth.mfa_factors f where f.user_id = u.id and f.status = 'verified'),
         a.last_sign_in_at
    from public.plataforma_staff s
    join public.usuarios u on u.id = s.usuario_id
    left join auth.users a on a.id = u.id
   order by s.ativo desc, s.papel, u.nome;
end;
$$;

create or replace function public.qg_definir_staff(p_email text, p_papel text, p_ativo boolean default true,
                                                   p_break_glass boolean default false) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_alvo uuid;
begin
  perform private.exigir_staff('staff_gerenciar');
  select id into v_alvo from public.usuarios where lower(email) = lower(btrim(p_email));
  if v_alvo is null then
    raise exception 'não existe conta com este e-mail';
  end if;
  if v_alvo = auth.uid() and (p_papel <> 'dono' or not p_ativo) then
    raise exception 'você não pode rebaixar nem desativar a si mesma(o) no QG';
  end if;

  insert into public.plataforma_staff (usuario_id, papel, ativo, break_glass, criado_por)
  values (v_alvo, p_papel, coalesce(p_ativo, true), coalesce(p_break_glass, false), auth.uid())
  on conflict (usuario_id) do update
     set papel = excluded.papel, ativo = excluded.ativo, break_glass = excluded.break_glass, updated_at = now();

  if not exists (select 1 from public.plataforma_staff where papel = 'dono' and ativo) then
    raise exception 'o QG precisa de pelo menos um dono ativo';
  end if;
  perform private.auditar(null, 'plataforma', 'staff.definir', 'usuarios', v_alvo::text,
                          jsonb_build_object('papel', p_papel, 'ativo', p_ativo, 'break_glass', p_break_glass));
end;
$$;

-- ---------------------------------------------------------------------------
-- 7. Suporte — os dois lados
-- ---------------------------------------------------------------------------
create or replace function public.qg_suporte_solicitar(p_escritorio_id uuid, p_motivo text,
                                                        p_ticket text default null, p_horas int default 4,
                                                        p_break_glass boolean default false) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := private.exigir_staff('suporte_solicitar');
  v_id  uuid;
begin
  if p_break_glass then
    perform private.exigir_staff('break_glass');
  end if;
  insert into public.acessos_suporte (escritorio_id, staff_id, motivo, ticket, horas, break_glass,
                                      status, respondido_em, inicio, fim)
  values (p_escritorio_id, v_uid, btrim(p_motivo), nullif(btrim(p_ticket), ''), coalesce(p_horas, 4), p_break_glass,
          case when p_break_glass then 'aprovado' else 'pendente' end,
          case when p_break_glass then now() end,
          case when p_break_glass then now() end,
          case when p_break_glass then now() + make_interval(hours => coalesce(p_horas, 4)) end)
  returning id into v_id;
  perform private.auditar(p_escritorio_id, case when p_break_glass then 'suporte' else 'plataforma' end,
                          case when p_break_glass then 'suporte.break_glass' else 'suporte.solicitar' end,
                          'acessos_suporte', v_id::text,
                          jsonb_build_object('motivo', btrim(p_motivo), 'ticket', p_ticket, 'horas', p_horas));
  return v_id;
end;
$$;

create or replace function public.qg_suporte()
returns table (id uuid, escritorio_id uuid, escritorio_nome text, staff_nome text, meu boolean, motivo text,
               ticket text, horas int, status text, break_glass boolean, solicitado_em timestamptz,
               inicio timestamptz, fim timestamptz, valido_agora boolean)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.exigir_staff('ver');
  return query
  select a.id, a.escritorio_id, e.nome, u.nome, a.staff_id = auth.uid(), a.motivo, a.ticket, a.horas,
         a.status, a.break_glass, a.solicitado_em, a.inicio, a.fim,
         a.status = 'aprovado' and now() >= a.inicio and now() < a.fim
    from public.acessos_suporte a
    join public.escritorios e on e.id = a.escritorio_id
    join public.usuarios u on u.id = a.staff_id
   order by a.solicitado_em desc
   limit 200;
end;
$$;

create or replace function public.qg_suporte_encerrar(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_esc uuid;
begin
  perform private.exigir_staff('suporte_solicitar');
  update public.acessos_suporte set status = 'encerrado', fim = least(coalesce(fim, now()), now())
   where id = p_id and status in ('pendente', 'aprovado')
  returning escritorio_id into v_esc;
  if not found then
    raise exception 'acesso não encontrado ou já encerrado';
  end if;
  perform private.auditar(v_esc, 'plataforma', 'suporte.encerrar', 'acessos_suporte', p_id::text);
end;
$$;

-- Lado do escritório: o admin vê os pedidos e responde.
create or replace function public.suporte_pedidos()
returns table (id uuid, staff_nome text, motivo text, ticket text, horas int, status text, break_glass boolean,
               solicitado_em timestamptz, inicio timestamptz, fim timestamptz)
language sql stable security definer set search_path = '' as $$
  select a.id, u.nome, a.motivo, a.ticket, a.horas, a.status, a.break_glass, a.solicitado_em, a.inicio, a.fim
    from public.acessos_suporte a
    join public.usuarios u on u.id = a.staff_id
   where a.escritorio_id = (select private.escritorio_ativo())
     and (select public.is_admin())
   order by a.solicitado_em desc
   limit 100
$$;

create or replace function public.suporte_responder(p_id uuid, p_aprovar boolean) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_esc uuid := private.escritorio_ativo();
begin
  if not public.is_admin() then
    raise exception 'só um administrador do escritório responde a pedido de suporte' using errcode = '42501';
  end if;
  update public.acessos_suporte
     set status = case when p_aprovar then 'aprovado' else 'recusado' end,
         respondido_por = auth.uid(), respondido_em = now(),
         inicio = case when p_aprovar then now() end,
         fim    = case when p_aprovar then now() + make_interval(hours => horas) end
   where id = p_id and escritorio_id = v_esc and status = 'pendente';
  if not found then
    raise exception 'pedido não encontrado ou já respondido';
  end if;
  perform private.auditar(v_esc, 'membro', case when p_aprovar then 'suporte.aprovar' else 'suporte.recusar' end,
                          'acessos_suporte', p_id::text);
end;
$$;

-- O front registra o que a sessão de suporte abriu (tela/recurso).
create or replace function public.suporte_registrar(p_recurso text, p_recurso_id text default null) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if private.em_suporte() then
    perform private.auditar(private.escritorio_ativo(), 'suporte', 'suporte.abrir', left(p_recurso, 120), left(p_recurso_id, 80));
  end if;
end;
$$;

-- Onde eu, staff, posso entrar agora (para o seletor de escritório do suporte).
create or replace function public.meus_acessos_suporte()
returns table (acesso_id uuid, escritorio_id uuid, escritorio_nome text, fim timestamptz)
language sql stable security definer set search_path = '' as $$
  select a.id, a.escritorio_id, e.nome, a.fim
    from public.acessos_suporte a
    join public.escritorios e on e.id = a.escritorio_id
   where a.staff_id = (select auth.uid())
     and a.status = 'aprovado' and now() >= a.inicio and now() < a.fim
$$;

-- Registro de execução das rotinas (chamado pelas edge functions com service role).
create or replace function public.ops_registrar_execucao(p_rotina text, p_status text, p_inicio timestamptz,
                                                          p_erro_codigo text default null,
                                                          p_contagens jsonb default '{}'::jsonb,
                                                          p_escritorio_id uuid default null) returns void
language sql security definer set search_path = '' as $$
  insert into ops.execucoes (escritorio_id, rotina, inicio, fim, status, erro_codigo, contagens)
  values (coalesce(p_escritorio_id, private.escritorio_padrao()), p_rotina, p_inicio, now(),
          case when p_status in ('ok', 'falhou') then p_status else 'falhou' end,
          left(p_erro_codigo, 80), coalesce(p_contagens, '{}'::jsonb))
$$;

-- ---------------------------------------------------------------------------
-- 8. Grants
-- ---------------------------------------------------------------------------
do $$
declare
  f record;
begin
  for f in
    select p.oid::regprocedure as assinatura, p.proname
      from pg_proc p
     where p.pronamespace = 'public'::regnamespace
       and (p.proname like 'qg\_%' or p.proname in ('suporte_pedidos', 'suporte_responder', 'suporte_registrar',
                                                     'meus_acessos_suporte', 'ops_registrar_execucao'))
  loop
    execute format('revoke execute on function %s from public, anon', f.assinatura);
    if f.proname = 'ops_registrar_execucao' then
      execute format('revoke execute on function %s from authenticated', f.assinatura);
      execute format('grant execute on function %s to service_role', f.assinatura);
    else
      execute format('grant execute on function %s to authenticated, service_role', f.assinatura);
    end if;
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Conferência
-- ---------------------------------------------------------------------------
select
  (select count(*) from pg_proc where pronamespace = 'public'::regnamespace and proname like 'qg\_%') as funcoes_qg,
  (select count(*) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname like 'qg\_%'
      and p.proname <> 'qg_eu' and pg_get_functiondef(p.oid) not like '%private.exigir_staff(%') as qg_sem_exigir_staff,
  (select count(*) from pg_policies where schemaname in ('public', 'storage')
      and coalesce(qual, '') || coalesce(with_check, '') ~ 'plataforma_staff') as policies_que_citam_staff,
  (select count(*) from pg_trigger where tgname = 'ab_suporte_nao_escreve') as gatilhos_suporte_nao_escreve,
  (select count(*) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind = 'f'
      and has_function_privilege('anon', p.oid, 'EXECUTE')) as executaveis_por_anon;

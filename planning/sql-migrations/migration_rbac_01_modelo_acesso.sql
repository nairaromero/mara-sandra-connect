-- migration_rbac_01_modelo_acesso.sql
--
-- RBAC multi-tenant, passo 1 de 5: o MODELO DE ACESSO (planning/MULTI_TENANT_RBAC.md
-- §4.1 e Fase 2). Aditiva — nada muda para quem usa o sistema.
--
--   escritorios · escritorio_config          o tenant e o que hoje está chumbado
--   permissoes · papeis · papel_permissoes   catálogo e a matriz de §4.3
--   membros                                  vínculo pessoa × escritório (a fonte da verdade)
--   private.escritorio_ativo()               o escritório desta requisição
--   tem_permissao() · minhas_permissoes()    o que o front e as policies perguntam
--
-- ESCRITÓRIO ATIVO. O front manda o header `x-escritorio-id` em toda chamada.
-- `private.escritorio_ativo()` só devolve esse id se a pessoa for membro ATIVO
-- de um escritório ATIVO (header presente e inválido = nulo, nunca fallback).
-- Sem header (Realtime, chamada antiga): a preferência salva em
-- `usuarios.escritorio_ativo_id`, e depois o vínculo único. Nada disso vem do
-- JWT: desativar um vínculo vale na consulta seguinte, não em até 1 h.
--
-- PAPEL E STATUS passam a morar no vínculo. As colunas antigas de `usuarios`
-- (tipo, eh_admin, ativo, desligado_em, eh_parceiro, percentual_parceiro)
-- seguem preenchidas por sincronização enquanto o código antigo existir — a
-- Fase 7 do plano as remove. Nenhuma decisão de acesso lê essas colunas mais
-- (migration_rbac_03).
--
-- Idempotente.

-- ---------------------------------------------------------------------------
-- 0. Schema privado: fora do PostgREST
-- ---------------------------------------------------------------------------
create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 1. Escritórios
-- ---------------------------------------------------------------------------
create table if not exists public.escritorios (
  id                  uuid primary key default gen_random_uuid(),
  slug                text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  nome                text not null,
  cnpj                text,
  status              text not null default 'ativo'
                      check (status in ('provisionando', 'ativo', 'suspenso', 'encerrado')),
  -- v1: as integrações ainda são globais (uma caixa Gmail do INSS, um WhatsApp,
  -- as OABs do DJEN). O que o sistema cria sem contexto de pessoa nem de caso
  -- cai no escritório padrão. Some quando as integrações forem por escritório.
  padrao_sistema      boolean not null default false,
  plano               text not null default 'padrao',
  limites             jsonb not null default '{}'::jsonb,
  flags               jsonb not null default '{}'::jsonb,
  contato_encarregado text,
  suspenso_em         timestamptz,
  suspenso_motivo     text,
  encerrado_em        timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create unique index if not exists escritorios_um_padrao
  on public.escritorios ((true)) where padrao_sistema;

create table if not exists public.escritorio_config (
  escritorio_id        uuid primary key references public.escritorios (id) on delete cascade,
  marca                jsonb not null default '{}'::jsonb,
  dados_legais         jsonb not null default '{}'::jsonb,
  fuso                 text not null default 'America/Sao_Paulo',
  digest_destinatarios text[] not null default '{}',
  responsaveis         jsonb not null default '{}'::jsonb,
  termos_versao        text,
  extras               jsonb not null default '{}'::jsonb,
  updated_at           timestamptz not null default now()
);

-- Escritório 1: o que existe hoje.
insert into public.escritorios (slug, nome, status, padrao_sistema)
select 'mara-vian', 'Mara Vian Advocacia', 'ativo', true
 where not exists (select 1 from public.escritorios where padrao_sistema);

insert into public.escritorio_config (escritorio_id)
select e.id from public.escritorios e
 where not exists (select 1 from public.escritorio_config c where c.escritorio_id = e.id);

-- ---------------------------------------------------------------------------
-- 2. Catálogo de permissões, papéis e a matriz v1 (§4.3)
-- ---------------------------------------------------------------------------
create table if not exists public.permissoes (
  chave     text primary key check (chave ~ '^[a-z_]+:[a-z_]+$'),
  grupo     text not null,
  descricao text not null
);

create table if not exists public.papeis (
  id            uuid primary key default gen_random_uuid(),
  escritorio_id uuid references public.escritorios (id) on delete cascade, -- nulo = papel de sistema
  chave         text not null check (chave ~ '^[a-z_]+$'),
  nome          text not null,
  descricao     text,
  -- Modo de acesso: é o que as telas chamam de interno × parceiro.
  tipo_acesso   text not null check (tipo_acesso in ('interno', 'parceiro')),
  ordem         int not null default 100
);
create unique index if not exists papeis_chave_uk
  on public.papeis (coalesce(escritorio_id, '00000000-0000-0000-0000-000000000000'::uuid), chave);

create table if not exists public.papel_permissoes (
  papel_id  uuid not null references public.papeis (id) on delete cascade,
  permissao text not null references public.permissoes (chave) on delete cascade,
  escopo    text not null check (escopo in ('todos', 'atribuidos', 'indicados', 'proprios')),
  primary key (papel_id, permissao, escopo)
);

insert into public.permissoes (chave, grupo, descricao) values
  ('escritorio:configurar',   'Escritório',  'Dados, marca e configurações do escritório'),
  ('equipe:gerenciar',        'Escritório',  'Convidar, definir papel, desligar e reativar pessoas'),
  ('auditoria:ler',           'Escritório',  'Ver a trilha de auditoria'),
  ('integracoes:gerenciar',   'Escritório',  'Integrações de IA, Google e webhooks'),
  ('ia:mcp_conceder',         'Escritório',  'Emitir token do MCP para uma pessoa do escritório'),
  ('parceiros:gerenciar',     'Parceiros',   'Cadastrar, editar, desligar e reativar parceiros'),
  ('parceiros:excluir',       'Parceiros',   'Excluir parceiro'),
  ('parceiros:ver_como',      'Parceiros',   'Ver o sistema como um parceiro (somente leitura)'),
  ('clientes:excluir',        'Clientes',    'Excluir cliente e tudo que é dele'),
  ('clientes:ler_contato',    'Clientes',    'Ver telefone, e-mail e endereço do cliente'),
  ('senha_inss:ler',          'Clientes',    'Ler a senha do MEU INSS (auditado)'),
  ('casos:ler',               'Casos',       'Ver casos'),
  ('casos:editar',            'Casos',       'Criar e editar casos e clientes'),
  ('andamentos:ler_internos', 'Casos',       'Ver andamentos internos'),
  ('analises:ler',            'Casos',       'Ver análises técnicas'),
  ('processos:ler',           'Casos',       'Ver processos administrativos e judiciais'),
  ('publicacoes:ler',         'Casos',       'Ver publicações do DJE'),
  ('documentos:enviar',       'Documentos',  'Enviar documentos'),
  ('documentos:excluir',      'Documentos',  'Excluir documentos'),
  ('tarefas:gerenciar',       'Rotina',      'Criar, editar e concluir tarefas'),
  ('agenda:gerenciar',        'Rotina',      'Criar e editar compromissos'),
  ('comercial:gerenciar',     'Comercial',   'Leads e funil comercial'),
  ('repasses:ler',            'Financeiro',  'Ver repasses'),
  ('ia:usar',                 'IA',          'Usar o assistente e as funções de IA'),
  ('etiquetas:gerenciar',     'Cadastros',   'Criar e editar etiquetas'),
  ('templates:gerenciar',     'Cadastros',   'Criar e editar templates de tarefa')
on conflict (chave) do update set grupo = excluded.grupo, descricao = excluded.descricao;

insert into public.papeis (escritorio_id, chave, nome, descricao, tipo_acesso, ordem)
select null, v.chave, v.nome, v.descricao, v.tipo_acesso, v.ordem
  from (values
    ('admin',      'Administrador', 'Tudo no escritório, inclusive equipe, integrações e auditoria', 'interno', 10),
    ('advogado',   'Advogado',      'O trabalho do dia a dia: casos, clientes, tarefas, documentos', 'interno', 20),
    ('assistente', 'Assistente',    'Apoio: vê os casos e cuida das tarefas atribuídas a ele',       'interno', 30),
    ('financeiro', 'Financeiro',    'Vê casos e repasses; não edita o trabalho jurídico',            'interno', 40),
    ('parceiro',   'Parceiro',      'Advogado parceiro: só os casos que indicou',                    'parceiro', 50)
  ) as v(chave, nome, descricao, tipo_acesso, ordem)
 where not exists (select 1 from public.papeis p where p.escritorio_id is null and p.chave = v.chave);

-- A matriz. Admin corresponde ao eh_admin de hoje, advogado ao interno e
-- parceiro ao parceiro: no escritório 1 ninguém ganha nem perde acesso.
-- (Excluir cliente/parceiro só para admin é mudança deliberada AINDA NÃO
-- aprovada — §4.3 —, então o advogado mantém as duas.)
with matriz(papel, permissao, escopo) as (values
  -- admin: tudo
  ('admin','escritorio:configurar','todos'), ('admin','equipe:gerenciar','todos'),
  ('admin','auditoria:ler','todos'), ('admin','integracoes:gerenciar','todos'),
  ('admin','ia:mcp_conceder','todos'), ('admin','parceiros:gerenciar','todos'),
  ('admin','parceiros:excluir','todos'), ('admin','parceiros:ver_como','todos'),
  ('admin','clientes:excluir','todos'), ('admin','clientes:ler_contato','todos'),
  ('admin','senha_inss:ler','todos'), ('admin','casos:ler','todos'), ('admin','casos:editar','todos'),
  ('admin','andamentos:ler_internos','todos'), ('admin','analises:ler','todos'),
  ('admin','processos:ler','todos'), ('admin','publicacoes:ler','todos'),
  ('admin','documentos:enviar','todos'), ('admin','documentos:excluir','todos'),
  ('admin','tarefas:gerenciar','todos'), ('admin','agenda:gerenciar','todos'),
  ('admin','comercial:gerenciar','todos'), ('admin','repasses:ler','todos'),
  ('admin','ia:usar','todos'), ('admin','etiquetas:gerenciar','todos'), ('admin','templates:gerenciar','todos'),
  -- advogado: o interno de hoje
  ('advogado','parceiros:gerenciar','todos'), ('advogado','parceiros:excluir','todos'),
  ('advogado','clientes:excluir','todos'), ('advogado','clientes:ler_contato','todos'),
  ('advogado','senha_inss:ler','todos'), ('advogado','casos:ler','todos'), ('advogado','casos:editar','todos'),
  ('advogado','andamentos:ler_internos','todos'), ('advogado','analises:ler','todos'),
  ('advogado','processos:ler','todos'), ('advogado','publicacoes:ler','todos'),
  ('advogado','documentos:enviar','todos'), ('advogado','documentos:excluir','todos'),
  ('advogado','tarefas:gerenciar','todos'), ('advogado','agenda:gerenciar','todos'),
  ('advogado','comercial:gerenciar','todos'), ('advogado','repasses:ler','todos'),
  ('advogado','ia:usar','todos'), ('advogado','etiquetas:gerenciar','todos'), ('advogado','templates:gerenciar','todos'),
  -- assistente
  ('assistente','clientes:ler_contato','todos'), ('assistente','senha_inss:ler','atribuidos'),
  ('assistente','casos:ler','todos'), ('assistente','casos:editar','todos'),
  ('assistente','andamentos:ler_internos','todos'), ('assistente','analises:ler','todos'),
  ('assistente','processos:ler','todos'), ('assistente','publicacoes:ler','todos'),
  ('assistente','documentos:enviar','todos'),
  ('assistente','tarefas:gerenciar','atribuidos'), ('assistente','agenda:gerenciar','atribuidos'),
  ('assistente','ia:usar','todos'),
  -- financeiro
  ('financeiro','casos:ler','todos'), ('financeiro','repasses:ler','todos'),
  -- parceiro
  ('parceiro','casos:ler','indicados'), ('parceiro','casos:editar','indicados'),
  ('parceiro','senha_inss:ler','indicados'), ('parceiro','documentos:enviar','indicados'),
  ('parceiro','processos:ler','indicados'), ('parceiro','publicacoes:ler','indicados'),
  ('parceiro','repasses:ler','proprios')
)
insert into public.papel_permissoes (papel_id, permissao, escopo)
select p.id, m.permissao, m.escopo
  from matriz m
  join public.papeis p on p.escritorio_id is null and p.chave = m.papel
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- 3. Membros: o vínculo
-- ---------------------------------------------------------------------------
create table if not exists public.membros (
  id                  uuid primary key default gen_random_uuid(),
  escritorio_id       uuid not null references public.escritorios (id) on delete cascade,
  usuario_id          uuid not null references public.usuarios (id) on delete cascade,
  papel_id            uuid not null references public.papeis (id),
  status              text not null default 'ativo'
                      check (status in ('convidado', 'ativo', 'desativado')),
  recebe_repasse      boolean not null default false,
  percentual_parceiro numeric(5,2),
  termos_versao       text,
  convidado_por       uuid references public.usuarios (id) on delete set null,
  desativado_em       timestamptz,
  desativado_por      uuid references public.usuarios (id) on delete set null,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (escritorio_id, usuario_id)
);
create index if not exists membros_usuario_idx on public.membros (usuario_id, status);

-- O escritório que a pessoa deixou aberto por último (o seletor grava aqui).
alter table public.usuarios
  add column if not exists escritorio_ativo_id uuid references public.escritorios (id) on delete set null;
-- Quem convida informa o escritório; sem isso a pessoa nasce no escritório padrão.
alter table public.usuarios
  add column if not exists escritorio_origem_id uuid references public.escritorios (id) on delete set null;

-- Backfill: cada usuário vira um vínculo no escritório 1 — SÓ NA PRIMEIRA
-- INSTALAÇÃO (tabela vazia). Depois disso quem cria vínculo é o convite, e
-- "usuário sem vínculo" passa a ser um estado legítimo: a equipe da plataforma
-- (QG) não é membro de escritório nenhum. Reaplicar esta migration sem a
-- guarda devolvia ao staff acesso aos dados do escritório 1 — pego pela
-- matriz cruzada em 22/09.
insert into public.membros
  (escritorio_id, usuario_id, papel_id, status, recebe_repasse, percentual_parceiro,
   termos_versao, desativado_em, desativado_por, created_at)
select e.id, u.id, p.id,
       case when coalesce(u.ativo, true) and u.desligado_em is null then 'ativo' else 'desativado' end,
       coalesce(u.eh_parceiro, false), u.percentual_parceiro, u.termos_versao,
       case when coalesce(u.ativo, true) and u.desligado_em is null then null
            else coalesce(u.desligado_em, now()) end,
       u.desligado_por, coalesce(u.created_at, now())
  from public.usuarios u
  cross join (select id from public.escritorios where padrao_sistema) e
  join public.papeis p
    on p.escritorio_id is null
   and p.chave = case when u.tipo = 'parceiro' then 'parceiro'
                      when coalesce(u.eh_admin, false) then 'admin'
                      else 'advogado' end
 where not exists (select 1 from public.membros);

-- ---------------------------------------------------------------------------
-- 4. Helpers (schema private)
-- ---------------------------------------------------------------------------
create or replace function private.escritorio_padrao() returns uuid
language sql stable security definer set search_path = '' as $$
  select id from public.escritorios where padrao_sistema
$$;

-- A pessoa pode abrir este escritório? A migration_rbac_05 REDEFINE esta função
-- (acrescenta a sessão de suporte). Reaplicar só a 01 depois da 05 não pode
-- desfazer isso em silêncio: se a versão com suporte já existe, fica.
do $guarda$
begin
  if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
              where n.nspname = 'private' and p.proname = 'pode_entrar' and p.prosrc like '%suporte_valido%') then
    raise notice 'private.pode_entrar já é a versão com suporte (migration_rbac_05) — mantida';
    return;
  end if;
  execute $f$
create or replace function private.pode_entrar(p_usuario uuid, p_escritorio uuid) returns boolean
language sql stable security definer set search_path = '' as $body$
  select exists (
    select 1
      from public.membros m
      join public.escritorios e on e.id = m.escritorio_id
     where m.usuario_id = p_usuario
       and m.escritorio_id = p_escritorio
       and m.status = 'ativo'
       and e.status = 'ativo'
  )
$body$;
  $f$;
end $guarda$;

create or replace function private.escritorio_ativo() returns uuid
language plpgsql stable security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_hdr text;
  v_esc uuid;
begin
  if v_uid is null then
    return null;
  end if;

  begin
    v_hdr := nullif(btrim(current_setting('request.headers', true)::json ->> 'x-escritorio-id'), '');
  exception when others then
    v_hdr := null;
  end;

  -- Header presente decide sozinho: inválido é NULO, nunca cai para outro
  -- escritório (senão um id forjado viraria "o que der").
  if v_hdr is not null then
    begin
      v_esc := v_hdr::uuid;
    exception when others then
      return null;
    end;
    if private.pode_entrar(v_uid, v_esc) then
      return v_esc;
    end if;
    return null;
  end if;

  select u.escritorio_ativo_id into v_esc from public.usuarios u where u.id = v_uid;
  if v_esc is not null and private.pode_entrar(v_uid, v_esc) then
    return v_esc;
  end if;

  select case when count(*) = 1 then (array_agg(m.escritorio_id))[1] end
    into v_esc
    from public.membros m
    join public.escritorios e on e.id = m.escritorio_id
   where m.usuario_id = v_uid and m.status = 'ativo' and e.status = 'ativo';
  return v_esc;
end;
$$;

create or replace function private.meus_escritorios() returns setof uuid
language sql stable security definer set search_path = '' as $$
  select m.escritorio_id
    from public.membros m
    join public.escritorios e on e.id = m.escritorio_id and e.status = 'ativo'
   where m.usuario_id = (select auth.uid()) and m.status = 'ativo'
$$;

-- O vínculo ativo da pessoa no escritório desta requisição. Também redefinida
-- pela migration_rbac_05 (suporte = leitura de advogado): mesma guarda.
do $guarda$
begin
  if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
              where n.nspname = 'private' and p.proname = 'meu_vinculo' and p.prosrc like '%em_suporte%') then
    raise notice 'private.meu_vinculo já é a versão com suporte (migration_rbac_05) — mantida';
    return;
  end if;
  execute $f$
create or replace function private.meu_vinculo()
returns table (membro_id uuid, escritorio_id uuid, papel_id uuid, papel text, tipo_acesso text)
language sql stable security definer set search_path = '' as $body$
  select m.id, m.escritorio_id, p.id, p.chave, p.tipo_acesso
    from public.membros m
    join public.papeis p on p.id = m.papel_id
   where m.usuario_id = (select auth.uid())
     and m.status = 'ativo'
     and m.escritorio_id = (select private.escritorio_ativo())
$body$;
  $f$;
end $guarda$;

-- 'interno' | 'parceiro' | nulo — substitui o `select tipo from usuarios`.
create or replace function private.meu_tipo() returns text
language sql stable security definer set search_path = '' as $$
  select v.tipo_acesso from private.meu_vinculo() v
$$;

create or replace function private.tem_permissao(p_perm text, p_escopo text default null) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
      from private.meu_vinculo() v
      join public.papel_permissoes pp on pp.papel_id = v.papel_id
     where pp.permissao = p_perm
       and (p_escopo is null or pp.escopo = p_escopo)
  )
$$;

-- A outra pessoa é do meu escritório ativo? (qualquer status: histórico de
-- quem foi desligado continua aparecendo com o nome.)
create or replace function private.usuario_no_escritorio_ativo(p_usuario uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.membros m
     where m.usuario_id = p_usuario
       and m.escritorio_id = (select private.escritorio_ativo())
  )
$$;

revoke all on all functions in schema private from public, anon;
grant execute on all functions in schema private to authenticated, service_role;
alter default privileges in schema private revoke execute on functions from public;

-- ---------------------------------------------------------------------------
-- 5. O que o front pergunta (schema public, só leitura sobre a própria pessoa)
-- ---------------------------------------------------------------------------
create or replace function public.escritorio_ativo() returns uuid
language sql stable security definer set search_path = '' as $$
  select private.escritorio_ativo()
$$;

create or replace function public.tem_permissao(p_perm text) returns boolean
language sql stable security definer set search_path = '' as $$
  select private.tem_permissao(p_perm, null)
$$;

create or replace function public.minhas_permissoes()
returns table (permissao text, escopo text)
language sql stable security definer set search_path = '' as $$
  select pp.permissao, pp.escopo
    from private.meu_vinculo() v
    join public.papel_permissoes pp on pp.papel_id = v.papel_id
$$;

-- Todos os vínculos da pessoa, inclusive em escritório suspenso (o seletor
-- precisa mostrar o aviso), com o papel de cada um.
create or replace function public.meus_vinculos()
returns table (escritorio_id uuid, escritorio_nome text, escritorio_slug text,
               escritorio_status text, membro_status text, papel text, papel_nome text,
               tipo_acesso text, ativo_agora boolean)
language sql stable security definer set search_path = '' as $$
  select e.id, e.nome, e.slug, e.status, m.status, p.chave, p.nome, p.tipo_acesso,
         e.id = (select private.escritorio_ativo())
    from public.membros m
    join public.escritorios e on e.id = m.escritorio_id
    join public.papeis p on p.id = m.papel_id
   where m.usuario_id = (select auth.uid())
     and m.status <> 'desativado'
     and e.status <> 'encerrado'
   order by e.nome
$$;

create or replace function public.definir_escritorio_ativo(p_escritorio_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then
    raise exception 'não autenticado' using errcode = '42501';
  end if;
  if not private.pode_entrar(auth.uid(), p_escritorio_id) then
    raise exception 'você não tem acesso a este escritório' using errcode = '42501';
  end if;
  update public.usuarios set escritorio_ativo_id = p_escritorio_id where id = auth.uid();
end;
$$;

revoke execute on function public.escritorio_ativo(), public.tem_permissao(text),
  public.minhas_permissoes(), public.meus_vinculos(), public.definir_escritorio_ativo(uuid)
  from public, anon;
grant execute on function public.escritorio_ativo(), public.tem_permissao(text),
  public.minhas_permissoes(), public.meus_vinculos(), public.definir_escritorio_ativo(uuid)
  to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 6. Sincronização temporária usuarios ⇄ membros
-- ---------------------------------------------------------------------------
-- O flag de transação evita o ping-pong: quem sincroniza marca, o outro lado vê
-- a marca e não devolve.

create or replace function private.tg_membros_para_usuarios() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_principal record;
begin
  if current_setting('msc.sincronizando', true) = '1' then
    return new;
  end if;
  perform set_config('msc.sincronizando', '1', true);

  -- As colunas antigas espelham o vínculo PRINCIPAL da pessoa: o ativo mais
  -- antigo; se não houver ativo, o mais antigo.
  select m.*, p.chave as papel, p.tipo_acesso
    into v_principal
    from public.membros m
    join public.papeis p on p.id = m.papel_id
   where m.usuario_id = new.usuario_id
   order by (m.status = 'ativo') desc, m.created_at
   limit 1;

  update public.usuarios u
     set tipo                = v_principal.tipo_acesso::public.tipo_usuario,
         eh_admin            = (v_principal.papel = 'admin' and v_principal.status = 'ativo'),
         ativo               = exists (select 1 from public.membros x
                                        where x.usuario_id = new.usuario_id and x.status <> 'desativado'),
         desligado_em        = case when exists (select 1 from public.membros x
                                                  where x.usuario_id = new.usuario_id and x.status <> 'desativado')
                                    then null else coalesce(u.desligado_em, v_principal.desativado_em, now()) end,
         desligado_por       = case when exists (select 1 from public.membros x
                                                  where x.usuario_id = new.usuario_id and x.status <> 'desativado')
                                    then null else coalesce(u.desligado_por, v_principal.desativado_por) end,
         eh_parceiro         = v_principal.recebe_repasse,
         -- usuarios.percentual_parceiro é NOT NULL DEFAULT 30; o do vínculo pode ser nulo
         percentual_parceiro = coalesce(v_principal.percentual_parceiro, u.percentual_parceiro)
   where u.id = new.usuario_id;

  perform set_config('msc.sincronizando', '', true);
  return new;
end;
$$;

drop trigger if exists trg_membros_para_usuarios on public.membros;
create trigger trg_membros_para_usuarios
  after insert or update on public.membros
  for each row execute function private.tg_membros_para_usuarios();

create or replace function private.tg_usuarios_para_membros() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_esc   uuid;
  v_papel uuid;
  v_status text;
begin
  if current_setting('msc.sincronizando', true) = '1' then
    return new;
  end if;

  if tg_op = 'UPDATE'
     and new.tipo is not distinct from old.tipo
     and coalesce(new.eh_admin, false) is not distinct from coalesce(old.eh_admin, false)
     and coalesce(new.ativo, true) is not distinct from coalesce(old.ativo, true)
     and new.desligado_em is not distinct from old.desligado_em
     and coalesce(new.eh_parceiro, false) is not distinct from coalesce(old.eh_parceiro, false)
     and new.percentual_parceiro is not distinct from old.percentual_parceiro
     and new.termos_versao is not distinct from old.termos_versao then
    return new;
  end if;

  perform set_config('msc.sincronizando', '1', true);

  -- Em que escritório o código antigo está mexendo: o de quem chama; senão o
  -- informado no convite; senão o único vínculo; senão o padrão.
  v_esc := coalesce(
    private.escritorio_ativo(),
    new.escritorio_origem_id,
    (select case when count(*) = 1 then (array_agg(m.escritorio_id))[1] end
       from public.membros m where m.usuario_id = new.id),
    private.escritorio_padrao());

  v_status := case when coalesce(new.ativo, true) and new.desligado_em is null then 'ativo' else 'desativado' end;

  select p.id into v_papel
    from public.papeis p
   where p.escritorio_id is null
     and p.chave = case when new.tipo = 'parceiro' then 'parceiro'
                        when coalesce(new.eh_admin, false) then 'admin'
                        else 'advogado' end;

  insert into public.membros as m
    (escritorio_id, usuario_id, papel_id, status, recebe_repasse, percentual_parceiro,
     termos_versao, desativado_em, desativado_por)
  values
    (v_esc, new.id, v_papel, v_status, coalesce(new.eh_parceiro, false), new.percentual_parceiro,
     new.termos_versao,
     case when v_status = 'desativado' then coalesce(new.desligado_em, now()) end,
     case when v_status = 'desativado' then new.desligado_por end)
  on conflict (escritorio_id, usuario_id) do update
     set -- Papel: o código antigo só conhece admin/advogado/parceiro. Assistente e
         -- financeiro não são rebaixados por um update que não mexeu em papel.
         papel_id = case
           when tg_op = 'UPDATE'
                and new.tipo is not distinct from old.tipo
                and coalesce(new.eh_admin, false) is not distinct from coalesce(old.eh_admin, false)
           then m.papel_id else excluded.papel_id end,
         status = case when m.status = 'convidado' and excluded.status = 'ativo' then m.status
                       else excluded.status end,
         recebe_repasse = excluded.recebe_repasse,
         percentual_parceiro = excluded.percentual_parceiro,
         termos_versao = excluded.termos_versao,
         desativado_em = excluded.desativado_em,
         desativado_por = excluded.desativado_por,
         updated_at = now();

  perform set_config('msc.sincronizando', '', true);
  return new;
end;
$$;

drop trigger if exists trg_usuarios_para_membros on public.usuarios;
create trigger trg_usuarios_para_membros
  after insert or update on public.usuarios
  for each row execute function private.tg_usuarios_para_membros();

-- ---------------------------------------------------------------------------
-- 7. RLS das tabelas novas — escrita só por função (precedente do PR #297)
-- ---------------------------------------------------------------------------
alter table public.escritorios       enable row level security;
alter table public.escritorio_config enable row level security;
alter table public.permissoes        enable row level security;
alter table public.papeis            enable row level security;
alter table public.papel_permissoes  enable row level security;
alter table public.membros           enable row level security;

revoke all on public.escritorios, public.escritorio_config, public.permissoes,
  public.papeis, public.papel_permissoes, public.membros from anon, authenticated;
grant select on public.escritorios, public.escritorio_config, public.permissoes,
  public.papeis, public.papel_permissoes, public.membros to authenticated;
grant all on public.escritorios, public.escritorio_config, public.permissoes,
  public.papeis, public.papel_permissoes, public.membros to service_role;

drop policy if exists escritorios_meus on public.escritorios;
create policy escritorios_meus on public.escritorios
  for select to authenticated
  using (exists (select 1 from public.membros m
                  where m.escritorio_id = escritorios.id
                    and m.usuario_id = (select auth.uid())
                    and m.status <> 'desativado'));

drop policy if exists escritorio_config_ativo on public.escritorio_config;
create policy escritorio_config_ativo on public.escritorio_config
  for select to authenticated
  using (escritorio_id = (select private.escritorio_ativo()));

drop policy if exists permissoes_ler on public.permissoes;
create policy permissoes_ler on public.permissoes for select to authenticated using (true);

drop policy if exists papeis_ler on public.papeis;
create policy papeis_ler on public.papeis
  for select to authenticated
  using (escritorio_id is null or escritorio_id = (select private.escritorio_ativo()));

drop policy if exists papel_permissoes_ler on public.papel_permissoes;
create policy papel_permissoes_ler on public.papel_permissoes for select to authenticated using (true);

-- O próprio vínculo em qualquer escritório (o seletor); os dos colegas, só no
-- escritório ativo.
drop policy if exists membros_ler on public.membros;
create policy membros_ler on public.membros
  for select to authenticated
  using (usuario_id = (select auth.uid())
         or escritorio_id = (select private.escritorio_ativo()));

-- Conferência
select
  (select count(*) from public.escritorios) as escritorios,
  (select count(*) from public.usuarios) as usuarios,
  (select count(*) from public.membros) as membros,
  (select count(*) from public.usuarios u
    where not exists (select 1 from public.membros m where m.usuario_id = u.id)
      and not exists (select 1 from pg_class where relname = 'plataforma_staff')) as usuarios_sem_vinculo_na_instalacao,
  (select count(*) from public.permissoes) as permissoes,
  (select string_agg(p.chave || '=' || (select count(*) from public.papel_permissoes pp where pp.papel_id = p.id), ', ' order by p.ordem)
     from public.papeis p where p.escritorio_id is null) as matriz;

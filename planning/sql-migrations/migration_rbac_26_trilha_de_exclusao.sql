-- migration_rbac_26_trilha_de_exclusao.sql
--
-- Apagar DOCUMENTO e ANDAMENTO passa a deixar rastro, no molde do que já existe
-- para tarefa (`tarefas_excluidas`, migration_exclusao_tarefa_andamento).
--
-- Gaps 2 e 3 do planning/AUDITABILIDADE.md. Hoje um CNIS apagado por engano
-- ("estava aqui ontem") ou um andamento apagado para "limpar" a linha do tempo
-- de um caso não deixam nada: somem do banco e, no caso do documento, do
-- storage. Tarefa tem trilha com motivo; esses dois não tinham equivalente.
--
-- POR QUE GATILHO, E NÃO RPC: a exclusão hoje passa DIRETO pela RLS
-- (`documentos:excluir` e `casos:editar`), sem função no meio. Um gatilho
-- `before delete` pega todo caminho — tela, API, e a cascata de
-- `excluir_cliente` — sem precisar reescrever seis lugares.
--
-- Quem lê: a equipe interna do escritório, igual a `tarefas_excluidas` (quem já
-- vê o caso e seus documentos não passa a saber nada de novo por saber que um
-- foi apagado). Quem escreve: só o gatilho.
--
-- Idempotente.

-- ---------------------------------------------------------------------------
-- 1. As duas tabelas
-- ---------------------------------------------------------------------------
create table if not exists public.documentos_excluidos (
  id            uuid primary key default gen_random_uuid(),
  documento_id  uuid not null,
  caso_id       uuid,
  nome_arquivo  text,
  tipo          text,
  storage_path  text,
  dados         jsonb not null,
  excluido_por  uuid references public.usuarios(id) on delete set null,
  excluido_em   timestamptz not null default now(),
  escritorio_id uuid not null references public.escritorios(id) on delete cascade
);

create table if not exists public.andamentos_excluidos (
  id            uuid primary key default gen_random_uuid(),
  andamento_id  uuid not null,
  caso_id       uuid,
  titulo        text,
  origem        text,
  data_evento   timestamptz,
  dados         jsonb not null,
  excluido_por  uuid references public.usuarios(id) on delete set null,
  excluido_em   timestamptz not null default now(),
  escritorio_id uuid not null references public.escritorios(id) on delete cascade
);

create index if not exists documentos_excluidos_caso_idx on public.documentos_excluidos (caso_id, excluido_em desc);
create index if not exists andamentos_excluidos_caso_idx on public.andamentos_excluidos (caso_id, excluido_em desc);

comment on table public.documentos_excluidos is
  'Trilha de documentos apagados (migration_rbac_26). Escrita só pelo gatilho; leitura da equipe interna do escritório.';
comment on table public.andamentos_excluidos is
  'Trilha de andamentos apagados (migration_rbac_26). Escrita só pelo gatilho; leitura da equipe interna do escritório.';

-- ---------------------------------------------------------------------------
-- 2. Os gatilhos (before delete: a linha ainda existe)
-- ---------------------------------------------------------------------------
create or replace function private.tg_documento_excluido()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.documentos_excluidos
    (documento_id, caso_id, nome_arquivo, tipo, storage_path, dados, excluido_por, escritorio_id)
  values (old.id, old.caso_id, old.nome_arquivo, old.tipo, old.storage_path,
          to_jsonb(old), auth.uid(), old.escritorio_id);
  return old;
exception
  -- A trilha nunca impede a exclusão: se ela falhar, o aviso fica no log e o
  -- delete segue. Perder o rastro é ruim; travar o trabalho é pior.
  when others then
    raise warning 'trilha de documento excluído falhou (doc %): %', old.id, sqlerrm;
    return old;
end $$;

create or replace function private.tg_andamento_excluido()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.andamentos_excluidos
    (andamento_id, caso_id, titulo, origem, data_evento, dados, excluido_por, escritorio_id)
  values (old.id, old.caso_id, old.titulo, old.origem, old.data_evento,
          to_jsonb(old), auth.uid(), old.escritorio_id);
  return old;
exception
  when others then
    raise warning 'trilha de andamento excluído falhou (and %): %', old.id, sqlerrm;
    return old;
end $$;

drop trigger if exists zz_trilha_exclusao on public.documentos;
create trigger zz_trilha_exclusao
  before delete on public.documentos
  for each row execute function private.tg_documento_excluido();

drop trigger if exists zz_trilha_exclusao on public.andamentos;
create trigger zz_trilha_exclusao
  before delete on public.andamentos
  for each row execute function private.tg_andamento_excluido();

-- ---------------------------------------------------------------------------
-- 3. Isolamento e leitura (molde da migration_rbac_02/03)
-- ---------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['documentos_excluidos', 'andamentos_excluidos'] loop
    execute format('alter table public.%I enable row level security', t);

    -- restritiva: nunca sai do escritório ativo
    execute format('drop policy if exists isolamento_escritorio on public.%I', t);
    execute format($p$create policy isolamento_escritorio on public.%I as restrictive
                     for all to authenticated
                     using (escritorio_id = (select private.escritorio_ativo()))
                     with check (escritorio_id = (select private.escritorio_ativo()))$p$, t);

    -- o espelho de leitura do staging (mesma linha das outras tabelas)
    execute format('drop policy if exists espelho_leitura_select on public.%I', t);
    execute format($p$create policy espelho_leitura_select on public.%I
                     for select to espelho_leitura using (true)$p$, t);

    -- permissiva de leitura: equipe interna, como em tarefas_excluidas
    execute format('drop policy if exists %I on public.%I', t || '_select_interno', t);
    execute format($p$create policy %I on public.%I
                     for select to authenticated using ((select public.is_interno()))$p$,
                   t || '_select_interno', t);

    -- escrita: só o gatilho (nenhuma policy permissiva de insert/update/delete)
    -- (sem TRUNCATE na lista: só o dono da tabela trunca, e o msc-sql recusa
    --  qualquer SQL que contenha a palavra — trava de segurança dele.)
    execute format('revoke insert, update, delete on public.%I from authenticated, anon', t);
    execute format('grant select on public.%I to authenticated', t);
  end loop;
end $$;

notify pgrst, 'reload schema';

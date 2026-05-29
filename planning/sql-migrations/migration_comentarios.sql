-- =============================================================================
-- Migration: tabela `comentarios` substitui o chat por sistema de threads.
--
-- Por que existe:
--   - Chat estilo bolha eh pessimo pra comunicacao assincrona entre
--     interno e parceiro (perdem-se topicos, sem estrutura).
--   - Comentarios com parent_id permitem agrupar discussoes por assunto.
--     Cada comentario top-level eh um thread; replies sao filhos.
--
-- Decisao: 1 nivel de aninhamento (sem replies de replies). Simples de
-- renderizar e cobre 95% dos casos de uso.
--
-- A tabela `mensagens` antiga fica intacta no banco como legacy, mas a UI
-- nao a usa mais. Migracao de dados nao eh necessaria - chat antigo
-- nao deve ter conteudo critico.
--
-- Idempotente.
-- =============================================================================

create table if not exists public.comentarios (
  id uuid primary key default gen_random_uuid(),
  caso_id uuid not null references public.casos(id) on delete cascade,
  parent_id uuid references public.comentarios(id) on delete cascade,
  autor_id uuid not null references public.usuarios(id) on delete restrict,
  texto text not null check (length(trim(texto)) > 0),
  created_at timestamptz not null default now()
);

-- Constraint: replies nao podem ter replies (1 nivel apenas).
-- Se parent_id nao eh null, parent_id.parent_id tem que ser null.
-- Implementado via trigger porque check constraint nao roda subqueries.
create or replace function public._comentarios_check_depth()
returns trigger
language plpgsql
as $$
begin
  if new.parent_id is not null then
    if exists (
      select 1 from public.comentarios
       where id = new.parent_id
         and parent_id is not null
    ) then
      raise exception 'Replies de replies nao sao permitidas (max 1 nivel de aninhamento)';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_comentarios_check_depth on public.comentarios;
create trigger trg_comentarios_check_depth
  before insert or update on public.comentarios
  for each row execute function public._comentarios_check_depth();

-- Indices pra UI: listar threads por caso ordenado por data
create index if not exists idx_comentarios_caso_created
  on public.comentarios(caso_id, created_at desc);

create index if not exists idx_comentarios_parent
  on public.comentarios(parent_id)
  where parent_id is not null;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table public.comentarios enable row level security;

-- SELECT: interno ve tudo. Parceiro ve so dos casos dele.
drop policy if exists "comentarios_select" on public.comentarios;
create policy "comentarios_select"
  on public.comentarios
  for select
  using (
    exists (
      select 1 from public.usuarios u
      where u.id = auth.uid() and u.tipo = 'interno'
    )
    or
    exists (
      select 1 from public.casos c
      where c.id = comentarios.caso_id
        and c.parceiro_id = auth.uid()
    )
  );

-- INSERT: interno pode inserir em qualquer caso. Parceiro so nos seus.
-- autor_id sempre tem que ser auth.uid() (impede falsificacao).
drop policy if exists "comentarios_insert" on public.comentarios;
create policy "comentarios_insert"
  on public.comentarios
  for insert
  with check (
    autor_id = auth.uid()
    and (
      exists (
        select 1 from public.usuarios u
        where u.id = auth.uid() and u.tipo = 'interno'
      )
      or
      exists (
        select 1 from public.casos c
        where c.id = comentarios.caso_id
          and c.parceiro_id = auth.uid()
      )
    )
  );

-- UPDATE/DELETE: autor pode editar/apagar o proprio comentario.
-- Interno pode editar/apagar qualquer comentario (moderacao).
drop policy if exists "comentarios_update" on public.comentarios;
create policy "comentarios_update"
  on public.comentarios
  for update
  using (
    autor_id = auth.uid()
    or exists (
      select 1 from public.usuarios u
      where u.id = auth.uid() and u.tipo = 'interno'
    )
  );

drop policy if exists "comentarios_delete" on public.comentarios;
create policy "comentarios_delete"
  on public.comentarios
  for delete
  using (
    autor_id = auth.uid()
    or exists (
      select 1 from public.usuarios u
      where u.id = auth.uid() and u.tipo = 'interno'
    )
  );

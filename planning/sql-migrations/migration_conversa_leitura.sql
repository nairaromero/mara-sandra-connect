-- migration_conversa_leitura.sql
--
-- Controle de "não lido" por usuário por conversa (caso), pra Caixa de Conversas
-- (planning/CAIXA_CONVERSAS.md, fase 1). Uma linha por (usuário, caso) com o
-- último momento em que o usuário leu aquela conversa.
--   Não-lido de uma thread = existe comentario com created_at > last_read_at
--                            e autor_id <> usuario (mensagem de outra pessoa).
-- Idempotente.

create table if not exists public.conversa_leitura (
  usuario_id   uuid not null references public.usuarios(id) on delete cascade,
  caso_id      uuid not null references public.casos(id) on delete cascade,
  last_read_at timestamptz not null default now(),
  primary key (usuario_id, caso_id)
);

alter table public.conversa_leitura enable row level security;

-- Cada um só enxerga/edita as próprias marcações de leitura.
drop policy if exists conversa_leitura_own on public.conversa_leitura;
create policy conversa_leitura_own on public.conversa_leitura
  for all to authenticated
  using (usuario_id = auth.uid())
  with check (usuario_id = auth.uid());

grant select, insert, update, delete on public.conversa_leitura to authenticated;

-- Monta a thread e a "última mensagem" de cada caso rapidinho.
create index if not exists comentarios_caso_created_idx
  on public.comentarios (caso_id, created_at desc);

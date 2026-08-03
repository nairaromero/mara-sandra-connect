-- migration_comentario_email_throttle.sql
--
-- Anti-repique de e-mail de comentário: registra o último envio por
-- (caso, destinatário). A edge function notify-novo-comentario só re-envia
-- e-mail a uma pessoa se já passaram 30 min do último — evita spam no chat.
-- Só a service_role (edge function) escreve; RLS ligada sem policy fecha o
-- acesso pelo cliente. Idempotente.

create table if not exists public.comentario_email_throttle (
  caso_id            uuid not null references public.casos(id) on delete cascade,
  destinatario_email text not null,
  ultimo_envio       timestamptz not null default now(),
  primary key (caso_id, destinatario_email)
);

alter table public.comentario_email_throttle enable row level security;

grant select, insert, update, delete on public.comentario_email_throttle to service_role;

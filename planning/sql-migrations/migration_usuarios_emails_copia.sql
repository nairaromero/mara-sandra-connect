-- E-mails adicionais do parceiro (cópia nas notificações).
--
-- `usuarios.email` NÃO pode virar lista: ele é o login (espelha
-- auth.users.email) e é por ele que o magic link chega. Escritório de parceiro
-- costuma ter secretaria/sócio que também precisa receber o aviso — daí uma
-- coluna separada, só para CÓPIA.
--
-- Quem recebe notificação passa a ser: email (principal) + emails_copia.
--
-- Idempotente.

alter table public.usuarios
  add column if not exists emails_copia text[] not null default '{}';

comment on column public.usuarios.emails_copia is
  'E-mails adicionais que recebem CÓPIA das notificações. O login continua sendo usuarios.email.';

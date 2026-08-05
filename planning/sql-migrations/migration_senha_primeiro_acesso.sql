-- migration_senha_primeiro_acesso.sql
--
-- Fluxo "senha no primeiro acesso": quem entra pela primeira vez (via convite
-- ou magic link) e ainda nao tem senha e obrigado a criar uma antes de usar o
-- sistema. Depois disso o magic link continua existindo, mas vira opcional.
--
-- Em vez de uma coluna nova em public.usuarios (que precisaria de backfill e
-- poderia dessincronizar do estado real), a verdade e lida direto de
-- auth.users.encrypted_password via funcao SECURITY DEFINER. Nao ha o que
-- backfillar e nao existe janela de divergencia.
--
-- Idempotente.

create or replace function public.precisa_definir_senha()
returns boolean
language sql
stable
security definer
set search_path = public, auth
as $$
  -- true  = usuario logado ainda NAO tem senha (so entra por magic link/convite)
  -- false = ja tem senha, ou nao ha sessao
  select coalesce(
    (
      select u.encrypted_password is null or u.encrypted_password = ''
      from auth.users u
      where u.id = auth.uid()
    ),
    false
  );
$$;

comment on function public.precisa_definir_senha() is
  'true quando o usuario logado ainda nao definiu senha (conta so com magic link/convite). Usada pelo gate de /definir-senha.';

-- Só quem tem sessao pode perguntar (e a funcao so responde sobre si mesma).
revoke execute on function public.precisa_definir_senha() from public, anon;
grant execute on function public.precisa_definir_senha() to authenticated;

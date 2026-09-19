-- Convite: quem é convidado cria senha antes de usar o sistema (#362).
--
-- precisa_definir_senha() decidia olhando auth.users.encrypted_password (nulo
-- ou vazio = ainda não tem senha). No convite real isso só vale até a pessoa
-- clicar no link: o Supabase grava um hash nesse campo no aceite, e a partir
-- daí o sistema passava a achar que ela já tinha senha. Ninguém convidado
-- chegava na tela de criar senha (conferido em produção e no staging;
-- reproduzido no ambiente local em 2026-09-18).
--
-- Quem responde agora é o nosso domínio: usuarios.senha_definida_em, nula até
-- a pessoa escolher a senha dela. Quem marca é UM gatilho em auth.users, então
-- vale para a tela de primeiro acesso, para o "esqueci a senha", para a troca
-- em Configurações e para qualquer tela futura, sem repetir a regra no front
-- nem em cada função que mexe em usuário.
--
-- O gatilho ignora de propósito a escrita do aceite do convite (vazio -> hash):
-- ali a pessoa não escolheu senha nenhuma.
--
-- Idempotente. O backfill roda só quando a coluna é criada: numa reaplicação
-- ele marcaria como "já criou senha" justamente quem está esperando criar.

do $$
begin
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public'
       and table_name = 'usuarios'
       and column_name = 'senha_definida_em'
  ) then
    alter table public.usuarios add column senha_definida_em timestamptz;

    -- Quem já usa o sistema não pode ser mandado para a tela de senha: entra
    -- como "já definiu". Quem foi convidado e ainda não aceitou (senha vazia
    -- no auth) fica nulo e passa pela tela quando aceitar.
    update public.usuarios u
       set senha_definida_em = now()
      from auth.users a
     where a.id = u.id
       and coalesce(a.encrypted_password, '') <> '';
  end if;
end $$;

comment on column public.usuarios.senha_definida_em is
  'Quando a pessoa criou a senha dela. Nulo em conta de convite que ainda não criou senha — é o que precisa_definir_senha() lê. Quem grava é o gatilho trg_senha_definida em auth.users, nunca o front.';

-- ---------------------------------------------------------------------------
-- Marcação: um só lugar, no gatilho.
-- ---------------------------------------------------------------------------
create or replace function public.tg_marcar_senha_definida()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.usuarios
     set senha_definida_em = now()
   where id = new.id
     and senha_definida_em is null;
  return null;
end;
$$;

comment on function public.tg_marcar_senha_definida() is
  'Marca usuarios.senha_definida_em na primeira senha escolhida pela pessoa. Ver trg_senha_definida.';

drop trigger if exists trg_senha_definida on auth.users;
create trigger trg_senha_definida
  after update of encrypted_password on auth.users
  for each row
  when (
    new.encrypted_password is distinct from old.encrypted_password
    -- vazio -> hash é o aceite do convite, escrito pelo próprio Supabase:
    -- ali a pessoa ainda não escolheu senha nenhuma. Qualquer outra troca
    -- (primeiro acesso, "esqueci a senha", Configurações, reset por admin) é
    -- escolha de senha e marca.
    and old.encrypted_password is distinct from ''
    and coalesce(new.encrypted_password, '') <> ''
  )
  execute function public.tg_marcar_senha_definida();

-- ---------------------------------------------------------------------------
-- A pergunta que o app faz a cada sessão.
-- ---------------------------------------------------------------------------
create or replace function public.precisa_definir_senha()
returns boolean
language sql
stable
security definer
set search_path to 'public', 'auth'
as $$
  -- true  = conta de convite cuja pessoa ainda não criou a própria senha
  -- false = já criou, não veio de convite, ou não há sessão
  select coalesce(
    (
      select a.invited_at is not null and u.senha_definida_em is null
        from public.usuarios u
        join auth.users a on a.id = u.id
       where u.id = auth.uid()
    ),
    false
  );
$$;

comment on function public.precisa_definir_senha() is
  'true quando a pessoa logada veio de convite e ainda não criou senha própria (usuarios.senha_definida_em). O app segura o sistema e manda para /definir-senha.';

-- Conferência: ninguém que já usa o sistema deve ficar pendente.
select
  count(*) filter (where senha_definida_em is null) as sem_senha_propria,
  count(*) filter (where senha_definida_em is not null) as com_senha,
  count(*) as total
from public.usuarios;

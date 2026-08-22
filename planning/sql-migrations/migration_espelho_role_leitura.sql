-- Role SO DE LEITURA pro espelho producao -> staging (2026-08-23)
--
-- POR QUE: scripts/espelho-staging.sh fazia o pg_dump de producao com o role
-- `postgres` (createrole, bypassrls, DDL/DML irrestrito). O dump so precisa de
-- SELECT. Com um role que nao consegue escrever, um erro de edicao futura no
-- script (trocar a URL de producao pela de staging numa linha) nao tem como
-- truncar producao — e, se o espelho rodar no GitHub Actions, o secret
-- guardado la e uma credencial de leitura, nao a senha do Postgres.
--
-- RLS: no Supabase o `postgres` nao e superuser e nao pode dar BYPASSRLS a
-- outro role. Entao cada tabela com RLS ganha uma policy de SELECT pro
-- espelho (using true), e o pg_dump roda com --enable-row-security. Tabela
-- nova com RLS precisa passar por aqui de novo (rodar a migration de novo —
-- e idempotente); o script de espelho aborta se achar tabela sem a policy.
--
-- A SENHA NAO FICA AQUI. Depois de aplicar, definir fora do repo:
--   node scripts/msc-sql.mjs "alter role espelho_leitura password '<senha>'"
-- e guardar em ESPELHO_LEITURA_PASSWORD no .env.local (ou secret do workflow).
--
-- Idempotente: pode rodar varias vezes.

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'espelho_leitura') then
    create role espelho_leitura login noinherit;
  end if;
end
$$;

-- Garantias, mesmo se o role ja existia. (Sem NOSUPERUSER explicito: no
-- Postgres, citar esse atributo — mesmo pra negar — exige superuser, e o
-- `postgres` do Supabase nao e. O role nasce sem superuser de qualquer forma.)
alter role espelho_leitura login noinherit nocreatedb nocreaterole;
-- Dump de ~40 MB leva segundos; 5 min e folga, nao carta branca.
alter role espelho_leitura set statement_timeout = '5min';
alter role espelho_leitura set search_path = public;

grant usage on schema public to espelho_leitura;
grant select on all tables in schema public to espelho_leitura;
-- pg_dump --data-only emite setval() das sequences, que precisa de SELECT nelas.
grant select on all sequences in schema public to espelho_leitura;

-- Tabelas/sequences criadas daqui pra frente (por migrations rodadas como
-- postgres) ja nascem legiveis pelo espelho.
alter default privileges for role postgres in schema public grant select on tables to espelho_leitura;
alter default privileges for role postgres in schema public grant select on sequences to espelho_leitura;

-- Policy de SELECT em toda tabela com RLS ligada (idempotente).
do $$
declare t record;
begin
  for t in
    select c.relname
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind in ('r', 'p') and c.relrowsecurity
  loop
    if not exists (
      select 1 from pg_policies
       where schemaname = 'public' and tablename = t.relname
         and policyname = 'espelho_leitura_select'
    ) then
      execute format(
        'create policy espelho_leitura_select on public.%I for select to espelho_leitura using (true)',
        t.relname
      );
    end if;
  end loop;
end
$$;

-- Conferencia: nada alem de SELECT, e nenhuma tabela com RLS sem a policy.
do $$
declare v int;
begin
  select count(*) into v
    from information_schema.role_table_grants
   where grantee = 'espelho_leitura' and privilege_type <> 'SELECT';
  if v > 0 then
    raise exception 'espelho_leitura tem % privilegio(s) alem de SELECT', v;
  end if;

  select count(*) into v
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind in ('r', 'p') and c.relrowsecurity
     and not exists (
       select 1 from pg_policies p
        where p.schemaname = 'public' and p.tablename = c.relname
          and p.policyname = 'espelho_leitura_select'
     );
  if v > 0 then
    raise exception '% tabela(s) com RLS sem policy espelho_leitura_select', v;
  end if;
end
$$;

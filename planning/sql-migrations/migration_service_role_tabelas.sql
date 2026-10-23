-- =============================================================================
-- Migration: a conta das edge functions (service_role) lê e grava as tabelas
-- do schema public — e tabela NOVA já nasce assim.
--
-- Achado da auditoria de 23/10 (item f44 da página de Prioridades). Em
-- PRODUÇÃO, o padrão de permissão de tabela nova do schema public dava a
-- `service_role` só `Dxtm` (sem SELECT/INSERT/UPDATE/DELETE); no STAGING dava
-- tudo. A diferença não vem de nenhuma migration do repositório. Efeito:
--   · ia_uso — o registro de uso da IA falhava em silêncio desde 18/10
--     ("[ia] registro de uso falhou: permission denied for table ia_uso",
--     34 vezes nos logs de 19, 21 e 22/10);
--   · caso_pastas_externas — a checagem do link (lançada em 23/10) não
--     conseguia gravar o veredito;
--   · mais 8 tabelas que nenhuma function usa hoje, mas a próxima quebraria.
-- Como o staging (e o banco local, copiado dele) tinha o padrão certo, nenhum
-- teste pegou.
--
-- `service_role` é a chave de servidor do Supabase: ignora RLS e nunca vai ao
-- navegador. Dar a ela as quatro operações em tudo do public é o padrão da
-- plataforma; quem restringe o que cada function faz é o código dela
-- (`escopado`, `exigirRecurso`), não a falta de GRANT.
--
-- Idempotente. Local primeiro; staging e produção só com aval.
-- =============================================================================

-- 1) O que já existe
grant select, insert, update, delete on all tables in schema public to service_role;
grant usage, select, update on all sequences in schema public to service_role;

-- 2) O que vier a existir: tabela criada pelas migrations (dono postgres)
alter default privileges for role postgres in schema public
  grant select, insert, update, delete on tables to service_role;
alter default privileges for role postgres in schema public
  grant usage, select, update on sequences to service_role;

-- 3) A régua, num lugar só: o que falta para service_role no public. A
-- migration se confere no fim, e o scripts/rbac-conferir-exigencias.mjs cobra
-- a mesma função em cada ambiente.
create or replace function private.service_role_sem_acesso()
returns table(objeto text, falta text)
language sql
stable
security definer
set search_path = ''
as $$
  -- tabelas sem alguma das quatro operações
  select c.relname::text,
         array_to_string(array_remove(array[
           case when not has_table_privilege('service_role', c.oid, 'SELECT') then 'SELECT' end,
           case when not has_table_privilege('service_role', c.oid, 'INSERT') then 'INSERT' end,
           case when not has_table_privilege('service_role', c.oid, 'UPDATE') then 'UPDATE' end,
           case when not has_table_privilege('service_role', c.oid, 'DELETE') then 'DELETE' end
         ], null), ',')
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public'
     and c.relkind in ('r', 'p')
     and not (has_table_privilege('service_role', c.oid, 'SELECT')
              and has_table_privilege('service_role', c.oid, 'INSERT')
              and has_table_privilege('service_role', c.oid, 'UPDATE')
              and has_table_privilege('service_role', c.oid, 'DELETE'))
  union all
  -- o padrão de tabela nova (dono postgres) sem as quatro operações
  select '(padrão de tabela nova)'::text, 'SELECT/INSERT/UPDATE/DELETE'
   where not exists (
     select 1
       from pg_default_acl a
       join pg_namespace n on n.oid = a.defaclnamespace
       cross join lateral aclexplode(a.defaclacl) x
      where n.nspname = 'public'
        and a.defaclobjtype = 'r'
        and a.defaclrole = 'postgres'::regrole
        and x.grantee = 'service_role'::regrole
      group by x.grantee
     having bool_or(x.privilege_type = 'SELECT') and bool_or(x.privilege_type = 'INSERT')
        and bool_or(x.privilege_type = 'UPDATE') and bool_or(x.privilege_type = 'DELETE')
   );
$$;

revoke all on function private.service_role_sem_acesso() from public, anon, authenticated;
grant execute on function private.service_role_sem_acesso() to service_role;

-- 4) Confere o próprio resultado: migration que não consertou não registra.
do $$
declare
  v text;
begin
  select string_agg(objeto || ' (' || falta || ')', ', ') into v
    from private.service_role_sem_acesso();
  if v is not null then
    raise exception 'service_role ainda sem acesso: %', v;
  end if;
end $$;

-- migration_anon_sem_escrita.sql
--
-- `anon` (a chave publicável, que está no bundle do navegador) não escreve em
-- nada, exceto o formulário público de lead.
--
-- Estado em 2026-09-19: produção já está quase assim — `anon` tem INSERT só em
-- `leads` —, mas carrega TRUNCATE/REFERENCES/TRIGGER em 44 tabelas por default
-- do Postgres. O **staging** está bem pior: `anon` tem SELECT em 47 tabelas e
-- INSERT/UPDATE/DELETE em 46, porque o projeto nasceu com os default
-- privileges do Supabase e as migrations antigas nunca fecharam isso. Como o
-- staging é onde a Naira valida e a suíte roda, a diferença de grants mascara
-- justamente a classe de bug que estamos corrigindo.
--
-- Esta migration deixa os dois ambientes iguais no que diz respeito a ESCRITA.
-- O SELECT de `anon` fica como está de propósito: em produção são 14 tabelas
-- protegidas por RLS, e mexer nisso é outra conversa (nenhuma tela pública lê
-- do banco hoje — o site institucional é estático e a página /upload usa URL
-- assinada do Storage).
--
-- RLS continua valendo por baixo: o que segura o formulário de lead é a policy
-- `leads_anon_insert`, não o grant.
--
-- Idempotente.

-- Nota: o TRUNCATE que `anon` carrega por default fica como está, por dois
-- motivos: é inerte (anon não é papel de login, então só chega pelo PostgREST,
-- que não emite TRUNCATE) e a palavra faz o scripts/msc-sql.mjs recusar o
-- arquivo inteiro — a trava contra comando destrutivo. Não vale contornar a
-- trava por causa de um grant sem efeito.
revoke insert, update, delete on all tables in schema public from anon;

-- Única escrita anônima do produto: o formulário do site institucional.
grant insert on public.leads to anon;

-- Próximas tabelas nascem sem escrita para anon.
alter default privileges in schema public revoke insert, update, delete on tables from anon;

-- Conferência
select
  count(*) filter (where privilege_type = 'SELECT') as select_anon,
  count(*) filter (where privilege_type = 'INSERT') as insert_anon,
  count(*) filter (where privilege_type in ('UPDATE','DELETE')) as escrita_anon,
  string_agg(distinct table_name, ', ') filter (where privilege_type = 'INSERT') as tabelas_insert
  from information_schema.role_table_grants
 where table_schema = 'public' and grantee = 'anon';

-- =============================================================================
-- Migration: registro de quais migrations rodaram em cada banco.
--
-- Até aqui não havia resposta para "esta migration já foi aplicada em
-- produção?". Em 2026-09-10, preparando o release do lote de tarefas, a
-- resposta teve de ser INFERIDA pelo pg_proc (a função existe? o hash bate com
-- o do staging?). Serviu uma vez, mas não escala: a responsavel_tarefa_caso é
-- reescrita por QUATRO migrations do mesmo lote, e olhando a função final não
-- dá para saber se a primeira delas rodou.
--
-- A partir daqui, o scripts/msc-sql.mjs grava nesta tabela toda
-- migration_*.sql que aplica com --file, no banco em que aplicou. Quem
-- responde "rodou?" passa a ser o próprio banco.
--
-- Por que num schema próprio (ops) e não no public:
--
--  * o espelho semanal (scripts/espelho-staging.sh) faz TRUNCATE em todas as
--    tabelas do public do staging e as restaura com os dados da produção. No
--    public, o registro do staging seria sobrescrito toda segunda pelo da
--    produção — e passaria a mentir sobre o que rodou no staging;
--  * a trava (b) do espelho ABORTA se existir tabela com RLS no public sem a
--    policy espelho_leitura_select. E sem RLS a tabela ficaria exposta pela
--    API REST, porque o Supabase dá acesso a anon/authenticated no public;
--  * o ops fica fora das duas coisas: o espelho só olha o public, e a API REST
--    só expõe os schemas configurados (public e graphql_public).
--
-- O registro COMEÇA nesta migration: o que foi aplicado antes dela não está
-- aqui. Para registrar sem executar (ex.: algo aplicado antes do registro):
--   node scripts/msc-sql.mjs --registrar planning/sql-migrations/<arquivo>
--
-- Leitura pelo GitHub Actions: o workflow do board lê este registro em
-- produção com o role espelho_leitura (só SELECT), o mesmo do espelho.
--
-- Idempotente. Apply:
--   node scripts/msc-sql.mjs --staging --file planning/sql-migrations/migration_registro_migrations.sql
--   (validar, depois sem --staging)
-- =============================================================================

create schema if not exists ops;

comment on schema ops is
  'Controle operacional. Fora da API REST (não exposto) e fora do espelho semanal (que só toca o public).';

create table if not exists ops.migrations_aplicadas (
  nome          text primary key
                check (nome ~ '^migration_[a-z0-9_]+\.sql$'),
  sha256        text not null
                check (sha256 ~ '^[0-9a-f]{64}$'),
  origem        text not null
                check (origem in ('msc-sql', 'manual')),
  aplicada_por  text,
  aplicada_em   timestamptz not null default now(),
  reaplicada_em timestamptz
);

comment on table ops.migrations_aplicadas is
  'Uma linha por migration aplicada NESTE banco. Preenchida pelo scripts/msc-sql.mjs.';
comment on column ops.migrations_aplicadas.nome is
  'Basename do arquivo em planning/sql-migrations/.';
comment on column ops.migrations_aplicadas.sha256 is
  'Hash do conteúdo do arquivo na última aplicação. Se o arquivo for editado depois, diverge.';
comment on column ops.migrations_aplicadas.origem is
  'Como a linha ENTROU no registro (não muda depois): msc-sql = executada pelo --file; manual = registrada pelo --registrar, sem executar.';
comment on column ops.migrations_aplicadas.aplicada_em is
  'Primeira aplicação. Para origem=manual, é quando foi REGISTRADA, não quando rodou.';
comment on column ops.migrations_aplicadas.reaplicada_em is
  'Última reaplicação (as migrations são idempotentes e às vezes rodam de novo).';

-- Fechado por padrão: ninguém lê nem escreve além do dono e do que é concedido
-- abaixo. anon/authenticated explícitos porque são os roles da API REST.
revoke all on schema ops from public, anon, authenticated;
revoke all on all tables in schema ops from public, anon, authenticated;

-- O role do espelho existe nos dois bancos (conferido em 2026-09-11). O bloco é
-- condicional só para a migration não quebrar num banco que não o tenha.
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'espelho_leitura') then
    grant usage on schema ops to espelho_leitura;
    grant select on ops.migrations_aplicadas to espelho_leitura;
  end if;
end $$;

-- migration_remove_intake_trello_runs.sql
--
-- `public.intake_trello_runs` é a última sobra do intake do Trello no staging.
-- Veio de `migration_intake_trello.sql` (#211/#212), que só rodou no staging;
-- o intake foi revertido na produção em 26/08, a staging foi alinhada no #365 e
-- a função órfã saiu no #366 — a tabela ficou para trás.
--
-- Conferência antes de remover (2026-09-21):
--   * nenhum código de main/staging/branches abertas cita a tabela (as únicas
--     menções são em planning/MULTI_TENANT_RBAC.md, justamente como sobra a
--     remover — item de #285);
--   * 0 linhas; nenhuma view, função, gatilho ou FK de OUTRA tabela depende
--     dela (as duas FKs são dela para clientes/casos, ON DELETE SET NULL);
--   * a edge function que escrevia nela (`intake-trello`) já não existe;
--   * o espelho semanal não a toca (só copia tabelas de produção).
--
-- Produção: no-op — a tabela nunca existiu lá. No release, registrar com
-- `node scripts/msc-sql.mjs --registrar migration_remove_intake_trello_runs.sql`.
--
-- Por conter DROP TABLE, o scripts/msc-sql.mjs recusa este arquivo (trava
-- contra comando destrutivo): aplicar à mão, com aprovação, e depois registrar
-- com `--registrar`.
--
-- Para recriar, se um dia o intake voltar (DDL do staging em 2026-09-21; o
-- original está no histórico do git, acc8452):
--   card_id text primary key, card_nome text, card_url text,
--   status text check (status in ('concluido','pendente','erro')), motivo text,
--   cliente_id uuid references clientes(id) on delete set null,
--   caso_id uuid references casos(id) on delete set null,
--   docs_importados int, docs_classificados_ia int, detalhes jsonb,
--   criado_em timestamptz, atualizado_em timestamptz;
--   RLS + policy intake_trello_runs_interno_select (select, using is_interno()).
--
-- Idempotente. Leva junto a policy, as FKs, a PK e o check.

drop table if exists public.intake_trello_runs;

-- Conferência
select count(*) as tabela_restante from pg_class where relname = 'intake_trello_runs';

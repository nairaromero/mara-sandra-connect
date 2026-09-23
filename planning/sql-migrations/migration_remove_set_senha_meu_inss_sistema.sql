-- Remove a sobra do intake do Trello: public.set_senha_meu_inss_sistema.
--
-- A função foi criada por migration_intake_trello.sql, aplicada só no staging.
-- O intake foi revertido na produção em 2026-08-26 (#211/#212) e o arquivo da
-- migration saiu do repositório junto. Em produção a função nunca existiu; no
-- staging ficou órfã.
--
-- Conferido em 2026-09-19, antes de remover:
--   * nenhum código da staging (que já contém o lote pendente de release) ou
--     da main cita a função — só a branch do PR fechado do intake;
--   * nenhuma outra função, gatilho, view, policy, default ou constraint do
--     banco depende dela;
--   * permissão de execução só para postgres e service_role (o app no
--     navegador não alcança), e zero chamadas nos últimos 7 dias;
--   * quem o app usa é set_senha_meu_inss — outra função, que fica.
--
-- Em produção isto é no-op (a função não está lá). Idempotente.
drop function if exists public.set_senha_meu_inss_sistema(uuid, text, uuid);

select count(*) as ainda_existe
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and p.proname = 'set_senha_meu_inss_sistema';

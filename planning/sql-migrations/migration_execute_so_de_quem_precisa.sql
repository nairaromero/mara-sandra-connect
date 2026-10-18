-- ============================================================================
-- Fecha o EXECUTE que voltou sozinho (2026-09-28)
--
-- POR QUE: o Postgres concede EXECUTE a PUBLIC em toda função nova, e o projeto
-- do Supabase ainda concede a `anon` por privilégio padrão. `create or replace`
-- preserva os grants; `drop` + `create` — que é o que se faz quando o TIPO DE
-- RETORNO muda — os perde e volta ao padrão. A regra que vale é a da
-- `migration_revoke_execute_anon`: `anon` só nos 4 helpers que aparecem DENTRO
-- de policy, default, constraint ou índice (caso_do_parceiro, is_admin,
-- is_interno, parceiro_ativo). Todo o resto é de `authenticated` e
-- `service_role`.
--
-- Duas funções estavam fora da regra:
--
--   · `permissoes_do_membro` — recriada em 28/09 pela migration_permissao_detalhe
--     para devolver a coluna `detalhe`. Virou a ÚNICA RPC da família alcançável
--     por PUBLIC. Não vazou dado (o corpo começa cobrando `equipe:gerenciar`, e
--     a chamada anônima leva 42501 — conferido no staging), mas ser a exceção da
--     família é o começo do próximo furo.
--
--   · `_fase_pelo_processo(p_caso_id)` — anterior a isto, e não é função de
--     gatilho (aquelas o Postgres confere no CREATE TRIGGER, e por isso ficaram
--     de fora do endurecimento). Fechar é seguro: quem a chama são
--     `_caso_fase_pelo_processo` e `_reabre_caso_finalizado`, as duas SECURITY
--     DEFINER — rodam com os direitos do dono, não com os de quem disparou.
--
-- Quem passa a cobrar isso sozinho: `scripts/rbac-conferir-exigencias.mjs`,
-- seção "funções alcançáveis por anon/PUBLIC".
--
-- Idempotente.
-- ============================================================================

revoke execute on function public.permissoes_do_membro(uuid) from public, anon;
grant  execute on function public.permissoes_do_membro(uuid) to authenticated, service_role;

revoke execute on function public._fase_pelo_processo(uuid) from public, anon;

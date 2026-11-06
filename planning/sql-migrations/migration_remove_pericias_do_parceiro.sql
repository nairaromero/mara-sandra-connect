-- =============================================================================
-- Migration: remove public.pericias_do_parceiro() — função sem uso (card #202).
--
-- O card pedia que ela exigisse parceiro ativo ("desligado com sessão aberta vê
-- a lista de perícias por até 1h"). Conferido em 05/11 (produção e staging):
--   · nenhum código chama a função (src, edge functions, specs, scripts) desde
--     que a Agenda do parceiro virou o kanban (commit 4241c67b);
--   · ninguém consegue chamá-la: sem EXECUTE para `authenticated` nem `anon`
--     (só a conta de serviço);
--   · nenhuma outra função do banco a usa.
-- Então o risco não existe hoje — e o que não tem uso sai, em vez de ganhar
-- conserto (CLAUDE.md). O que a substituiu é `pericias_do_caso`, que já confere
-- o acesso pela linha.
--
-- Idempotente. Local primeiro; staging e produção só com aval.
-- =============================================================================

drop function if exists public.pericias_do_parceiro();

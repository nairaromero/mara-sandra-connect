-- ============================================================================
-- RBAC 12 · Token do MCP emitido para outra pessoa (#385) — 2026-09-23
--
-- Quem tem ia:mcp_conceder (admin) escolhe a pessoa e emite o token DELA; o
-- token grava para quem é (usuario_id) e quem emitiu (emitido_por). O ia-mcp
-- roda como o dono (RLS dele) e exige dono ativo E emissor ainda admin ativo
-- no escritório do token — emissor rebaixado/desligado derruba o token na
-- hora. Quem vê/revoga: o dono e o emissor (um admin não vê o que outro
-- admin emitiu). ia_acoes registra o emissor. Idempotente.
-- ============================================================================

alter table public.ia_tokens
  add column if not exists emitido_por uuid references public.usuarios (id) on delete set null;
-- tokens antigos: a pessoa emitiu para si mesma
update public.ia_tokens set emitido_por = usuario_id where emitido_por is null;
create index if not exists ia_tokens_emitido_por_idx on public.ia_tokens (emitido_por);

alter table public.ia_acoes
  add column if not exists emitido_por uuid;

-- dono OU emissor veem o token (a restritiva de escritório continua valendo)
drop policy if exists ia_tokens_select on public.ia_tokens;
create policy ia_tokens_select on public.ia_tokens
  for select to authenticated
  using (usuario_id = (select auth.uid()) or emitido_por = (select auth.uid()));

notify pgrst, 'reload schema';

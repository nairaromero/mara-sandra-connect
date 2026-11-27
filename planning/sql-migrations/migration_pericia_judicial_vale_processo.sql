-- Perícia judicial: vale o PROCESSO a que a tarefa está ligada.
--
-- A migration_pericia_judicial_laudo deixava o template do INSS vencer o
-- vínculo ("pericia_parceiro" num processo judicial continuava com os botões
-- do INSS). Conferido com a Naira em 27/11/2026: nos casos reais (agosto/2026)
-- a perícia era judicial e o template é que tinha sido escolhido errado. O
-- ciclo nasce do processo — e a tela já não deixa salvar perícia sem processo.
--
-- Espelho de ehPericiaJudicial (src/lib/tarefas/pericia.ts).
-- Também fecha o EXECUTE, como as outras funções do `private`: quem chama é a
-- rotina diária (SECURITY DEFINER, dona postgres).
--
-- Idempotente.

create or replace function private.eh_pericia_judicial(
  p_metadata jsonb,
  p_processo_judicial_id uuid
) returns boolean
language sql
immutable
set search_path = pg_catalog
as $$
  select p_processo_judicial_id is not null
      or coalesce(p_metadata->>'pericia_judicial', '') = 'true'
      or coalesce(p_metadata->>'template_aplicado' = 'pericia_judicial', false)
$$;

comment on function private.eh_pericia_judicial(jsonb, uuid) is
  'A pericia desta tarefa e judicial? Ligada a processo judicial -> sim, qualquer que seja o template; sem processo judicial, so com o template judicial ou a marca explicita. Espelho de ehPericiaJudicial (src/lib/tarefas/pericia.ts).';

revoke all on function private.eh_pericia_judicial(jsonb, uuid) from public, anon, authenticated;
grant execute on function private.eh_pericia_judicial(jsonb, uuid) to service_role;

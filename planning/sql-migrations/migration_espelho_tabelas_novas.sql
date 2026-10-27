-- =============================================================================
-- Migration: as tabelas novas que o espelho semanal COPIA ganham a leitura do
-- role espelho_leitura (card #481).
--
-- O espelho (scripts/espelho-staging.sh) aborta desde 28/09: antes de copiar,
-- ele exige que toda tabela com RLS em produção, cujos dados saem de lá, tenha
-- a policy `espelho_leitura_select` (sem ela o pg_dump traria a tabela VAZIA
-- em silêncio). Sete tabelas nasceram depois sem essa decisão. Divisão
-- (Naira, 27/10):
--   · pedidos_prorrogacao, relogios_prazo → COPIAR: policy aqui;
--   · auditoria, caso_pastas_externas, membros, membro_permissoes,
--     plataforma_staff → não saem de produção (lista EXCLUIR do script):
--     dado pessoal / link real do cliente / reconstruídas no passo 6/6.
--
-- Só as duas: a migration_espelho_role_leitura cria a policy em TODA tabela
-- com RLS, o que daria ao espelho leitura sobre a auditoria e os links dos
-- clientes sem ninguém precisar.
--
-- Idempotente. Em staging/local, sem o role espelho_leitura, não faz nada.
-- =============================================================================

do $$
declare
  t text;
begin
  if not exists (select 1 from pg_roles where rolname = 'espelho_leitura') then
    raise notice 'sem o role espelho_leitura neste banco: nada a fazer';
    return;
  end if;
  foreach t in array array['pedidos_prorrogacao', 'relogios_prazo'] loop
    execute format('grant select on public.%I to espelho_leitura', t);
    if not exists (
      select 1 from pg_policies
       where schemaname = 'public' and tablename = t and policyname = 'espelho_leitura_select'
    ) then
      execute format(
        'create policy espelho_leitura_select on public.%I for select to espelho_leitura using (true)', t);
    end if;
  end loop;
end $$;

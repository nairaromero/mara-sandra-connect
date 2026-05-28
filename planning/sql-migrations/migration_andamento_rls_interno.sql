-- =============================================================================
-- Migration: garantir que usuarios INTERNOS tem acesso total a `andamentos`.
--
-- Causa do bug: as policies atuais de UPDATE/DELETE em andamentos provavelmente
-- restringem por `criado_por = auth.uid()`. Como notas importadas do TI eram
-- inseridas com criado_por NULL (antes do fix da edge function), e mesmo apos
-- o backfill, internos so podiam editar o que criaram. Para o escritorio,
-- internos (Naira / Mara Sandra) precisam de acesso total a todos andamentos.
--
-- Estrategia: adicionar uma policy permissive nova "andamentos_interno_acesso_total"
-- sem dropar as existentes. RLS combina policies via OR, entao basta uma
-- permitir para o usuario poder agir.
--
-- Idempotente: pode rodar varias vezes sem dano.
-- =============================================================================

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'andamentos'
      and policyname = 'andamentos_interno_acesso_total'
  ) then
    create policy "andamentos_interno_acesso_total"
    on public.andamentos
    as permissive
    for all
    to authenticated
    using (public.is_interno())
    with check (public.is_interno());
  end if;
end$$;

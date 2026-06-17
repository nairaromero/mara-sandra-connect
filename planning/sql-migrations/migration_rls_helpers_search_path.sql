-- migration_rls_helpers_search_path.sql
--
-- Adiciona SET search_path explícito nas funções helper usadas em policies RLS.
-- Sem search_path fixo, SECURITY DEFINER + STABLE pode ter comportamento
-- imprevisível quando avaliado dentro de policies (especialmente em outros
-- schemas como storage.objects).
--
-- Sintoma: parceiro do caso recebia "new row violates row-level security
-- policy" ao tentar upload em storage.objects, mesmo sendo de fato dono do
-- caso (caso_do_parceiro retornava TRUE quando chamada isolada).
--
-- Idempotente.

CREATE OR REPLACE FUNCTION public.caso_do_parceiro(p_caso_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
  select exists (
    select 1 from public.casos
    where id = p_caso_id and parceiro_id = auth.uid()
  );
$$;

CREATE OR REPLACE FUNCTION public.is_interno()
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
  select exists (
    select 1 from public.usuarios
    where id = auth.uid() and tipo = 'interno' and ativo = true
  );
$$;

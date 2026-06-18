-- migration_clientes_created_by.sql
--
-- Adiciona public.clientes.created_by (uuid) preenchido automaticamente
-- com auth.uid() no INSERT, e amplia a policy SELECT para permitir o
-- próprio criador ler a row imediatamente após o INSERT.
--
-- Motivo: parceiro cadastra cliente via supabase-js
-- (.insert({...}).select("id").single()). PostgREST aplica a policy SELECT
-- na row retornada; como o caso ainda não foi criado, a policy SELECT
-- (que checava só "is_interno OR parceiro do caso") falhava e PostgREST
-- devolvia "new row violates row-level security policy". Com created_by,
-- o criador consegue ler a row recém-inserida e o fluxo passa.
--
-- Idempotente.

ALTER TABLE public.clientes
  ADD COLUMN IF NOT EXISTS created_by uuid REFERENCES public.usuarios(id);

-- Trigger BEFORE INSERT: preenche created_by com auth.uid() se NULL.
CREATE OR REPLACE FUNCTION public._clientes_set_created_by()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, auth, pg_temp
AS $$
begin
  if NEW.created_by is null then
    NEW.created_by := auth.uid();
  end if;
  return NEW;
end;
$$;

DROP TRIGGER IF EXISTS clientes_set_created_by ON public.clientes;
CREATE TRIGGER clientes_set_created_by
BEFORE INSERT ON public.clientes
FOR EACH ROW EXECUTE FUNCTION public._clientes_set_created_by();

-- Substitui policy SELECT incluindo created_by.
DROP POLICY IF EXISTS clientes_select ON public.clientes;
CREATE POLICY clientes_select ON public.clientes
FOR SELECT USING (
  is_interno()
  OR created_by = auth.uid()
  OR EXISTS (
    SELECT 1 FROM public.casos
    WHERE casos.cliente_id = clientes.id
      AND casos.parceiro_id = auth.uid()
  )
);

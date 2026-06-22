-- =============================================================================
-- migration_clientes_update_parceiro.sql
--
-- Permite que parceiros atualizem dados cadastrais dos clientes vinculados aos
-- casos deles. Antes: clientes_update era is_interno()-only.
--
-- Restricao: parceiro so pode UPDATE em clientes que tem pelo menos um caso
-- com casos.parceiro_id = auth.uid(). Mesma forma que a policy de SELECT.
--
-- Idempotente: DROP IF EXISTS + CREATE.
-- =============================================================================

DROP POLICY IF EXISTS clientes_update ON public.clientes;

CREATE POLICY clientes_update ON public.clientes
  FOR UPDATE
  USING (
    is_interno()
    OR EXISTS (
      SELECT 1 FROM public.casos
      WHERE casos.cliente_id = clientes.id
        AND casos.parceiro_id = auth.uid()
    )
  );
-- WITH CHECK omitido: Postgres usa USING como default, e como cliente.id eh
-- chave primaria (nao muda), o conjunto de linhas que satisfaz USING tambem
-- satisfaz WITH CHECK trivialmente.

-- migration_etiquetas_tabela.sql
--
-- Cria estrutura própria de etiquetas (substitui clientes.tags JSON
-- vindo do TI). A coluna clientes.tags fica como legado/fallback, mas
-- a UI passa a usar essas tabelas como fonte de verdade.
--
-- public.etiquetas: catálogo global, editável pelos internos.
-- public.clientes_etiquetas: vínculo many-to-many.
--
-- Importa as etiquetas distintas atuais (de clientes.tags) preservando
-- nome e cor — uma única vez. Reexecutar é seguro (ON CONFLICT).
--
-- Idempotente.

CREATE TABLE IF NOT EXISTS public.etiquetas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nome text NOT NULL UNIQUE,
  cor text NOT NULL DEFAULT '#e3d0e5',
  ti_id int,                -- origem TI; null pra etiquetas criadas no sistema
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_etiquetas_ti_id ON public.etiquetas(ti_id) WHERE ti_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.clientes_etiquetas (
  cliente_id uuid NOT NULL REFERENCES public.clientes(id) ON DELETE CASCADE,
  etiqueta_id uuid NOT NULL REFERENCES public.etiquetas(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (cliente_id, etiqueta_id)
);

CREATE INDEX IF NOT EXISTS idx_clientes_etiquetas_cliente ON public.clientes_etiquetas(cliente_id);
CREATE INDEX IF NOT EXISTS idx_clientes_etiquetas_etiqueta ON public.clientes_etiquetas(etiqueta_id);

-- RLS: interno lê e escreve tudo. Parceiro lê (pra ver etiquetas do
-- próprio caso).
ALTER TABLE public.etiquetas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.clientes_etiquetas ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS etiquetas_select_todos ON public.etiquetas;
CREATE POLICY etiquetas_select_todos ON public.etiquetas
FOR SELECT USING (true);

DROP POLICY IF EXISTS etiquetas_modify_interno ON public.etiquetas;
CREATE POLICY etiquetas_modify_interno ON public.etiquetas
FOR ALL USING (public.is_interno()) WITH CHECK (public.is_interno());

DROP POLICY IF EXISTS clientes_etiquetas_select ON public.clientes_etiquetas;
CREATE POLICY clientes_etiquetas_select ON public.clientes_etiquetas
FOR SELECT USING (
  public.is_interno() OR EXISTS (
    SELECT 1 FROM public.casos c
    WHERE c.cliente_id = clientes_etiquetas.cliente_id
      AND c.parceiro_id = auth.uid()
  )
);

DROP POLICY IF EXISTS clientes_etiquetas_modify_interno ON public.clientes_etiquetas;
CREATE POLICY clientes_etiquetas_modify_interno ON public.clientes_etiquetas
FOR ALL USING (public.is_interno()) WITH CHECK (public.is_interno());

-- Trigger pra manter updated_at em etiquetas.
CREATE OR REPLACE FUNCTION public._etiquetas_set_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
begin NEW.updated_at = now(); return NEW; end;
$$;

DROP TRIGGER IF EXISTS etiquetas_updated_at ON public.etiquetas;
CREATE TRIGGER etiquetas_updated_at
BEFORE UPDATE ON public.etiquetas
FOR EACH ROW EXECUTE FUNCTION public._etiquetas_set_updated_at();

-- ============== IMPORTAR DO TI ==============
-- Snapshot único: pra cada (id, name, color) distinto em clientes.tags,
-- cria uma etiqueta correspondente. ON CONFLICT (nome) garante que
-- reexecuções não duplicam.
WITH tags_unicas AS (
  SELECT DISTINCT
    (t->>'id')::int AS ti_id,
    t->>'name' AS nome,
    t->>'color' AS cor
  FROM public.clientes,
       jsonb_array_elements(tags) t
  WHERE tags IS NOT NULL
)
INSERT INTO public.etiquetas (nome, cor, ti_id)
SELECT nome, COALESCE(cor, '#e3d0e5'), ti_id
FROM tags_unicas
WHERE nome IS NOT NULL
ON CONFLICT (nome) DO NOTHING;

-- Vincula cada cliente às etiquetas das tags atuais (match por ti_id).
INSERT INTO public.clientes_etiquetas (cliente_id, etiqueta_id)
SELECT DISTINCT c.id, e.id
FROM public.clientes c,
     jsonb_array_elements(c.tags) t
JOIN public.etiquetas e ON e.ti_id = (t->>'id')::int
WHERE c.tags IS NOT NULL
ON CONFLICT DO NOTHING;

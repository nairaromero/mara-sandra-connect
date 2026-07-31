-- Cadastro gerenciavel de tipos de beneficio (antes hardcoded no front).
-- Interno inclui/desativa/exclui em Configuracoes; dropdowns de caso e
-- processo carregam daqui (ativo=true, ordem).
--
-- Idempotente: CREATE IF NOT EXISTS + seed com ON CONFLICT DO NOTHING.

CREATE TABLE IF NOT EXISTS tipos_beneficio (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nome text NOT NULL UNIQUE,
  ativo boolean NOT NULL DEFAULT true,
  ordem integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE tipos_beneficio ENABLE ROW LEVEL SECURITY;

-- Leitura: qualquer usuario autenticado (parceiro tambem abre caso novo).
DROP POLICY IF EXISTS tipos_beneficio_select ON tipos_beneficio;
CREATE POLICY tipos_beneficio_select ON tipos_beneficio
  FOR SELECT TO authenticated USING (true);

-- Escrita: so interno.
DROP POLICY IF EXISTS tipos_beneficio_insert ON tipos_beneficio;
CREATE POLICY tipos_beneficio_insert ON tipos_beneficio
  FOR INSERT TO authenticated WITH CHECK (is_interno());

DROP POLICY IF EXISTS tipos_beneficio_update ON tipos_beneficio;
CREATE POLICY tipos_beneficio_update ON tipos_beneficio
  FOR UPDATE TO authenticated USING (is_interno());

DROP POLICY IF EXISTS tipos_beneficio_delete ON tipos_beneficio;
CREATE POLICY tipos_beneficio_delete ON tipos_beneficio
  FOR DELETE TO authenticated USING (is_interno());

-- Seed com a lista atual (mesma ordem do dropdown de hoje).
INSERT INTO tipos_beneficio (nome, ordem) VALUES
  ('Aposentadoria por idade', 1),
  ('Aposentadoria por tempo de contribuição', 2),
  ('Aposentadoria especial', 3),
  ('Aposentadoria da PCD (LC 142/2013)', 4),
  ('Aposentadoria por incapacidade permanente', 5),
  ('Auxílio por incapacidade temporária', 6),
  ('Auxílio-acidente', 7),
  ('Pensão por morte', 8),
  ('Salário-maternidade', 9),
  ('BPC/LOAS', 10),
  ('Revisão da vida toda', 11),
  ('Revisão de aposentadoria', 12),
  ('Outro', 13)
ON CONFLICT (nome) DO NOTHING;

-- migration_tipos_documento_intake.sql
--
-- Acrescenta ao enum public.tipo_documento os 8 tipos que existiam SÓ no
-- staging, para que a classificação de documentos do PR #367 funcione em
-- produção.
--
-- Contexto (2026-09-19): os valores entraram no staging pela
-- migration_intake_trello.sql, que nunca rodou em produção e cujo arquivo foi
-- removido do repositório quando o intake do Trello foi revertido na `main`
-- (commits 8cd9d23 / 9ecf984, e depois o PR #365). Resultado: staging com 34
-- valores, produção com 26. O PR #367 voltou a oferecer os 8 tipos no front
-- (src/lib/documentos/tipos.ts e src/lib/doc-type-inference.ts) e, como
-- documentos.tipo e solicitacoes_documento.tipo são desse enum, subir a
-- staging para a main sem esta migration faria o salvamento desses documentos
-- falhar em produção com "invalid input value for enum tipo_documento".
--
-- `before 'senha_meu_inss'` reproduz a MESMA ordem do enum do staging: lá os 8
-- ficam entre 'declaracao_ausencia_duplicidade' e 'senha_meu_inss'. Sem isso,
-- os valores entrariam no fim e os dois ambientes divergiriam em qualquer
-- `order by` sobre a coluna.
--
-- Idempotente (`add value if not exists`): no staging é no-op, e reaplicar em
-- produção não faz nada.
--
-- ATENÇÃO: valor de enum NÃO tem volta — o Postgres não remove valor de enum.
-- Reverter exigiria recriar o tipo e reescrever as colunas que o usam.
--
-- Conferência depois de aplicar (em cada ambiente):
--   select count(*) from pg_enum e join pg_type t on t.oid = e.enumtypid
--    where t.typname = 'tipo_documento';           -- esperado: 34

alter type public.tipo_documento add value if not exists 'cnis_resumido'             before 'senha_meu_inss';
alter type public.tipo_documento add value if not exists 'laudo_inss'                before 'senha_meu_inss';
alter type public.tipo_documento add value if not exists 'pgr_ppra'                  before 'senha_meu_inss';
alter type public.tipo_documento add value if not exists 'termo_representacao'       before 'senha_meu_inss';
alter type public.tipo_documento add value if not exists 'autodeclaracao_veracidade' before 'senha_meu_inss';
alter type public.tipo_documento add value if not exists 'termo_renuncia_teto'       before 'senha_meu_inss';
alter type public.tipo_documento add value if not exists 'termo_responsabilidade'    before 'senha_meu_inss';
alter type public.tipo_documento add value if not exists 'cnpj_empregadora'          before 'senha_meu_inss';

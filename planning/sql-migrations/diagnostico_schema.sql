-- =============================================================================
-- Diagnostico de schema (somente leitura, nao altera nada)
-- Rodar no Supabase Studio > SQL Editor > New query > colar > Run
-- Copiar e colar de volta no chat o resultado das 3 queries.
-- =============================================================================

-- Query 1: tipos e estrutura de TODAS as colunas da tabela casos
select column_name,
       data_type,
       udt_name,
       is_nullable,
       column_default
  from information_schema.columns
 where table_schema = 'public'
   and table_name = 'casos'
 order by ordinal_position;

-- Query 2: valores aceitos por todos os enums do schema public
-- (cobre fase_caso, status_caso, tipo_documento, e qualquer outro)
select t.typname                                                  as enum_nome,
       array_agg(e.enumlabel order by e.enumsortorder)             as valores
  from pg_type t
  join pg_enum e on e.enumtypid = t.oid
  join pg_namespace n on n.oid = t.typnamespace
 where n.nspname = 'public'
 group by t.typname
 order by t.typname;

-- Query 3: colunas existentes em andamentos e documentos
-- (para confirmar se visivel_parceiro foi adicionada ou nao)
select table_name, column_name, data_type
  from information_schema.columns
 where table_schema = 'public'
   and table_name in ('andamentos', 'documentos', 'analises_tecnicas')
 order by table_name, ordinal_position;

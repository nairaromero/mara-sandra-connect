-- =============================================================================
-- Migration: adiciona coluna `tipo_personalizado` em public.documentos.
--
-- Uso: quando o usuario escolhe tipo='outro' no upload, ele tambem informa
-- um nome livre para o documento (ex.: "Cartao do INSS", "Decisao do MS").
-- Esse nome livre fica em tipo_personalizado. UI exibe esse nome no lugar
-- do label generico "Outro".
--
-- Compatibilidade: documentos antigos com tipo='outro' continuam validos
-- com tipo_personalizado=NULL (sem rename forcado).
--
-- Idempotente: pode rodar varias vezes.
-- =============================================================================

alter table public.documentos
  add column if not exists tipo_personalizado text;

comment on column public.documentos.tipo_personalizado is
  'Nome livre do documento quando tipo=outro. NULL para tipos padrao.';

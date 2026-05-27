-- =============================================================================
-- Migration: adicionar coluna fase em casos
-- Separa fase (etapa processual) de status (situacao atual).
-- Idempotente: pode rodar varias vezes.
-- Rodar no Supabase Studio: SQL Editor > New query > colar e Run.
-- =============================================================================

-- 1) Adicionar coluna fase com default
alter table public.casos
  add column if not exists fase text not null default 'analise';

-- 2) Garantir que valores antigos (caso existam) sejam validos antes do check
-- Se ja existia casos com fase = NULL ou valor invalido, normaliza para 'analise'
update public.casos
   set fase = 'analise'
 where fase is null
    or fase not in (
      'analise',
      'documentacao',
      'protocolo',
      'administrativo',
      'recurso_administrativo',
      'judicial',
      'concluido',
      'arquivado'
    );

-- 3) Check constraint para limitar aos 8 valores aceitos
-- Drop antes de criar para idempotencia
alter table public.casos
  drop constraint if exists casos_fase_check;

alter table public.casos
  add constraint casos_fase_check check (
    fase in (
      'analise',
      'documentacao',
      'protocolo',
      'administrativo',
      'recurso_administrativo',
      'judicial',
      'concluido',
      'arquivado'
    )
  );

-- 4) Indice para filtros por fase
create index if not exists idx_casos_fase
  on public.casos (fase);

-- =============================================================================
-- Mapeamento sugerido fase x status (apenas referencia, nao automatico):
--
-- fase = 'analise'                -> status = 'em_analise' | 'em_revisao'
-- fase = 'documentacao'           -> status = 'aguardando_documentos'
-- fase = 'protocolo'              -> status = 'em_andamento'
-- fase = 'administrativo'         -> status = 'em_andamento'
-- fase = 'recurso_administrativo' -> status = 'em_andamento' | 'em_revisao'
-- fase = 'judicial'               -> status = 'em_andamento'
-- fase = 'concluido'              -> status = 'concluido_exito' | 'concluido_sem_exito'
-- fase = 'arquivado'              -> status = 'arquivado'
-- =============================================================================

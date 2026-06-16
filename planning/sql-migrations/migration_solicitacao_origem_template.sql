-- =============================================================================
-- Migration: amplia o check constraint de solicitacoes_documento.origem
--             pra aceitar valores "template:<nome>".
--
-- O constraint original só aceitava 'interna' ou 'externa'. Com a feature
-- de templates criando solicitações automaticamente (destino=
-- solicitacao_documento), precisamos rastrear a origem do template (ex:
-- "template:exigencia") pra que o trigger trg_solicitacao_atendida_cria_tarefa
-- possa criar uma tarefa quando o parceiro responder.
--
-- Idempotente.
-- =============================================================================

alter table public.solicitacoes_documento
  drop constraint if exists solicitacoes_documento_origem_check;

alter table public.solicitacoes_documento
  add constraint solicitacoes_documento_origem_check
  check (
    origem in ('interna', 'externa')
    or origem like 'template:%'
  );

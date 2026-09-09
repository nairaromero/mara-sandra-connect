-- =============================================================================
-- Migration: cumprimento de exigência aceita VÁRIOS documentos
-- (feedback dos parceiros via Naira, 2026-08-26).
--
-- Antes o vínculo era 1:1 (solicitacoes_documento.documento_id). Agora cada
-- documento aponta pra solicitação que ele cumpre (N:1), e o parceiro sobe
-- quantos arquivos precisar (frente/verso, várias páginas). documento_id
-- continua existindo por compatibilidade (aponta pro primeiro).
--
-- Idempotente.
-- =============================================================================

alter table public.documentos
  add column if not exists solicitacao_id uuid
    references public.solicitacoes_documento(id) on delete set null;

create index if not exists idx_documentos_solicitacao
  on public.documentos (solicitacao_id)
  where solicitacao_id is not null;

-- Backfill: documentos que já eram o anexo 1:1 de uma solicitação.
update public.documentos d
   set solicitacao_id = s.id
  from public.solicitacoes_documento s
 where s.documento_id = d.id
   and d.solicitacao_id is null;

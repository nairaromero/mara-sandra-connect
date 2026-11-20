-- ============================================================================
-- ZapSign: contrato gerado a partir de um MODELO da conta do escritório (#522)
--
-- O envio que nasce de um modelo não tem arquivo no caso (`documento_id` nulo):
-- a linha passa a guardar de qual modelo veio e com que tipo o PDF assinado
-- entra nos documentos do caso.
--   · modelo_token   — o modelo do ZapSign (para "um envio em curso por modelo
--                      e caso": clique repetido não gasta a cota);
--   · tipo_documento — tipo do PDF assinado quando não há arquivo original de
--                      quem herdar (`contrato_honorarios`, `procuracao`…).
-- Idempotente.
-- ============================================================================
alter table public.assinaturas add column if not exists modelo_token text;
alter table public.assinaturas add column if not exists tipo_documento text;

-- A lista é a `EM_CURSO` de _shared/assinatura.ts (a régua zapsign-fonte-unica confere).
create unique index if not exists assinaturas_um_em_curso_por_modelo
  on public.assinaturas (caso_id, modelo_token)
  where modelo_token is not null and status in ('enviando', 'enviado', 'aberto', 'gravando');

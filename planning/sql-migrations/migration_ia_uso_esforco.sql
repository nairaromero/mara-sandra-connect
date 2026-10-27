-- =============================================================================
-- Migration: o registro de uso da IA grava o esforço pedido ao provedor.
--
-- Desde o "esforço por tarefa" (ESFORCO_POR_TAREFA em
-- supabase/functions/_shared/ia-providers.ts) cada função de IA pede o seu
-- nível (low/medium/high). Esta coluna é o que permite MEDIR antes de mudar um
-- nível: tokens, tempo e cortes por função e por esforço, lado a lado.
-- Nulo = o modelo não recebe esforço (OpenAI, Haiku 4.5, raciocínio desligado).
--
-- Idempotente. Local primeiro; staging e produção só com aval.
-- =============================================================================

alter table public.ia_uso add column if not exists esforco text;

alter table public.ia_uso drop constraint if exists ia_uso_esforco_check;
alter table public.ia_uso add constraint ia_uso_esforco_check
  check (esforco is null or esforco in ('low', 'medium', 'high'));

comment on column public.ia_uso.esforco is
  'Esforço pedido ao provedor (low/medium/high, ESFORCO_POR_TAREFA). Nulo: o modelo não recebe esforço.';

-- =============================================================================
-- Migration: adiciona 3 valores novos ao enum tipo_documento
--   - substabelecimento
--   - declaracao_hipossuficiencia
--   - declaracao_ausencia_duplicidade
--
-- Esses tipos ficam no grupo 3 da UI (Procuracao/Substabelecimento/Declaracoes).
--
-- Importante: ALTER TYPE ... ADD VALUE precisa ser rodado fora de transacao.
-- No Supabase SQL Editor isso e o comportamento padrao (auto-commit).
--
-- Idempotente: usa IF NOT EXISTS, pode rodar varias vezes.
-- =============================================================================

alter type tipo_documento add value if not exists 'substabelecimento';
alter type tipo_documento add value if not exists 'declaracao_hipossuficiencia';
alter type tipo_documento add value if not exists 'declaracao_ausencia_duplicidade';

-- =============================================================================
-- Migration: onboarding de parceiro + aceite de termos LGPD.
--
-- Por que existe:
--   - Hoje quando o parceiro recebe o convite e clica no link, ele cai
--     direto no /casos sem nenhuma orientacao do que pode fazer.
--   - Tambem nao temos registro de aceite dos termos LGPD pelo parceiro,
--     o que e um problema de conformidade.
--
-- Como funciona:
--   - Adiciona usuarios.onboarded_em (quando o usuario completou o boas-vindas)
--   - Adiciona usuarios.aceitou_termos_em (quando aceitou termos LGPD)
--   - Auto-marca internos como onboarded (eles ja conhecem o sistema)
--
-- Idempotente.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Novas colunas em usuarios
-- ---------------------------------------------------------------------------
alter table public.usuarios
  add column if not exists onboarded_em timestamptz;

alter table public.usuarios
  add column if not exists aceitou_termos_em timestamptz;

comment on column public.usuarios.onboarded_em is
  'Quando o usuario completou a tela de boas-vindas. Null = ainda nao viu.
   Usado pra redirecionar parceiros para /boas-vindas no primeiro login.';

comment on column public.usuarios.aceitou_termos_em is
  'Quando o usuario aceitou os termos de uso e politica de privacidade.
   Obrigatorio para conformidade LGPD. Setado junto com onboarded_em.';

-- ---------------------------------------------------------------------------
-- Backfill: internos ja estao "onboarded" (eles sao a equipe do escritorio).
-- Nao marca aceitou_termos_em pra manter consistencia juridica - se quisermos
-- registrar aceite dos internos isso deve ser feito explicitamente.
-- ---------------------------------------------------------------------------
update public.usuarios
   set onboarded_em = coalesce(onboarded_em, now())
 where tipo = 'interno'
   and onboarded_em is null;

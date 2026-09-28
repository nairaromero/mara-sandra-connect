-- ============================================================================
-- RBAC 11 · QG exige verificação em duas etapas (2026-09-23)
--
-- O mecanismo já existia (private.exigir_staff confere auth.jwt()->>'aal'
-- quando app_config.qg_exigir_aal2 = 'true'); faltava a tela de cadastro do
-- autenticador e a etapa do código (front). Aqui: a chave nasce LIGADA onde
-- ainda não existe (staging/produção). No local o seed (seed-local-rbac.mjs)
-- grava 'false' logo depois, para dar para testar sem autenticador; para
-- ensaiar a exigência no local: update app_config set valor='true' where
-- chave='qg_exigir_aal2'. Pré-requisito no Supabase: MFA TOTP habilitado no
-- Auth do projeto (Authentication → Multi-factor). Idempotente.
-- ============================================================================

insert into public.app_config (chave, valor)
values ('qg_exigir_aal2', 'true')
on conflict (chave) do nothing;

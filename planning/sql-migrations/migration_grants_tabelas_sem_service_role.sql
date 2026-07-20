-- migration_grants_tabelas_sem_service_role.sql
--
-- Gotcha conhecido: tabela criada via Management API (supabase db query) NAO
-- recebe os grants default do Supabase. Resultado: edge functions com
-- service_role levam "permission denied" silencioso ao inserir, mesmo
-- bypassando RLS. Auditoria de 2026-07-20 encontrou 9 tabelas nesse estado
-- (has_table_privilege('service_role', ..., 'INSERT') = false).
--
-- authenticated recebe DML tambem (padrao Supabase); RLS continua gateando.
-- Idempotente: GRANT repetido e no-op.

grant all on table public.aceites_termos       to service_role;
grant all on table public.acessos_documento    to service_role;
grant all on table public.clientes_etiquetas   to service_role;
grant all on table public.etiquetas            to service_role;
grant all on table public.leads                to service_role;
grant all on table public.webhook_config       to service_role;
grant all on table public.webhook_destinos     to service_role;
grant all on table public.webhook_eventos      to service_role;
grant all on table public.whatsapp_outbox      to service_role;

grant select, insert, update, delete on table public.aceites_termos     to authenticated;
grant select, insert, update, delete on table public.acessos_documento  to authenticated;
grant select, insert, update, delete on table public.clientes_etiquetas to authenticated;
grant select, insert, update, delete on table public.etiquetas          to authenticated;
grant select, insert, update, delete on table public.leads              to authenticated;
grant select, insert, update, delete on table public.webhook_config     to authenticated;
grant select, insert, update, delete on table public.webhook_destinos   to authenticated;
grant select, insert, update, delete on table public.webhook_eventos    to authenticated;
grant select, insert, update, delete on table public.whatsapp_outbox    to authenticated;

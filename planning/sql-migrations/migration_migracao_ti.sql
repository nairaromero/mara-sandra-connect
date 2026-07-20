-- migration_migracao_ti.sql
--
-- Suporte à migração total do Tramitação Inteligente (TI):
--   1. clientes.ti_dados — payload completo do cliente no TI (35 campos:
--      RG, CNH, sexo, dados dos pais, endereço detalhado etc.). Nada se
--      perde mesmo sem coluna dedicada; campos podem ser promovidos depois.
--   2. tarefas.origem passa a aceitar 'migracao_ti' (tarefas/perícias
--      extraídas do TI na fase 2 da migração).
--   3. Índice único parcial em andamentos por ti_nota_id — garante que
--      re-execuções do script de migração / sync-ti-todos nunca dupliquem
--      nota importada (verificado em 2026-07-20: sem duplicatas existentes).
--
-- Idempotente.

alter table public.clientes
  add column if not exists ti_dados jsonb;

comment on column public.clientes.ti_dados is
  'Payload completo do cliente no Tramitação Inteligente (GET /clientes). Fonte: migração/sync TI.';

alter table public.tarefas drop constraint if exists tarefas_origem_check;
alter table public.tarefas add constraint tarefas_origem_check
  check (origem in ('manual','template','sync_inss_email','sync_djen','sync_legalmail','migracao_ti'));

create unique index if not exists andamentos_ti_nota_id_uniq
  on public.andamentos ((metadata->>'ti_nota_id'))
  where origem = 'tramitacao' and metadata->>'ti_nota_id' is not null;

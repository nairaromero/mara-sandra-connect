# Deploy do lote kanban do parceiro + radar de prazos → PRODUÇÃO

Checklist do finding 1 do code review (2026-09-01): o front deste lote
**depende** de objetos de banco que só existem no staging (`prazo_at`,
`agenda_do_parceiro(p_desde)`, `casos_sem_proximo_passo`, triggers do radar).
Conferido ao vivo em 2026-09-01: a produção **não tem nenhum deles** e o
fallback antigo (`pericias_do_parceiro` no front) foi removido. Merge antes
das migrations = kanban e Agenda do parceiro quebrados em produção
(vídeo `finding-1-prod-sem-migrations.mp4`).

## Ordem (TUDO antes do merge staging→main)

1. Migrations, **nesta ordem** (todas idempotentes; a `prazo` não recria mais
   o overload zero-arg — finding 6):

   ```bash
   node scripts/msc-sql.mjs --file planning/sql-migrations/migration_radar_caso_sem_proximo_passo.sql
   node scripts/msc-sql.mjs --file planning/sql-migrations/migration_radar_judicial_gatilhos_publicacao.sql
   node scripts/msc-sql.mjs --file planning/sql-migrations/migration_tarefas_parceiro_prazo.sql
   node scripts/msc-sql.mjs --file planning/sql-migrations/migration_tarefas_parceiro_correcoes.sql
   node scripts/msc-sql.mjs --file planning/sql-migrations/migration_requerimento_adm_e_desfechos.sql
   node scripts/msc-sql.mjs --file planning/sql-migrations/migration_fix_review_trigger_prazos.sql
   ```

2. Edge function (o processor ganhou o recuo de fim de semana no prazo −3 e o
   dedup cruzado com o botão de desfecho — findings 8 e 5):

   ```bash
   bunx supabase functions deploy inss-email-processor --no-verify-jwt --project-ref llugytkdsfsrciavhrfw
   ```

3. Conferências pós-migration na produção (deploy verde ≠ funcionando):
   - `select proname, pronargs from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and proname='agenda_do_parceiro';`
     → **exatamente 1 linha, pronargs = 1**.
   - `explain (costs off) select 1 from tarefas t where t.origem='sync_djen' and t.origem_ref='andamento:00000000-0000-0000-0000-000000000000:acionavel';`
     → **Index Only Scan** (finding 9).
   - Nenhum prazo pendente de exigência em fim de semana:
     `select count(*) from solicitacoes_documento where origem='template:exigencia' and status='pendente' and extract(dow from (prazo_at at time zone 'America/Sao_Paulo')::date) in (0,6);` → 0.
   - `cron.job_run_details` do `enviar_lembretes_solicitacao` no dia seguinte.

4. Só então: merge `staging → main` (merge commit) e validar
   marasandraconnect.com com conta de parceiro real.

Aviso herdado do review: no primeiro run do cron de lembretes em produção,
conferir se alguma solicitação antiga entrou no balde `0d` com prazo já
vencido (mecanismo sem guarda; hoje 0 linhas na prod se enquadram).

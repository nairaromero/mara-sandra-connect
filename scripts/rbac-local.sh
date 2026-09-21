#!/usr/bin/env bash
# RBAC multi-tenant no ambiente LOCAL: aplica as migrations e o seed.
#
#   bun run local:copiar   # banco local = cópia do staging (antes, se quiser zerar)
#   bun run local:rbac     # este script
#
# Enquanto as migration_rbac_0* não estiverem no staging, a cópia local nasce
# sem elas — por isso este passo existe. Idempotente: pode rodar de novo.
set -euo pipefail
cd "$(dirname "$0")/.."

for m in 01_modelo_acesso 02_escritorio_id 03_isolamento 04_rpcs 05_qg; do
  echo "==> migration_rbac_$m"
  node scripts/msc-sql.mjs --local --file "planning/sql-migrations/migration_rbac_$m.sql" | tail -n 3
done

echo "==> seed (QG, escritório canário, uma conta por papel)"
node scripts/seed-local-rbac.mjs

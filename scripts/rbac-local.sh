#!/usr/bin/env bash
# RBAC multi-tenant no ambiente LOCAL: o seed (e as migrations, se faltarem).
#
#   bun run local:copiar   # banco local = cópia do staging
#   bun run local:rbac     # este script
#
# Desde 24/09 as migration_rbac_* estão NO STAGING, então `local:copiar` já traz
# o modelo inteiro (schema `private` incluído, ver o `-n private` do pg_dump).
# Reaplicar a 01 por cima quebra — a 20 e a 21 mudaram o tipo de retorno de
# `minhas_permissoes` e `meu_contexto`, e o Postgres recusa com "cannot change
# return type of existing function" (27/09).
#
# Então: aplica as migrations SÓ se o banco local não tiver o modelo, e sempre
# roda o seed, que é o que cria o escritório Canário, as contas por papel e os
# ajustes que só existem no local (`qg_exigir_aal2=false`, `qg_carencia_dias=0`
# — sem eles as specs do QG batem na carência de 30 dias, que é a regra real de
# produção). Idempotente: pode rodar de novo.
set -euo pipefail
cd "$(dirname "$0")/.."

tem_papeis=$(node scripts/msc-sql.mjs --local \
  "select (select count(*) from pg_tables where schemaname = 'public' and tablename = 'papeis')::int as n" \
  2>/dev/null | grep -o '"n": *[0-9]*' | grep -o '[0-9]*' || echo 0)

if [ "${tem_papeis:-0}" = "0" ]; then
  echo "==> banco local sem o modelo de acesso: aplicando as migrations do RBAC"
  for m in 01_modelo_acesso 02_escritorio_id 03_isolamento 04_rpcs 05_qg 06_qg_paginacao 07_suporte_escritorio \
           08_excluir_so_admin 09_integracoes_por_escritorio 10_marca_por_escritorio 11_qg_aal2 \
           12_mcp_para_terceiro 13_integracoes_status 14_whatsapp_outbox_por_escritorio \
           15_escrita_so_por_funcao 16_notificacao_e_comentario 17_rpc_com_permissao \
           18_solicitacoes_e_alertas 19_ticket_de_suporte 20_permissoes_por_pessoa \
           21_contexto_efetivo 22_papel_limpa_ajustes 23_membro_pode 24_auditoria_por_permissao; do
    echo "==> migration_rbac_$m"
    node scripts/msc-sql.mjs --local --file "planning/sql-migrations/migration_rbac_$m.sql" | tail -n 3
  done
else
  echo "==> o modelo de acesso já veio na cópia do staging (pulando as migrations)"
fi

echo "==> seed (QG, escritório canário, uma conta por papel, ajustes do local)"
node scripts/seed-local-rbac.mjs

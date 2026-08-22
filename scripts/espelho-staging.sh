#!/usr/bin/env bash
# Espelha PRODUÇÃO -> STAGING com anonimização (ver planning/AMBIENTES.md).
#
# Uso:  bash scripts/espelho-staging.sh
# Credenciais lidas do .env.local (ou do ambiente, em CI):
#   SUPABASE_DB_PASSWORD     senha do Postgres de PRODUÇÃO
#   STAGING_DB_PASSWORD      senha do Postgres de STAGING
#   STAGING_SYNTH_PASSWORD   senha única dos usuários sintéticos do staging
#
# Passos: dump (produção, só dados, JÁ excluindo tabelas sensíveis que nunca
# saem de prod) -> truncate staging -> restore -> anonimizar-staging.sql.
# Documentos do Storage NÃO são copiados (linhas de `documentos` ficam, o
# download falha graciosamente no staging).
set -euo pipefail
export PATH="/opt/homebrew/opt/libpq/bin:$PATH"

PROD_REF="llugytkdsfsrciavhrfw"
STG_REF="alhqbpbekmxpoibrrnbi"
POOLER_PROD="aws-1-sa-east-1.pooler.supabase.com"
POOLER_STG="aws-0-sa-east-1.pooler.supabase.com"

env_local() { grep "^$1=" .env.local 2>/dev/null | head -1 | cut -d= -f2-; }
PROD_PW="${SUPABASE_DB_PASSWORD:-$(env_local SUPABASE_DB_PASSWORD)}"
STG_PW="${STAGING_DB_PASSWORD:-$(env_local STAGING_DB_PASSWORD)}"
SYNTH_PW="${STAGING_SYNTH_PASSWORD:-$(env_local STAGING_SYNTH_PASSWORD)}"
[ -n "$PROD_PW" ] || { echo "SUPABASE_DB_PASSWORD ausente"; exit 1; }
[ -n "$STG_PW" ] || { echo "STAGING_DB_PASSWORD ausente"; exit 1; }
[ -n "$SYNTH_PW" ] || { echo "STAGING_SYNTH_PASSWORD ausente"; exit 1; }

enc() { python3 -c "import urllib.parse,sys; print(urllib.parse.quote(sys.argv[1], safe=''))" "$1"; }
PROD_URL="postgresql://postgres.${PROD_REF}:$(enc "$PROD_PW")@${POOLER_PROD}:5432/postgres"
STG_URL="postgresql://postgres.${STG_REF}:$(enc "$STG_PW")@${POOLER_STG}:5432/postgres"

DUMP="$(mktemp -d)/espelho.dump"
trap 'rm -rf "$(dirname "$DUMP")"' EXIT

# Tabelas sensíveis que NUNCA saem de produção (minimização na origem).
EXCLUIR=(ia_integracoes ia_tokens ia_acoes usuario_gmail_oauth aceites_termos
  acessos_documento acessos_senha_inss alertas_duplicidade mensagens
  webhook_eventos whatsapp_mensagens whatsapp_outbox whatsapp_sessoes
  whatsapp_lid_map whatsapp_ativacao_codigos)
EXCL_ARGS=()
for t in "${EXCLUIR[@]}"; do EXCL_ARGS+=(--exclude-table-data "public.$t"); done

echo "==> 1/4 dump de produção (só dados, public, sem tabelas sensíveis)…"
pg_dump "$PROD_URL" -n public --data-only "${EXCL_ARGS[@]}" -f "$DUMP"
echo "    $(du -h "$DUMP" | cut -f1)"

echo "==> 2/4 limpando staging…"
# Ordem importa: public primeiro (esvazia as referências), depois auth —
# o delete de auth.users cascateia em public.usuarios já vazio.
psql "$STG_URL" -q -v ON_ERROR_STOP=1 -c "
do \$\$ declare r record; begin
  for r in select tablename from pg_tables where schemaname='public' loop
    execute format('truncate table public.%I cascade', r.tablename);
  end loop;
  delete from auth.identities;
  delete from auth.users;
end \$\$;"

echo "==> 3/4 restore no staging…"
# session_replication_role=replica desliga triggers (inclusive FK) na sessão —
# postgres gerenciado não permite DISABLE TRIGGER ALL de pg_restore.
{ echo "set session_replication_role = replica;"; cat "$DUMP"; } |
  psql "$STG_URL" -q -v ON_ERROR_STOP=1 -o /dev/null

echo "==> 4/4 anonimizando…"
psql "$STG_URL" -q -v ON_ERROR_STOP=1 -v senha_sintetica="$SYNTH_PW" \
  -f "$(dirname "$0")/anonimizar-staging.sql"

# O passo 2 apagou auth.users e o 4 recriou só quem existe em produção. As
# contas sintéticas de papel (e2e+admin/interno/parceiro) não existem lá —
# recria aqui. Precisa de STAGING_SERVICE_ROLE_KEY e STAGING_PUBLISHABLE_KEY
# (no .env.local ou como secret do workflow); sem elas, avisa e segue.
echo "==> 5/5 contas sintéticas de papel…"
if command -v node >/dev/null 2>&1; then
  node "$(dirname "$0")/seed-staging-contas.mjs" || echo "AVISO: seed de contas falhou — rode `node scripts/seed-staging-contas.mjs` à mão."
else
  echo "AVISO: node ausente — rode `node scripts/seed-staging-contas.mjs` à mão."
fi

echo "==> Espelho concluído: $(date '+%Y-%m-%d %H:%M')"

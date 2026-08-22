#!/usr/bin/env bash
# Espelha PRODUÇÃO -> STAGING com anonimização (ver planning/AMBIENTES.md).
#
# Uso:  bash scripts/espelho-staging.sh
# Credenciais lidas do .env.local (ou do ambiente, em CI):
#   ESPELHO_LEITURA_PASSWORD senha do role espelho_leitura em PRODUÇÃO — só
#                            SELECT (migration_espelho_role_leitura). A senha
#                            do Postgres de produção NÃO é usada aqui.
#   STAGING_DB_PASSWORD      senha do Postgres de STAGING
#   STAGING_SYNTH_PASSWORD   senha única dos usuários sintéticos do staging
#
# Travas: aborta se a conexão de produção não for espelho_leitura, se alguma
# tabela com RLS em produção estiver sem a policy do espelho, ou se o banco de
# destino não tiver o marcador `comment on schema public is 'ambiente=staging'`.
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
# Produção: role SÓ DE LEITURA (migration_espelho_role_leitura). Não é a senha
# do Postgres de produção — esta credencial não consegue escrever nada lá.
PROD_PW="${ESPELHO_LEITURA_PASSWORD:-$(env_local ESPELHO_LEITURA_PASSWORD)}"
STG_PW="${STAGING_DB_PASSWORD:-$(env_local STAGING_DB_PASSWORD)}"
SYNTH_PW="${STAGING_SYNTH_PASSWORD:-$(env_local STAGING_SYNTH_PASSWORD)}"
[ -n "$PROD_PW" ] || { echo "ESPELHO_LEITURA_PASSWORD ausente"; exit 1; }
[ -n "$STG_PW" ] || { echo "STAGING_DB_PASSWORD ausente"; exit 1; }
[ -n "$SYNTH_PW" ] || { echo "STAGING_SYNTH_PASSWORD ausente"; exit 1; }

enc() { python3 -c "import urllib.parse,sys; print(urllib.parse.quote(sys.argv[1], safe=''))" "$1"; }
PROD_URL="postgresql://espelho_leitura.${PROD_REF}:$(enc "$PROD_PW")@${POOLER_PROD}:5432/postgres"
STG_URL="postgresql://postgres.${STG_REF}:$(enc "$STG_PW")@${POOLER_STG}:5432/postgres"

# ---- Travas antes de qualquer coisa ---------------------------------------
# (a) Em produção só entramos como espelho_leitura (SELECT, nada mais).
quem_prod="$(psql "$PROD_URL" -tAXc "select current_user")"
[ "$quem_prod" = "espelho_leitura" ] || { echo "ABORTANDO: conexão de produção não é espelho_leitura (é '$quem_prod')"; exit 1; }
# (b) Toda tabela com RLS em produção precisa da policy do espelho; sem ela o
#     pg_dump --enable-row-security traria a tabela VAZIA em silêncio.
sem_policy="$(psql "$PROD_URL" -tAXc "
  select string_agg(c.relname, ', ')
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind in ('r','p') and c.relrowsecurity
     and not exists (select 1 from pg_policies p where p.schemaname = 'public'
                       and p.tablename = c.relname and p.policyname = 'espelho_leitura_select')")"
[ -z "$sem_policy" ] || { echo "ABORTANDO: tabela(s) com RLS sem policy espelho_leitura_select em produção: $sem_policy — rode migration_espelho_role_leitura.sql de novo"; exit 1; }
# (c) O alvo DESTRUTIVO (truncate/restore) tem que se declarar staging. O
#     marcador é o comentário do schema public, que nem dump --data-only nem
#     truncate tocam: `comment on schema public is 'ambiente=staging'`.
marcador_stg="$(psql "$STG_URL" -tAXc "select coalesce(obj_description('public'::regnamespace, 'pg_namespace'), '')")"
[ "$marcador_stg" = "ambiente=staging" ] || { echo "ABORTANDO: o banco de destino não está marcado como staging (marcador='$marcador_stg')"; exit 1; }
echo "==> travas ok: produção como '$quem_prod' (só leitura), destino marcado '$marcador_stg'"

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
# --enable-row-security: o role não tem BYPASSRLS (Supabase não deixa); ele
# enxerga tudo pelas policies espelho_leitura_select (conferidas acima).
pg_dump "$PROD_URL" -n public --data-only --enable-row-security "${EXCL_ARGS[@]}" -f "$DUMP"
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

echo "==> Espelho concluído: $(date '+%Y-%m-%d %H:%M')"

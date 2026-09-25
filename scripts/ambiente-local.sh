#!/usr/bin/env bash
# Ambiente LOCAL isolado: cópia do STAGING num Supabase local (Docker).
# Ver planning/AMBIENTES.md ("Ambiente local").
#
# Uso (pelos atalhos do package.json):
#   bun run local:copiar   início de TODA implementação/conserto: sobe a pilha
#                          local e recria o banco local como cópia do staging
#   bun run dev:local      app (vite :8080) no banco local
#   bun run e2e:local      suíte E2E no banco local (vite próprio na :8095)
#   bun run local:parar    desliga a pilha (os containers param; nada é apagado)
#   bash scripts/ambiente-local.sh status
#
# Migration nova: `node scripts/msc-sql.mjs --local --file <arq>` primeiro,
# depois --staging, depois produção.
#
# Isolamento — o que roda local NÃO alcança staging nem produção:
#   - o app e a suíte recebem a URL e as chaves da pilha local (VITE_* no
#     ambiente vencem o .env.local);
#   - app_config.edge_base_url passa a apontar pras edge functions LOCAIS
#     (senão os triggers do banco local chamariam as do staging);
#   - as edge functions locais só têm as variáveis que a pilha injeta
#     (SUPABASE_URL etc. da própria pilha): sem chave de IA, Resend, WhatsApp.
#     Quem quiser testar uma integração de verdade põe a chave em
#     supabase/functions/.env (gitignored; lido quando a pilha sobe — parar e
#     subir de novo) — e sabe que a chamada sai da máquina;
#   - e-mail do Auth local cai no Mailpit (http://127.0.0.1:55324).
#
# Cópia (subcomando `copiar`):
#   Leitura do staging com credencial TEMPORÁRIA da Management API
#   (cli/login-role, vale 5 min) em sessão read-only — o script não consegue
#   escrever no staging. Não precisa da senha do Postgres do staging, só do
#   SUPABASE_ACCESS_TOKEN do .env.local.
#   Travas: a origem tem que ser o projeto de staging E ter o marcador
#   `ambiente=staging`; o destino é sempre 127.0.0.1:55322 (pilha local deste
#   projeto) e, antes de apagar, não pode estar marcado como outro ambiente.
#   Passos: coleta (auth/storage/vault/extras) + pg_dump (esquema e dados de
#   public e ops) -> reset do banco local -> restore -> ajustes locais ->
#   conferência (linhas por tabela, login, edge function).
#   Não copia: arquivos do Storage (os buckets sim; download de documento
#   antigo falha, igual no staging), sessões do Auth, cron (o staging não tem).
set -euo pipefail
export PATH="/opt/homebrew/opt/libpq/bin:$PATH"
cd "$(dirname "$0")/.."

PROD_REF="llugytkdsfsrciavhrfw"
STG_REF="alhqbpbekmxpoibrrnbi"
POOLER_STG="aws-0-sa-east-1.pooler.supabase.com"
# Pilha local deste projeto (portas em supabase/config.toml).
LOCAL_DB_URL="postgresql://postgres:postgres@127.0.0.1:55322/postgres"
PORTA_APP=8080
PORTA_E2E="${PORTA_E2E:-8095}"   # outra sessão na 8095? PORTA_E2E=8097 bun run e2e:local
# Os triggers chamam edge functions de DENTRO do container do banco: o
# endereço é o do gateway na rede do Docker, não o 127.0.0.1 da máquina.
EDGE_BASE_URL_LOCAL="http://kong:8000/functions/v1"

env_local() { grep "^$1=" .env.local 2>/dev/null | head -1 | cut -d= -f2-; }
falha() { echo "ABORTANDO: $*" >&2; exit 1; }

supabase_cli() { bunx supabase "$@"; }

# Lê URL e chaves da pilha local já no ar. Sai com erro se não estiver.
carregar_pilha() {
  local json
  json="$(supabase_cli status -o json 2>/dev/null)" || return 1
  eval "$(printf '%s' "$json" | python3 -c '
import json, shlex, sys
d = json.load(sys.stdin)
for k in ("API_URL", "DB_URL", "ANON_KEY", "SERVICE_ROLE_KEY", "STUDIO_URL", "MAILPIT_URL"):
    print("PILHA_" + k + "=" + shlex.quote(d.get(k) or str()))
')"
  # A pilha tem que ser a deste projeto, nas portas do supabase/config.toml.
  [ "$PILHA_DB_URL" = "$LOCAL_DB_URL" ] || falha "a pilha local respondeu com outro banco ($PILHA_DB_URL)"
  LOCAL_API_URL="$PILHA_API_URL"
  LOCAL_ANON_KEY="$PILHA_ANON_KEY"
  LOCAL_SERVICE_ROLE_KEY="$PILHA_SERVICE_ROLE_KEY"
  LOCAL_STUDIO_URL="$PILHA_STUDIO_URL"
  LOCAL_MAILPIT_URL="$PILHA_MAILPIT_URL"
  case "$LOCAL_API_URL" in
    http://127.0.0.1:*|http://localhost:*) ;;
    *) falha "a pilha local respondeu com API_URL fora da máquina ($LOCAL_API_URL)" ;;
  esac
}

marcador_local() {
  psql "$LOCAL_DB_URL" -tAXc "select coalesce(obj_description('public'::regnamespace, 'pg_namespace'), '')"
}

# O app e a suíte só rodam em cima de uma cópia feita por este script.
exigir_copia() {
  carregar_pilha || falha "a pilha local não está no ar — rode: bun run local:copiar"
  [ "$(marcador_local)" = "ambiente=local" ] || falha "o banco local ainda não é uma cópia do staging — rode: bun run local:copiar"
}

# Credencial temporária (5 min) do Postgres do STAGING via Management API.
# Pedida de novo antes de cada conexão: cada pedido renova a senha.
credencial_staging() {
  [ "$STG_REF" != "$PROD_REF" ] || falha "STG_REF aponta pra produção"
  local token resposta
  token="${SUPABASE_ACCESS_TOKEN:-$(env_local SUPABASE_ACCESS_TOKEN)}"
  [ -n "$token" ] || falha "SUPABASE_ACCESS_TOKEN ausente no .env.local"
  resposta="$(curl -sf -X POST "https://api.supabase.com/v1/projects/${STG_REF}/cli/login-role" \
    -H "Authorization: Bearer $token" -H "Content-Type: application/json" \
    -d '{"read_only": false}')" || falha "Management API recusou a credencial temporária do staging"
  PGPASSWORD="$(printf '%s' "$resposta" | python3 -c 'import json,sys; print(json.load(sys.stdin)["password"])')"
  export PGPASSWORD
  STG_CONN="host=${POOLER_STG} port=5432 dbname=postgres user=cli_login_postgres.${STG_REF} sslmode=require"
}

# psql no staging como postgres e SEM poder escrever (transação read-only).
psql_staging() {
  psql "$STG_CONN" -X -v ON_ERROR_STOP=1 -c "set role postgres" -c "set default_transaction_read_only = on" "$@"
}

psql_local() { PGOPTIONS='-c client_min_messages=warning' psql "$LOCAL_DB_URL" -X -q -v ON_ERROR_STOP=1 "$@"; }

cmd_copiar() {
  command -v docker >/dev/null && docker info >/dev/null 2>&1 || falha "Docker não está rodando"
  command -v pg_dump >/dev/null || falha "pg_dump ausente (brew install libpq)"
  local synth_pw
  synth_pw="${STAGING_SYNTH_PASSWORD:-$(env_local STAGING_SYNTH_PASSWORD)}"
  [ -n "$synth_pw" ] || falha "STAGING_SYNTH_PASSWORD ausente no .env.local"

  echo "==> 1/6 pilha local…"
  if ! carregar_pilha; then
    supabase_cli start
    carregar_pilha || falha "a pilha local não subiu"
  fi

  # ---- Travas ------------------------------------------------------------
  credencial_staging
  local marcador_stg marcador_dst
  marcador_stg="$(psql_staging -tA -c "select coalesce(obj_description('public'::regnamespace, 'pg_namespace'), '')" | tail -1)"
  [ "$marcador_stg" = "ambiente=staging" ] || falha "a origem não está marcada como staging (marcador='$marcador_stg')"
  marcador_dst="$(marcador_local)"
  case "$marcador_dst" in
    "ambiente=local"|"standard public schema"|"") ;;
    *) falha "o banco em 127.0.0.1:55322 está marcado como '$marcador_dst' — não é a pilha local deste projeto" ;;
  esac
  echo "==> travas ok: origem '$marcador_stg' ($STG_REF, só leitura), destino local"

  # A coleta traz segredos do vault do staging: o diretório é 700 e some no fim.
  dir="$(mktemp -d)"
  trap 'rm -rf "$dir"' EXIT

  echo "==> 2/6 lendo o staging (coleta + esquema + dados)…"
  cat > "$dir/coleta.sql" <<'SQL'
\pset tuples_only on
\pset format unaligned
\o :arq_extras
-- Roles citados em GRANT/policy que a pilha local não tem (ex.: espelho_leitura).
select format('do $x$ begin if not exists (select from pg_roles where rolname = %L) then create role %I nologin; end if; end $x$;', rolname, rolname)
  from pg_roles
 where rolname !~ '^(pg_|cli_login_)' and rolname not in (
   'postgres','anon','authenticated','service_role','authenticator','dashboard_user','pgbouncer',
   'supabase_admin','supabase_auth_admin','supabase_functions_admin','supabase_read_only_user',
   'supabase_realtime_admin','supabase_replication_admin','supabase_storage_admin','supabase_etl_admin',
   'supabase_privileged_role','pgsodium_keyholder','pgsodium_keyiduser','pgsodium_keymaker');
select format('create extension if not exists %I with schema %I;', e.extname, n.nspname)
  from pg_extension e join pg_namespace n on n.oid = e.extnamespace
 where e.extname <> 'plpgsql';
\o :arq_pos
-- Triggers em tabelas do storage/auth que chamam função do projeto.
select pg_get_triggerdef(t.oid) || ';'
  from pg_trigger t
  join pg_class c on c.oid = t.tgrelid join pg_namespace n on n.oid = c.relnamespace
  join pg_proc p on p.oid = t.tgfoid join pg_namespace pn on pn.oid = p.pronamespace
 where not t.tgisinternal and n.nspname in ('auth', 'storage') and pn.nspname not in ('auth', 'storage');
-- Policies do storage/auth (as do public vêm no pg_dump).
select format('drop policy if exists %I on %I.%I; create policy %I on %I.%I as %s for %s to %s%s%s;',
         policyname, schemaname, tablename, policyname, schemaname, tablename, permissive, cmd,
         (select string_agg(quote_ident(r), ', ') from unnest(roles) r),
         coalesce(' using (' || qual || ')', ''), coalesce(' with check (' || with_check || ')', ''))
  from pg_policies where schemaname in ('auth', 'storage');
select format('do $x$ begin if not exists (select from pg_publication_tables where pubname = %L and schemaname = %L and tablename = %L) then alter publication %I add table %I.%I; end if; end $x$;',
         pubname, schemaname, tablename, pubname, schemaname, tablename)
  from pg_publication_tables where pubname = 'supabase_realtime';
select format('select vault.create_secret(%L, %L, %L);', decrypted_secret, name, description)
  from vault.decrypted_secrets order by name;
-- Linhas de tabelas gerenciadas (versão do Auth/Storage pode diferir entre o
-- staging e a pilha local): vão como JSON e entram só nas colunas em comum.
-- (\copy não expande variável do psql; o destino vem do \o.)
\o :arq_linhas
\copy (select 'auth.users', row_to_json(x)::text from auth.users x union all select 'auth.identities', row_to_json(x)::text from auth.identities x union all select 'storage.buckets', row_to_json(x)::text from storage.buckets x) to stdout with (format csv, quote e'\x01', delimiter e'\x02')
\o
SQL
  credencial_staging
  psql_staging -q -v arq_extras="$dir/extras.sql" -v arq_pos="$dir/pos.sql" -v arq_linhas="$dir/linhas.csv" \
    -f "$dir/coleta.sql" >/dev/null

  credencial_staging
  pg_dump "$STG_CONN" --role=postgres --schema-only -n public -n ops -n private --no-owner -f "$dir/esquema.sql"
  credencial_staging
  # Dump só de dados avisa das FKs circulares (comentarios, usuarios…); o
  # restore desliga os triggers, então o aviso é ruído — erro de verdade passa.
  pg_dump "$STG_CONN" --role=postgres --data-only -n public -n ops -n private -f "$dir/dados.sql" \
    2> >(grep -v -e 'circular foreign-key' -e '^pg_dump: detail:' -e '^pg_dump: hint:' >&2)
  unset PGPASSWORD
  echo "    esquema $(du -h "$dir/esquema.sql" | cut -f1), dados $(du -h "$dir/dados.sql" | cut -f1)"

  # O `public` já existe na pilha (com os grants padrão do Supabase); o marcador
  # vira `ambiente=local`; os default privileges do supabase_admin a pilha já
  # tem e o postgres local não pode alterá-los.
  sed -e '/^CREATE SCHEMA public;$/d' \
    -e "s/^COMMENT ON SCHEMA public IS .*;\$/COMMENT ON SCHEMA public IS 'ambiente=local';/" \
    -e '/^ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin /d' \
    "$dir/esquema.sql" > "$dir/esquema-local.sql"
  mv "$dir/esquema-local.sql" "$dir/esquema.sql"
  grep -q "^COMMENT ON SCHEMA public IS 'ambiente=local';$" "$dir/esquema.sql" || falha "o esquema do staging veio sem o marcador (nada foi alterado no banco local)"

  echo "==> 3/6 recriando o banco local do zero…"
  # --local explícito: este repositório está linkado à PRODUÇÃO (supabase/.temp).
  supabase_cli db reset --local --no-seed >/dev/null
  carregar_pilha || falha "a pilha local não voltou depois do reset"
  # Marcado antes de restaurar: uma cópia que falhe no meio continua 'local'.
  psql_local -c "comment on schema public is 'ambiente=local'"

  echo "==> 4/6 restaurando…"
  psql_local -o /dev/null -f "$dir/extras.sql"
  # Sem os default privileges da pilha na hora do CREATE: com eles, toda tabela
  # e função nasceria com ALL pra anon/authenticated, e o dump só ACRESCENTA
  # grants — um REVOKE do staging (ex.: ia_tokens só leitura pro anon) sumiria.
  # O próprio esquema.sql recoloca os default privileges do staging no fim.
  psql_local -c "alter default privileges for role postgres in schema public revoke all on tables from anon, authenticated, service_role" \
    -c "alter default privileges for role postgres in schema public revoke all on sequences from anon, authenticated, service_role" \
    -c "alter default privileges for role postgres in schema public revoke all on functions from anon, authenticated, service_role"
  psql_local -o /dev/null -f "$dir/esquema.sql"
  { echo "set session_replication_role = replica;"; cat "$dir/dados.sql"; } | psql_local -o /dev/null
  psql_local -o /dev/null <<SQL
set session_replication_role = replica;
create temp table _linhas (tabela text, j jsonb);
\copy _linhas from '$dir/linhas.csv' with (format csv, quote e'\x01', delimiter e'\x02')
do \$\$
declare t text; cols text; rcols text;
begin
  foreach t in array array['auth.users', 'auth.identities', 'storage.buckets'] loop
    select string_agg(quote_ident(c.column_name), ', ' order by c.ordinal_position),
           string_agg('r.' || quote_ident(c.column_name), ', ' order by c.ordinal_position)
      into cols, rcols
      from information_schema.columns c
     where c.table_schema = split_part(t, '.', 1) and c.table_name = split_part(t, '.', 2)
       and c.is_generated = 'NEVER'
       and c.column_name in (select jsonb_object_keys(j) from _linhas where tabela = t);
    continue when cols is null;
    execute format('insert into %s (%s) select %s from _linhas l, jsonb_populate_record(null::%s, l.j) r where l.tabela = %L',
                   t, cols, rcols, t, t);
  end loop;
end \$\$;
SQL
  psql_local -o /dev/null -f "$dir/pos.sql"

  echo "==> 5/6 ajustes do ambiente local…"
  psql_local -o /dev/null -c "update public.app_config set valor = '$EDGE_BASE_URL_LOCAL' where chave = 'edge_base_url'" \
    -c "notify pgrst, 'reload schema'"

  echo "==> 6/6 conferindo…"
  # Linhas por tabela: o que o dump trouxe (contado no próprio arquivo, sem
  # corrida com quem estiver mexendo no staging agora) x o que entrou.
  awk '/^COPY /{t=$2; n=0; dentro=1; next} /^\\\.$/{if (dentro) print t, n; dentro=0; next} dentro{n++}' \
    "$dir/dados.sql" | sort > "$dir/esperado.txt"
  psql "$LOCAL_DB_URL" -tAX -F' ' -c "
    select format('%I.%I', table_schema, table_name),
           (xpath('/row/c/text()', query_to_xml(format('select count(*) as c from %I.%I', table_schema, table_name), false, true, '')))[1]::text
      from information_schema.tables
     where table_schema in ('public', 'ops') and table_type = 'BASE TABLE'" | sort > "$dir/local.txt"
  if ! diff -q "$dir/esperado.txt" "$dir/local.txt" >/dev/null; then
    diff "$dir/esperado.txt" "$dir/local.txt" | head -20 >&2
    falha "as linhas no banco local não batem com o dump do staging (acima: < staging, > local)"
  fi
  local tabelas linhas
  tabelas="$(wc -l < "$dir/local.txt" | tr -d ' ')"
  linhas="$(awk '{s += $2} END {print s}' "$dir/local.txt")"

  local marcador edge usuarios
  marcador="$(marcador_local)"
  [ "$marcador" = "ambiente=local" ] || falha "marcador local inesperado: '$marcador'"
  edge="$(psql "$LOCAL_DB_URL" -tAXc "select valor from public.app_config where chave = 'edge_base_url'")"
  [ "$edge" = "$EDGE_BASE_URL_LOCAL" ] || falha "edge_base_url local não foi reescrito"
  usuarios="$(psql "$LOCAL_DB_URL" -tAXc "select count(*) from auth.users")"

  local login
  login="$(curl -s -o /dev/null -w '%{http_code}' -X POST "$LOCAL_API_URL/auth/v1/token?grant_type=password" \
    -H "apikey: $LOCAL_ANON_KEY" -H "Content-Type: application/json" \
    -d "$(python3 -c 'import json,sys; print(json.dumps({"email": "e2e+interno@marasandraconnect.com", "password": sys.argv[1]}))' "$synth_pw")")"
  [ "$login" = "200" ] || falha "login local do e2e+interno respondeu $login"
  local edge_http
  edge_http="$(curl -s -o /dev/null -w '%{http_code}' -X OPTIONS "$LOCAL_API_URL/functions/v1/sugerir-proxima-tarefa")"
  [ "$edge_http" = "200" ] || echo "AVISO: edge functions locais não responderam (HTTP $edge_http)"

  echo "==> Cópia local pronta: $tabelas tabelas, $linhas linhas, $usuarios usuários do Auth (senha dos sintéticos = STAGING_SYNTH_PASSWORD)"
  echo "    app:        bun run dev:local   (http://localhost:$PORTA_APP)"
  echo "    E2E:        bun run e2e:local"
  echo "    migration:  node scripts/msc-sql.mjs --local --file <arq>"
  echo "    Studio:     $LOCAL_STUDIO_URL   ·   e-mails: $LOCAL_MAILPIT_URL"
}

exportar_env_local() {
  export VITE_SUPABASE_URL="$LOCAL_API_URL"
  export VITE_SUPABASE_PUBLISHABLE_KEY="$LOCAL_ANON_KEY"
  export LOCAL_SERVICE_ROLE_KEY="$LOCAL_SERVICE_ROLE_KEY"
  export LOCAL_DB_URL="$LOCAL_DB_URL"
}

cmd_app() {
  exigir_copia
  exportar_env_local
  echo "==> app no banco LOCAL ($LOCAL_API_URL)"
  exec bun run dev --port "$PORTA_APP" "$@"
}

cmd_e2e() {
  exigir_copia
  # Porta própria e sem reaproveitar servidor: um vite na :8085 apontando pro
  # staging não pode virar o alvo da suíte local.
  if lsof -iTCP:"$PORTA_E2E" -sTCP:LISTEN >/dev/null 2>&1; then
    falha "porta $PORTA_E2E ocupada — a suíte local sobe o próprio vite nela"
  fi
  exportar_env_local
  export E2E_PORTA="$PORTA_E2E"
  unset PLAYWRIGHT_BASE_URL
  echo "==> suíte E2E no banco LOCAL ($LOCAL_API_URL), vite na :$PORTA_E2E"
  exec bunx playwright test "$@"
}

case "${1:-}" in
  copiar) cmd_copiar ;;
  app) shift; cmd_app "$@" ;;
  e2e) shift; cmd_e2e "$@" ;;
  parar) supabase_cli stop ;;
  status)
    if carregar_pilha; then
      echo "pilha local no ar: $LOCAL_API_URL · banco marcado '$(marcador_local)'"
    else
      echo "pilha local parada — bun run local:copiar"
    fi ;;
  *) sed -n '2,15p' "$0"; exit 1 ;;
esac

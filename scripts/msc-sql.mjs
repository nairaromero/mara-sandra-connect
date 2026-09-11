#!/usr/bin/env node
// msc-sql.mjs — roda SQL no banco de PRODUÇÃO via Supabase Management API.
//
// Uso:
//   node scripts/msc-sql.mjs "select 1;"
//   node scripts/msc-sql.mjs --file caminho/para/migration.sql
//   node scripts/msc-sql.mjs --registrar caminho/para/migration.sql
//   echo "select 1;" | node scripts/msc-sql.mjs
//
// Credencial: lê SUPABASE_ACCESS_TOKEN do .env.local (gitignored).
// Projeto:   PROJECT_REF abaixo (override via env SUPABASE_PROJECT_REF).
//
// REGISTRO DE MIGRATIONS: toda migration_*.sql aplicada com --file que rodar
// sem erro é gravada em ops.migrations_aplicadas do banco em que rodou
// (migration_registro_migrations.sql). É isso que responde "já rodou em
// produção?" — o workflow do board depende disso. --registrar grava sem
// executar, para o que foi aplicado por outro caminho ou antes do registro.
// Arquivos fora do padrão migration_*.sql (diagnósticos, correções avulsas)
// rodam normalmente e não são registrados.
//
// Saída: 0 ok · 1 erro · 2 recusado por segurança ·
//        3 migration APLICADA mas o registro falhou (ver mensagem).
//
// SEGURANÇA: este script é pré-autorizado (allowlist). Por isso ele RECUSA
// operações catastróficas (DROP TABLE/SCHEMA/DATABASE, TRUNCATE, DELETE/UPDATE
// sem WHERE). Para algo assim (raro), use curl manual — que continua pedindo
// aprovação. Migrations (CREATE/ALTER/GRANT/DROP FUNCTION) e escritas com WHERE
// passam normalmente.

import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// --staging roda no projeto de STAGING (alhqbpbekmxpoibrrnbi). Sem a flag,
// PRODUÇÃO. Toda migration deve rodar primeiro com --staging, validar, e só
// então em produção (ver planning/AMBIENTES.md).
const STAGING_REF = "alhqbpbekmxpoibrrnbi";
const ehStaging = process.argv.includes("--staging");
const PROJECT_REF =
  process.env.SUPABASE_PROJECT_REF || (ehStaging ? STAGING_REF : "llugytkdsfsrciavhrfw");
if (ehStaging) console.error(`[msc-sql] alvo: STAGING (${PROJECT_REF})`);

function readEnvLocal(key) {
  try {
    const txt = fs.readFileSync(path.join(process.cwd(), ".env.local"), "utf8");
    const m = txt.match(new RegExp("^" + key + "=(.*)$", "m"));
    return m ? m[1].trim() : null;
  } catch {
    return null;
  }
}

function getSql() {
  const args = process.argv.slice(2);
  const fileIdx = args.indexOf("--file");
  if (fileIdx !== -1 && args[fileIdx + 1]) {
    return fs.readFileSync(args[fileIdx + 1], "utf8");
  }
  const inline = args.find((a) => !a.startsWith("--"));
  if (inline) return inline;
  // stdin
  try {
    return fs.readFileSync(0, "utf8");
  } catch {
    return "";
  }
}

// Remove comentários (-- ... e /* ... */) só para a checagem de segurança.
function stripComments(sql) {
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/--[^\n]*/g, " ");
}

function blockedReason(sql) {
  const s = stripComments(sql).toLowerCase();
  if (/\btruncate\b/.test(s)) return "TRUNCATE";
  if (/\bdrop\s+(table|schema|database)\b/.test(s)) return "DROP TABLE/SCHEMA/DATABASE";
  if (/\bdelete\s+from\b/.test(s) && !/\bwhere\b/.test(s)) return "DELETE sem WHERE";
  if (/\bupdate\s+[\w."]+\s+set\b/.test(s) && !/\bwhere\b/.test(s)) return "UPDATE sem WHERE";
  return null;
}

// Nome que o registro aceita — o mesmo check da tabela ops.migrations_aplicadas.
const PADRAO_MIGRATION = /^migration_[a-z0-9_]+\.sql$/;

// Migration pesada pode demorar; o registro é uma linha. Sem timeout, uma
// conexão pendurada deixava o terminal esperando para sempre.
const TIMEOUT_QUERY_MS = 5 * 60_000;
const TIMEOUT_REGISTRO_MS = 30_000;

async function runQuery(token, sql, timeoutMs) {
  const resp = await fetch(
    `https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query: sql }),
      signal: AbortSignal.timeout(timeoutMs),
    },
  );
  return { ok: resp.ok, status: resp.status, text: await resp.text() };
}

// Quem aplicou: o nome do git; sem git configurado, o usuário do sistema.
function quemAplica() {
  try {
    const nome = execFileSync("git", ["config", "user.name"], { encoding: "utf8" }).trim();
    if (nome) return nome;
  } catch {
    // sem git ou sem user.name: cai no usuário do sistema abaixo
  }
  return os.userInfo().username;
}

const literal = (s) => `'${String(s).replace(/'/g, "''")}'`;

// Grava a migration no registro do banco-alvo. 'msc-sql' atualiza a linha se
// ela já existir (reaplicação); 'manual' nunca sobrescreve o que já está lá.
// origem e aplicada_em descrevem como e quando a linha ENTROU no registro e
// não mudam depois — promover 'manual' a 'msc-sql' na reaplicação faria a
// linha afirmar uma execução na hora em que só houve um registro.
// O nome já chega validado por PADRAO_MIGRATION, então não carrega aspas.
async function registrar(token, arquivo, origem) {
  const nome = path.basename(arquivo);
  const sha256 = crypto.createHash("sha256").update(fs.readFileSync(arquivo)).digest("hex");
  const conflito =
    origem === "msc-sql"
      ? "do update set sha256 = excluded.sha256, reaplicada_em = now()"
      : "do nothing";
  const sql = `
    insert into ops.migrations_aplicadas (nome, sha256, origem, aplicada_por)
    values (${literal(nome)}, ${literal(sha256)}, ${literal(origem)}, ${literal(quemAplica())})
    on conflict (nome) ${conflito}
    returning nome, aplicada_em, reaplicada_em;`;
  return { nome, ...(await runQuery(token, sql, TIMEOUT_REGISTRO_MS)) };
}

async function modoRegistrar(token, arquivo) {
  if (!arquivo || !fs.existsSync(arquivo)) {
    console.error("ERRO: --registrar precisa do caminho de um arquivo que exista");
    process.exit(1);
  }
  if (!PADRAO_MIGRATION.test(path.basename(arquivo))) {
    console.error(`ERRO: ${path.basename(arquivo)} não segue o padrão migration_*.sql`);
    process.exit(1);
  }
  const r = await registrar(token, arquivo, "manual");
  if (!r.ok) {
    console.error(`ERRO ao registrar (HTTP ${r.status}): ${r.text.slice(0, 500)}`);
    process.exit(1);
  }
  // do nothing no conflito => sem linha de volta => já estava registrada.
  const linhas = JSON.parse(r.text);
  console.error(
    linhas.length
      ? `[msc-sql] registrada (manual, sem executar): ${r.nome}`
      : `[msc-sql] ${r.nome} já estava no registro — nada mudou`,
  );
}

async function main() {
  const token = readEnvLocal("SUPABASE_ACCESS_TOKEN");
  if (!token) {
    console.error("ERRO: SUPABASE_ACCESS_TOKEN não encontrado no .env.local");
    process.exit(1);
  }
  const args = process.argv.slice(2);
  const regIdx = args.indexOf("--registrar");
  if (regIdx !== -1) return modoRegistrar(token, args[regIdx + 1]);

  const sql = getSql();
  if (!sql || !sql.trim()) {
    console.error("ERRO: nenhum SQL fornecido (arg, --file ou stdin)");
    process.exit(1);
  }
  const reason = blockedReason(sql);
  if (reason) {
    console.error(
      `RECUSADO por segurança: detectado "${reason}".\n` +
        "Operação destrutiva não passa por este script (allowlist).\n" +
        "Se for realmente necessário, rode via curl manual (pedirá aprovação).",
    );
    process.exit(2);
  }

  const { ok, status, text } = await runQuery(token, sql, TIMEOUT_QUERY_MS);
  if (!ok) {
    console.error(`HTTP ${status}`);
    console.error(text.slice(0, 1000));
    process.exit(1);
  }
  // Pretty-print quando for JSON
  try {
    console.log(JSON.stringify(JSON.parse(text), null, 2));
  } catch {
    console.log(text);
  }

  // Registro: só para --file de migration_*.sql, e só DEPOIS de rodar sem erro
  // (registrar antes afirmaria "rodou" para uma migration que falhou).
  const fileIdx = args.indexOf("--file");
  const arquivo = fileIdx !== -1 ? args[fileIdx + 1] : null;
  if (!arquivo) return;
  if (!PADRAO_MIGRATION.test(path.basename(arquivo))) {
    console.error(`[msc-sql] não registrada: ${path.basename(arquivo)} não é migration_*.sql`);
    return;
  }
  let r;
  try {
    r = await registrar(token, arquivo, "msc-sql");
  } catch (e) {
    r = { ok: false, status: 0, text: String(e?.message ?? e) };
  }
  if (!r.ok) {
    // Não é erro silencioso: a migration já está no banco, então sair 1 faria
    // alguém achar que ela falhou. Sai 3 e diz exatamente como consertar.
    console.error(
      `\nATENÇÃO: a migration RODOU, mas NÃO ficou registrada (HTTP ${r.status}).\n` +
        `  ${r.text.slice(0, 300)}\n` +
        "  O ops.migrations_aplicadas existe neste banco? (migration_registro_migrations.sql)\n" +
        "  Para registrar sem rodar de novo:\n" +
        `    node scripts/msc-sql.mjs${ehStaging ? " --staging" : ""} --registrar ${arquivo}`,
    );
    process.exit(3);
  }
  const [linha] = JSON.parse(r.text);
  console.error(
    `[msc-sql] registrada: ${r.nome} (${linha?.reaplicada_em ? "reaplicada" : "primeira vez"})`,
  );
}

main().catch((e) => {
  console.error("ERRO:", e?.message ?? e);
  process.exit(1);
});

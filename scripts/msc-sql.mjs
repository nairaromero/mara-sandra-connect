#!/usr/bin/env node
// msc-sql.mjs — roda SQL no banco de PRODUÇÃO via Supabase Management API.
//
// Uso:
//   node scripts/msc-sql.mjs "select 1;"
//   node scripts/msc-sql.mjs --file caminho/para/migration.sql
//   echo "select 1;" | node scripts/msc-sql.mjs
//
// Credencial: lê SUPABASE_ACCESS_TOKEN do .env.local (gitignored).
// Projeto:   PROJECT_REF abaixo (override via env SUPABASE_PROJECT_REF).
//
// SEGURANÇA: este script é pré-autorizado (allowlist). Por isso ele RECUSA
// operações catastróficas (DROP TABLE/SCHEMA/DATABASE, TRUNCATE, DELETE/UPDATE
// sem WHERE). Para algo assim (raro), use curl manual — que continua pedindo
// aprovação. Migrations (CREATE/ALTER/GRANT/DROP FUNCTION) e escritas com WHERE
// passam normalmente.

import fs from "node:fs";
import path from "node:path";

const PROJECT_REF = process.env.SUPABASE_PROJECT_REF || "llugytkdsfsrciavhrfw";

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

async function main() {
  const token = readEnvLocal("SUPABASE_ACCESS_TOKEN");
  if (!token) {
    console.error("ERRO: SUPABASE_ACCESS_TOKEN não encontrado no .env.local");
    process.exit(1);
  }
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

  const resp = await fetch(
    `https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query: sql }),
    },
  );
  const text = await resp.text();
  if (!resp.ok) {
    console.error(`HTTP ${resp.status}`);
    console.error(text.slice(0, 1000));
    process.exit(1);
  }
  // Pretty-print quando for JSON
  try {
    console.log(JSON.stringify(JSON.parse(text), null, 2));
  } catch {
    console.log(text);
  }
}

main().catch((e) => {
  console.error("ERRO:", e?.message ?? e);
  process.exit(1);
});

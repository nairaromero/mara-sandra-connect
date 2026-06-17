#!/usr/bin/env node
// debug-storage-rls.mjs — conecta direto no Postgres, simula JWT do Andre,
// tenta INSERT em storage.objects e mostra exatamente o que falha.

import fs from "node:fs";
import path from "node:path";
import pg from "pg";

const PROJECT_REF = "llugytkdsfsrciavhrfw";
const ANDRE_UUID = "e11d9a06-ce2a-4746-9f2f-3a55bc658c8f";
const CASO_ID = "35e96ed3-39e7-458e-b735-8f36a64fdb36";

function envLocal(key) {
  const txt = fs.readFileSync(path.join(process.cwd(), ".env.local"), "utf8");
  const m = txt.match(new RegExp("^" + key + "=(.*)$", "m"));
  return m ? m[1].trim() : null;
}

const pwd = envLocal("SUPABASE_DB_PASSWORD");
if (!pwd) { console.error("Sem SUPABASE_DB_PASSWORD"); process.exit(1); }

// Pooler (transaction) — Supabase recomenda 6543 pra apps externos
// Session mode (porta 5432) — suporta SET LOCAL. Transaction (6543) não.
const url = `postgresql://postgres.${PROJECT_REF}:${encodeURIComponent(pwd)}@aws-1-sa-east-1.pooler.supabase.com:5432/postgres`;

const client = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
await client.connect();

console.log("Conectado.");

async function run(label, sql, params) {
  try {
    const r = await client.query(sql, params);
    console.log(`[${label}] OK rows=${r.rowCount ?? 0}`, r.rows?.slice(0, 3) ?? "");
    return r;
  } catch (e) {
    console.log(`[${label}] ERRO ${e.code} ${e.message}`);
    if (e.detail) console.log(`  detail: ${e.detail}`);
    if (e.hint) console.log(`  hint: ${e.hint}`);
    if (e.where) console.log(`  where: ${e.where}`);
    if (e.table) console.log(`  table: ${e.schema}.${e.table}`);
    if (e.routine) console.log(`  routine: ${e.routine}`);
    return null;
  }
}

const jwt = JSON.stringify({ sub: ANDRE_UUID, role: "authenticated", aud: "authenticated" });

await run("BEGIN", "BEGIN");
await run("set claims", `SET LOCAL request.jwt.claims TO '${jwt}'`);
await run("set role", "SET LOCAL role TO authenticated");
await run("who am i", "SELECT auth.uid() AS uid, current_user AS role");
await run("caso_do_parceiro direta", `SELECT caso_do_parceiro('${CASO_ID}'::uuid)`);
await run("EXISTS direto", `SELECT EXISTS (SELECT 1 FROM casos WHERE id='${CASO_ID}'::uuid AND parceiro_id = auth.uid())`);
await run("SELECT casos", `SELECT id, parceiro_id FROM casos WHERE id='${CASO_ID}'::uuid`);
// 1) INSERT puro (sem ON CONFLICT)
await run("INSERT puro", `INSERT INTO storage.objects (bucket_id, name, owner) VALUES ('documentos', '${CASO_ID}/x1.pdf', '${ANDRE_UUID}'::uuid)`);
await run("ROLLBACK 1", "ROLLBACK");

await run("BEGIN 2", "BEGIN");
await run("set claims 2", `SET LOCAL request.jwt.claims TO '${jwt}'`);
await run("set role 2", "SET LOCAL role TO authenticated");

// 2) INSERT ON CONFLICT DO NOTHING
await run("INSERT DO NOTHING", `INSERT INTO storage.objects (bucket_id, name, owner) VALUES ('documentos', '${CASO_ID}/x2.pdf', '${ANDRE_UUID}'::uuid) ON CONFLICT (bucket_id, name) DO NOTHING`);
await run("ROLLBACK 2", "ROLLBACK");

await run("BEGIN 3", "BEGIN");
await run("set claims 3", `SET LOCAL request.jwt.claims TO '${jwt}'`);
await run("set role 3", "SET LOCAL role TO authenticated");

// 3) INSERT ON CONFLICT DO UPDATE
await run("INSERT DO UPDATE", `INSERT INTO storage.objects (bucket_id, name, owner) VALUES ('documentos', '${CASO_ID}/x3.pdf', '${ANDRE_UUID}'::uuid) ON CONFLICT (bucket_id, name) DO UPDATE SET owner = EXCLUDED.owner`);
await run("ROLLBACK 3", "ROLLBACK");

await client.end();

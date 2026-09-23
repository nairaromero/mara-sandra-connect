// Utilitários do ambiente LOCAL pros filmes e conferências (e2e/demo/roteiros/*.cjs):
// chaves da pilha (bunx supabase status), sessões via API (nunca digita senha),
// storageState nas duas origens (produto e QG), chamada de function, mock dos
// provedores, TOTP (RFC 6238) e pequenas ações de tela com ritmo humano.
const fs = require("fs");
const path = require("path");
const { execSync, execFileSync } = require("child_process");
const { createHmac } = require("crypto");
const { createClient } = require("@supabase/supabase-js");
const { clicar } = require("./helpers.cjs");

const REPO = path.resolve(__dirname, "..", "..");
const BASE = process.env.DEMO_BASE_URL || "http://localhost:8080";
const QG = process.env.DEMO_QG_URL || "http://qg.localhost:8080";
const MOCK = "http://localhost:8787";
const MOCK_DOCKER = "http://host.docker.internal:8787";
const DOM = "marasandraconnect.com";

// ---------- pilha local (chaves) ----------
function envLocal(nome) {
  for (const arq of [".env", ".env.local"]) {
    try {
      for (const l of fs.readFileSync(path.join(REPO, arq), "utf8").split("\n")) {
        const m = l.match(new RegExp(`^${nome}=(.*)$`));
        if (m) return m[1].replace(/^"|"$/g, "").trim();
      }
    } catch { /* sem arquivo */ }
  }
  return null;
}
function pilha() {
  const out = execSync("bunx supabase status -o env", { cwd: REPO, encoding: "utf8" });
  const pega = (k) => (out.match(new RegExp(`^${k}="?([^"\\n]+)"?$`, "m")) || [])[1];
  return { url: pega("API_URL"), anon: pega("ANON_KEY"), service: pega("SERVICE_ROLE_KEY") };
}
const PILHA = pilha();
if (!PILHA.url || !PILHA.anon || !PILHA.service) throw new Error("pilha local fora do ar (bunx supabase status)");
const SENHA = envLocal("STAGING_SYNTH_PASSWORD");
if (!SENHA) throw new Error("STAGING_SYNTH_PASSWORD ausente no .env.local");
const REF = new URL(PILHA.url).hostname.split(".")[0];
const FN = `${PILHA.url}/functions/v1`;
const admin = createClient(PILHA.url, PILHA.service, { auth: { persistSession: false, autoRefreshToken: false } });

async function sessao(email, escritorio) {
  const sb = createClient(PILHA.url, PILHA.anon, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: escritorio ? { headers: { "x-escritorio-id": escritorio } } : {},
  });
  const { data, error } = await sb.auth.signInWithPassword({ email, password: SENHA });
  if (error || !data.session) throw new Error(`login ${email}: ${error?.message}`);
  return { sb, session: data.session, jwt: data.session.access_token, id: data.user.id };
}
/** storageState com a sessão nas duas origens (produto e QG) e o escritório ativo. */
function estadoNavegador(session, escritorioId) {
  const ls = [{ name: `sb-${REF}-auth-token`, value: JSON.stringify(session) }];
  if (escritorioId) ls.push({ name: "msc:escritorio_ativo", value: escritorioId });
  return { cookies: [], origins: [{ origin: new URL(BASE).origin, localStorage: ls }, { origin: new URL(QG).origin, localStorage: ls }] };
}
async function fn(nome, jwt, escritorio, body) {
  const r = await fetch(`${FN}/${nome}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${jwt}`, apikey: PILHA.anon, "content-type": "application/json", ...(escritorio ? { "x-escritorio-id": escritorio } : {}) },
    body: JSON.stringify(body ?? {}),
  });
  const texto = await r.text();
  let json = null;
  try { json = JSON.parse(texto); } catch { /* sem JSON */ }
  return { status: r.status, json, texto };
}
const mock = async (rota, body) => (await fetch(`${MOCK}${rota}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body ?? {}) })).json();
const esc = (t) => String(t ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

// ---------- TOTP (RFC 6238), igual ao da spec mfa ----------
function base32Decode(s) {
  const alf = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "", out = [];
  for (const ch of s.replace(/=+$/, "").toUpperCase()) { const v = alf.indexOf(ch); if (v < 0) continue; bits += v.toString(2).padStart(5, "0"); }
  for (let i = 0; i + 8 <= bits.length; i += 8) out.push(parseInt(bits.slice(i, i + 8), 2));
  return Buffer.from(out);
}
function totp(secret, agora = Date.now()) {
  const buf = Buffer.alloc(8); buf.writeBigUInt64BE(BigInt(Math.floor(agora / 1000 / 30)));
  const h = createHmac("sha1", base32Decode(secret)).update(buf).digest();
  const o = h[h.length - 1] & 0xf;
  return ((((h[o] & 0x7f) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3]) % 1_000_000).toString().padStart(6, "0");
}
let ultimaJanela = -1;
async function codigoNovo(secret) {
  let j = Math.floor(Date.now() / 30000);
  if (j === ultimaJanela) { await new Promise((r) => setTimeout(r, (j + 1) * 30000 - Date.now() + 500)); j = Math.floor(Date.now() / 30000); }
  ultimaJanela = j;
  return totp(secret);
}


/** Espera o SPA cair numa das rotas (o guard redireciona sem "load"). */
async function esperarRota(page, rotas, rotulo, ms = 15000, stillDir = null) {
  const fim = Date.now() + ms;
  while (Date.now() < fim) {
    const path = new URL(page.url()).pathname;
    if (rotas.includes(path)) return path;
    await page.waitForTimeout(250);
  }
  if (stillDir) await page.screenshot({ path: path.join(stillDir, `falha-${rotulo}.png`) }).catch(() => {});
  throw new Error(`${rotulo}: esperava ${rotas.join("|")}, ficou em ${page.url()}`);
}
/** Fecha o context da página (encerra o clipe): sem isso o clipe grava tela parada até o fim do take. */
const fechar = async (page) => { try { await page.context().close(); } catch { /* já fechado */ } };
// digitação com ritmo humano
async function digitar(page, locator, texto) {
  await clicar(page, locator);
  await locator.fill("");
  await locator.pressSequentially(texto, { delay: 55 });
  await page.waitForTimeout(300);
}


/** SQL no banco local (scripts/msc-sql.mjs --local); devolve as linhas em JSON. */
function sqlLocal(q) {
  // execFileSync (sem shell): um `$$` de bloco DO viraria o PID dentro de aspas duplas
  const out = execFileSync("node", ["scripts/msc-sql.mjs", "--local", q], { cwd: REPO, encoding: "utf8" });
  const txt = out.split("\n").filter((l) => !l.startsWith("[msc-sql]")).join("\n").trim();
  if (!txt) return [];
  try { return JSON.parse(txt); } catch { throw new Error(`sql local: ${txt.slice(0, 200)}`); }
}
/** Segredo de sistema das functions LOCAIS (supabase/functions/.env). */
function segredoSistemaLocal() {
  const txt = fs.readFileSync(path.join(REPO, "supabase/functions/.env"), "utf8");
  return (txt.match(/^MSC_SYSTEM_SECRET=(.*)$/m) || [])[1]?.trim().replace(/^"|"$/g, "") ?? null;
}
/**
 * "Cron simulado": roda no banco LOCAL o mesmo comando que o pg_cron executa em
 * produção — net.http_post com ops.headers_sistema(job) — apontando para a
 * function local. Antes, alinha o segredo do Vault local ao das functions
 * (senão a assinatura não confere). Devolve o que o pg_net recebeu.
 */
async function cronSimulado(job, funcao, body, { timeoutMs = 45000 } = {}) {
  const segredo = segredoSistemaLocal();
  if (!segredo) throw new Error("MSC_SYSTEM_SECRET ausente em supabase/functions/.env");
  sqlLocal(`do $$ declare v uuid; begin
      select id into v from vault.secrets where name = 'msc_system_secret';
      if v is null then perform vault.create_secret('${segredo}', 'msc_system_secret');
      else perform vault.update_secret(v, '${segredo}'); end if; end $$`);
  const url = `http://host.docker.internal:55321/functions/v1/${funcao}`;
  const comando = `select net.http_post(url := '${url}', headers := ops.headers_sistema('${job}'), body := '${JSON.stringify(body)}'::jsonb, timeout_milliseconds := 60000) as id`;
  const [{ id }] = sqlLocal(comando);
  const fim = Date.now() + timeoutMs;
  while (Date.now() < fim) {
    const r = sqlLocal(`select status_code, content::text as corpo, error_msg from net._http_response where id = ${id}`);
    if (r.length && (r[0].status_code !== null || r[0].error_msg)) {
      let json = null; try { json = JSON.parse(r[0].corpo); } catch { /* texto */ }
      return { id, status: r[0].status_code, corpo: r[0].corpo, json, erro: r[0].error_msg, comando };
    }
    await new Promise((res) => setTimeout(res, 800));
  }
  throw new Error(`pg_net não respondeu em ${timeoutMs / 1000}s (request ${id})`);
}

module.exports = { sqlLocal, segredoSistemaLocal, cronSimulado, REPO, BASE, QG, MOCK, MOCK_DOCKER, DOM, PILHA, SENHA, REF, FN, admin, envLocal, sessao, estadoNavegador, fn, mock, esc, totp, codigoNovo, esperarRota, fechar, digitar };

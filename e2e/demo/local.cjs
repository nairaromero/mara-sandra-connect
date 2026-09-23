// Utilitários do ambiente LOCAL pros filmes e conferências (e2e/demo/roteiros/*.cjs):
// chaves da pilha (bunx supabase status), sessões via API (nunca digita senha),
// storageState nas duas origens (produto e QG), chamada de function, mock dos
// provedores, TOTP (RFC 6238) e pequenas ações de tela com ritmo humano.
const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");
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


module.exports = { REPO, BASE, QG, MOCK, MOCK_DOCKER, DOM, PILHA, SENHA, REF, FN, admin, envLocal, sessao, estadoNavegador, fn, mock, esc, totp, codigoNovo, esperarRota, fechar, digitar };

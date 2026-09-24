// Utilitários do ambiente de STAGING pros filmes (e2e/demo/roteiros/*.cjs).
//
// Irmão do local.cjs, com a mesma cara, mas apontando para o projeto de
// staging: chaves do .env.local, sessões por API (nunca digita senha),
// storageState nas duas origens (produto e QG), chamada de edge function,
// TOTP (RFC 6238) e digitação com ritmo humano.
//
// A BASE é o endereço onde o front está servido. Enquanto o PR do lote RBAC
// não entra na branch `staging`, o domínio staging.marasandraconnect.com ainda
// serve o build ANTIGO: nesse período filma-se com o front novo servido na
// máquina (`bun dev`, que já lê VITE_SUPABASE_* do staging) contra o banco e
// as functions do staging. Depois do merge, basta DEMO_BASE_URL=
// https://staging.marasandraconnect.com (e DEMO_QG_URL=https://qg.staging…).
const fs = require("fs");
const path = require("path");
const { createHmac } = require("crypto");
const { createClient } = require("@supabase/supabase-js");
const { clicar } = require("./helpers.cjs");

const REPO = path.resolve(__dirname, "..", "..");
const BASE = process.env.DEMO_BASE_URL || "http://localhost:8080";
const QG = process.env.DEMO_QG_URL || "http://qg.localhost:8080";
const DOM = "marasandraconnect.com";
const URL_SB = "https://alhqbpbekmxpoibrrnbi.supabase.co";
const REF = "alhqbpbekmxpoibrrnbi";
const FN = `${URL_SB}/functions/v1`;

function envLocal(nome) {
  for (const l of fs.readFileSync(path.join(REPO, ".env.local"), "utf8").split("\n")) {
    const m = l.match(new RegExp(`^${nome}=(.*)$`));
    if (m) return m[1].replace(/^"|"$/g, "").trim();
  }
  return null;
}

const ANON = envLocal("STAGING_PUBLISHABLE_KEY") || envLocal("VITE_SUPABASE_PUBLISHABLE_KEY");
const SERVICE = envLocal("STAGING_SERVICE_ROLE_KEY");
const SENHA = envLocal("STAGING_SYNTH_PASSWORD");
if (!ANON || !SERVICE) throw new Error("STAGING_PUBLISHABLE_KEY/STAGING_SERVICE_ROLE_KEY ausentes no .env.local");
if (!SENHA) throw new Error("STAGING_SYNTH_PASSWORD ausente no .env.local");

const admin = createClient(URL_SB, SERVICE, { auth: { persistSession: false, autoRefreshToken: false } });

/** Sessão de uma conta sintética do staging (senha = STAGING_SYNTH_PASSWORD). */
async function sessao(email, escritorio) {
  const sb = createClient(URL_SB, ANON, {
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

/** Chamada de edge function do staging com a sessão de uma pessoa. */
async function fn(nome, jwt, escritorio, body) {
  const r = await fetch(`${FN}/${nome}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${jwt}`, apikey: ANON, "content-type": "application/json",
      ...(escritorio ? { "x-escritorio-id": escritorio } : {}),
    },
    body: JSON.stringify(body ?? {}),
  });
  const texto = await r.text();
  let json = null;
  try { json = JSON.parse(texto); } catch { /* sem JSON */ }
  return { status: r.status, json, texto };
}

const esc = (t) => String(t ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

// ---------- TOTP (RFC 6238), igual ao da spec mfa ----------
function base32Decode(s) {
  const alf = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = ""; const out = [];
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
/** Código de uma janela NOVA: o mesmo código não é aceito duas vezes. */
async function codigoNovo(secret) {
  let j = Math.floor(Date.now() / 30000);
  if (j === ultimaJanela) { await new Promise((r) => setTimeout(r, (j + 1) * 30000 - Date.now() + 500)); j = Math.floor(Date.now() / 30000); }
  ultimaJanela = j;
  return totp(secret);
}

/** Eleva uma sessão a AAL2 com autenticador descartável (para preparar cena fora de cāmera). */
async function elevarComTotp(sb) {
  const { data: lista } = await sb.auth.mfa.listFactors();
  for (const f of lista?.all ?? []) await sb.auth.mfa.unenroll({ factorId: f.id });
  const en = await sb.auth.mfa.enroll({ factorType: "totp", friendlyName: `filme-${Date.now()}` });
  if (en.error) throw new Error(`mfa.enroll: ${en.error.message}`);
  const ch = await sb.auth.mfa.challenge({ factorId: en.data.id });
  if (ch.error) throw new Error(`mfa.challenge: ${ch.error.message}`);
  const vf = await sb.auth.mfa.verify({ factorId: en.data.id, challengeId: ch.data.id, code: await codigoNovo(en.data.totp.secret) });
  if (vf.error) throw new Error(`mfa.verify: ${vf.error.message}`);
  return async () => { await sb.auth.mfa.unenroll({ factorId: en.data.id }).catch(() => {}); };
}

/** Espera o SPA cair numa das rotas (o guard redireciona sem "load"). */
async function esperarRota(page, rotas, rotulo, ms = 20000) {
  const fim = Date.now() + ms;
  while (Date.now() < fim) {
    if (rotas.includes(new URL(page.url()).pathname)) return new URL(page.url()).pathname;
    await page.waitForTimeout(250);
  }
  throw new Error(`${rotulo}: esperava ${rotas.join("|")}, ficou em ${page.url()}`);
}

/** Fecha o context (encerra o clipe): sem isso o clipe grava tela parada até o fim do take. */
const fechar = async (page) => { try { await page.context().close(); } catch { /* já fechado */ } };

/** Digitação com ritmo humano. */
async function digitar(page, locator, texto) {
  await clicar(page, locator);
  await locator.fill("");
  await locator.pressSequentially(texto, { delay: 55 });
  await page.waitForTimeout(300);
}

module.exports = {
  REPO, BASE, QG, DOM, URL_SB, REF, FN, ANON, SENHA,
  admin, envLocal, sessao, estadoNavegador, fn, esc,
  totp, codigoNovo, elevarComTotp, esperarRota, fechar, digitar,
};

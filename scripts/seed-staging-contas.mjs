#!/usr/bin/env node
// Contas sinteticas de STAGING, uma por papel: admin / interno / parceiro.
//
//   node scripts/seed-staging-contas.mjs
//
// Por que existe: ate 2026-08-22 todo mundo (Naira, Yuri, a suite E2E) usava a
// mesma conta e2e+interno. Duas pessoas na mesma sessao derrubam uma a outra
// (rotacao de refresh token) e ninguem consegue validar o que so admin ve
// (/equipe, webhooks, auditoria) nem o que so parceiro ve.
//
// O que faz (idempotente — pode rodar quantas vezes quiser):
//   1. garante o usuario no Auth (cria, ou redefine a senha e tira o ban);
//   2. garante a linha em public.usuarios com o papel certo, onboarding e
//      termos aceitos (parceiro nao cai em /boas-vindas);
//   3. prova que cada conta loga por senha.
//
// Senha: STAGING_SYNTH_PASSWORD (a mesma de todos os sinteticos do espelho).
// E-mails e2e+* sao preservados pelo anonimizador, mas o espelho semanal
// APAGA auth.users e recria so quem existe em producao — por isso
// scripts/espelho-staging.sh chama este seed no fim. Ver planning/AMBIENTES.md.
//
// So roda contra STAGING. Se STAGING_PROJECT_REF apontar pra producao, aborta.

import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

const PROD_REF = "llugytkdsfsrciavhrfw";

function lerEnvLocal() {
  const out = {};
  try {
    const txt = fs.readFileSync(path.join(process.cwd(), ".env.local"), "utf8");
    for (const linha of txt.split("\n")) {
      const m = linha.match(/^([A-Z0-9_]+)=(.*)$/);
      if (m) out[m[1]] = m[2].trim().replace(/^"|"$/g, "");
    }
  } catch {
    // CI: so process.env
  }
  return out;
}
const env = { ...lerEnvLocal(), ...process.env };

const REF = env.STAGING_PROJECT_REF || "alhqbpbekmxpoibrrnbi";
if (REF === PROD_REF) {
  console.error("STAGING_PROJECT_REF aponta pra PRODUCAO — abortando.");
  process.exit(2);
}
const URL = `https://${REF}.supabase.co`;
const SERVICE_KEY = env.STAGING_SERVICE_ROLE_KEY;
const ANON_KEY = env.STAGING_PUBLISHABLE_KEY || env.VITE_SUPABASE_PUBLISHABLE_KEY;
const SENHA = env.STAGING_SYNTH_PASSWORD;
for (const [nome, v] of [
  ["STAGING_SERVICE_ROLE_KEY", SERVICE_KEY],
  ["STAGING_PUBLISHABLE_KEY", ANON_KEY],
  ["STAGING_SYNTH_PASSWORD", SENHA],
]) {
  if (!v) {
    console.error(`${nome} ausente no .env.local / ambiente.`);
    process.exit(1);
  }
}

// Mesma versao que o app exige (src/lib/legal/termos.ts) — lida do fonte pra
// nao desalinhar quando os termos mudarem.
const TERMOS_VERSAO = /TERMOS_VERSAO = "([^"]+)"/.exec(
  fs.readFileSync(path.join(process.cwd(), "src/lib/legal/termos.ts"), "utf8"),
)?.[1];
if (!TERMOS_VERSAO) {
  console.error("nao achei TERMOS_VERSAO em src/lib/legal/termos.ts");
  process.exit(1);
}

const CONTAS = [
  { email: "e2e+admin@marasandraconnect.com", nome: "[E2E] Admin", tipo: "interno", eh_admin: true, eh_parceiro: false },
  { email: "e2e+interno@marasandraconnect.com", nome: "[E2E] Interno", tipo: "interno", eh_admin: false, eh_parceiro: false },
  { email: "e2e+parceiro@marasandraconnect.com", nome: "[E2E] Parceiro", tipo: "parceiro", eh_admin: false, eh_parceiro: true },
];

const admin = createClient(URL, SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const anon = createClient(URL, ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } });

async function usuariosAuthPorEmail() {
  const mapa = new Map();
  for (let page = 1; page <= 20; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw new Error(`listUsers: ${error.message}`);
    for (const u of data.users) mapa.set((u.email || "").toLowerCase(), u);
    if (data.users.length < 1000) break;
  }
  return mapa;
}

async function garantirAuth(conta, existente) {
  if (!existente) {
    const { data, error } = await admin.auth.admin.createUser({
      email: conta.email,
      password: SENHA,
      email_confirm: true,
      user_metadata: { nome: conta.nome },
    });
    if (error) throw new Error(`createUser ${conta.email}: ${error.message}`);
    return { id: data.user.id, acao: "criado" };
  }
  // Existe: garante senha sintetica, e-mail confirmado e sem ban (o
  // desligar_interno bane; o seed desfaz pra conta voltar a servir).
  const { error } = await admin.auth.admin.updateUserById(existente.id, {
    password: SENHA,
    email_confirm: true,
    ban_duration: "none",
  });
  if (error) throw new Error(`updateUser ${conta.email}: ${error.message}`);
  return { id: existente.id, acao: "atualizado" };
}

async function garantirPerfil(conta, id) {
  const { data: atual } = await admin
    .from("usuarios")
    .select("onboarded_em, aceitou_termos_em")
    .eq("id", id)
    .maybeSingle();
  const agora = new Date().toISOString();
  const perfil = {
    id,
    email: conta.email,
    nome: conta.nome,
    tipo: conta.tipo,
    eh_admin: conta.eh_admin,
    eh_parceiro: conta.eh_parceiro,
    ativo: true,
    desligado_em: null,
    desligado_por: null,
    onboarded_em: atual?.onboarded_em ?? agora,
    aceitou_termos_em: atual?.aceitou_termos_em ?? agora,
    termos_versao: TERMOS_VERSAO,
  };
  const { error } = await admin.from("usuarios").upsert(perfil, { onConflict: "id" });
  if (error) throw new Error(`usuarios ${conta.email}: ${error.message}`);
}

async function provarLogin(conta) {
  const { data, error } = await anon.auth.signInWithPassword({ email: conta.email, password: SENHA });
  if (error || !data.session) return `FALHOU: ${error?.message}`;
  await anon.auth.signOut({ scope: "local" });
  return "ok";
}

console.error(`[seed-staging-contas] alvo: ${REF} (staging)`);
const porEmail = await usuariosAuthPorEmail();
const linhas = [];
for (const conta of CONTAS) {
  const { id, acao } = await garantirAuth(conta, porEmail.get(conta.email));
  await garantirPerfil(conta, id);
  const login = await provarLogin(conta);
  linhas.push({ email: conta.email, papel: conta.eh_admin ? "admin" : conta.tipo, auth: acao, login });
}
console.table(linhas);
if (linhas.some((l) => l.login !== "ok")) process.exit(1);

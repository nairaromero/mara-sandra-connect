// globalSetup do Playwright: gera as sessões dos três papéis SEM passar pela
// UI de login, e grava como storageState (a sessão do supabase-js vive em
// localStorage: sb-<ref>-auth-token — ver src/lib/supabase.ts).
//
// - INTERNO: usuário dedicado e2e+interno@… (criado aqui se não existir, via
//   admin API, pré-confirmado) + signInWithPassword.
// - ADMIN: e2e+admin@… (eh_admin=true) + signInWithPassword. NÃO é criado
//   aqui: vem de `node scripts/seed-staging-contas.mjs` (só staging). Se não
//   existir, o setup avisa e o admin.json não é gerado — os specs que usam
//   STORAGE_ADMIN falham com a mensagem certa, os outros seguem.
// - PARCEIRO: e2e+parceiro@… (seed-staging-contas) + signInWithPassword. Sem
//   senha configurada (alvo = produção), cai no magic link: admin.generateLink
//   devolve o token SEM enviar e-mail; verifyOtp troca por sessão.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createClient, type Session } from "@supabase/supabase-js";
import type { FullConfig } from "@playwright/test";
import { ENV, PROJECT_REF } from "./env";
import { adminClient } from "./supabase-admin";

const AUTH_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), ".auth");

function anonClient() {
  return createClient(ENV.supabaseUrl, ENV.anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function gravarStorageState(arquivo: string, baseURL: string, session: Session) {
  const state = {
    cookies: [],
    origins: [
      {
        origin: new URL(baseURL).origin,
        localStorage: [
          {
            name: `sb-${PROJECT_REF}-auth-token`,
            value: JSON.stringify(session),
          },
        ],
      },
    ],
  };
  fs.mkdirSync(AUTH_DIR, { recursive: true });
  fs.writeFileSync(path.join(AUTH_DIR, arquivo), JSON.stringify(state, null, 2));
}

async function sessaoInterno(): Promise<Session> {
  const anon = anonClient();
  const tenta = await anon.auth.signInWithPassword({
    email: ENV.internoEmail,
    password: ENV.internoPassword,
  });
  if (tenta.data.session) return tenta.data.session;

  // Primeiro uso: cria o usuário de teste pré-confirmado + perfil interno.
  const admin = adminClient();
  const { data: novo, error: criaErr } = await admin.auth.admin.createUser({
    email: ENV.internoEmail,
    password: ENV.internoPassword,
    email_confirm: true,
  });
  if (criaErr && !/already/i.test(criaErr.message)) {
    throw new Error(`criar usuário e2e interno: ${criaErr.message}`);
  }
  const userId = novo?.user?.id;
  if (!userId) {
    // Usuário existe mas a senha estava errada — não sobrescrevemos senha de
    // conta pré-existente automaticamente por segurança.
    throw new Error(
      `Usuário ${ENV.internoEmail} já existe mas E2E_INTERNO_PASSWORD não confere.`,
    );
  }
  const { error: perfilErr } = await admin.from("usuarios").upsert({
    id: userId,
    nome: "[E2E] Interno",
    email: ENV.internoEmail,
    tipo: "interno",
    ativo: true,
  });
  if (perfilErr) throw new Error(`perfil e2e interno: ${perfilErr.message}`);

  const login = await anon.auth.signInWithPassword({
    email: ENV.internoEmail,
    password: ENV.internoPassword,
  });
  if (!login.data.session) {
    throw new Error(`login interno falhou: ${login.error?.message}`);
  }
  return login.data.session;
}

async function sessaoAdmin(): Promise<Session | null> {
  if (!ENV.adminPassword) return null;
  const { data, error } = await anonClient().auth.signInWithPassword({
    email: ENV.adminEmail,
    password: ENV.adminPassword,
  });
  if (!data.session) {
    console.warn(
      `[auth.setup] admin ${ENV.adminEmail} não logou (${error?.message}). ` +
        "Rode `node scripts/seed-staging-contas.mjs` — specs com STORAGE_ADMIN vão falhar.",
    );
    return null;
  }
  return data.session;
}

async function sessaoParceiro(): Promise<Session> {
  if (ENV.parceiroPassword) {
    const { data, error } = await anonClient().auth.signInWithPassword({
      email: ENV.parceiroEmail,
      password: ENV.parceiroPassword,
    });
    if (!data.session) {
      throw new Error(
        `login parceiro ${ENV.parceiroEmail} falhou (${error?.message}). ` +
          "Rode `node scripts/seed-staging-contas.mjs`.",
      );
    }
    return data.session;
  }

  const admin = adminClient();
  const { data, error } = await admin.auth.admin.generateLink({
    type: "magiclink",
    email: ENV.parceiroEmail,
  });
  if (error) throw new Error(`generateLink parceiro: ${error.message}`);
  const tokenHash = data.properties?.hashed_token;
  if (!tokenHash) throw new Error("generateLink não devolveu hashed_token");

  const anon = anonClient();
  const { data: verif, error: otpErr } = await anon.auth.verifyOtp({
    token_hash: tokenHash,
    type: "email",
  });
  if (otpErr || !verif.session) {
    throw new Error(`verifyOtp parceiro: ${otpErr?.message}`);
  }
  return verif.session;
}

export default async function globalSetup(config: FullConfig) {
  const baseURL =
    (config.projects[0]?.use?.baseURL as string | undefined) ||
    process.env.PLAYWRIGHT_BASE_URL ||
    "http://localhost:8085";

  const [interno, parceiro, admin] = await Promise.all([
    sessaoInterno(),
    sessaoParceiro(),
    sessaoAdmin(),
  ]);
  gravarStorageState("interno.json", baseURL, interno);
  gravarStorageState("parceiro.json", baseURL, parceiro);
  if (admin) gravarStorageState("admin.json", baseURL, admin);
  else fs.rmSync(path.join(AUTH_DIR, "admin.json"), { force: true });
}

export const STORAGE_INTERNO = path.join(AUTH_DIR, "interno.json");
export const STORAGE_PARCEIRO = path.join(AUTH_DIR, "parceiro.json");
export const STORAGE_ADMIN = path.join(AUTH_DIR, "admin.json");

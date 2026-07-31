// Carrega segredos do .env.local (gitignored) + process.env pros testes E2E.
// Roda em Node (setup/fixtures) — nunca no browser.

import fs from "node:fs";
import path from "node:path";

function lerEnvLocal(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const nome of [".env", ".env.local"]) {
    try {
      const txt = fs.readFileSync(path.join(process.cwd(), nome), "utf8");
      for (const linha of txt.split("\n")) {
        const m = linha.match(/^([A-Z0-9_]+)=(.*)$/);
        if (m) out[m[1]] = m[2].trim().replace(/^"|"$/g, "");
      }
    } catch {
      // arquivo pode não existir (CI usa só process.env)
    }
  }
  return out;
}

const arquivo = lerEnvLocal();

function pega(nome: string, obrigatorio = true): string {
  const v = process.env[nome] ?? arquivo[nome] ?? "";
  if (!v && obrigatorio) {
    throw new Error(
      `Variável ${nome} ausente — defina no .env.local ou no ambiente (CI secrets).`,
    );
  }
  return v;
}

export const ENV = {
  supabaseUrl: pega("VITE_SUPABASE_URL"),
  anonKey: pega("VITE_SUPABASE_PUBLISHABLE_KEY"),
  serviceRoleKey: pega("SUPABASE_SERVICE_ROLE_KEY"),
  // Usuário interno dedicado aos testes (criado pelo auth.setup se não existir).
  internoEmail: process.env.E2E_INTERNO_EMAIL ?? "e2e+interno@marasandraconnect.com",
  internoPassword: pega("E2E_INTERNO_PASSWORD"),
  // Parceira de teste que já existe em produção (login por magic link).
  parceiroEmail: process.env.E2E_PARCEIRO_EMAIL ?? "nairaromerovian+isabella@gmail.com",
};

// Ref do projeto extraído da URL — usado no nome da chave do localStorage
// (sb-<ref>-auth-token) onde o supabase-js guarda a sessão.
export const PROJECT_REF = new URL(ENV.supabaseUrl).hostname.split(".")[0];

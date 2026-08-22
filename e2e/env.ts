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

const supabaseUrl = pega("VITE_SUPABASE_URL");
// Ambiente STAGING (padrão desde a separação dos bancos): a service key e a
// senha dos usuários sintéticos são as do projeto de staging. Se algum dia o
// VITE_SUPABASE_URL local voltar pra produção, os testes seguem coerentes.
const ehStaging = supabaseUrl.includes("alhqbpbekmxpoibrrnbi");

export const ENV = {
  supabaseUrl,
  anonKey: pega("VITE_SUPABASE_PUBLISHABLE_KEY"),
  serviceRoleKey: ehStaging
    ? pega("STAGING_SERVICE_ROLE_KEY")
    : pega("SUPABASE_SERVICE_ROLE_KEY"),
  // Usuário interno dedicado aos testes (criado pelo auth.setup se não existir).
  internoEmail: process.env.E2E_INTERNO_EMAIL ?? "e2e+interno@marasandraconnect.com",
  // No staging todos os usuários sintéticos usam a mesma senha do espelho.
  internoPassword: ehStaging ? pega("STAGING_SYNTH_PASSWORD") : pega("E2E_INTERNO_PASSWORD"),
  // Parceira de teste (login por magic link; e-mail preservado no espelho).
  parceiroEmail: process.env.E2E_PARCEIRO_EMAIL ?? "nairaromerovian+isabella@gmail.com",
  // Admin sintetico (eh_admin=true). So existe no staging — criado por
  // scripts/seed-staging-contas.mjs, mesma senha dos demais sinteticos.
  adminEmail: process.env.E2E_ADMIN_EMAIL ?? "e2e+admin@marasandraconnect.com",
  adminPassword: ehStaging ? pega("STAGING_SYNTH_PASSWORD") : pega("E2E_ADMIN_PASSWORD", false),
  // Cloudflare Access (service token) na frente do staging: quando os dois
  // estiverem definidos, o Playwright manda os headers CF-Access-Client-*.
  // Sem eles, nada muda (staging aberto ou ambiente local).
  cfAccessClientId: pega("CF_ACCESS_CLIENT_ID", false),
  cfAccessClientSecret: pega("CF_ACCESS_CLIENT_SECRET", false),
  // Token da Management API (mesmo do scripts/msc-sql.mjs). Opcional: só o spec
  // de primeiro acesso usa, pra zerar a senha de um usuário e simular convite.
  accessToken: pega("SUPABASE_ACCESS_TOKEN", false),
};

// Ref do projeto extraído da URL — usado no nome da chave do localStorage
// (sb-<ref>-auth-token) onde o supabase-js guarda a sessão.
export const PROJECT_REF = new URL(ENV.supabaseUrl).hostname.split(".")[0];

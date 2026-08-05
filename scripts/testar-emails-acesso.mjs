#!/usr/bin/env node
// testar-emails-acesso.mjs — verifica se o e-mail de acesso realmente CHEGA
// pra cada pessoa cadastrada.
//
// O pipeline testado e o mesmo do dia a dia:
//   supabase auth  ->  hook send-email-hook (edge function)  ->  Resend  ->  caixa
//
// O script dispara um magic link real pra cada destinatario e depois le os logs
// da edge function pra provar que o Resend aceitou cada envio (HTTP 200).
// "Aceito pelo Resend" != "caiu na inbox" — o ultimo metro (spam/inbox) so a
// pessoa confirma olhando a caixa. Por isso o relatorio separa as duas coisas.
//
// Uso:
//   node scripts/testar-emails-acesso.mjs                 # so lista quem seria testado
//   node scripts/testar-emails-acesso.mjs --enviar        # dispara de verdade
//   node scripts/testar-emails-acesso.mjs --enviar --todos          # inclui e-mails reais
//   node scripts/testar-emails-acesso.mjs --enviar --parceiros      # inclui parceiros
//   node scripts/testar-emails-acesso.mjs --enviar --email a@b.com  # so um endereco
//
// Por padrao SO manda pros enderecos alias (`+algo@`), que caem todos na mesma
// caixa — util pra testar sem incomodar o time. `--todos` remove esse filtro.
//
// Credenciais: .env.local (SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY,
// SUPABASE_SERVICE_ROLE_KEY, SUPABASE_ACCESS_TOKEN).

import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

const PROJECT_REF = process.env.SUPABASE_PROJECT_REF || "llugytkdsfsrciavhrfw";

// Intervalo minimo entre 2 e-mails PRO MESMO usuario (smtp_max_frequency=60s no
// config de auth). Entre usuarios diferentes nao ha essa trava, mas espacamos um
// pouco pra nao esbarrar no rate_limit_email_sent (30/hora no projeto).
const PAUSA_ENTRE_ENVIOS_MS = 1500;

function lerEnv(nome) {
  for (const arquivo of [".env.local", ".env"]) {
    try {
      const txt = fs.readFileSync(path.join(process.cwd(), arquivo), "utf8");
      const m = txt.match(new RegExp("^" + nome + "=(.*)$", "m"));
      if (m) return m[1].trim().replace(/^"|"$/g, "");
    } catch {
      // arquivo pode nao existir
    }
  }
  return process.env[nome] || null;
}

const SUPABASE_URL = lerEnv("SUPABASE_URL");
const ANON_KEY = lerEnv("SUPABASE_PUBLISHABLE_KEY");
const SERVICE_KEY = lerEnv("SUPABASE_SERVICE_ROLE_KEY");
const ACCESS_TOKEN = lerEnv("SUPABASE_ACCESS_TOKEN");

if (!SUPABASE_URL || !ANON_KEY || !SERVICE_KEY) {
  console.error(
    "Faltam credenciais no .env.local (SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, SUPABASE_SERVICE_ROLE_KEY).",
  );
  process.exit(1);
}

const args = process.argv.slice(2);
const enviar = args.includes("--enviar");
const incluirTodos = args.includes("--todos");
const incluirParceiros = args.includes("--parceiros");
const emailUnico = (() => {
  const i = args.indexOf("--email");
  return i !== -1 ? args[i + 1] : null;
})();

const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const anon = createClient(SUPABASE_URL, ANON_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const ehAlias = (email) => /\+/.test(email.split("@")[0]);

async function destinatarios() {
  if (emailUnico) return [{ nome: "(avulso)", email: emailUnico, tipo: "?" }];

  const tipos = incluirParceiros ? ["interno", "parceiro"] : ["interno"];
  const { data, error } = await admin
    .from("usuarios")
    .select("nome, email, tipo, ativo")
    .in("tipo", tipos)
    .eq("ativo", true)
    .order("tipo")
    .order("nome");
  if (error) throw new Error("consulta usuarios: " + error.message);

  return data
    .filter((u) => !u.nome?.startsWith("[E2E]"))
    .filter((u) => incluirTodos || ehAlias(u.email));
}

/** Logs da edge function do hook de e-mail, a partir de um instante. */
async function logsDoHook(desdeISO) {
  if (!ACCESS_TOKEN) return null;
  const sql = `
    select function_edge_logs.timestamp, response.status_code
    from function_edge_logs
    cross join unnest(metadata) as m
    cross join unnest(m.response) as response
    cross join unnest(m.request) as request
    where request.url like '%send-email-hook%'
    order by timestamp desc
    limit 200`;
  const url = new URL(
    `https://api.supabase.com/v1/projects/${PROJECT_REF}/analytics/endpoints/logs.all`,
  );
  url.searchParams.set("sql", sql);
  url.searchParams.set("iso_timestamp_start", desdeISO);
  url.searchParams.set(
    "iso_timestamp_end",
    new Date().toISOString().replace(/\.\d+Z$/, ".000Z"),
  );
  const resp = await fetch(url, {
    headers: { Authorization: `Bearer ${ACCESS_TOKEN}` },
  });
  if (!resp.ok) return null;
  const json = await resp.json();
  return json.result ?? null;
}

const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const alvos = await destinatarios();

  console.log(`\nProjeto: ${PROJECT_REF}`);
  console.log(
    `Destinatarios: ${alvos.length}` +
      (incluirTodos ? " (todos)" : " (so alias +algo@)") +
      (incluirParceiros ? " · internos + parceiros" : " · so internos"),
  );
  for (const u of alvos) {
    console.log(`  · ${u.tipo.padEnd(9)} ${u.email.padEnd(42)} ${u.nome ?? ""}`);
  }

  if (!enviar) {
    console.log(
      "\nModo listagem (nenhum e-mail enviado). Rode com --enviar pra disparar de verdade.\n",
    );
    return;
  }

  const inicio = new Date();
  const inicioISO = new Date(inicio.getTime() - 60_000)
    .toISOString()
    .replace(/\.\d+Z$/, ".000Z");

  console.log("\nDisparando magic links...\n");
  const resultados = [];
  for (const u of alvos) {
    const { error } = await anon.auth.signInWithOtp({
      email: u.email,
      options: {
        shouldCreateUser: false,
        emailRedirectTo: "https://marasandraconnect.com/login",
      },
    });
    const ok = !error;
    resultados.push({ ...u, ok, erro: error?.message });
    console.log(`  ${ok ? "OK  " : "FALHA"}  ${u.email}${error ? " — " + error.message : ""}`);
    await dormir(PAUSA_ENTRE_ENVIOS_MS);
  }

  const aceitos = resultados.filter((r) => r.ok).length;

  // Da um tempo pros logs da edge function aparecerem no analytics.
  console.log("\nAguardando os logs do send-email-hook (15s)...");
  await dormir(15_000);
  const logs = await logsDoHook(inicioISO);

  console.log("\n===== RESULTADO =====");
  console.log(`Aceitos pelo Supabase Auth: ${aceitos}/${resultados.length}`);
  const falhas = resultados.filter((r) => !r.ok);
  if (falhas.length) {
    console.log("Falharam no auth:");
    for (const f of falhas) console.log(`  · ${f.email} — ${f.erro}`);
  }

  if (logs === null) {
    console.log(
      "Logs do hook: indisponiveis (falta SUPABASE_ACCESS_TOKEN ou a API recusou).",
    );
  } else {
    const ok200 = logs.filter((l) => l.status_code === 200).length;
    const erros = logs.filter((l) => l.status_code !== 200);
    console.log(`Hook send-email-hook -> Resend: ${ok200} envio(s) com HTTP 200`);
    if (erros.length) {
      console.log("  Invocacoes com erro:");
      for (const e of erros) console.log(`    · status ${e.status_code}`);
    }
    if (ok200 < aceitos) {
      console.log(
        `  ATENCAO: ${aceitos - ok200} e-mail(s) aceitos pelo auth nao aparecem como entregues ao Resend.`,
      );
    }
  }

  console.log(
    "\nUltimo passo (manual): confirme na caixa de entrada — inclusive Spam/Promocoes.",
  );
  console.log("Cada link vale 1 hora e so pode ser usado uma vez.\n");
}

main().catch((e) => {
  console.error("erro:", e.message);
  process.exit(1);
});

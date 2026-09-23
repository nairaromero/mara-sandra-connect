#!/usr/bin/env node
// link-teste-primeiro-acesso.mjs — gera um link de acesso pra TESTAR a tela de
// "criar senha no primeiro acesso" no STAGING.
//
// Por que existe: no staging o envio de e-mail esta desligado
// (hook_send_email_enabled=false), entao o convite nao chega em lugar nenhum.
// E todos os usuarios sinteticos do espelho ja tem senha, entao nenhum deles
// cai na tela nova. Este script resolve os dois: CONVIDA o usuario de teste
// (mesmo estado do convite da tela de Equipe) e imprime o link de uso unico
// pronto pra colar no navegador.
//
// Uso:
//   node scripts/link-teste-primeiro-acesso.mjs
//   node scripts/link-teste-primeiro-acesso.mjs --url https://<preview>.workers.dev
//   node scripts/link-teste-primeiro-acesso.mjs --parceiro   # testa como parceiro
//
// O link vale 1 hora e so pode ser usado UMA vez — rode de novo pra gerar outro.
// Roda sempre contra o STAGING; nunca toca em producao.

import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

const STAGING_REF = "alhqbpbekmxpoibrrnbi";
const URL_PADRAO = "https://staging-mara-sandra-connect.nairaromerovian.workers.dev";

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

const SERVICE_KEY = lerEnv("STAGING_SERVICE_ROLE_KEY");
if (!SERVICE_KEY) {
  console.error("Falta STAGING_SERVICE_ROLE_KEY no .env.local.");
  process.exit(1);
}

const args = process.argv.slice(2);
const ehParceiro = args.includes("--parceiro");
const baseUrl = (() => {
  const i = args.indexOf("--url");
  return (i !== -1 ? args[i + 1] : URL_PADRAO).replace(/\/$/, "");
})();

const SUPABASE_URL = `https://${STAGING_REF}.supabase.co`;
const EMAIL = ehParceiro
  ? "teste+primeiroacesso-parceiro@marasandraconnect.com"
  : "teste+primeiroacesso@marasandraconnect.com";

const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

async function main() {
  // Recria do zero pra garantir o estado "recem convidado" a cada rodada.
  const { data: lista } = await admin.auth.admin.listUsers({ perPage: 1000 });
  const antigo = lista?.users.find((u) => u.email === EMAIL);
  if (antigo) {
    await admin.from("usuarios").delete().eq("id", antigo.id);
    await admin.auth.admin.deleteUser(antigo.id);
  }

  // Convite de verdade (o mesmo inviteUserByEmail da edge convidar-usuario,
  // sem mandar e-mail): a conta nasce convidada e sem senha propria. NAO trocar
  // por createUser + zerar senha — esse estado o produto nao produz, e foi
  // justamente o que escondeu o #362 dos testes.
  const { data: convite, error } = await admin.auth.admin.generateLink({
    type: "invite",
    email: EMAIL,
    options: { redirectTo: `${baseUrl}/login` },
  });
  if (error) throw new Error(`convidar: ${error.message}`);
  const userId = convite.user.id;

  const { error: perfilErr } = await admin.from("usuarios").upsert({
    id: userId,
    nome: ehParceiro ? "[TESTE] Parceiro Novo" : "[TESTE] Primeiro Acesso",
    email: EMAIL,
    tipo: ehParceiro ? "parceiro" : "interno",
    ativo: true,
    // parceiro sem onboarded_em passa por /boas-vindas DEPOIS de criar a senha.
    onboarded_em: ehParceiro ? null : new Date().toISOString(),
  });
  if (perfilErr) throw new Error(`perfil: ${perfilErr.message}`);

  const url =
    `${SUPABASE_URL}/auth/v1/verify?token=${convite.properties.hashed_token}` +
    `&type=invite&redirect_to=${encodeURIComponent(`${baseUrl}/login`)}`;

  console.log(`
Usuario de teste CONVIDADO no STAGING (ainda sem senha propria):
  e-mail : ${EMAIL}
  tipo   : ${ehParceiro ? "parceiro" : "interno"}
  destino: ${baseUrl}

Cole este link no navegador (uso unico, vale 1 hora):

${url}

O que deve acontecer:
  1. entra direto, sem pedir senha;
  2. e desviado pra /definir-senha;
  3. depois de salvar a senha, cai no sistema${ehParceiro ? " (e ai sim vai pro aceite de termos)" : ""};
  4. saindo e entrando de novo, ja da pra usar e-mail + a senha que voce criou.

Rode o script de novo pra gerar um link novo (o antigo queima no primeiro uso).
`);
}

main().catch((e) => {
  console.error("erro:", e.message);
  process.exit(1);
});

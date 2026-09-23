// E2E: quem usa o MCP e com que credencial (#374).
//
// 1. O token do MCP é o controle de acesso: só admin libera o uso (decisão de
//    2026-09-21). Hoje o admin só gera token para si, então o dono do token
//    tem que SEGUIR admin — quem perde o papel perde o MCP na hora. Liberar
//    para outra pessoa é a #385 (lá voltam os testes de RLS do parceiro, que
//    estavam neste spec no commit c186c76).
// 2. As ferramentas rodam com a SESSÃO do dono, nunca com service role. Até
//    2026-09 o ia-mcp cunhava um JWT HS256 com SUPABASE_JWT_SECRET e, como o
//    Supabase deixou de injetar esse segredo, caía calado para service role.
//    Sem sessão possível, a chamada falha com 503.
//
// Tudo via API, com contas descartáveis (nunca as e2e+ compartilhadas). Contra
// o staging, só depois do deploy da function lá.

import { test, expect } from "@playwright/test";
import { createHash, randomBytes } from "node:crypto";
import { ENV } from "../env";
import { adminClient, cleanupE2E, MARCADOR, seedClienteCaso } from "../supabase-admin";

const admin = adminClient();
const MCP = `${ENV.supabaseUrl}/functions/v1/ia-mcp`;
const EMAILS = {
  admin: "e2e+mcp-admin@marasandraconnect.com",
  interno: "e2e+mcp-interno@marasandraconnect.com",
  parceiro: "e2e+mcp-parceiro@marasandraconnect.com",
  banido: "e2e+mcp-banido@marasandraconnect.com",
};

const ids: Record<keyof typeof EMAILS, string> = { admin: "", interno: "", parceiro: "", banido: "" };
const tokens: Record<keyof typeof EMAILS, string> = { admin: "", interno: "", parceiro: "", banido: "" };
let casoId: string;

async function apagarConta(email: string) {
  const { data: lista } = await admin.auth.admin.listUsers({ perPage: 1000 });
  const id = lista?.users.find((u) => u.email === email)?.id;
  if (!id) return;
  await admin.from("ia_tokens").delete().eq("usuario_id", id);
  await admin.from("ia_acoes").delete().eq("usuario_id", id);
  await admin.from("comentarios").delete().eq("autor_id", id);
  await admin.from("casos").delete().eq("parceiro_id", id);
  await admin.from("usuarios").delete().eq("id", id);
  await admin.auth.admin.deleteUser(id);
}

async function criarConta(email: string, tipo: "interno" | "parceiro", ehAdmin: boolean) {
  const { data, error } = await admin.auth.admin.createUser({ email, email_confirm: true });
  if (error || !data.user) throw new Error(`criar ${email}: ${error?.message}`);
  const agora = new Date().toISOString();
  const { error: perfilErr } = await admin.from("usuarios").upsert({
    id: data.user.id,
    email,
    nome: `${MARCADOR} MCP ${email.split("@")[0].split("-").pop()}`,
    tipo,
    eh_admin: ehAdmin,
    eh_parceiro: tipo === "parceiro",
    ativo: true,
    onboarded_em: agora,
    aceitou_termos_em: agora,
  });
  if (perfilErr) throw new Error(`perfil ${email}: ${perfilErr.message}`);
  return data.user.id;
}

// Grava o token direto no banco: simula token que já existe (ex.: de alguém
// que era admin quando gerou). Quem gera pela tela é o ia-config, só para admin.
async function criarToken(usuarioId: string) {
  const token = "msc_" + randomBytes(32).toString("base64url");
  const { error } = await admin.from("ia_tokens").insert({
    usuario_id: usuarioId,
    nome: `${MARCADOR} MCP`,
    token_hash: createHash("sha256").update(token).digest("hex"),
    prefixo: token.slice(0, 12),
    escopo: "completo",
  });
  if (error) throw new Error(`token: ${error.message}`);
  return token;
}

let seq = 0;
async function chamar(token: string, method: string, params: Record<string, unknown> = {}) {
  const r = await fetch(MCP, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: ++seq, method, params }),
  });
  const corpo = await r.json().catch(() => null);
  const texto: string = corpo?.result?.content?.[0]?.text ?? "";
  return { status: r.status, corpo, texto, erroTool: corpo?.result?.isError === true };
}

async function ultimoLogin(id: string) {
  const { data, error } = await admin.auth.admin.getUserById(id);
  if (error) throw new Error(`getUserById: ${error.message}`);
  return data.user.last_sign_in_at ?? null;
}

test.describe.serial("ia-mcp: acesso e sessão", () => {
  test.beforeAll(async () => {
    for (const email of Object.values(EMAILS)) await apagarConta(email); // sobra de run interrompido

    ids.admin = await criarConta(EMAILS.admin, "interno", true);
    ids.interno = await criarConta(EMAILS.interno, "interno", false);
    ids.parceiro = await criarConta(EMAILS.parceiro, "parceiro", false);
    ids.banido = await criarConta(EMAILS.banido, "interno", true);
    // Admin ativo no perfil, banido no Auth: a sessão não abre.
    await admin.auth.admin.updateUserById(ids.banido, { ban_duration: "1h" });

    for (const k of Object.keys(ids) as Array<keyof typeof ids>) tokens[k] = await criarToken(ids[k]);
    ({ casoId } = await seedClienteCaso(admin, { sufixo: `MCP ${Date.now()}`, parceiroId: ids.parceiro }));
  });

  test.afterAll(async () => {
    await cleanupE2E(admin);
    for (const email of Object.values(EMAILS)) await apagarConta(email);
  });

  test("admin: ferramentas rodam com a sessão dele", async () => {
    const antes = await ultimoLogin(ids.admin);
    const busca = await chamar(tokens.admin, "tools/call", { name: "buscar_casos", arguments: { limite: 5 } });
    expect(busca.status).toBe(200);
    expect(busca.erroTool, busca.texto).toBe(false);
    // Service role não abre sessão; a sessão da pessoa atualiza o último login.
    // Era exatamente o que não acontecia antes do #374.
    expect(await ultimoLogin(ids.admin)).not.toBe(antes);

    const comentario = await chamar(tokens.admin, "tools/call", {
      name: "criar_comentario",
      arguments: { caso_id: casoId, texto: `${MARCADOR} MCP admin` },
    });
    expect(comentario.erroTool, comentario.texto).toBe(false);
  });

  test("quem não é admin não usa o MCP, mesmo com token", async () => {
    for (const papel of ["parceiro", "interno"] as const) {
      const antes = await ultimoLogin(ids[papel]);
      const r = await chamar(tokens[papel], "tools/call", { name: "buscar_casos", arguments: { limite: 1 } });
      expect(r.status, `${papel} tinha que ser recusado`).toBe(403);
      // Recusado antes de abrir sessão.
      expect(await ultimoLogin(ids[papel])).toBe(antes);
      expect((await chamar(tokens[papel], "initialize")).status).toBe(403);
    }
  });

  test("admin rebaixado perde o MCP na hora, sem revogar o token", async () => {
    const { error } = await admin.from("usuarios").update({ eh_admin: false }).eq("id", ids.admin);
    expect(error).toBeNull();
    const r = await chamar(tokens.admin, "tools/call", { name: "buscar_casos", arguments: { limite: 1 } });
    expect(r.status).toBe(403);
  });

  test("sem sessão possível: 503, nunca service role", async () => {
    const r = await chamar(tokens.banido, "tools/call", { name: "buscar_casos", arguments: { limite: 1 } });
    expect(r.status).toBe(503);
    // O que não roda ferramenta segue respondendo (o cliente MCP não cai).
    expect((await chamar(tokens.banido, "initialize")).status).toBe(200);
  });
});

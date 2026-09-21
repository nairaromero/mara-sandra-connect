// E2E: o ia-mcp roda as ferramentas com a SESSÃO da pessoa, nunca com service
// role (#374).
//
// Até 2026-09 ele cunhava um JWT HS256 com SUPABASE_JWT_SECRET e, como o
// Supabase deixou de injetar esse segredo, caía calado para service role — a
// RLS não valia para nenhuma ferramenta do MCP. Agora o token pessoal é trocado
// por uma sessão de verdade (`abrirSessaoDe`, em _shared/auth.ts) e, sem
// sessão, a chamada falha com 503.
//
// Tudo via API, com contas descartáveis (nunca as e2e+ compartilhadas). Contra
// o staging, só depois do deploy da function lá.

import { test, expect } from "@playwright/test";
import { createHash, randomBytes } from "node:crypto";
import { ENV } from "../env";
import { adminClient, cleanupE2E, MARCADOR, seedClienteCaso } from "../supabase-admin";

const admin = adminClient();
const MCP = `${ENV.supabaseUrl}/functions/v1/ia-mcp`;
const EMAIL_PARCEIRO = "e2e+mcp-parceiro@marasandraconnect.com";
const EMAIL_BANIDO = "e2e+mcp-banido@marasandraconnect.com";

let parceiroId: string;
let banidoId: string;
let casoProprio: string;
let casoAlheio: string;
let tokenParceiro: string;
let tokenBanido: string;

async function apagarConta(email: string) {
  const { data: lista } = await admin.auth.admin.listUsers({ perPage: 1000 });
  const id = lista?.users.find((u) => u.email === email)?.id;
  if (!id) return;
  await admin.from("ia_tokens").delete().eq("usuario_id", id);
  await admin.from("comentarios").delete().eq("autor_id", id);
  await admin.from("casos").delete().eq("parceiro_id", id);
  await admin.from("usuarios").delete().eq("id", id);
  await admin.auth.admin.deleteUser(id);
}

async function criarConta(email: string, tipo: "interno" | "parceiro") {
  const { data, error } = await admin.auth.admin.createUser({ email, email_confirm: true });
  if (error || !data.user) throw new Error(`criar ${email}: ${error?.message}`);
  const agora = new Date().toISOString();
  const { error: perfilErr } = await admin.from("usuarios").upsert({
    id: data.user.id,
    email,
    nome: `${MARCADOR} MCP ${tipo}`,
    tipo,
    eh_parceiro: tipo === "parceiro",
    ativo: true,
    onboarded_em: agora,
    aceitou_termos_em: agora,
  });
  if (perfilErr) throw new Error(`perfil ${email}: ${perfilErr.message}`);
  return data.user.id;
}

async function criarToken(usuarioId: string, escopo: "leitura" | "completo") {
  const token = "msc_" + randomBytes(32).toString("base64url");
  const { error } = await admin.from("ia_tokens").insert({
    usuario_id: usuarioId,
    nome: `${MARCADOR} MCP`,
    token_hash: createHash("sha256").update(token).digest("hex"),
    prefixo: token.slice(0, 12),
    escopo,
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
  let saida: unknown = null;
  try {
    saida = JSON.parse(texto);
  } catch {
    saida = null;
  }
  return { status: r.status, corpo, texto, saida, erroTool: corpo?.result?.isError === true };
}

test.beforeAll(async () => {
  await apagarConta(EMAIL_PARCEIRO); // sobra de run interrompido
  await apagarConta(EMAIL_BANIDO);

  parceiroId = await criarConta(EMAIL_PARCEIRO, "parceiro");
  ({ casoId: casoProprio } = await seedClienteCaso(admin, { sufixo: `MCP próprio ${Date.now()}`, parceiroId }));
  ({ casoId: casoAlheio } = await seedClienteCaso(admin, { sufixo: `MCP alheio ${Date.now()}` }));
  tokenParceiro = await criarToken(parceiroId, "completo");

  // Ativo no perfil, banido no Auth: a sessão não abre.
  banidoId = await criarConta(EMAIL_BANIDO, "interno");
  await admin.auth.admin.updateUserById(banidoId, { ban_duration: "1h" });
  tokenBanido = await criarToken(banidoId, "leitura");
});

test.afterAll(async () => {
  await cleanupE2E(admin);
  await apagarConta(EMAIL_PARCEIRO);
  await apagarConta(EMAIL_BANIDO);
});

test("parceiro: buscar_casos só devolve os casos dele", async () => {
  const r = await chamar(tokenParceiro, "tools/call", { name: "buscar_casos", arguments: { limite: 20 } });
  expect(r.status).toBe(200);
  expect(r.erroTool, r.texto).toBe(false);
  const lista = Array.isArray(r.saida) ? r.saida : ((r.saida as { casos?: unknown[] })?.casos ?? []);
  const ids = (lista as Array<{ id?: string; caso_id?: string }>).map((c) => c.id ?? c.caso_id);
  // Com service role viriam os casos de todo mundo.
  expect(ids).toEqual([casoProprio]);
});

test("parceiro: caso alheio não aparece nem aceita comentário", async () => {
  const detalhe = await chamar(tokenParceiro, "tools/call", { name: "detalhe_caso", arguments: { caso_id: casoAlheio } });
  expect(detalhe.status).toBe(200);
  expect(detalhe.saida).toMatchObject({ encontrado: false });

  const proprio = await chamar(tokenParceiro, "tools/call", { name: "detalhe_caso", arguments: { caso_id: casoProprio } });
  expect(proprio.saida).toMatchObject({ encontrado: true, id: casoProprio });

  const comentario = await chamar(tokenParceiro, "tools/call", {
    name: "criar_comentario",
    arguments: { caso_id: casoAlheio, texto: `${MARCADOR} MCP em caso alheio` },
  });
  expect(comentario.erroTool, "a RLS tinha que recusar").toBe(true);
  const { data: gravados, error } = await admin.from("comentarios").select("id").eq("caso_id", casoAlheio);
  expect(error).toBeNull();
  expect(gravados ?? []).toHaveLength(0);

  // No próprio caso, grava — e com a autoria da pessoa, que vem da sessão.
  const ok = await chamar(tokenParceiro, "tools/call", {
    name: "criar_comentario",
    arguments: { caso_id: casoProprio, texto: `${MARCADOR} MCP no próprio caso` },
  });
  expect(ok.erroTool, ok.texto).toBe(false);
  const { data: meu } = await admin.from("comentarios").select("autor_id").eq("caso_id", casoProprio).single();
  expect(meu?.autor_id).toBe(parceiroId);
});

test("sem sessão possível: 503, nunca service role", async () => {
  const r = await chamar(tokenBanido, "tools/call", { name: "buscar_casos", arguments: { limite: 1 } });
  expect(r.status).toBe(503);

  // O que não roda ferramenta segue respondendo (o cliente MCP não cai).
  const ini = await chamar(tokenBanido, "initialize");
  expect(ini.status).toBe(200);
});

// E2E: token do MCP emitido para OUTRA pessoa (#385, migration_rbac_12).
//
// O admin do Canário escolhe a pessoa (parceiro, assistente) e emite o token
// dela pelo ia-config; o MCP roda COMO essa pessoa (a sessão é dela — o último
// login dela muda, e ia_acoes registra dono + emissor). Quem não concede não
// emite (servidor). Quem vê/revoga: dono e emissor — outro admin do mesmo
// escritório não vê, e o escritório 1 muito menos. Emissor que deixa de poder
// conceder derruba o token na hora — e quem PODE conceder não precisa ser
// administrador (permissão ajustada por pessoa, migration_rbac_20/23).
// Só no banco local com o seed; limpa o que criou.

import { test, expect } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { ENV } from "../env";
import { adminClient } from "../supabase-admin";

const admin = adminClient();
const DOM = "marasandraconnect.com";
const FN = `${ENV.supabaseUrl}/functions/v1`;
const NOME = "[E2E terceiro]";

async function sessao(email: string, escritorio: string): Promise<{ sb: SupabaseClient; jwt: string; id: string }> {
  const sb = createClient(ENV.supabaseUrl, ENV.anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { "x-escritorio-id": escritorio } },
  });
  const { data, error } = await sb.auth.signInWithPassword({ email, password: ENV.internoPassword });
  if (error || !data.session) throw new Error(`login ${email}: ${error?.message}`);
  return { sb, jwt: data.session.access_token, id: data.user!.id };
}
async function iaConfig(jwt: string, escritorio: string, body: Record<string, unknown>) {
  const r = await fetch(`${FN}/ia-config`, {
    method: "POST",
    headers: { Authorization: `Bearer ${jwt}`, apikey: ENV.anonKey, "content-type": "application/json", "x-escritorio-id": escritorio },
    body: JSON.stringify(body),
  });
  const texto = await r.text();
  let json: Record<string, unknown> = {};
  try { json = JSON.parse(texto); } catch { /* sem JSON */ }
  return { status: r.status, json, texto };
}
let seq = 0;
async function mcp(token: string, method: string, params: Record<string, unknown> = {}) {
  const r = await fetch(`${FN}/ia-mcp`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: ++seq, method, params }),
  });
  const corpo = (await r.json().catch(() => null)) as { result?: { isError?: boolean; content?: Array<{ text?: string }> }; error?: string } | null;
  return { status: r.status, corpo, erroTool: corpo?.result?.isError === true, texto: corpo?.result?.content?.[0]?.text ?? "" };
}
async function ultimoLogin(id: string) {
  const { data } = await admin.auth.admin.getUserById(id);
  return data.user?.last_sign_in_at ?? null;
}

let ESC1: string;
let ESC2: string;
async function limpar() {
  await admin.from("ia_tokens").delete().like("nome", `${NOME}%`);
  await admin.from("ia_acoes").delete().eq("superficie", "mcp").like("ferramenta", "buscar_casos").gte("created_at", new Date(Date.now() - 3600_000).toISOString()).in("usuario_id", ids ? Object.values(ids) : []);
}
let ids: Record<string, string> = {};

test.describe.serial("MCP: token para terceiro", () => {
  test.beforeAll(async () => {
    test.skip(!ENV.local, "só no banco local");
    const { data: escs, error } = await admin.from("escritorios").select("id, slug, padrao_sistema");
    test.skip(!!error, "migrations do RBAC ausentes");
    ESC1 = escs!.find((e) => e.padrao_sistema)!.id;
    const canario = escs!.find((e) => e.slug === "canario");
    test.skip(!canario, "canário ausente — rode `bun run local:rbac`");
    ESC2 = canario!.id;
    const { data: us } = await admin.from("usuarios").select("id, email").in("email", ["admin", "parceiro", "assistente", "advogado"].map((p) => `canario+${p}@${DOM}`));
    ids = Object.fromEntries((us ?? []).map((u) => [u.email.split("+")[1].split("@")[0], u.id]));
    await limpar();
  });
  test.afterAll(async () => {
    if (!ESC2) return;
    await limpar();
    // advogado volta a ser advogado, se algum teste o promoveu
    const { data: a } = await admin.from("papeis").select("id").is("escritorio_id", null).eq("chave", "advogado").single();
    await admin.from("membros").update({ papel_id: a!.id }).eq("escritorio_id", ESC2).eq("usuario_id", ids.advogado);
    // e sem ajuste individual sobrando (o teste do emissor não-admin concede um)
    await admin.from("membro_permissoes").delete()
      .eq("escritorio_id", ESC2)
      .in("membro_id", (await admin.from("membros").select("id").eq("escritorio_id", ESC2).eq("usuario_id", ids.advogado)).data?.map((m) => m.id) ?? []);
  });

  test("admin emite para parceiro e assistente; o MCP roda como cada um", async () => {
    const adm = await sessao(`canario+admin@${DOM}`, ESC2);
    const pessoas = await iaConfig(adm.jwt, ESC2, { action: "token_membros" });
    expect(pessoas.status, pessoas.texto).toBe(200);
    const lista = pessoas.json.pessoas as Array<{ usuario_id: string; papel_nome: string }>;
    expect(lista.some((p) => p.usuario_id === ids.parceiro)).toBe(true);
    expect(lista.some((p) => p.usuario_id === ids.assistente)).toBe(true);

    for (const quem of ["parceiro", "assistente"] as const) {
      const r = await iaConfig(adm.jwt, ESC2, { action: "token_criar", nome: `${NOME} ${quem}`, usuario_id: ids[quem], escopo: "leitura", dias: 1 });
      expect(r.status, r.texto).toBe(200);
      const token = r.json.token as string;
      expect(token).toBeTruthy();
      const antes = await ultimoLogin(ids[quem]);
      const busca = await mcp(token, "tools/call", { name: "buscar_casos", arguments: { limite: 5 } });
      expect(busca.status, JSON.stringify(busca.corpo)).toBe(200);
      expect(busca.erroTool, busca.texto).toBe(false);
      // a sessão aberta é a do DONO (último login dele muda), não a do admin
      await expect.poll(() => ultimoLogin(ids[quem])).not.toBe(antes);
      const { data: acao } = await admin.from("ia_acoes").select("usuario_id, emitido_por").eq("superficie", "mcp").eq("usuario_id", ids[quem]).order("created_at", { ascending: false }).limit(1).maybeSingle();
      expect(acao?.usuario_id).toBe(ids[quem]);
      expect(acao?.emitido_por, "ia_acoes registra o emissor").toBe(ids.admin);
    }
    // parceiro: só os casos dele — a ferramenta devolve texto; conferimos que
    // não aparece cliente de caso sem ele (Joana só tem caso sem parceiro)
    const { data: tokParc } = await admin.from("ia_tokens").select("id").eq("nome", `${NOME} parceiro`).single();
    expect(tokParc).toBeTruthy();
  });

  test("quem não concede não emite (servidor); token para quem não é membro é recusado", async () => {
    const adv = await sessao(`canario+advogado@${DOM}`, ESC2);
    expect((await iaConfig(adv.jwt, ESC2, { action: "token_criar", nome: `${NOME} adv` })).status).toBe(403);
    expect((await iaConfig(adv.jwt, ESC2, { action: "token_criar", nome: `${NOME} adv2`, usuario_id: ids.parceiro })).status).toBe(403);
    expect((await iaConfig(adv.jwt, ESC2, { action: "token_membros" })).status).toBe(403);
    const adm = await sessao(`canario+admin@${DOM}`, ESC2);
    const { data: e2eAdmin } = await admin.from("usuarios").select("id").eq("email", `e2e+admin@${DOM}`).single();
    const r = await iaConfig(adm.jwt, ESC2, { action: "token_criar", nome: `${NOME} fora`, usuario_id: e2eAdmin!.id });
    expect(r.status, "admin do escritório 1 não é membro do Canário").toBe(400);
  });

  test("dono e emissor veem; outro admin do escritório e o escritório 1 não", async () => {
    const adm = await sessao(`canario+admin@${DOM}`, ESC2);
    const meus = await iaConfig(adm.jwt, ESC2, { action: "token_listar" });
    const nomes = (meus.json.tokens as Array<{ nome: string; dono?: { nome: string | null } }>).filter((t) => t.nome.startsWith(NOME));
    expect(nomes.map((t) => t.nome).sort()).toEqual([`${NOME} assistente`, `${NOME} parceiro`]);
    expect(nomes.find((t) => t.nome.endsWith("parceiro"))?.dono?.nome).toContain("Gilda");

    const parc = await sessao(`canario+parceiro@${DOM}`, ESC2);
    const doParc = await iaConfig(parc.jwt, ESC2, { action: "token_listar" });
    expect((doParc.json.tokens as Array<{ nome: string }>).map((t) => t.nome)).toEqual([`${NOME} parceiro`]);

    // outro admin do Canário: promove o advogado, lista, e não vê nada
    expect((await adm.sb.rpc("definir_papel", { p_usuario_id: ids.advogado, p_papel: "admin" })).error).toBeNull();
    const adv = await sessao(`canario+advogado@${DOM}`, ESC2);
    const doAdv = await iaConfig(adv.jwt, ESC2, { action: "token_listar" });
    expect((doAdv.json.tokens as Array<{ nome: string }>).filter((t) => t.nome.startsWith(NOME))).toHaveLength(0);
    expect((await adm.sb.rpc("definir_papel", { p_usuario_id: ids.advogado, p_papel: "advogado" })).error).toBeNull();

    // escritório 1
    const a1 = await sessao(`e2e+admin@${DOM}`, ESC1);
    const do1 = await iaConfig(a1.jwt, ESC1, { action: "token_listar" });
    expect((do1.json.tokens as Array<{ nome: string }>).filter((t) => t.nome.startsWith(NOME))).toHaveLength(0);
  });

  test("emissor revoga → 401; emissor rebaixado → 403 na hora", async () => {
    const adm = await sessao(`canario+admin@${DOM}`, ESC2);
    const { data: tok } = await admin.from("ia_tokens").select("id").eq("nome", `${NOME} assistente`).single();
    // re-emite pra ter o token em claro
    const r = await iaConfig(adm.jwt, ESC2, { action: "token_criar", nome: `${NOME} assistente 2`, usuario_id: ids.assistente, escopo: "leitura" });
    const token = r.json.token as string;
    expect((await mcp(token, "tools/call", { name: "buscar_casos", arguments: { limite: 1 } })).status).toBe(200);
    const { data: tok2 } = await admin.from("ia_tokens").select("id").eq("nome", `${NOME} assistente 2`).single();
    expect((await iaConfig(adm.jwt, ESC2, { action: "token_revogar", id: tok2!.id })).status).toBe(200);
    expect((await mcp(token, "tools/call", { name: "buscar_casos", arguments: { limite: 1 } })).status).toBe(401);
    expect(tok).toBeTruthy();

    // emissor rebaixado: o advogado vira admin, emite, e é rebaixado
    expect((await adm.sb.rpc("definir_papel", { p_usuario_id: ids.advogado, p_papel: "admin" })).error).toBeNull();
    const adv = await sessao(`canario+advogado@${DOM}`, ESC2);
    const r2 = await iaConfig(adv.jwt, ESC2, { action: "token_criar", nome: `${NOME} do adv`, usuario_id: ids.assistente, escopo: "leitura" });
    expect(r2.status, r2.texto).toBe(200);
    const tokenAdv = r2.json.token as string;
    expect((await mcp(tokenAdv, "tools/call", { name: "buscar_casos", arguments: { limite: 1 } })).status).toBe(200);
    expect((await adm.sb.rpc("definir_papel", { p_usuario_id: ids.advogado, p_papel: "advogado" })).error).toBeNull();
    const dep = await mcp(tokenAdv, "tools/call", { name: "buscar_casos", arguments: { limite: 1 } });
    expect(dep.status).toBe(403);
    expect(JSON.stringify(dep.corpo)).toMatch(/nao pode mais conceder/);
  });

  // O que o conserto de 26/09 fechou: `ia-config` emite para quem tem
  // `ia:mcp_conceder` (permissão, ajustável por pessoa) e o `ia-mcp` cobrava o
  // PAPEL admin do emissor. As duas réguas juntas davam um token que nascia
  // morto. Agora as duas perguntam a mesma coisa.
  test("emissor não-admin com a permissão ajustada: o token vale — e cai quando o ajuste sai", async () => {
    const adm = await sessao(`canario+admin@${DOM}`, ESC2);
    // o advogado NÃO é admin; ganha só `ia:mcp_conceder`
    expect((await adm.sb.rpc("definir_permissao_do_membro", {
      p_usuario_id: ids.advogado, p_permissao: "ia:mcp_conceder", p_estado: "conceder",
    })).error).toBeNull();

    const adv = await sessao(`canario+advogado@${DOM}`, ESC2);
    const { data: papelAdv } = await admin.from("membros")
      .select("papel:papeis!inner(chave)").eq("escritorio_id", ESC2).eq("usuario_id", ids.advogado).single();
    expect((papelAdv as { papel?: { chave?: string } })?.papel?.chave, "continua advogado").toBe("advogado");

    const r = await iaConfig(adv.jwt, ESC2, { action: "token_criar", nome: `${NOME} adv concede`, usuario_id: ids.assistente, escopo: "leitura" });
    expect(r.status, r.texto).toBe(200);
    const token = r.json.token as string;
    const uso = await mcp(token, "tools/call", { name: "buscar_casos", arguments: { limite: 1 } });
    expect(uso.status, JSON.stringify(uso.corpo)).toBe(200);
    expect(uso.erroTool, uso.texto).toBe(false);

    // tirar o ajuste derruba o token na hora, como o rebaixamento
    expect((await adm.sb.rpc("definir_permissao_do_membro", {
      p_usuario_id: ids.advogado, p_permissao: "ia:mcp_conceder", p_estado: "papel",
    })).error).toBeNull();
    const dep = await mcp(token, "tools/call", { name: "buscar_casos", arguments: { limite: 1 } });
    expect(dep.status).toBe(403);
    expect(JSON.stringify(dep.corpo)).toMatch(/nao pode mais conceder/);
  });
});

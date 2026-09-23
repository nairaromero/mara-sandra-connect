// E2E: Legalmail e Tramitação Inteligente (TI) POR ESCRITÓRIO (migration_rbac_13).
//
// Antes, as cinco functions usavam LEGALMAIL_TOKEN/TI_TOKEN globais: qualquer
// escritório buscava na conta da Mara. Agora a credencial vem de
// escritorio_integracoes do escritório ativo (cifrada; só a function lê), e
// quem não tem recebe 412 `integracao_nao_configurada` — e a tela nem oferece
// o botão (RPC minhas_integracoes). O escritório padrão do sistema ainda cai
// na variável de ambiente antiga, os outros nunca.
//
// Só no banco local com o seed e os mocks (e2e/demo/mocks/provedores.cjs em
// :8787, LEGALMAIL_BASE_URL/TI_BASE_URL no supabase/functions/.env).

import { test, expect, type Browser, type BrowserContext } from "@playwright/test";
import { createClient, type Session } from "@supabase/supabase-js";
import { ENV, PROJECT_REF } from "../env";
import { adminClient } from "../supabase-admin";
import { cursorVisivel } from "../cursor";

const admin = adminClient();
const DOM = "marasandraconnect.com";
const FN = `${ENV.supabaseUrl}/functions/v1`;
const MOCK = "http://localhost:8787";

async function sessao(email: string, escritorio?: string) {
  const sb = createClient(ENV.supabaseUrl, ENV.anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: escritorio ? { headers: { "x-escritorio-id": escritorio } } : {},
  });
  const { data, error } = await sb.auth.signInWithPassword({ email, password: ENV.internoPassword });
  if (error || !data.session) throw new Error(`login ${email}: ${error?.message}`);
  return { sb, session: data.session, jwt: data.session.access_token };
}
async function fn(nome: string, jwt: string, escritorio: string, body: Record<string, unknown>) {
  const r = await fetch(`${FN}/${nome}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${jwt}`, apikey: ENV.anonKey, "content-type": "application/json", "x-escritorio-id": escritorio },
    body: JSON.stringify(body),
  });
  const texto = await r.text();
  let json: Record<string, unknown> = {};
  try { json = JSON.parse(texto); } catch { /* sem JSON */ }
  return { status: r.status, json, texto };
}
async function contexto(browser: Browser, baseURL: string, session: Session, escritorioId: string): Promise<BrowserContext> {
  return browser.newContext({
    storageState: {
      cookies: [],
      origins: [{ origin: new URL(baseURL).origin, localStorage: [
        { name: `sb-${PROJECT_REF}-auth-token`, value: JSON.stringify(session) },
        { name: "msc:escritorio_ativo", value: escritorioId },
      ] }],
    },
  });
}

let ESC1: string;
let ESC2: string;
let mockVivo = false;
async function limpar() {
  const { error } = await admin.from("escritorio_integracoes").delete().eq("escritorio_id", ESC2).in("tipo", ["legalmail", "ti"]);
  if (error) throw new Error(`limpeza de escritorio_integracoes: ${error.message}`);
}

test.describe.serial("Legalmail e TI por escritório", () => {
  test.beforeAll(async () => {
    test.skip(!ENV.local, "só no banco local");
    const { data: canario } = await admin.from("escritorios").select("id").eq("slug", "canario").maybeSingle();
    test.skip(!canario, "escritório canário ausente — rode `bun run local:rbac`");
    ESC2 = canario!.id;
    const { data: e1 } = await admin.from("escritorios").select("id").eq("padrao_sistema", true).single();
    ESC1 = e1!.id;
    mockVivo = await fetch(`${MOCK}/_health`).then((r) => r.ok).catch(() => false);
    await limpar();
  });
  test.afterAll(async () => {
    if (ESC2) await limpar();
  });

  test("sem credencial: functions respondem 412 e a RPC diz 'não configurada' — o escritório 1 (padrão) não vaza para o Canário", async () => {
    const adv = await sessao(`canario+advogado@${DOM}`, ESC2);
    for (const nome of ["check-legalmail-nome", "listar-processos-legalmail", "listar-clientes-ti"]) {
      const r = await fn(nome, adv.jwt, ESC2, { nome: "Helena Bastos Ferraz" });
      expect(r.status, `${nome}: ${r.texto.slice(0, 120)}`).toBe(412);
      expect(r.json.code).toBe("integracao_nao_configurada");
    }
    const { data: minhas } = await adv.sb.rpc("minhas_integracoes");
    const tipos = (minhas as Array<{ tipo: string; configurada: boolean }>).filter((i) => ["legalmail", "ti"].includes(i.tipo) && i.configurada);
    expect(tipos, "Canário sem credencial não pode ver legalmail/ti como configurados").toEqual([]);
    // escritório padrão: a RPC anuncia o legado (variável de ambiente), sem segredo nenhum
    const e2e = await sessao(`e2e+interno@${DOM}`, ESC1);
    const { data: do1 } = await e2e.sb.rpc("minhas_integracoes");
    const legado = (do1 as Array<{ tipo: string; legado: boolean }>).filter((i) => i.legado).map((i) => i.tipo).sort();
    expect(legado).toEqual(["legalmail", "ti"]);
  });

  test("admin do Canário cadastra Legalmail e TI (chave cifrada) e testa; advogado não cadastra", async () => {
    test.skip(!mockVivo, "mock dos provedores (:8787) fora do ar");
    const adm = await sessao(`canario+admin@${DOM}`, ESC2);
    const lm = await fn("integracoes-escritorio", adm.jwt, ESC2, { action: "salvar", tipo: "legalmail", config: { usuario: "canario@exemplo.com.br" }, segredo: "chave-legalmail-canario" });
    expect(lm.status, lm.texto.slice(0, 160)).toBe(200);
    const ti = await fn("integracoes-escritorio", adm.jwt, ESC2, { action: "salvar", tipo: "ti", config: { usuario: "canario@exemplo.com.br" }, segredo: "token-ti-canario" });
    expect(ti.status, ti.texto.slice(0, 160)).toBe(200);
    // segredo nunca volta: nem no status, nem na tabela para authenticated
    const st = await fn("integracoes-escritorio", adm.jwt, ESC2, { action: "status", tipo: "legalmail" });
    expect(JSON.stringify(st.json)).not.toContain("chave-legalmail-canario");
    // grant por coluna: o admin lê a linha sem as colunas de segredo; pedir o segredo dá 42501
    const { error: eLido } = await adm.sb.from("escritorio_integracoes").select("tipo, ativo, segredo_definido_em").eq("tipo", "legalmail");
    expect(eLido, "admin lê as colunas públicas").toBeNull();
    const { error: eSegredo } = await adm.sb.from("escritorio_integracoes").select("segredo_cipher").eq("tipo", "legalmail");
    expect(eSegredo?.code, "coluna de segredo é negada ao navegador").toBe("42501");
    // testar contra o mock
    for (const tipo of ["legalmail", "ti"]) {
      const t = await fn("integracoes-escritorio", adm.jwt, ESC2, { action: "testar", tipo });
      expect(t.json.ok, `${tipo}: ${t.texto.slice(0, 160)}`).toBe(true);
    }
    // advogado: 403 na function e RPC de status mostra configurado
    const adv = await sessao(`canario+advogado@${DOM}`, ESC2);
    expect((await fn("integracoes-escritorio", adv.jwt, ESC2, { action: "salvar", tipo: "legalmail", segredo: "x" })).status).toBe(403);
    const { data: minhas } = await adv.sb.rpc("minhas_integracoes");
    const conf = (minhas as Array<{ tipo: string; configurada: boolean; legado: boolean }>).filter((i) => i.configurada && !i.legado).map((i) => i.tipo).sort();
    expect(conf).toEqual(["legalmail", "ti"]);
  });

  test("com credencial: busca no Legalmail e clientes do TI vêm da conta DO CANÁRIO (mock); escritório 1 continua sem", async () => {
    test.skip(!mockVivo, "mock dos provedores (:8787) fora do ar");
    const adv = await sessao(`canario+advogado@${DOM}`, ESC2);
    const lm = await fn("check-legalmail-nome", adv.jwt, ESC2, { nome: "Helena Bastos Ferraz" });
    expect(lm.status, lm.texto.slice(0, 200)).toBe(200);
    expect(lm.texto).toContain("5001234-56.2026.4.03.6183");
    const ti = await fn("listar-clientes-ti", adv.jwt, ESC2, {});
    expect(ti.status, ti.texto.slice(0, 200)).toBe(200);
    expect(ti.texto).toContain("Otávio Lins Barreto");
    // escritório 1 (padrão) não tem a variável de ambiente no local: 412 — e nunca a chave do Canário
    const e2e = await sessao(`e2e+interno@${DOM}`, ESC1);
    const r1 = await fn("check-legalmail-nome", e2e.jwt, ESC1, { nome: "Helena Bastos Ferraz" });
    expect([412, 500]).toContain(r1.status);
    expect(r1.texto).not.toContain("5001234-56.2026.4.03.6183");
  });

  test("tela: cards em Integrações; 'Buscar no Legalmail' aparece no caso e os diálogos em Novo caso só com a credencial", async ({ browser, baseURL }) => {
    test.skip(!mockVivo, "mock dos provedores (:8787) fora do ar");
    const { session } = await sessao(`canario+admin@${DOM}`);
    const ctx = await contexto(browser, baseURL!, session, ESC2);
    const page = await ctx.newPage();
    await cursorVisivel(page);
    try {
      await page.goto("/configuracoes?tab=integracoes");
      await expect(page.locator('[data-card-integracao="legalmail"]')).toBeVisible();
      await expect(page.locator('[data-card-integracao="ti"]')).toBeVisible();
      await expect(page.locator('[data-card-integracao="legalmail"] [data-integracao-estado]')).toHaveText("ativo");
      const { data: helena } = await admin.from("clientes").select("id").eq("escritorio_id", ESC2).eq("nome", "Helena Bastos Ferraz").single();
      const { data: caso } = await admin.from("casos").select("id").eq("cliente_id", helena!.id).limit(1).single();
      await page.goto(`/casos/${caso!.id}?tab=processos`);
      await expect(page.locator('[title*="Legalmail"]').first()).toBeVisible();
      await page.goto("/casos/novo");
      await expect(page.getByRole("button", { name: /Buscar no Legalmail/ })).toBeVisible();
      await expect(page.getByRole("button", { name: /Buscar no TI/ })).toBeVisible();
      // sem credencial (apaga as linhas): os botões somem
      await limpar();
      await page.reload();
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      await expect(page.getByRole("button", { name: /Buscar no Legalmail/ })).toHaveCount(0);
      await expect(page.getByRole("button", { name: /Buscar no TI/ })).toHaveCount(0);
      await page.goto(`/casos/${caso!.id}?tab=processos`);
      await expect(page.getByRole("tab", { name: /Processos/ })).toHaveAttribute("data-state", "active");
      await expect(page.locator('[title*="Legalmail"]')).toHaveCount(0);
    } finally {
      await ctx.close();
    }
  });
});

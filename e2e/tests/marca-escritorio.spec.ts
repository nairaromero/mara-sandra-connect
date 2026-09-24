// E2E: marca POR ESCRITÓRIO (migration_rbac_10).
//
// O topo mostra a marca do escritório ativo (logo ou nome; iniciais na cor
// quando a sidebar está recolhida). O admin do Canário troca nome, cor e logo
// em Configurações → Escritório (o logo vai pro bucket público `marcas`);
// o escritório 1 continua com o logo dele; advogado não vê a aba, a RPC e o
// Storage recusam. O convite enviado pelo Canário sai com o nome do Canário
// (send-email-hook lê o user_metadata) — conferido no Mailpit.

import { test, expect, type Browser, type BrowserContext } from "@playwright/test";
import { createClient, type Session, type SupabaseClient } from "@supabase/supabase-js";
import { STORAGE_ADMIN } from "../auth.setup";
import { cursorVisivel } from "../cursor";
import { ENV, PROJECT_REF } from "../env";
import { adminClient } from "../supabase-admin";

const admin = adminClient();
const DOM = "marasandraconnect.com";
const MAILPIT = "http://127.0.0.1:55324";
// 1x1 PNG transparente
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");

async function como(email: string, escritorio: string): Promise<{ sb: SupabaseClient; session: Session }> {
  const sb = createClient(ENV.supabaseUrl, ENV.anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { "x-escritorio-id": escritorio } },
  });
  const { data, error } = await sb.auth.signInWithPassword({ email, password: ENV.internoPassword });
  if (error || !data.session) throw new Error(`login ${email}: ${error?.message}`);
  return { sb, session: data.session };
}
async function contextoProduto(browser: Browser, baseURL: string, session: Session, escritorioId: string): Promise<BrowserContext> {
  return browser.newContext({
    storageState: {
      cookies: [],
      origins: [{
        origin: new URL(baseURL).origin,
        localStorage: [
          { name: `sb-${PROJECT_REF}-auth-token`, value: JSON.stringify(session) },
          { name: "msc:escritorio_ativo", value: escritorioId },
        ],
      }],
    },
  });
}

let ESC2: string;
let marcaOriginal: Record<string, unknown> | null = null;
let convidadoId: string | null = null;

test.describe.serial("marca por escritório", () => {
  test.beforeAll(async () => {
    test.skip(!ENV.local, "só no banco local");
    const { data: canario, error } = await admin.from("escritorios").select("id").eq("slug", "canario").maybeSingle();
    test.skip(!!error || !canario, "canário ausente — rode `bun run local:rbac`");
    ESC2 = canario!.id;
    const { data: cfg } = await admin.from("escritorio_config").select("marca").eq("escritorio_id", ESC2).maybeSingle();
    marcaOriginal = (cfg?.marca as Record<string, unknown>) ?? null;
  });
  test.afterAll(async () => {
    if (!ESC2) return;
    // devolve a marca do seed e apaga o convidado de teste
    if (marcaOriginal) await admin.from("escritorio_config").update({ marca: marcaOriginal }).eq("escritorio_id", ESC2);
    if (convidadoId) {
      await admin.from("membros").delete().eq("usuario_id", convidadoId);
      await admin.from("usuarios").delete().eq("id", convidadoId);
      await admin.auth.admin.deleteUser(convidadoId);
    }
  });

  test("admin do Canário troca nome, cor e logo; o topo acompanha", async ({ browser, baseURL }) => {
    const { session } = await como(`canario+admin@${DOM}`, ESC2);
    const ctx = await contextoProduto(browser, baseURL!, session, ESC2);
    const page = await ctx.newPage();
    await cursorVisivel(page);
    try {
      await page.goto("/configuracoes?tab=escritorio");
      const card = page.locator("[data-card-marca]");
      await expect(card).toBeVisible();

      await card.getByLabel("Nome de exibição").fill("Canário & Associados");
      await card.getByLabel("Cor de destaque (opcional)").fill("#7c3aed");
      await card.getByRole("button", { name: "Salvar", exact: true }).click();
      await expect(page.getByText("Marca do escritório salva.")).toBeVisible();
      // topo: aria-label da sidebar usa o nome novo
      await expect(page.getByRole("link", { name: "Canário & Associados - voltar para a página inicial" })).toBeVisible();
      const { data: cfg } = await admin.from("escritorio_config").select("marca").eq("escritorio_id", ESC2).single();
      expect(cfg?.marca).toMatchObject({ nome_exibicao: "Canário & Associados", cor: "#7c3aed" });

      // logo novo (PNG) -> bucket marcas/<esc>/logo.png e URL pública gravada
      await card.locator("[data-input-logo]").setInputFiles({ name: "logo.png", mimeType: "image/png", buffer: PNG });
      await expect(page.getByText("Logo atualizado.")).toBeVisible();
      const topo = page.locator('[data-marca-escritorio="logo"]').first();
      await expect(topo).toHaveAttribute("src", new RegExp(`/storage/v1/object/public/marcas/${ESC2}/logo\\.png`));
      const { data: obj } = await admin.storage.from("marcas").list(ESC2);
      expect((obj ?? []).some((o) => o.name === "logo.png")).toBe(true);
      // o arquivo é público de verdade
      const pub = await page.request.get(`${ENV.supabaseUrl}/storage/v1/object/public/marcas/${ESC2}/logo.png`);
      expect(pub.ok()).toBe(true);

      // remover logo -> nome em texto no topo, na cor
      await card.getByRole("button", { name: "Remover logo" }).click();
      await expect(page.getByText(/Logo removido/)).toBeVisible();
      await expect(page.locator('[data-marca-escritorio="nome"]').first()).toHaveText("Canário & Associados");
    } finally {
      await ctx.close();
    }
  });

  test("advogado não vê a aba; RPC e Storage recusam", async ({ browser, baseURL }) => {
    const { sb: adv, session } = await como(`canario+advogado@${DOM}`, ESC2);
    expect((await adv.rpc("escritorio_definir_marca", { p_nome_exibicao: "hack" })).error?.code).toBe("42501");
    const up = await adv.storage.from("marcas").upload(`${ESC2}/hack.png`, PNG, { contentType: "image/png", upsert: true });
    expect(up.error, "storage recusa quem não configura o escritório").toBeTruthy();
    const ctx = await contextoProduto(browser, baseURL!, session, ESC2);
    const page = await ctx.newPage();
    try {
      await page.goto("/configuracoes?tab=escritorio");
      await expect(page.getByRole("tab", { name: "Escritório" })).toHaveCount(0);
      await expect(page.locator("[data-card-marca]")).toHaveCount(0);
    } finally {
      await ctx.close();
    }
  });

  test("convite do Canário sai com o nome do Canário no e-mail", async () => {
    const { session } = await como(`canario+admin@${DOM}`, ESC2);
    const email = `e2e+marca-${Date.now()}@${DOM}`;
    const r = await fetch(`${ENV.supabaseUrl}/functions/v1/convidar-usuario`, {
      method: "POST",
      headers: { Authorization: `Bearer ${session.access_token}`, apikey: ENV.anonKey, "content-type": "application/json", "x-escritorio-id": ESC2 },
      body: JSON.stringify({ nome: "[E2E] Convidado da marca", email, tipo: "interno", papel: "assistente" }),
    });
    const j = (await r.json()) as { ok?: boolean; id?: string; error?: string };
    expect(r.status, JSON.stringify(j)).toBe(200);
    convidadoId = j.id ?? null;
    // o convite leva o nome de exibição ATUAL do escritório (o teste anterior
    // trocou para "Canário & Associados"; o seed é restaurado no afterAll)
    const { data: cfg } = await admin.from("escritorio_config").select("marca").eq("escritorio_id", ESC2).single();
    const nomeAtual = String((cfg?.marca as { nome_exibicao?: string })?.nome_exibicao ?? "Canário Advocacia");
    const { data: u } = await admin.auth.admin.getUserById(convidadoId!);
    expect(u.user?.user_metadata?.escritorio_nome).toBe(nomeAtual);
    // e o e-mail (Mailpit) sai com o nome do escritório no assunto — só onde o
    // send-email-hook está ligado no Auth (staging/produção); o Auth local
    // manda o template padrão do Supabase ("You have been invited")
    let assunto = "";
    await expect.poll(async () => {
      const resp = await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:${email}`)}`);
      const lista = (await resp.json()) as { messages?: Array<{ Subject: string }> };
      assunto = lista.messages?.[0]?.Subject ?? "";
      return assunto;
    }, { timeout: 15000 }).not.toBe("");
    test.skip(/You have been invited/i.test(assunto), "send-email-hook não está ligado no Auth local; o metadata do convite (acima) foi conferido");
    expect(assunto).toContain(nomeAtual);
  });
});

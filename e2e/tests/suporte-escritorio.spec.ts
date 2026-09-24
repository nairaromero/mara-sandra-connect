// E2E: o lado do ESCRITÓRIO no acesso de suporte (migration_rbac_07).
//
// A plataforma pede acesso pelo QG (API); o admin do Canário vê o aviso no
// topo, abre Configurações → Suporte, aprova; o suporte passa a ler o Canário;
// a Auditoria do escritório mostra pedido, aprovação e cada tela aberta com o
// nome de quem fez; o admin encerra e o acesso some na hora. Depois, um
// segundo pedido é recusado. Quem não é admin não vê aviso nem aba.
//
// Sessões via API injetadas no localStorage (nunca digita senha). Só roda no
// banco local com o seed (`bun run local:rbac`). Limpa os pedidos que criou.

import { test, expect, type Browser, type BrowserContext } from "@playwright/test";
import { createClient, type Session, type SupabaseClient } from "@supabase/supabase-js";
import { ENV, PROJECT_REF } from "../env";
import { adminClient } from "../supabase-admin";
import { cursorVisivel } from "../cursor";

const admin = adminClient();
const DOM = "marasandraconnect.com";
const MOTIVO = "[E2E suporte] conferir tarefa que não aparece para a equipe";

async function como(email: string, escritorio?: string): Promise<{ sb: SupabaseClient; session: Session }> {
  const sb = createClient(ENV.supabaseUrl, ENV.anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: escritorio ? { headers: { "x-escritorio-id": escritorio } } : {},
  });
  const { data, error } = await sb.auth.signInWithPassword({ email, password: ENV.internoPassword });
  if (error || !data.session) throw new Error(`login ${email}: ${error?.message}`);
  return { sb, session: data.session };
}

/** Contexto do PRODUTO logado como a pessoa, já no escritório dado (preferência salva). */
async function contextoProduto(browser: Browser, baseURL: string, session: Session, escritorioId: string): Promise<BrowserContext> {
  const origem = new URL(baseURL).origin;
  return browser.newContext({
    storageState: {
      cookies: [],
      origins: [
        {
          origin: origem,
          localStorage: [
            { name: `sb-${PROJECT_REF}-auth-token`, value: JSON.stringify(session) },
            { name: "msc:escritorio_ativo", value: escritorioId },
          ],
        },
      ],
    },
  });
}

let ESC2: string;

async function limpar() {
  const { error } = await admin.from("acessos_suporte").delete().like("motivo", "[E2E suporte]%");
  if (error) throw new Error(`limpeza de acessos_suporte falhou: ${error.message}`);
}

test.describe.serial("suporte: lado do escritório", () => {
  test.beforeAll(async () => {
    test.skip(!ENV.local, "só no banco local");
    const { data: canario, error } = await admin.from("escritorios").select("id").eq("slug", "canario").maybeSingle();
    test.skip(!!error || !canario, "escritório canário ausente — rode `bun run local:rbac`");
    ESC2 = canario!.id;
    await limpar();
  });
  test.afterAll(async () => {
    if (ESC2) await limpar();
  });

  test("aviso no topo, aprovar na aba Suporte, trilha na Auditoria, encerrar", async ({ browser, baseURL }) => {
    // 1) plataforma pede (API)
    const { sb: sup } = await como(`qg+suporte@${DOM}`, ESC2);
    const pedido = await sup.rpc("qg_suporte_solicitar", { p_escritorio_id: ESC2, p_motivo: MOTIVO, p_horas: 1 });
    expect(pedido.error).toBeNull();
    const { id: pedidoId, ticket: ticketGerado } = (pedido.data as Array<{ id: string; ticket: string }>)[0];
    expect((await sup.from("casos").select("id", { count: "exact", head: true })).count, "pendente não abre nada").toBe(0);

    // 2) admin do Canário vê o aviso e aprova pela tela
    const { session } = await como(`canario+admin@${DOM}`);
    const ctx = await contextoProduto(browser, baseURL!, session, ESC2);
    const page = await ctx.newPage();
    await cursorVisivel(page);
    try {
      await page.goto("/tarefas");
      const aviso = page.locator("[data-aviso-suporte]");
      await expect(aviso).toBeVisible();
      await expect(aviso).toContainText("pediu acesso de suporte");
      await aviso.getByRole("link", { name: "Ver pedido" }).click();
      await expect(page).toHaveURL(/tab=suporte/);

      const card = page.locator(`[data-pedido="${pedidoId}"]`);
      await expect(card).toBeVisible();
      await expect(card).toContainText(MOTIVO);
      // O número sai do servidor (migration_rbac_19): a spec confere o FORMATO e
      // que é o mesmo que a RPC devolveu, não um texto digitado.
      await expect(card).toContainText(`ticket ${ticketGerado}`);
      expect(ticketGerado).toMatch(/^SUP-\d{4}-\d{4,}$/);
      await card.getByRole("button", { name: "Aprovar por 1 h" }).click();
      await expect(page.locator('[data-secao="andamento"]').locator(`[data-pedido="${pedidoId}"]`)).toContainText("em andamento");
      await expect(aviso).toHaveCount(0);
      const { data: linha } = await admin.from("acessos_suporte").select("status, inicio, fim").eq("id", pedidoId).single();
      expect(linha?.status).toBe("aprovado");
      expect(linha?.fim).toBeTruthy();

      // 3) suporte agora lê o Canário (e registra o que abre)
      expect((await sup.from("casos").select("id", { count: "exact", head: true })).count).toBeGreaterThan(0);
      expect((await sup.rpc("suporte_registrar", { p_recurso: "/casos", p_recurso_id: "e2e" })).error).toBeNull();

      // 4) Auditoria do escritório: pedido, aprovação e a tela aberta, com nome
      await page.goto("/auditoria");
      const trilha = page.locator("[data-trilha-plataforma]");
      await expect(trilha).toBeVisible();
      await expect(trilha).toContainText("Pediu acesso de suporte");
      await expect(trilha).toContainText("Aprovou o acesso de suporte");
      await expect(trilha).toContainText("Abriu, em sessão de suporte");
      await expect(trilha).toContainText("/casos");
      await expect(trilha).toContainText("QG · Suporte");
      await expect(trilha).toContainText("Carla Nogueira");

      // 5) admin encerra: some na hora
      await page.goto("/configuracoes?tab=suporte");
      await page.locator('[data-secao="andamento"]').locator(`[data-pedido="${pedidoId}"]`).getByRole("button", { name: "Encerrar agora" }).click();
      await expect(page.locator('[data-secao="historico"]').locator(`[data-pedido="${pedidoId}"]`)).toContainText("encerrado");
      expect((await sup.from("casos").select("id", { count: "exact", head: true })).count, "depois de encerrado").toBe(0);
      const { data: fim } = await admin.from("acessos_suporte").select("status").eq("id", pedidoId).single();
      expect(fim?.status).toBe("encerrado");

      // 6) segundo pedido: recusar
      const pedido2 = await sup.rpc("qg_suporte_solicitar", { p_escritorio_id: ESC2, p_motivo: MOTIVO + " (2)", p_horas: 2 });
      expect(pedido2.error).toBeNull();
      const pedido2Id = (pedido2.data as Array<{ id: string }>)[0].id;
      await page.reload();
      const card2 = page.locator(`[data-pedido="${pedido2Id}"]`);
      await card2.getByRole("button", { name: "Recusar" }).click();
      await expect(page.locator('[data-secao="historico"]').locator(`[data-pedido="${pedido2Id}"]`)).toContainText("recusado");
      expect((await sup.from("casos").select("id", { count: "exact", head: true })).count).toBe(0);
    } finally {
      await ctx.close();
    }
  });

  test("quem não é admin não vê aviso nem aba; RPCs recusam", async ({ browser, baseURL }) => {
    const { sb: sup } = await como(`qg+suporte@${DOM}`, ESC2);
    const pedido = await sup.rpc("qg_suporte_solicitar", { p_escritorio_id: ESC2, p_motivo: MOTIVO + " (3)", p_horas: 1 });
    const pedido3Id = (pedido.data as Array<{ id: string }>)[0].id;
    expect(pedido.error).toBeNull();

    const { sb: adv, session } = await como(`canario+advogado@${DOM}`, ESC2);
    expect((await adv.rpc("suporte_encerrar", { p_id: pedido3Id })).error?.code).toBe("42501");
    expect((await adv.rpc("auditoria_plataforma")).error?.code).toBe("42501");

    const ctx = await contextoProduto(browser, baseURL!, session, ESC2);
    const page = await ctx.newPage();
    try {
      await page.goto("/configuracoes?tab=suporte");
      await expect(page.getByRole("heading", { name: /Configurações/ }).first()).toBeVisible();
      await expect(page.locator("[data-aviso-suporte]")).toHaveCount(0);
      await expect(page.getByRole("tab", { name: "Suporte" })).toHaveCount(0);
      // aba fora do papel cai em Perfil
      await expect(page.locator('[data-secao="pendentes"]')).toHaveCount(0);
    } finally {
      await ctx.close();
    }
  });
});

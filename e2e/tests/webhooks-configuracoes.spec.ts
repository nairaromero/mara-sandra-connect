// E2E: webhooks saíram da sidebar e viraram aba das Configurações (2026-09-14).
//
// Admin: sem item "Webhooks" na sidebar; o /webhooks antigo abre a aba; e a
// aba mostra "Em breve" (desde 2026-09-23 o módulo não é oferecido na tela:
// a entrega era do n8n, que saiu das rotinas do sistema). O ciclo do destino
// dentro da aba volta a ser testado quando a entrega por function chegar.
//
// Seguro no staging: os triggers só ENFILEIRAM em webhook_eventos (quem entrega
// é o n8n, que não olha o staging; lá nem existe pg_cron), e a URL usa o TLD
// reservado .invalid, que não resolve em lugar nenhum.

import { test, expect, type Locator, type Page } from "@playwright/test";
import { STORAGE_ADMIN } from "../auth.setup";
import { cursorVisivel } from "../cursor";
import { ENV } from "../env";
import { adminClient } from "../supabase-admin";

test.use({ storageState: STORAGE_ADMIN });

const admin = adminClient();
const PREFIXO_URL = "https://e2e-webhook.invalid/";
const URL_E2E = `${PREFIXO_URL}msv`;
const URL_E2E_EDITADA = `${PREFIXO_URL}msv-editado`;

// Rede de segurança se o teste cair no meio: nenhum destino e2e sobra.
// Erro de query não pode passar calado como "não havia nada".
async function limparDestinosE2E() {
  const { error } = await admin.from("webhook_destinos").delete().like("url", `${PREFIXO_URL}%`);
  if (error) throw new Error(`limpeza de webhook_destinos falhou: ${error.message}`);
}

async function destinoE2E() {
  const { data, error } = await admin
    .from("webhook_destinos")
    .select("id, url, ativo, eventos, secret_id, parceiro_id")
    .like("url", `${PREFIXO_URL}%`);
  if (error) throw new Error(`leitura de webhook_destinos falhou: ${error.message}`);
  return data ?? [];
}

// O clique do Playwright teleporta o mouse e no vídeo isso some: move em
// etapas, respira, e só então clica (mesmo padrão do smoke-lote).
async function clicar(page: Page, alvo: Locator) {
  const b = await alvo.boundingBox();
  if (b) {
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 20 });
    await page.waitForTimeout(350);
  }
  await alvo.click();
}

test.beforeAll(limparDestinosE2E);
test.afterAll(limparDestinosE2E);

test("admin: webhooks saíram da sidebar e /webhooks abre a aba nas Configurações", async ({
  page,
}) => {
  await cursorVisivel(page);
  await page.goto("/tarefas");
  // Os outros itens de admin continuam na sidebar; só Webhooks saiu.
  await expect(page.getByRole("link", { name: "Equipe", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Auditoria" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Webhooks" })).toHaveCount(0);

  await page.goto("/webhooks");
  await expect(page).toHaveURL(/\/configuracoes\?tab=webhooks/, { timeout: 15_000 });
  await expect(page.getByRole("tab", { name: "Webhooks" })).toHaveAttribute("data-state", "active");
  // desde 2026-09-23 a aba mostra o card "Em breve" (o módulo não é oferecido)
  await expect(page.locator('[data-em-breve="webhooks"]')).toBeVisible();

  // Admin vê as sete abas, na ordem (Escritório: marca, RBAC 10; Suporte: RBAC 07).
  await expect(page.getByRole("tab")).toHaveText([
    "Perfil",
    "Segurança",
    "Tipos de benefício",
    "Escritório",
    "Integrações",
    "Webhooks",
    "Suporte",
  ]);

  // Trocar de aba atualiza a URL (deep-link) e mostra o conteúdo certo.
  await clicar(page, page.getByRole("tab", { name: "Integrações" }));
  await expect(page).toHaveURL(/\/configuracoes\?tab=integracoes/);
  await expect(page.getByText(/Integração Gmail/).first()).toBeVisible();
  await clicar(page, page.getByRole("tab", { name: "Perfil" }));
  await expect(page).toHaveURL(/\/configuracoes$/);
  await expect(page.getByText("Meu perfil", { exact: true })).toBeVisible();

  // Deep-link direto abre a aba. É a contraprova do teste do interno comum
  // (autoria-tarefas-admin.spec): a mesma URL, pra ele, cai em Perfil.
  await page.goto("/configuracoes?tab=integracoes");
  await expect(page.getByRole("tab", { name: "Integrações" })).toHaveAttribute(
    "data-state",
    "active",
  );
  await expect(page.getByText(/Integração Gmail/).first()).toBeVisible();
});

// Alguma face da Inter (Google Fonts) já carregou?
const interCarregada = (page: Page) =>
  page.evaluate(() =>
    [...document.fonts].some((f) => f.family.replace(/["']/g, "") === "Inter" && f.status === "loaded"),
  );

test("admin no celular: /webhooks mostra a aba ativa na barra que rola", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  // A fonte chega DEPOIS de a aba rolar pra vista — como no celular com rede
  // lenta. Com a fonte de reserva as abas são mais estreitas; quando a Inter
  // entra (display=swap) elas alargam e a ativa saía 8px pela borda da barra
  // (flaky de 2026-09-14: ratio 0.93, dependia de a fonte chegar antes ou
  // depois). Segurar os arquivos de fonte torna o caso determinístico. Só os
  // arquivos (gstatic): o CSS do Google Fonts bloqueia a renderização.
  let liberarFontes!: () => void;
  const fontesLiberadas = new Promise<void>((r) => (liberarFontes = r));
  await page.route(/fonts\.gstatic\.com/, async (route) => {
    await fontesLiberadas;
    await route.continue();
  });
  // "load" esperaria as fontes seguradas.
  await page.goto("/webhooks", { waitUntil: "domcontentloaded" });
  const webhooks = page.getByRole("tab", { name: "Webhooks" });
  await expect(webhooks).toHaveAttribute("data-state", "active", { timeout: 20_000 });
  expect(await interCarregada(page), "a Inter chegou antes da aba rolar: o caso não foi exercido").toBe(
    false,
  );
  liberarFontes();
  await expect.poll(() => interCarregada(page), { timeout: 15_000 }).toBe(true);
  // Cinco abas não cabem em 375px: a barra rola por dentro. Sem rolar até a
  // aba ativa, ela ficava fora da tela (visto em 2026-09-14).
  await expect(webhooks).toBeInViewport({ ratio: 1 });
  // Contraprova de que a barra rolou de fato (e não que tudo coube): a
  // primeira aba saiu da vista.
  await expect(page.getByRole("tab", { name: "Perfil" })).not.toBeInViewport({ ratio: 1 });
  // E quem rola é a barra, não a página inteira.
  expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)).toBe(
    false,
  );
});

test("admin: a aba Webhooks mostra 'Em breve' e não oferece criar destino (desde 2026-09-23)", async ({ page }) => {
  await cursorVisivel(page);
  await page.goto("/configuracoes?tab=webhooks");
  await expect(page.getByRole("tab", { name: "Webhooks" })).toHaveAttribute("data-state", "active");
  const card = page.locator('[data-em-breve="webhooks"]');
  await expect(card).toBeVisible();
  await expect(card.getByText("Em breve", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Novo webhook" })).toHaveCount(0);
  await expect(page.getByText(/Nenhum webhook cadastrado/)).toHaveCount(0);
  // o módulo antigo continua íntegro por baixo: a tabela existe e nada foi criado por esta tela
  expect(await destinoE2E()).toEqual([]);
});

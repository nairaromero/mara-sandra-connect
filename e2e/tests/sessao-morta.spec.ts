// Sessao morta -> voltar pro /login (issue #184). SO LEITURA. Cada teste faz
// o proprio login e derruba so essa sessao — a do storageState, usada pelos
// outros specs, fica intacta.
//
// Dois jeitos de a sessao morrer, os dois tem que terminar no /login:
//
//  (1) O SERVIDOR recusa o JWT (401 "JWT expired" do PostgREST) enquanto o
//      cliente ainda acha que ele vale. Acontece com relogio do aparelho
//      atrasado, ou quando o auth-js "preserva" a sessao depois de um refresh
//      proativo falhar. Simulado interceptando /rest/v1 e devolvendo a
//      resposta real do PostgREST. Antes da correcao: 401 em loop a cada 60s,
//      tela parada, sem redirect.
//
//  (2) O refresh token foi REVOGADO (senha trocada, desligar_interno, outra
//      aba consumiu o token na rotacao). Simulado com admin.signOut(local)
//      + adiantando o expires_at local, que equivale a esperar a hora passar.
//      Esse caminho o supabase-js ja tratava; fica aqui como regressao.
//
// Com video:  bun run e2e:video:staging

import { test, expect, type Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { cursorVisivel } from "../cursor";
import { STORAGE_INTERNO } from "../auth.setup";
import { adminClient } from "../supabase-admin";
import { ENV, PROJECT_REF } from "../env";

test.use({ storageState: STORAGE_INTERNO });
test.setTimeout(120_000);

const STORAGE_KEY = `sb-${PROJECT_REF}-auth-token`;

async function moverE(page: Page, alvo: ReturnType<Page["locator"]>) {
  const b = await alvo.boundingBox();
  if (b) {
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 25 });
    await page.waitForTimeout(500);
  }
}

// Cada teste faz login PROPRIO e injeta a sessao no browser. Nao pode usar a
// sessao do storageState: estes testes a encerrariam tambem no servidor (o
// auth-js chama /logout mesmo com scope local) e os specs seguintes cairiam
// no /login.
async function entrarComSessaoPropria(page: Page) {
  const anon = createClient(ENV.supabaseUrl, ENV.anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const login = await anon.auth.signInWithPassword({
    email: ENV.internoEmail,
    password: ENV.internoPassword,
  });
  if (!login.data.session) throw new Error(`login: ${login.error?.message}`);
  const sessao = login.data.session;

  await page.goto("/login");
  await page.evaluate(
    ([k, v]) => localStorage.setItem(k, v),
    [STORAGE_KEY, JSON.stringify(sessao)] as const,
  );
  await page.goto("/tarefas");
  await expect(page.getByRole("link", { name: /Tarefas/i }).first()).toBeVisible();
  await page.waitForTimeout(1500); // deixa a tela assentar no video
  return sessao;
}

test.describe("sessao morta volta pro login", () => {
  test("(1) servidor responde 401 JWT expired -> /login", async ({ page }) => {
    await cursorVisivel(page);
    await entrarComSessaoPropria(page);

    // Conta os 401 pra provar que foi isso que disparou o logout.
    let r401 = 0;
    page.on("response", (r) => {
      if (r.status() === 401 && r.url().includes("/rest/v1/")) r401++;
    });

    await page.route(/\/rest\/v1\//, (route) =>
      route.fulfill({
        status: 401,
        contentType: "application/json",
        body: JSON.stringify({ code: "PGRST301", message: "JWT expired", details: null, hint: null }),
      }),
    );

    // Qualquer navegacao dispara queries -> 401 -> sessao encerrada -> /login.
    const docs = page.getByRole("link", { name: /Documentos pendentes/i }).first();
    await moverE(page, docs);
    await docs.click();

    await page.waitForURL(/\/login$/, { timeout: 20_000 });
    await expect(page.getByRole("button", { name: /^Entrar$/ })).toBeVisible();
    expect(r401).toBeGreaterThan(0);

    // Sessao limpa de verdade: nada sobrou no localStorage.
    const sobrou = await page.evaluate((k) => localStorage.getItem(k), STORAGE_KEY);
    expect(sobrou).toBeNull();
    await page.waitForTimeout(1500);
  });

  test("(2) refresh token revogado no servidor -> /login", async ({ page }) => {
    await cursorVisivel(page);
    const sessao = await entrarComSessaoPropria(page);

    const admin = adminClient();
    // "local" = so a sessao deste teste; "global" derrubaria tambem a do
    // storageState que os outros specs usam.
    const { error } = await admin.auth.admin.signOut(sessao.access_token, "local");
    if (error) throw new Error(`admin signOut: ${error.message}`);

    // Equivale a esperar o access token vencer: o proximo tick do auth-js
    // tenta renovar, o servidor recusa, a sessao cai.
    await page.evaluate((k) => {
      const s = JSON.parse(localStorage.getItem(k)!);
      s.expires_at = Math.floor(Date.now() / 1000) - 5;
      localStorage.setItem(k, JSON.stringify(s));
    }, STORAGE_KEY);

    await page.waitForURL(/\/login$/, { timeout: 90_000 });
    await expect(page.getByRole("button", { name: /^Entrar$/ })).toBeVisible();
    await page.waitForTimeout(1500);
  });
});

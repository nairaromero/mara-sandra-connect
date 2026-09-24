// E2E: marca do PRODUTO (Legal Connect) × marca do ESCRITÓRIO.
//
// Antes do login ninguém sabe o escritório: entrada, esqueci a senha e criar
// senha mostram Legal Connect (e nunca a logo de um escritório). Logado, o topo
// continua com a marca do escritório e o produto assina no rodapé da sidebar.
// Título e favicon são do produto.

import { test, expect } from "@playwright/test";
import { STORAGE_ADMIN } from "../auth.setup";
import { cursorVisivel } from "../cursor";

test("antes do login: Legal Connect em entrada, esqueci a senha e criar senha; título e favicon do produto", async ({ page }) => {
  await page.goto("/login");
  await cursorVisivel(page);
  await expect(page.getByRole("img", { name: "Legal Connect" })).toBeVisible();
  await expect(page.getByRole("img", { name: /Mara Sandra/ })).toHaveCount(0);
  await expect(page.getByText("Gestão de casos previdenciários para escritórios e parceiros")).toBeVisible();
  await expect(page).toHaveTitle(/Legal Connect/);
  await expect(page.locator('link[rel="icon"]')).toHaveAttribute("href", "/favicon.svg");
  await expect(page.locator('link[rel="apple-touch-icon"]')).toHaveAttribute("href", "/marca/apple-touch-icon.png");
  const svg = await page.request.get("/favicon.svg");
  expect(svg.ok()).toBe(true);
  expect(svg.headers()["content-type"]).toContain("svg");

  for (const rota of ["/redefinir-senha", "/definir-senha"]) {
    await page.goto(rota);
    await expect(page.getByRole("img", { name: "Legal Connect" })).toBeVisible();
    await expect(page.getByRole("img", { name: /Mara Sandra/ })).toHaveCount(0);
  }
});

test.describe("logado", () => {
  test.use({ storageState: STORAGE_ADMIN });
  test("o escritório fica no topo; o produto assina no rodapé da sidebar", async ({ page }) => {
    await page.goto("/tarefas");
    await cursorVisivel(page);
    // marca do escritório no topo da sidebar (logo.png é do escritório padrão)
    await expect(page.locator('img[src="/logo.png"]').first()).toBeVisible();
    const rodape = page.locator("[data-rodape-marca]");
    await expect(rodape).toBeVisible();
    await expect(rodape).toContainText("por");
    await expect(rodape.getByRole("img", { name: "Legal Connect" })).toBeVisible();
  });
});

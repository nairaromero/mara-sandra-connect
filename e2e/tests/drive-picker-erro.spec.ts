// Google Drive Picker: erro ao carregar os scripts do Google tem que virar
// toast, nunca spinner eterno (issue #180). SO LEITURA: nao vincula pasta
// nenhuma — o script do Google e interceptado antes de chegar no OAuth.
//
// Dois jeitos de o script do Google Identity falhar, os dois tem que
// terminar em toast + botao "Vincular pasta" de volta ao normal:
//
//  (1) Script chega VAZIO (200, corpo "//"): e o que proxy corporativo ou
//      bloqueador faz quando "neutraliza" em vez de bloquear. loadScript
//      resolve, `window.google.accounts` nao existe, e o TypeError acontece
//      DEPOIS do try/catch do executor. Antes da correcao (executor async):
//      throw engolido, Promise pendente pra sempre, spinner ate recarregar.
//
//  (2) Script BLOQUEADO (erro de rede): loadScript rejeita dentro do
//      try/catch. Ja funcionava; fica como regressao.
//
// Com video:  bun run e2e:video:staging

import { test, expect, type Page } from "@playwright/test";
import { cursorVisivel } from "../cursor";
import { STORAGE_INTERNO } from "../auth.setup";
import { adminClient } from "../supabase-admin";

test.use({ storageState: STORAGE_INTERNO });
test.setTimeout(90_000);

const GSI = /accounts\.google\.com\/gsi\/client/;

// Qualquer caso sem pasta vinculada serve: so nele aparece "Vincular pasta".
async function casoSemPasta(): Promise<string> {
  const { data, error } = await adminClient()
    .from("casos")
    .select("id")
    .is("gdrive_folder_id", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error || !data) throw new Error(`caso sem pasta: ${error?.message ?? "nenhum"}`);
  return data.id as string;
}

async function moverE(page: Page, alvo: ReturnType<Page["getByRole"]>) {
  const b = await alvo.boundingBox();
  if (b) {
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 25 });
    await page.waitForTimeout(500);
  }
}

async function abrirDocumentosDoCaso(page: Page) {
  await page.goto(`/casos/${await casoSemPasta()}`);
  const aba = page.getByRole("tab", { name: /Documentos/i });
  await expect(aba).toBeVisible({ timeout: 20_000 });
  await moverE(page, aba);
  await aba.click();
  const btn = page.getByRole("button", { name: /Vincular pasta/i });
  await expect(btn).toBeVisible();
  await page.waitForTimeout(1000);
  return btn;
}

async function clicarEEsperarToast(page: Page, btn: ReturnType<Page["getByRole"]>) {
  await moverE(page, btn);
  await btn.click();
  // O toast do sonner some em ~4s; o Playwright faz polling rapido o bastante.
  const toast = page.locator("[data-sonner-toast]").first();
  await expect(toast).toBeVisible({ timeout: 20_000 });
  const texto = (await toast.innerText()).trim();
  // Botao volta: sem spinner, habilitado.
  await expect(btn).toBeEnabled({ timeout: 5_000 });
  await expect(btn.locator("svg.animate-spin")).toHaveCount(0);
  await page.waitForTimeout(1500); // deixa o toast aparecer no video
  return texto;
}

test.describe("drive picker: falha nos scripts do Google vira toast", () => {
  test("(1) script do Google Identity chega vazio -> toast, sem spinner eterno", async ({ page }) => {
    await cursorVisivel(page);
    await page.route(GSI, (route) =>
      route.fulfill({ status: 200, contentType: "application/javascript", body: "// neutralizado\n" }),
    );
    const btn = await abrirDocumentosDoCaso(page);
    const texto = await clicarEEsperarToast(page, btn);
    // O erro real (TypeError do google.accounts) chega ao usuario.
    expect(texto).toMatch(/oauth2|undefined|Erro ao vincular/i);
  });

  test("(2) script do Google Identity bloqueado -> toast", async ({ page }) => {
    await cursorVisivel(page);
    await page.route(GSI, (route) => route.abort("blockedbyclient"));
    const btn = await abrirDocumentosDoCaso(page);
    const texto = await clicarEEsperarToast(page, btn);
    expect(texto).toMatch(/Falha ao carregar/i);
  });
});

// Smoke visual de um lote — SO LEITURA.
//
// Ao contrario dos outros specs desta pasta, este NAO cria nem apaga nada:
// so navega e confere que as telas principais respondem. E o que a Naira roda
// depois de um merge em staging, antes de promover pra main.
//
// Com video:  bun run e2e:video:staging
// Sem video:  bun run e2e:staging
//
// O ponteiro do mouse so aparece no video por causa do cursorVisivel() — o
// Playwright move um mouse de verdade, mas nao desenha nada.

import { test, expect } from "@playwright/test";
import { cursorVisivel } from "../cursor";
import { STORAGE_INTERNO } from "../auth.setup";

// Sem isto o teste roda deslogado e cai na tela de login — os outros specs
// desta pasta declaram o mesmo.
test.use({ storageState: STORAGE_INTERNO });

// Passo a passo devagar: o clique do Playwright teleporta o mouse, e no video
// isso some. Move em etapas, respira, e ai clica.
async function moverE(page: import("@playwright/test").Page, alvo: ReturnType<import("@playwright/test").Page["locator"]>) {
  const b = await alvo.boundingBox();
  if (b) {
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 25 });
    await page.waitForTimeout(500);
  }
}

test.describe("smoke do lote (so leitura)", () => {
  test("telas principais do interno respondem", async ({ page }) => {
    await cursorVisivel(page);

    // Prova que a sessao valeu: a sidebar so existe logado. Checar so a URL
    // seria falso-positivo — o redirect pro /login e client-side e chega depois.
    await page.goto("/tarefas");
    await expect(page.getByRole("link", { name: "Clientes" })).toBeVisible({ timeout: 30_000 });

    for (const rota of ["/tarefas", "/clientes", "/agenda", "/processos"]) {
      await page.goto(rota);
      await expect(page).toHaveURL(new RegExp(rota));
      await expect(page.getByRole("link", { name: "Clientes" })).toBeVisible();
      // se a tela estourasse, o errorComponent do __root apareceria
      await expect(page.getByText(/Algo deu errado/i)).toHaveCount(0);
      await page.waitForTimeout(800);
    }
  });

  test("tela do caso abre e a aba Documentos carrega", async ({ page }) => {
    await cursorVisivel(page);

    await page.goto("/clientes");
    // A lista e uma TABELA de linhas clicaveis, nao links pra /casos/<id>.
    const linha = page.getByRole("row").nth(1);
    await expect(linha).toBeVisible({ timeout: 30_000 });
    await moverE(page, linha);
    await linha.click();
    await expect(page).toHaveURL(/\/casos\/[0-9a-f-]{20,}/);

    const aba = page.getByRole("tab", { name: /Documentos/i }).first();
    await expect(aba).toBeVisible();
    await moverE(page, aba);
    await aba.click();

    // Os dois fluxos do Drive precisam ser distinguiveis (PR #111): o botao de
    // arquivos dizia so "Drive" e ninguem sabia qual era qual.
    const importar = page.getByRole("button", { name: /Importar arquivos/i });
    await expect(importar).toBeVisible();
    await expect(page.getByRole("button", { name: /Vincular pasta/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /^Drive$/ })).toHaveCount(0);
    await moverE(page, importar);
    await page.waitForTimeout(800);
  });

  test("form de caso novo tem o responsavel pela tarefa", async ({ page }) => {
    await cursorVisivel(page);
    await page.goto("/casos/novo");
    await expect(page.getByText(/Quem recebe a tarefa de novo cliente/i)).toBeVisible();
    await page.waitForTimeout(800);
  });
});

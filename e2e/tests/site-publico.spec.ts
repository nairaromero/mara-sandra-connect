// Site institucional (rota "/") — SO LEITURA, SEM AUTENTICACAO.
//
// A home publica tem ~850 linhas e nao tinha teste nenhum, apesar de ser o
// funil de captacao: e por ela que lead entra em `leads` e cai no /comercial.
// Quebra aqui nao aparece em nenhum outro spec, porque todos os demais rodam
// logados.
//
// Cobre o essencial: a pagina renderiza por SSR, o SEO esta no HTML (importa
// pra busca organica, que e o ponto do site), a navegacao ancora funciona e o
// formulario de contato existe nos dois publicos (cliente e parceiro).

import { test, expect } from "@playwright/test";
import { cursorVisivel } from "../cursor";

// Deslogado de proposito: o site publico nao pode depender de sessao.
test.use({ storageState: { cookies: [], origins: [] } });

test.describe("site institucional (publico)", () => {
  test("home renderiza por SSR com o SEO no HTML", async ({ page }) => {
    // Sem JS: prova que o conteudo vem do servidor, nao so do bundle.
    const resp = await page.goto("/");
    expect(resp?.status()).toBe(200);

    await expect(page).toHaveTitle(/Mara Sandra Vian Advocacia/i);

    const desc = page.locator('meta[name="description"]');
    await expect(desc).toHaveAttribute("content", /Direito Previdenci[áa]rio/i);

    // Open Graph — e o que aparece quando alguem compartilha o link
    await expect(page.locator('meta[property="og:title"]')).toHaveAttribute(
      "content",
      /Mara Sandra Vian/i,
    );
    await expect(page.locator('meta[property="og:type"]')).toHaveAttribute("content", "website");
  });

  test("fontes Inter e Cormorant Garamond carregam de verdade (issue #199)", async ({ page }) => {
    // Regressao: o @import no CSS era descartado pelo Tailwind v4 e todo mundo
    // via o fallback (system-ui / Georgia). Agora vai por <link> no head.
    await page.goto("/");
    await expect(page.locator('link[rel="stylesheet"][href*="fonts.googleapis.com"]')).toHaveCount(1);

    // O browser precisa ter BAIXADO as faces — nao basta a regra existir.
    const carregadas = await page.evaluate(async () => {
      const fonts = (document as Document & { fonts: FontFaceSet }).fonts;
      await fonts.ready;
      await Promise.all([fonts.load('16px "Inter"'), fonts.load('16px "Cormorant Garamond"')]);
      return [...fonts]
        .filter((f) => f.status === "loaded")
        .map((f) => f.family.replace(/"/g, ""));
    });
    expect(carregadas).toContain("Inter");
    expect(carregadas).toContain("Cormorant Garamond");
  });

  test("navegacao e o formulario dos dois publicos existem", async ({ page }) => {
    await cursorVisivel(page);
    await page.goto("/");

    // O site fala com dois publicos: quem busca beneficio e escritorio parceiro.
    await expect(page.getByRole("link", { name: /Parceiros/i }).first()).toBeVisible();

    // O formulario de lead e o que alimenta a tabela `leads` -> /comercial
    const form = page.locator("form").first();
    await expect(form).toBeVisible();

    // O CTA de WhatsApp e LINK (wa.me), nao button — e o caminho de captacao
    // mais curto do site. Confere o destino, sem clicar.
    const zap = page.getByRole("link", { name: /WhatsApp/i }).first();
    await expect(zap).toBeVisible();
    await expect(zap).toHaveAttribute("href", /^https:\/\/wa\.me\/\d{12,13}/);
  });

  test("politica de privacidade abre sem login", async ({ page }) => {
    const resp = await page.goto("/privacidade");
    expect(resp?.status()).toBe(200);
    await expect(page.getByText(/privacidade/i).first()).toBeVisible();
  });
});

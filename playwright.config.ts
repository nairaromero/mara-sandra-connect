import { defineConfig } from "@playwright/test";

// E2E do MaraSandraConnect (ver e2e/README.md).
//
// - Local: sobe o vite dev na :8085 sozinho (webServer abaixo).
// - CI/preview: exportar PLAYWRIGHT_BASE_URL com a preview URL do Cloudflare
//   (saída do `wrangler versions upload`) — aí o webServer não é usado.
//
// Segredos (service role, senha do usuário e2e) vêm do .env.local via
// e2e/env.ts — nunca ficam em código.
const baseURL = process.env.PLAYWRIGHT_BASE_URL || "http://localhost:8085";
// PW_VIDEO=1 grava video de cada teste (e o cursor fica visivel nos specs que
// chamam cursorVisivel). Usado por `bun run e2e:video`.
const GRAVAR_VIDEO = process.env.PW_VIDEO === "1";

export default defineConfig({
  testDir: "./e2e/tests",
  globalSetup: "./e2e/auth.setup.ts",
  timeout: 60_000,
  expect: { timeout: 10_000 },
  // Banco é o de staging: serializa pra evitar corridas entre specs que mexem
  // nos mesmos dados [E2E].
  workers: 1,
  // O Playwright APAGA o outputDir inteiro no inicio de cada run — conferido
  // empiricamente. Entao video de run antigo nunca acumula: cada execucao
  // substitui a anterior. Um run completo com PW_VIDEO=1 ocupa ~5,6 MB em
  // test-results/ e ~6,1 MB em playwright-report/, e os dois sao gitignored.
  //
  // NAO trocar por "failures-only": o video de teste que PASSA e justamente o
  // registro de validacao de um lote (ver e2e/README.md).
  preserveOutput: "always",
  retries: process.env.CI ? 1 : 0,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    // Video so quando pedido: `bun run e2e:video`. Ligado sempre pesaria todo
    // run e nao ajuda em CI. Ver e2e/README.md.
    video: GRAVAR_VIDEO ? { mode: "on", size: { width: 1280, height: 800 } } : "off",
    viewport: { width: 1280, height: 800 },
  },
  webServer: process.env.PLAYWRIGHT_BASE_URL
    ? undefined
    : {
        command: "bun run dev --port 8085",
        url: "http://localhost:8085",
        reuseExistingServer: true,
        timeout: 90_000,
      },
});

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

export default defineConfig({
  testDir: "./e2e/tests",
  globalSetup: "./e2e/auth.setup.ts",
  timeout: 60_000,
  expect: { timeout: 10_000 },
  // Banco é o de produção (único): serializa pra evitar corridas entre specs
  // que mexem nos mesmos dados [E2E].
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
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

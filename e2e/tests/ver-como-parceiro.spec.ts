// E2E: "Ver como parceiro" (admin, somente leitura) — Naira 2026-09-02.
// Admin abre /parceiros, clica em "Ver como" no parceiro de teste, cai no
// kanban DELE (escopado), com faixa de leitura e SEM botão Cumprir.

import { test, expect } from "@playwright/test";
import { STORAGE_ADMIN } from "../auth.setup";
import { ENV } from "../env";
import { adminClient, cleanupE2E, seedClienteCaso, seedSolicitacao } from "../supabase-admin";

test.use({ storageState: STORAGE_ADMIN });

const admin = adminClient();
let nomeCliente: string;

test.beforeAll(async () => {
  const { data: parceira } = await admin
    .from("usuarios")
    .select("id")
    .eq("email", ENV.parceiroEmail)
    .single();
  if (!parceira) throw new Error(`parceira de teste não encontrada: ${ENV.parceiroEmail}`);
  const sufixo = `Ver Como ${Date.now()}`;
  nomeCliente = `[E2E] ${sufixo}`;
  const { casoId } = await seedClienteCaso(admin, { sufixo, parceiroId: parceira.id });
  await seedSolicitacao(admin, casoId, "cnis", {
    prazoAt: new Date(Date.now() + 5 * 86400_000).toISOString(),
  });
});

test.afterAll(async () => {
  await cleanupE2E(admin);
});

test("admin vê como parceiro: kanban escopado, leitura, sem Cumprir", async ({ page }) => {
  await page.goto("/parceiros");

  // Botão "Ver como" do parceiro de teste. (Só admin o vê.)
  const verComo = page
    .getByRole("button", { name: new RegExp(`Ver como`, "i") })
    .first();
  await verComo.waitFor({ timeout: 20000 });
  await verComo.click();

  // Caiu no kanban do parceiro, com a faixa de leitura.
  await expect(page.getByRole("heading", { name: "Tarefas" })).toBeVisible({ timeout: 20000 });
  await expect(page.getByText(/Vendo como .* — somente leitura/)).toBeVisible();

  // Vê o card do cliente do parceiro (dado escopado)…
  await expect(page.getByText(nomeCliente)).toBeVisible();

  // …e NÃO há ação de cumprir em nome do parceiro (leitura).
  await expect(page.getByRole("button", { name: "Cumprir", exact: true })).toHaveCount(0);

  // Sair volta pra visão de admin (o item de menu interno "Tarefas" some do
  // modo; ao sair, a sidebar do admin volta — checamos que a faixa some).
  await page.getByRole("button", { name: "Sair" }).first().click();
  await expect(page.getByText(/Vendo como .* — somente leitura/)).toHaveCount(0);
});

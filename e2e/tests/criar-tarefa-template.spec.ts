// E2E: criar tarefa via template "Indeferido" (usuário interno).
// Exercita os Selects Radix em portal e valida que TODAS as tarefas do
// template saem com responsável (feature dos selects por item).

import { test, expect } from "@playwright/test";
import { STORAGE_INTERNO } from "../auth.setup";
import { adminClient, cleanupE2E, seedClienteCaso } from "../supabase-admin";

test.use({ storageState: STORAGE_INTERNO });

const admin = adminClient();
let casoId: string;
let nomeCliente: string;

test.beforeAll(async () => {
  const sufixo = `Tarefa Template ${Date.now()}`;
  nomeCliente = `[E2E] ${sufixo}`;
  ({ casoId } = await seedClienteCaso(admin, { sufixo }));
});

test.afterAll(async () => {
  await cleanupE2E(admin);
});

test("template indeferido cria 2 tarefas, ambas com responsável", async ({ page }) => {
  await page.goto("/tarefas");
  await page.getByRole("button", { name: "Nova tarefa" }).click();

  // Radix Select do Caso (trigger mostra o placeholder "Sem caso").
  await page.getByRole("combobox").filter({ hasText: "Sem caso" }).click();
  await page.getByRole("option", { name: nomeCliente }).click();

  // Select do template.
  await page.getByRole("combobox").filter({ hasText: "Escolha um template" }).click();
  await page.getByRole("option", { name: /Indeferido/ }).click();

  // Prefill assíncrono concluiu quando o bloco de responsáveis por item
  // aparece — e o item extra ("Baixar PA") já vem com executor padrão.
  await expect(
    page.getByText("Responsáveis das outras tarefas do template"),
  ).toBeVisible();
  await expect(page.getByText(/Baixar PA/).first()).toBeVisible();

  await page.getByRole("button", { name: "Salvar" }).click();
  await expect(
    page.getByText("2 tarefas criadas (1 adicional do template)."),
  ).toBeVisible();

  // Verificação forte no banco: 2 tarefas, nenhuma sem responsável.
  const { data: tarefas } = await admin
    .from("tarefas")
    .select("titulo, responsavel_id")
    .eq("caso_id", casoId);
  expect(tarefas).toHaveLength(2);
  for (const t of tarefas!) {
    expect(t.responsavel_id, `tarefa sem responsável: ${t.titulo}`).toBeTruthy();
  }
});

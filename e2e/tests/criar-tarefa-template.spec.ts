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

  // Combobox do Cliente (trigger mostra o placeholder "Sem cliente").
  await page.getByRole("combobox").filter({ hasText: "Sem cliente" }).click();
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

  // Verificação forte no banco: 2 tarefas, nenhuma sem responsável.
  //
  // Espera o efeito no banco em vez do toast: o toast some sozinho em poucos
  // segundos e a lista re-renderiza pesado depois do save, o que deixava a
  // asserção de UI numa corrida. Também não serve olhar os títulos na tela — o
  // painel mostra um preview dos itens do template ANTES de salvar, então esse
  // texto já está visível mesmo se o save falhar.
  await expect
    .poll(
      async () => {
        const { data } = await admin
          .from("tarefas")
          .select("titulo, responsavel_id")
          .eq("caso_id", casoId);
        return data?.length ?? 0;
      },
      { timeout: 15_000, message: "esperando as 2 tarefas do template no banco" },
    )
    .toBe(2);

  const { data: tarefas } = await admin
    .from("tarefas")
    .select("titulo, responsavel_id")
    .eq("caso_id", casoId);
  for (const t of tarefas!) {
    expect(t.responsavel_id, `tarefa sem responsável: ${t.titulo}`).toBeTruthy();
  }
});

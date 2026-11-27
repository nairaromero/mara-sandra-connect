// E2E: template só cabe no processo da natureza dele.
//
// Naira, 27/11/2026: com um requerimento escolhido no formulário não dá para
// aplicar template judicial, e vice-versa. Foi como perícia judicial nasceu com
// o template do INSS — e os botões de "deferido" apareceram num processo judicial.

import { test, expect } from "@playwright/test";
import { STORAGE_INTERNO } from "../auth.setup";
import { adminClient, cleanupE2E, seedClienteCaso } from "../supabase-admin";
import { abrirNovaTarefaNoCaso } from "../tarefas";

test.use({ storageState: STORAGE_INTERNO });

const admin = adminClient();
let casoId: string;
let req: string;
let jud: string;

test.beforeAll(async () => {
  const sufixo = Date.now();
  ({ casoId } = await seedClienteCaso(admin, { sufixo: `Natureza ${sufixo}` }));
  req = `E2E-REQ-${sufixo}`;
  jud = `E2E-JUD-${sufixo}`;
  const a = await admin.from("processos_admin").insert({ caso_id: casoId, numero_requerimento: req });
  if (a.error) throw new Error(a.error.message);
  const j = await admin.from("processos_judiciais").insert({ caso_id: casoId, numero_processo: jud });
  if (j.error) throw new Error(j.error.message);
});

test.afterAll(async () => {
  await cleanupE2E(admin);
});

test("o processo escolhido decide quais templates aparecem", async ({ page }) => {
  await abrirNovaTarefaNoCaso(page, casoId);
  const processo = page.getByRole("combobox").filter({ hasText: /Escolha o processo|E2E-/ });
  const template = page.getByRole("combobox").filter({ hasText: "Escolha um template" });

  // Processo judicial: os do INSS somem, os judiciais e os livres ficam.
  await processo.click();
  await page.getByRole("option", { name: new RegExp(jud) }).click();
  await template.click();
  await expect(page.getByRole("option", { name: /Perícia Judicial/ })).toBeVisible();
  await expect(page.getByRole("option", { name: /Concedido/ })).toBeVisible();
  await expect(page.getByRole("option", { name: /Perícia INSS/ })).toHaveCount(0);
  await expect(page.getByRole("option", { name: /Exigência INSS/ })).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(page.getByText(/não aparecem\s+porque o processo escolhido é judicial/)).toBeVisible();

  // Requerimento: é o contrário.
  await processo.click();
  await page.getByRole("option", { name: new RegExp(req) }).click();
  await template.click();
  await expect(page.getByRole("option", { name: /Perícia INSS/ })).toBeVisible();
  await expect(page.getByRole("option", { name: /Perícia Judicial/ })).toHaveCount(0);
  await expect(page.getByRole("option", { name: /Exigência Judicial/ })).toHaveCount(0);

  // Template escolhido e depois o processo muda para a outra natureza: sai.
  await page.getByRole("option", { name: /Perícia INSS/ }).click();
  await processo.click();
  await page.getByRole("option", { name: new RegExp(jud) }).click();
  await expect(page.getByText(/"Perícia INSS" não cabe em processo judicial/)).toBeVisible();
  await expect(template).toBeVisible();
});

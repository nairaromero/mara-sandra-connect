// E2E: popup ao concluir tarefa pelo "Feito" (Naira, 2026-09-02).
// Pela aba Atividades do caso: clicar "Feito" (menu "..." → Mover para →
// Feito) abre o popup Concluir/Editar/Excluir; a exclusão exige motivo e
// registra no log (tarefas_excluidas.motivo).

import { test, expect } from "@playwright/test";
import { STORAGE_INTERNO } from "../auth.setup";
import { adminClient, cleanupE2E, seedClienteCaso } from "../supabase-admin";

test.use({ storageState: STORAGE_INTERNO });

const admin = adminClient();
let casoId: string;
let tituloTarefa: string;
let tarefaId: string;

test.beforeAll(async () => {
  const sufixo = `Popup Concluir ${Date.now()}`;
  ({ casoId } = await seedClienteCaso(admin, { sufixo }));
  tituloTarefa = `[E2E] Analisar ${Date.now()}`;
  const { data, error } = await admin
    .from("tarefas")
    .insert({
      caso_id: casoId,
      tipo: "interna",
      status: "a_fazer",
      titulo: tituloTarefa,
      descricao: "tarefa de teste do popup",
      origem: "manual",
    })
    .select("id")
    .single();
  if (error) throw new Error(`seed tarefa: ${error.message}`);
  tarefaId = data.id;
});

test.afterAll(async () => {
  await admin.from("tarefas_excluidas").delete().eq("tarefa_id", tarefaId);
  await cleanupE2E(admin);
});

test("clicar Feito abre popup; excluir exige motivo e registra no log", async ({ page }) => {
  await page.goto(`/casos/${casoId}`);
  // Aba Atividades.
  await page.getByText("Atividades", { exact: true }).first().click();
  await expect(page.getByText(tituloTarefa)).toBeVisible({ timeout: 20000 });

  // O botão "..." é opacity-0 até o hover no card (group-hover). Localiza o
  // card pelo título, faz hover e clica no menu por aria-label.
  const cardTarefa = page
    .locator("div.group")
    .filter({ hasText: tituloTarefa })
    .first();
  await cardTarefa.hover();
  await cardTarefa.getByRole("button", { name: "Ações da tarefa" }).click();
  await page.getByRole("menuitem", { name: "Feito", exact: true }).click();

  // Popup de conclusão.
  await expect(page.getByRole("heading", { name: "Concluir tarefa" })).toBeVisible();
  await expect(page.getByRole("button", { name: /Concluir tarefa/ })).toBeVisible();

  // Excluir sem motivo: bloqueado.
  await page.getByRole("button", { name: /Excluir com motivo/ }).click();
  await page.getByRole("button", { name: "Excluir tarefa" }).click();
  await expect(page.getByText("Escreva o motivo antes de excluir.")).toBeVisible();

  // Com motivo: exclui.
  await page
    .getByPlaceholder(/caso é judicial/)
    .fill("caso judicial — análise do Legalmail não se aplica");
  await page.getByRole("button", { name: "Excluir tarefa" }).click();
  await expect(page.getByText(/Tarefa excluída/)).toBeVisible({ timeout: 15000 });

  // Banco: tarefa apagada e log com o motivo.
  const { data: viva } = await admin.from("tarefas").select("id").eq("id", tarefaId).maybeSingle();
  expect(viva).toBeNull();
  const { data: log } = await admin
    .from("tarefas_excluidas")
    .select("motivo")
    .eq("tarefa_id", tarefaId)
    .maybeSingle();
  expect(log?.motivo).toContain("Legalmail");
});

// E2E: painel de edição da tarefa (TarefaSheet) — excluir com motivo (vira
// andamento) e ausência da opção "Cancelado" (Naira, 2026-09-02).

import { test, expect } from "@playwright/test";
import { STORAGE_INTERNO } from "../auth.setup";
import { adminClient, cleanupE2E, seedClienteCaso } from "../supabase-admin";

test.use({ storageState: STORAGE_INTERNO });

const admin = adminClient();
let casoId: string;
let titulo: string;
let tarefaId: string;

test.beforeAll(async () => {
  const sufixo = `Sheet Excluir ${Date.now()}`;
  ({ casoId } = await seedClienteCaso(admin, { sufixo }));
  titulo = `[E2E] Sheet ${Date.now()}`;
  const { data, error } = await admin
    .from("tarefas")
    .insert({ caso_id: casoId, tipo: "interna", status: "a_fazer", titulo, origem: "manual" })
    .select("id")
    .single();
  if (error) throw new Error(`seed tarefa: ${error.message}`);
  tarefaId = data.id;
});

test.afterAll(async () => {
  await admin.from("tarefas_excluidas").delete().eq("tarefa_id", tarefaId);
  await cleanupE2E(admin);
});

test('"Cancelado" não é escolhível; sheet exclui com motivo (vira andamento)', async ({ page }) => {
  await page.goto(`/casos/${casoId}`);
  await page.getByText("Atividades", { exact: true }).first().click();
  await expect(page.getByText(titulo)).toBeVisible({ timeout: 20000 });

  // O card não tem mais menu "...": criar, alterar e excluir é dentro da
  // tarefa (Naira, 2026-09-09).
  const card = page.locator("div.group").filter({ hasText: titulo }).first();
  await card.hover();
  await expect(card.getByRole("button", { name: "Ações da tarefa" })).toHaveCount(0);

  // Abre o sheet (clicando no card).
  await page.getByText(titulo).click();
  await expect(page.getByRole("heading", { name: "Editar tarefa" })).toBeVisible({ timeout: 10000 });

  // Status: tem "Feito", NÃO tem "Cancelado".
  await page.getByRole("combobox", { name: "Status" }).click();
  await expect(page.getByRole("option", { name: "Feito", exact: true })).toBeVisible();
  await expect(page.getByRole("option", { name: "Cancelado", exact: true })).toHaveCount(0);
  await page.keyboard.press("Escape");

  // Exclui com motivo.
  await page.getByRole("button", { name: "Excluir", exact: true }).click();

  // Popup de exclusão (mesmo dialog do Concluir, já no modo de motivo):
  // sem motivo é barrado.
  await expect(page.getByRole("heading", { name: "Excluir tarefa" })).toBeVisible();
  await page.getByRole("button", { name: "Excluir tarefa" }).click();
  await expect(page.getByText("Escreva o motivo antes de excluir.")).toBeVisible();

  await page.getByPlaceholder(/caso é judicial/).fill("caso judicial — não se aplica");
  await page.getByRole("button", { name: "Excluir tarefa" }).click();
  await expect(page.getByText("Tarefa excluída.", { exact: true })).toBeVisible({ timeout: 15000 });

  // Banco: tarefa apagada + andamento com o motivo. Checar `error` antes do
  // `data` — falha de query engolida viraria "tarefa apagada" falso.
  const { data: viva, error: erroViva } = await admin
    .from("tarefas")
    .select("id")
    .eq("id", tarefaId)
    .maybeSingle();
  expect(erroViva).toBeNull();
  expect(viva).toBeNull();
  const { data: and, error: erroAnd } = await admin
    .from("andamentos")
    .select("descricao, visivel_parceiro")
    .eq("caso_id", casoId)
    .eq("metadata->>tarefa_id", tarefaId)
    .maybeSingle();
  expect(erroAnd).toBeNull();
  expect(and, "andamento do motivo não foi criado").toBeTruthy();
  expect(and!.visivel_parceiro).toBe(false);
});

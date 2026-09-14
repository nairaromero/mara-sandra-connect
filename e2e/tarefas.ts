import { expect, type Page } from "@playwright/test";

// Navegação de tarefas compartilhada entre specs. Desde 2026-09-14 tarefa nova
// só nasce no caso (o "Nova tarefa" saiu de /tarefas), então todo spec que cria
// ou conclui tarefa passa pela aba Atividades do caso.

export async function abrirAtividadesDoCaso(page: Page, casoId: string) {
  await page.goto(`/casos/${casoId}`);
  await page.getByText("Atividades", { exact: true }).first().click();
}

// Formulário de nova tarefa aberto pelo caso (Cliente já vem preenchido).
export async function abrirNovaTarefaNoCaso(page: Page, casoId: string) {
  await abrirAtividadesDoCaso(page, casoId);
  await page.getByRole("button", { name: "Nova tarefa" }).click();
  await expect(page.getByRole("heading", { name: "Nova tarefa" })).toBeVisible({ timeout: 10000 });
}

// Abre a tarefa (sheet "Editar tarefa") pelo card na aba Atividades.
export async function abrirTarefaNoCaso(page: Page, casoId: string, titulo: string) {
  await abrirAtividadesDoCaso(page, casoId);
  await expect(page.getByText(titulo)).toBeVisible({ timeout: 20000 });
  await page.locator("div.group").filter({ hasText: titulo }).first().getByText(titulo).click();
  await expect(page.getByRole("heading", { name: "Editar tarefa" })).toBeVisible({
    timeout: 10000,
  });
}

// Status "Feito" no sheet aberto: abre o popup "Concluir tarefa".
export async function marcarFeito(page: Page) {
  await page.getByRole("combobox", { name: "Status" }).click();
  await page.getByRole("option", { name: "Feito", exact: true }).click();
}

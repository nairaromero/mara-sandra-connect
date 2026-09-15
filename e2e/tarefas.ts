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

// Resposta fixa da edge sugerir-proxima-tarefa. O staging tem chave de IA desde
// 2026-09-15: sem isto, cada conclusão pelo popup chamava a IA de verdade (gasto
// a cada rodada) e o teste dependia do que ela respondesse. Registrar de novo no
// mesmo teste troca a resposta — a rota registrada por último vale primeiro.
const LATENCIA_SIMULADA_MS = 1200;

export const SEM_SUGESTAO = { sugestao: null, motivo: "A IA não viu próximo passo para este caso." };

export async function simularSugestaoProxima(
  page: Page,
  corpo: object = SEM_SUGESTAO,
  aoPedir?: (corpoDoPedido: unknown) => void,
) {
  await page.route("**/functions/v1/sugerir-proxima-tarefa", async (route) => {
    const cors = {
      "access-control-allow-origin": "*",
      "access-control-allow-headers": "*",
      "access-control-allow-methods": "POST, OPTIONS",
    };
    if (route.request().method() === "OPTIONS") {
      await route.fulfill({ status: 204, headers: cors });
      return;
    }
    aoPedir?.(route.request().postDataJSON());
    // Latência realista: a edge de verdade leva segundos. Resposta instantânea
    // fazia o teste clicar em "Criar nova tarefa" enquanto o painel da tarefa
    // ainda fechava, e reabrir no meio da animação deixava o fundo escurecido
    // preso por cima do formulário (visto na Agenda em 2026-09-15).
    await new Promise((r) => setTimeout(r, LATENCIA_SIMULADA_MS));
    await route.fulfill({
      status: 200,
      headers: { ...cors, "content-type": "application/json" },
      body: JSON.stringify(corpo),
    });
  });
}

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

  // Popup de conclusão — botão de concluir já leva "e adicionar outra".
  await expect(page.getByRole("heading", { name: "Concluir tarefa" })).toBeVisible();
  await expect(
    page.getByRole("button", { name: /Concluir tarefa e adicionar outra/ }),
  ).toBeVisible();

  // Excluir sem motivo: bloqueado.
  await page.getByRole("button", { name: /Excluir com motivo/ }).click();
  await page.getByRole("button", { name: "Excluir tarefa" }).click();
  await expect(page.getByText("Escreva o motivo antes de excluir.")).toBeVisible();

  // Com motivo: exclui.
  await page
    .getByPlaceholder(/caso é judicial/)
    .fill("caso judicial — análise do Legalmail não se aplica");
  await page.getByRole("button", { name: "Excluir tarefa" }).click();
  // Toast exato (o andamento novo "Tarefa excluída: ..." também casaria o regex).
  await expect(page.getByText("Tarefa excluída.", { exact: true })).toBeVisible({ timeout: 15000 });

  // Banco: tarefa apagada, log com o motivo, e ANDAMENTO no caso com o motivo.
  // Sempre checar `error` antes do `data`: falha de query engolida viraria
  // "tarefa apagada" falso (error ignorado ≠ resultado vazio).
  const { data: viva, error: erroViva } = await admin
    .from("tarefas")
    .select("id")
    .eq("id", tarefaId)
    .maybeSingle();
  expect(erroViva).toBeNull();
  expect(viva).toBeNull();
  const { data: log, error: erroLog } = await admin
    .from("tarefas_excluidas")
    .select("motivo")
    .eq("tarefa_id", tarefaId)
    .maybeSingle();
  expect(erroLog).toBeNull();
  expect(log?.motivo).toContain("Legalmail");
  const { data: and, error: erroAnd } = await admin
    .from("andamentos")
    .select("titulo, descricao, visivel_parceiro")
    .eq("caso_id", casoId)
    .eq("metadata->>tarefa_id", tarefaId)
    .maybeSingle();
  expect(erroAnd).toBeNull();
  expect(and, "andamento do motivo não foi criado").toBeTruthy();
  expect(and!.descricao).toContain("Legalmail");
  expect(and!.visivel_parceiro).toBe(false);
});

test("Concluir tarefa e adicionar outra abre a criação da próxima", async ({ page }) => {
  // Segunda tarefa dedicada (a do outro teste é excluída).
  const titulo2 = `[E2E] Proxima ${Date.now()}`;
  const { data: t2, error: erroT2 } = await admin
    .from("tarefas")
    .insert({ caso_id: casoId, tipo: "interna", status: "a_fazer", titulo: titulo2, origem: "manual" })
    .select("id")
    .single();
  if (erroT2) throw new Error(`seed tarefa 2: ${erroT2.message}`);

  await page.goto(`/casos/${casoId}`);
  await page.getByText("Atividades", { exact: true }).first().click();
  await expect(page.getByText(titulo2)).toBeVisible({ timeout: 20000 });

  const card = page.locator("div.group").filter({ hasText: titulo2 }).first();
  await card.hover();
  await card.getByRole("button", { name: "Ações da tarefa" }).click();
  await page.getByRole("menuitem", { name: "Feito", exact: true }).click();
  await page.getByRole("button", { name: /Concluir tarefa e adicionar outra/ }).click();

  // Abriu o sheet de criação da próxima tarefa (SheetTitle "Nova tarefa" — o
  // heading, não o botão da toolbar).
  await expect(page.getByRole("heading", { name: "Nova tarefa" })).toBeVisible({ timeout: 10000 });

  // Banco: a primeira ficou concluída.
  const { data: feita, error: erroFeita } = await admin
    .from("tarefas")
    .select("status")
    .eq("id", t2!.id)
    .single();
  expect(erroFeita).toBeNull();
  expect(feita!.status).toBe("feito");
  await admin.from("tarefas").delete().eq("id", t2!.id);
});

// E2E: caso do parceiro nasce como ORGANIZAÇÃO DE DOCUMENTOS e só depois vira
// análise (card #434).
//
// O que isso conserta: todo caso de parceiro caía direto na análise, e caía com
// a pasta bagunçada. Agora a conferência tem tarefa própria, e concluí-la é o
// que entrega a análise na mão de quem analisa — com a lista do que falta.

import { test, expect } from "@playwright/test";
import { STORAGE_INTERNO } from "../auth.setup";
import { ENV } from "../env";
import { adminClient, cleanupE2E, seedClienteCaso } from "../supabase-admin";
import { abrirAtividadesDoCaso } from "../tarefas";

test.use({ storageState: STORAGE_INTERNO });

const admin = adminClient();
let casoId: string;
let parceiroId: string;
let internoId: string;

test.beforeAll(async () => {
  const { data: parceiro } = await admin
    .from("usuarios")
    .select("id")
    .eq("email", ENV.parceiroEmail)
    .single();
  if (!parceiro) throw new Error(`parceiro de teste não encontrado: ${ENV.parceiroEmail}`);
  parceiroId = parceiro.id as string;

  const { data: interno } = await admin
    .from("usuarios")
    .select("id")
    .eq("email", ENV.internoEmail)
    .single();
  if (!interno) throw new Error(`interno de teste não encontrado: ${ENV.internoEmail}`);
  internoId = interno.id as string;

  ({ casoId } = await seedClienteCaso(admin, {
    sufixo: `Organizar docs ${Date.now()}`,
    parceiroId,
  }));

  // A tarefa nasce do gatilho, no nome de quem o escritório configurou. Pra o
  // teste enxergar a tarefa em "Minhas tarefas", ela passa pro interno do E2E.
  await admin
    .from("tarefas")
    .update({ responsavel_id: internoId })
    .eq("caso_id", casoId)
    .eq("metadata->>etapa", "organizacao_documentos");
});

test.afterAll(async () => {
  await cleanupE2E(admin);
});

test("caso do parceiro abre conferência de documentos, não análise", async () => {
  const { data, error } = await admin
    .from("tarefas")
    .select("titulo, status, metadata")
    .eq("caso_id", casoId);
  expect(error, "erro ao ler as tarefas do caso").toBeFalsy();
  expect(data?.length, "deveria nascer UMA tarefa").toBe(1);
  expect(data![0].titulo).toMatch(/^Organizar documentos/);
  expect((data![0].metadata as { etapa?: string }).etapa).toBe("organizacao_documentos");
});

test("concluir a conferência entrega a análise com o que falta", async ({ page }) => {
  await abrirAtividadesDoCaso(page, casoId);
  const card = page.locator("div.group").filter({ hasText: "Organizar documentos" }).first();
  await expect(card).toBeVisible({ timeout: 20_000 });

  // A conferência não é formulário: o card resume o que a IA achou e o que
  // falta. Sem documento nenhum no caso, tudo da lista base aparece faltando.
  await expect(card.getByText(/Falta:/)).toBeVisible();
  await expect(card.getByText(/identificados/)).toBeVisible();

  await card.getByRole("button", { name: /Conferido — enviar para análise/ }).click();
  await expect(page.getByText(/Documentos conferidos — a análise/)).toBeVisible({
    timeout: 20_000,
  });

  // Banco: conferência fechada, análise aberta com os faltantes na descrição.
  await expect
    .poll(
      async () => {
        const { data } = await admin
          .from("tarefas")
          .select("titulo, status, descricao, metadata")
          .eq("caso_id", casoId)
          .order("created_at");
        return data ?? [];
      },
      { timeout: 20_000 },
    )
    .toMatchObject([
      { titulo: expect.stringMatching(/^Organizar documentos/), status: "feito" },
      {
        titulo: expect.stringMatching(/Analisar$/),
        status: "a_fazer",
        descricao: expect.stringContaining("Falta:"),
      },
    ]);

  // E o rastro no caso.
  const { data: andamentos } = await admin
    .from("andamentos")
    .select("titulo, visivel_parceiro")
    .eq("caso_id", casoId)
    .eq("titulo", "Documentos organizados");
  expect(andamentos?.length).toBe(1);
  expect(andamentos![0].visivel_parceiro, "rastro interno não vai pro parceiro").toBe(false);
});

test("a conferência não se conclui pelo status, só pelo botão", async ({ page }) => {
  const { casoId: outroCaso } = await seedClienteCaso(admin, {
    sufixo: `Organizar docs guard ${Date.now()}`,
    parceiroId,
  });
  await admin
    .from("tarefas")
    .update({ responsavel_id: internoId })
    .eq("caso_id", outroCaso)
    .eq("metadata->>etapa", "organizacao_documentos");

  await abrirAtividadesDoCaso(page, outroCaso);
  await page.getByText("Organizar documentos", { exact: false }).first().click();
  await expect(page.getByRole("heading", { name: "Editar tarefa" })).toBeVisible({
    timeout: 20_000,
  });
  await page.getByRole("combobox", { name: "Status" }).click();
  await page.getByRole("option", { name: "Feito", exact: true }).click();

  // O popup avisa que quem conclui é o checklist — e não oferece "Concluir".
  // O popup explica que quem conclui é o checklist da tarefa.
  await expect(page.getByText(/conferência dos documentos \(botão/)).toBeVisible({
    timeout: 10_000,
  });
  await expect(page.getByRole("button", { name: "Concluir tarefa" })).toHaveCount(0);
});

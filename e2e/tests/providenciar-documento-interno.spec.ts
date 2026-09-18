// E2E: pedido de documento INTERNO — tarefa "Providenciar documentos" leva ao
// cumprimento do pedido (card #357, Naira 2026-09-18).
//
// O buraco que isto fecha: a tarefa nascia no nome de alguém da equipe, mas
// concluir a tarefa (ou subir o arquivo pelo upload comum) não fechava o
// PEDIDO — ele ficava pendente pra sempre.
//
// Cobre:
//  - a tarefa nasce no responsável escolhido (gatilho do banco);
//  - o painel da tarefa mostra o pedido e o botão de cumprir;
//  - cumprir pelo painel anexa o documento, fecha o pedido e conclui a tarefa
//    sozinha;
//  - o popup de "Feito" avisa quando o pedido continua aberto.

import { test, expect } from "@playwright/test";
import { STORAGE_INTERNO } from "../auth.setup";
import { ENV } from "../env";
import { adminClient, cleanupE2E, seedClienteCaso } from "../supabase-admin";

test.use({ storageState: STORAGE_INTERNO });

const admin = adminClient();

const PDF_FAKE = Buffer.from(
  "%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF",
);

let casoId: string;
let solicId: string;
let tarefaId: string;
let internoId: string;

test.beforeAll(async () => {
  const { data: interno } = await admin
    .from("usuarios")
    .select("id")
    .eq("email", ENV.internoEmail)
    .single();
  if (!interno) throw new Error(`interno de teste não encontrado: ${ENV.internoEmail}`);
  internoId = interno.id as string;

  ({ casoId } = await seedClienteCaso(admin, { sufixo: `Providenciar ${Date.now()}` }));

  const { data: solic, error } = await admin
    .from("solicitacoes_documento")
    .insert({
      caso_id: casoId,
      tipo: "cnis",
      descricao: "[E2E] baixar o CNIS no Meu INSS",
      status: "pendente",
      origem: "interna",
      responsavel_id: internoId,
    })
    .select("id")
    .single();
  if (error) throw new Error(`seed solicitação interna: ${error.message}`);
  solicId = solic.id as string;
});

test.afterAll(async () => {
  await cleanupE2E(admin);
});

test("tarefa de providenciar abre no responsável e cumpre o pedido pelo painel", async ({
  page,
}) => {
  // 1. O gatilho abriu a tarefa no nome de quem foi escolhido.
  const { data: tarefas, error } = await admin
    .from("tarefas")
    .select("id, titulo, status, responsavel_id")
    .eq("origem_ref", `solicitacao:${solicId}`);
  expect(error, "erro ao ler as tarefas do pedido").toBeFalsy();
  expect(tarefas?.length, "tarefa de providenciar não nasceu").toBe(1);
  expect(tarefas![0].responsavel_id).toBe(internoId);
  expect(tarefas![0].status).toBe("a_fazer");
  tarefaId = tarefas![0].id as string;
  const titulo = tarefas![0].titulo as string;

  await page.goto(`/casos/${casoId}`);
  await page.getByText("Atividades", { exact: true }).first().click();
  await expect(page.getByText(titulo).first()).toBeVisible({ timeout: 20_000 });
  await page.getByText(titulo).first().click();
  await expect(page.getByRole("heading", { name: "Editar tarefa" })).toBeVisible({
    timeout: 10_000,
  });

  // 2. O painel mostra o pedido ligado à tarefa.
  await expect(page.getByText("Pedido de documento")).toBeVisible();

  // 3. Concluir pelo "Feito" avisa que o pedido continua aberto — e deixa
  //    cumprir na hora, em vez de deixar pedido órfão.
  // No painel, "Feito" é o status: escolher abre o popup de conclusão.
  await page.getByRole("combobox", { name: "Status" }).click();
  await page.getByRole("option", { name: "Feito", exact: true }).click();
  await expect(page.getByText(/continua aberto/)).toBeVisible({ timeout: 10_000 });
  await expect(page.getByRole("button", { name: "Concluir mesmo assim" })).toBeVisible();
  await page
    .getByRole("button", { name: "Anexar documento e cumprir o pedido" })
    .first()
    .click();

  // 4. Cumpre: anexo obrigatório.
  await expect(page.getByRole("heading", { name: "Cumprir pedido de documento" })).toBeVisible();
  await page.getByRole("button", { name: "Anexar e cumprir" }).click();
  await expect(page.getByText("Anexe o documento")).toBeVisible();

  await page
    .locator('input[type="file"]')
    .last()
    .setInputFiles([{ name: "cnis-e2e.pdf", mimeType: "application/pdf", buffer: PDF_FAKE }]);
  await page.getByRole("button", { name: "Anexar e cumprir" }).click();
  await expect(page.getByText(/Pedido cumprido/)).toBeVisible({ timeout: 30_000 });

  // 5. Banco: pedido atendido, documento vinculado ao pedido, tarefa concluída
  //    pelo gatilho — sem ninguém precisar lembrar de fechar as duas pontas.
  await expect
    .poll(
      async () => {
        const { data } = await admin
          .from("solicitacoes_documento")
          .select("status, documento_id")
          .eq("id", solicId)
          .single();
        return data;
      },
      { timeout: 20_000 },
    )
    .toMatchObject({ status: "atendido" });

  const { data: docs, error: erroDocs } = await admin
    .from("documentos")
    .select("id, nome_arquivo")
    .eq("solicitacao_id", solicId);
  expect(erroDocs, "erro ao ler os documentos do pedido").toBeFalsy();
  expect(docs?.length).toBe(1);

  await expect
    .poll(
      async () => {
        const { data } = await admin
          .from("tarefas")
          .select("status")
          .eq("id", tarefaId)
          .single();
        return data?.status;
      },
      { timeout: 20_000 },
    )
    .toBe("feito");
});

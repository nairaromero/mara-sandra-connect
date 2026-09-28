// E2E: a obrigatoriedade do processo em perícia/audiência, pela tela
// (achado 13 da revisão do Yuri no PR #391 — a regra existia sem teste).
//
// Dois lados:
//  1. caso com frente e ninguém escolheu → não salva, e o campo diz o que falta;
//  2. leitura das frentes falhando → também não salva. Esse é o furo do achado
//     1: `listarProcessosDoCaso` engolia o erro e devolvia [], então "não
//     consegui ler" virava "cliente sem processo" e o compromisso ia sem frente.

import { test, expect } from "@playwright/test";
import { STORAGE_INTERNO } from "../auth.setup";
import { adminClient, cleanupE2E, seedClienteCaso } from "../supabase-admin";
import { abrirAtividadesDoCaso } from "../tarefas";

test.use({ storageState: STORAGE_INTERNO });

const admin = adminClient();
let casoId: string;
let titulo: string;

test.beforeAll(async () => {
  const sufixo = Date.now();
  // Nome do cliente diferente do título do compromisso: senão o cabeçalho do
  // caso e a tarefa "Avisar o cliente da perícia" casam com o mesmo texto.
  ({ casoId } = await seedClienteCaso(admin, { sufixo: `Frente obrigatória ${sufixo}` }));
  titulo = `[E2E] Compromisso ${sufixo}`;
  const inicio = new Date(Date.now() + 3 * 86400_000);
  inicio.setUTCHours(13, 0, 0, 0);
  const { error } = await admin.from("agenda_eventos").insert({
    caso_id: casoId,
    tipo: "pericia",
    titulo,
    start_at: inicio.toISOString(),
    end_at: new Date(inicio.getTime() + 3600_000).toISOString(),
  });
  if (error) throw new Error(`seed perícia: ${error.message}`);

  // As DUAS frentes: com uma só, o gatilho do banco preencheria sozinho e não
  // haveria escolha a cobrar da tela.
  const admins = await admin
    .from("processos_admin")
    .insert({ caso_id: casoId, numero_requerimento: `E2E-REQ-${sufixo}` });
  if (admins.error) throw new Error(`seed requerimento: ${admins.error.message}`);
  const jud = await admin
    .from("processos_judiciais")
    .insert({ caso_id: casoId, numero_processo: `E2E-JUD-${sufixo}` });
  if (jud.error) throw new Error(`seed processo judicial: ${jud.error.message}`);
});

test.afterAll(async () => {
  await cleanupE2E(admin);
});

test("perícia não salva sem escolher o processo", async ({ page }) => {
  await abrirAtividadesDoCaso(page, casoId);
  await page.getByText(titulo, { exact: true }).click();
  const painel = page
    .getByRole("dialog")
    .filter({ has: page.getByRole("heading", { name: "Editar agendamento" }) });
  await expect(painel).toBeVisible({ timeout: 20_000 });

  // O campo aparece marcado como obrigatório e mostra o que falta — não em
  // branco (achado 12).
  await expect(painel.getByText("Processo *")).toBeVisible();
  await expect(painel.getByLabel("Processo do compromisso")).toContainText("Escolha o processo");

  await painel.getByRole("button", { name: "Salvar" }).click();
  await expect(page.getByText("Escolha o processo da perícia")).toBeVisible({ timeout: 10_000 });

  // Escolhendo, salva.
  await painel.getByLabel("Processo do compromisso").click();
  await page.getByRole("option", { name: /Judicial/ }).first().click();
  await painel.getByRole("button", { name: "Salvar" }).click();
  await expect(page.getByText("Evento atualizado.")).toBeVisible({ timeout: 20_000 });

  const { data } = await admin
    .from("agenda_eventos")
    .select("processo_judicial_id")
    .eq("caso_id", casoId)
    .eq("titulo", titulo)
    .single();
  expect(data!.processo_judicial_id).toBeTruthy();
});

test("falha ao ler os processos do caso também barra o salvar", async ({ page }) => {
  await abrirAtividadesDoCaso(page, casoId);

  // A leitura das frentes quebra DEPOIS que a tela do caso carregou: o painel
  // não pode concluir "cliente sem processo" e liberar o salvar.
  await page.route("**/rest/v1/processos_judiciais*", (rota) => rota.abort());

  await page.getByText(titulo, { exact: true }).click();
  const painel = page
    .getByRole("dialog")
    .filter({ has: page.getByRole("heading", { name: "Editar agendamento" }) });
  await expect(painel).toBeVisible({ timeout: 20_000 });

  await painel.getByRole("button", { name: "Salvar" }).click();
  await expect(page.getByText("Não consegui carregar os processos do caso")).toBeVisible({
    timeout: 10_000,
  });
});

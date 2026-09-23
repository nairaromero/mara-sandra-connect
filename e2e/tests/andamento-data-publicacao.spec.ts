// E2E: andamento com a data do fato (#315).
//
// O sintoma: um deferimento de julho lançado hoje ia pro TOPO da lista, porque
// o formulário gravava `data_evento: new Date()` e não tinha campo de data.
//
// Cobre:
//  - lançamento retroativo grava a data informada e entra na ordem certa;
//  - data no futuro pede confirmação antes de salvar;
//  - com parceiro no caso, data antiga já muda o aviso para "Vê, sem aviso" —
//    andamento velho não chega como novidade (decisão da Naira, 2026-09-18);
//  - a data também se corrige na edição (é o conserto de automação que veio
//    com data errada).

import { test, expect, type Page } from "@playwright/test";
import { STORAGE_INTERNO } from "../auth.setup";
import { ENV } from "../env";
import { adminClient, cleanupE2E, seedClienteCaso } from "../supabase-admin";

test.use({ storageState: STORAGE_INTERNO });

const admin = adminClient();
let casoId: string;
let parceiroId: string;

function inputDateTimeBR(d: Date): string {
  // O input datetime-local trabalha no fuso do navegador, que nos testes é o
  // de Brasília (playwright.config). Formato: 2026-07-21T09:00.
  const fmt = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
  return fmt.format(d).replace(" ", "T");
}

async function abrirNovoAndamento(page: Page) {
  await page.goto(`/casos/${casoId}`);
  await page.getByText("Atividades", { exact: true }).first().click();
  await page.getByRole("button", { name: "Novo", exact: true }).first().click();
  await expect(page.getByRole("heading", { name: /Novo andamento/ })).toBeVisible({
    timeout: 20_000,
  });
}

test.beforeAll(async () => {
  const { data: parceiro } = await admin
    .from("usuarios")
    .select("id")
    .eq("email", ENV.parceiroEmail)
    .single();
  if (!parceiro) throw new Error(`parceiro de teste não encontrado: ${ENV.parceiroEmail}`);
  parceiroId = parceiro.id as string;

  ({ casoId } = await seedClienteCaso(admin, {
    sufixo: `Andamento retroativo ${Date.now()}`,
    parceiroId,
  }));

  // Andamento recente, pra provar a ordem: o retroativo tem que ficar DEPOIS.
  const { error } = await admin.from("andamentos").insert({
    caso_id: casoId,
    origem: "interno",
    titulo: "[E2E] Andamento de hoje",
    data_evento: new Date().toISOString(),
    visivel_parceiro: false,
  });
  if (error) throw new Error(`seed andamento: ${error.message}`);
});

test.afterAll(async () => {
  await cleanupE2E(admin);
});

test("andamento retroativo grava a data informada e entra na ordem do caso", async ({ page }) => {
  const doisMesesAtras = new Date(Date.now() - 60 * 86400_000);
  const titulo = `[E2E] Deferimento retroativo ${Date.now()}`;

  await abrirNovoAndamento(page);
  await page.getByPlaceholder("Ex.: Documentos recebidos").fill(titulo);
  await page.getByLabel("Data da publicação").fill(inputDateTimeBR(doisMesesAtras));

  // Data antiga: o aviso ao parceiro cai sozinho para "Vê, sem aviso".
  await expect(page.getByLabel("O parceiro indicador")).toContainText("Vê, sem aviso");

  await page.getByRole("button", { name: "Adicionar" }).click();
  await expect(page.getByText("Andamento adicionado")).toBeVisible({ timeout: 20_000 });

  // Banco: a data é a informada, não o agora.
  const { data, error } = await admin
    .from("andamentos")
    .select("data_evento, visivel_parceiro")
    .eq("caso_id", casoId)
    .eq("titulo", titulo)
    .single();
  expect(error).toBeFalsy();
  const gravada = new Date(data!.data_evento as string);
  const difDias = Math.abs((Date.now() - gravada.getTime()) / 86400_000 - 60);
  expect(difDias, "data gravada deveria ser ~60 dias atrás").toBeLessThan(1);
  expect(data!.visivel_parceiro).toBe(true);

  // Tela: o retroativo aparece DEPOIS do andamento de hoje.
  const posicaoHoje = await page.getByText("[E2E] Andamento de hoje").first().boundingBox();
  const posicaoAntigo = await page.getByText(titulo).first().boundingBox();
  expect(posicaoHoje!.y, "o andamento de hoje fica acima do retroativo").toBeLessThan(
    posicaoAntigo!.y,
  );
});

test("data no futuro pede confirmação antes de salvar", async ({ page }) => {
  const semanaQueVem = new Date(Date.now() + 7 * 86400_000);
  const titulo = `[E2E] Andamento futuro ${Date.now()}`;

  await abrirNovoAndamento(page);
  await page.getByPlaceholder("Ex.: Documentos recebidos").fill(titulo);
  await page.getByLabel("Data da publicação").fill(inputDateTimeBR(semanaQueVem));
  await page.getByRole("button", { name: "Adicionar" }).click();

  await expect(page.getByRole("heading", { name: "Confere a data?" })).toBeVisible();
  await expect(page.getByText("Essa data ainda não chegou.")).toBeVisible();

  // Voltar e corrigir: nada é gravado.
  await page.getByRole("button", { name: "Voltar e corrigir" }).click();
  const { count } = await admin
    .from("andamentos")
    .select("id", { count: "exact", head: true })
    .eq("caso_id", casoId)
    .eq("titulo", titulo);
  expect(count).toBe(0);

  // Confirmando, grava.
  await page.getByRole("button", { name: "Adicionar" }).click();
  await page.getByRole("button", { name: "Salvar assim mesmo" }).click();
  await expect(page.getByText("Andamento adicionado")).toBeVisible({ timeout: 20_000 });
});

test("a data de um andamento existente se corrige na edição", async ({ page }) => {
  const titulo = `[E2E] Automação com data errada ${Date.now()}`;
  const { error } = await admin.from("andamentos").insert({
    caso_id: casoId,
    origem: "interno",
    titulo,
    data_evento: new Date().toISOString(),
    visivel_parceiro: false,
  });
  if (error) throw new Error(`seed andamento: ${error.message}`);

  await page.goto(`/casos/${casoId}`);
  await page.getByText("Atividades", { exact: true }).first().click();
  await expect(page.getByText(titulo)).toBeVisible({ timeout: 20_000 });
  await page
    .locator("li")
    .filter({ hasText: titulo })
    .first()
    .getByTitle("Editar andamento")
    .click();
  await expect(page.getByRole("heading", { name: "Editar andamento" })).toBeVisible();

  const ontem = new Date(Date.now() - 86400_000);
  await page.getByLabel("Data da publicação").fill(inputDateTimeBR(ontem));
  await page.getByRole("button", { name: "Salvar" }).click();
  await expect(page.getByText("Andamento atualizado")).toBeVisible({ timeout: 20_000 });

  const { data } = await admin
    .from("andamentos")
    .select("data_evento")
    .eq("caso_id", casoId)
    .eq("titulo", titulo)
    .single();
  const horas = (Date.now() - new Date(data!.data_evento as string).getTime()) / 3600_000;
  expect(horas, "data deveria ter voltado ~24h").toBeGreaterThan(12);
});

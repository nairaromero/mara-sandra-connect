// E2E: o parceiro indica o caso e, em vez de anexar, cola o link da pasta
// (card #434). É o caso mais comum dele: tudo está numa pasta do OneDrive.
//
// O que isso protege: o campo vive na seção Documentos do formulário, que NÃO
// é só de interno — se alguém fechar a seção por papel, este teste cai.

import { test, expect } from "@playwright/test";
import { STORAGE_PARCEIRO } from "../auth.setup";
import { adminClient, cleanupE2E, cpfValido, MARCADOR } from "../supabase-admin";

test.use({ storageState: STORAGE_PARCEIRO });

const admin = adminClient();
const nomeCliente = `${MARCADOR} Indicacao com link ${Date.now()}`;
const LINK = "https://1drv.ms/f/s!e2e-parceiro-cadastro";

test.afterAll(async () => {
  await cleanupE2E(admin);
});

test("parceiro cadastra o caso com o link da pasta, sem anexar nada", async ({ page }) => {
  await page.goto("/casos/novo");

  await page.getByLabel("Nome completo *").fill(nomeCliente);
  // O FormControl do CPF envolve uma div (input + botão Buscar no TI), então
  // o label não chega no input — vai pelo placeholder.
  await page.getByPlaceholder("000.000.000-00").fill(cpfValido());
  await page.getByLabel("Data de nascimento *").fill("1985-03-22");
  await page.getByLabel("Telefone *").fill("65988887777");

  await page.getByLabel("Tipo de benefício *").click();
  await page.getByRole("option").first().click();

  // O campo do link: o parceiro não escolhe parceiro (é ele) e não anexa nada.
  const campoLink = page.getByPlaceholder("https://1drv.ms/f/…");
  await expect(campoLink, "o parceiro precisa enxergar o campo do link").toBeVisible();
  await campoLink.fill(LINK);

  await page.getByRole("button", { name: "Cadastrar caso" }).click();
  await expect(page).not.toHaveURL(/casos\/novo/, { timeout: 20_000 });

  const { data: cliente } = await admin
    .from("clientes")
    .select("id, casos(id, parceiro_id)")
    .eq("nome", nomeCliente)
    .single();
  const casos = cliente!.casos as Array<{ id: string; parceiro_id: string | null }>;
  expect(casos.length, "o caso do parceiro foi criado").toBe(1);
  expect(casos[0].parceiro_id, "o caso nasce no nome dele").not.toBeNull();

  // O link entrou pela sessão DELE — é a RLS do parceiro que aceitou.
  const { data: pastas } = await admin
    .from("caso_pastas_externas")
    .select("url, criado_por")
    .eq("caso_id", casos[0].id);
  expect(pastas?.map((p) => p.url)).toEqual([LINK]);
  expect(pastas![0].criado_por, "o link é dele, e é ele quem pode corrigir").toBe(
    casos[0].parceiro_id,
  );

  // E a tarefa de organizar já nasce sabendo onde os arquivos estão.
  const { data: tarefas } = await admin
    .from("tarefas")
    .select("titulo, metadata")
    .eq("caso_id", casos[0].id);
  expect(tarefas?.length, "uma tarefa: a conferência").toBe(1);
  expect((tarefas![0].metadata as { etapa?: string }).etapa).toBe("organizacao_documentos");
});

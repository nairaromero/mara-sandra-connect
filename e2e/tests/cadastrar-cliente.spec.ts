// E2E: cadastrar cliente + caso pelo formulário /casos/novo (usuário interno).
// Form é react-hook-form + zod com labels wireados — getByLabel funciona.

import { test, expect } from "@playwright/test";
import { STORAGE_INTERNO } from "../auth.setup";
import { adminClient, cleanupE2E, cpfValido, MARCADOR } from "../supabase-admin";

test.use({ storageState: STORAGE_INTERNO });

const admin = adminClient();
const nomeCliente = `${MARCADOR} Cadastro ${Date.now()}`;

test.afterAll(async () => {
  await cleanupE2E(admin);
});

test("cadastrar cliente cria cliente e caso", async ({ page }) => {
  await page.goto("/casos/novo");

  await page.getByLabel("Nome completo *").fill(nomeCliente);
  // O FormControl do CPF envolve uma div (input + botão Buscar no TI), então
  // o label não chega no input — vai pelo placeholder.
  await page.getByPlaceholder("000.000.000-00").fill(cpfValido());
  await page.getByLabel("Data de nascimento *").fill("1990-05-10");
  await page.getByLabel("Telefone *").fill("65999990000");

  // Tipo de benefício é Select Radix dentro de FormControl (label wireado).
  await page.getByLabel("Tipo de benefício *").click();
  await page.getByRole("option").first().click();

  // Sem escolher a origem o formulário não pode gravar: antes o caso virava
  // "sem parceiro" (interno) calado.
  await page.getByRole("button", { name: "Cadastrar caso" }).click();
  await expect(
    page.getByText("Informe se o cliente veio por parceiro ou é interno do escritório").first(),
  ).toBeVisible();
  await expect(page).toHaveURL(/casos\/novo/);

  await page.getByLabel("Cliente interno do escritório (sem parceiro indicador)").check();

  await page.getByRole("button", { name: "Cadastrar caso" }).click();

  // Sucesso: sai do formulário (vai pro caso criado ou lista).
  await expect(page).not.toHaveURL(/casos\/novo/, { timeout: 15_000 });

  // Verificação no banco: cliente e caso existem, caso sem parceiro.
  const { data: cliente } = await admin
    .from("clientes")
    .select("id, casos(id, parceiro_id)")
    .eq("nome", nomeCliente)
    .single();
  expect(cliente).toBeTruthy();
  const casos = cliente!.casos as Array<{ id: string; parceiro_id: string | null }>;
  expect(casos.length).toBeGreaterThan(0);
  expect(casos[0].parceiro_id).toBeNull();
});

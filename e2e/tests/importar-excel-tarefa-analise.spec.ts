// E2E: importação por planilha (Naira, 2026-09-03). Linha SEM parceiro não
// dispara o trigger do banco — o caso entrava mudo, sem a tarefa "Cliente novo
// - Analisar". Agora o dialog cria a tarefa, com o mesmo dono padrão do
// trigger (a Mara).

import { test, expect } from "@playwright/test";
import * as XLSX from "xlsx";
import { STORAGE_INTERNO } from "../auth.setup";
import { adminClient, cleanupE2E, cpfValido, MARCADOR } from "../supabase-admin";

test.use({ storageState: STORAGE_INTERNO });

const admin = adminClient();
const nomeCliente = `${MARCADOR} Import Interno ${Date.now()}`;

test.afterAll(async () => {
  await cleanupE2E(admin);
});

test("linha sem parceiro importa com tarefa de análise", async ({ page }) => {
  const planilha = XLSX.utils.json_to_sheet([
    {
      Nome: nomeCliente,
      CPF: cpfValido(),
      "Tipo Beneficio": "Aposentadoria por idade",
      Fase: "Em análise",
      Status: "Em análise",
      Parceiro: "",
    },
  ]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, planilha, "Clientes");
  const buffer: Buffer = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });

  await page.goto("/clientes");
  await page.getByRole("button", { name: "Importar Excel" }).click();
  await page.locator('input[type="file"]').setInputFiles({
    name: "clientes.xlsx",
    mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    buffer,
  });

  await page.getByRole("button", { name: /Importar 1 cliente/ }).click();
  await expect(page.getByText("1 tarefa(s) de análise")).toBeVisible({ timeout: 30000 });

  const { data: cliente } = await admin
    .from("clientes")
    .select("id, casos(id)")
    .eq("nome", nomeCliente)
    .single();
  expect(cliente).toBeTruthy();
  const casoId = (cliente!.casos as Array<{ id: string }>)[0].id;

  const { data: tarefas } = await admin
    .from("tarefas")
    .select("titulo, responsavel_id, metadata")
    .eq("caso_id", casoId);
  const analise = (tarefas ?? []).find(
    (t) => (t.metadata as { etapa?: string })?.etapa === "analise_inicial_interno",
  );
  expect(analise).toBeTruthy();
  const { data: mara } = await admin.rpc("responsavel_padrao_analise");
  expect(analise!.responsavel_id).toBe(mara);
});

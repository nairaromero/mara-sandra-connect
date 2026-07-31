// E2E: parceiro cumpre solicitação de documento com anexo (regressão dos
// bugs de acento/upsert + trigger da tarefa de análise).

import { test, expect } from "@playwright/test";
import { STORAGE_PARCEIRO } from "../auth.setup";
import { ENV } from "../env";
import {
  adminClient,
  cleanupE2E,
  seedClienteCaso,
  seedSolicitacao,
} from "../supabase-admin";

test.use({ storageState: STORAGE_PARCEIRO });

const admin = adminClient();
let casoId: string;
let solicId: string;
let nomeCliente: string;

// PDF mínimo válido o suficiente pro upload.
const PDF_FAKE = Buffer.from(
  "%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF",
);

test.beforeAll(async () => {
  const { data: parceira } = await admin
    .from("usuarios")
    .select("id")
    .eq("email", ENV.parceiroEmail)
    .single();
  if (!parceira) throw new Error(`parceira de teste não encontrada: ${ENV.parceiroEmail}`);

  const sufixo = `Solicitação ${Date.now()}`;
  nomeCliente = `[E2E] ${sufixo}`;
  ({ casoId } = await seedClienteCaso(admin, { sufixo, parceiroId: parceira.id }));
  solicId = await seedSolicitacao(admin, casoId, "comprovante_residencia");
});

test.afterAll(async () => {
  await cleanupE2E(admin);
});

test("parceiro cumpre solicitação com anexo; tarefa de análise nasce via trigger", async ({
  page,
}) => {
  await page.goto("/documentos");

  // Card do cliente seedado com a pendência.
  await expect(page.getByText(nomeCliente)).toBeVisible();
  await page
    .locator("div")
    .filter({ hasText: nomeCliente })
    .getByRole("button", { name: "Cumprir" })
    .first()
    .click();

  // Modal: anexo obrigatório pro parceiro; nome vem pré-preenchido com acento
  // ("Comprovante_de_residência.pdf") — o upload sanitiza o path (regressão).
  await page.locator('input[type="file"]').setInputFiles({
    name: "doc-e2e.pdf",
    mimeType: "application/pdf",
    buffer: PDF_FAKE,
  });
  // Label do campo não tem htmlFor — localiza pelo placeholder.
  await expect(page.getByPlaceholder("Ex: RG_e_CPF_Joao.pdf")).toHaveValue(/Comprovante/);
  await page.getByRole("button", { name: "Confirmar" }).click();

  await expect(
    page.getByText("Solicitação cumprida e documento anexado"),
  ).toBeVisible({ timeout: 20_000 });

  // Banco: solicitação atendida e vinculada ao documento…
  const { data: solic } = await admin
    .from("solicitacoes_documento")
    .select("status, documento_id")
    .eq("id", solicId)
    .single();
  expect(solic!.status).toBe("atendido");
  expect(solic!.documento_id).toBeTruthy();

  // …e o trigger criou a tarefa de análise pro interno.
  const { data: tarefas } = await admin
    .from("tarefas")
    .select("titulo, metadata")
    .eq("caso_id", casoId);
  const analise = (tarefas ?? []).find(
    (t) => (t.metadata as { analise_solicitacao?: boolean })?.analise_solicitacao,
  );
  expect(analise, "tarefa de análise não foi criada pelo trigger").toBeTruthy();
});

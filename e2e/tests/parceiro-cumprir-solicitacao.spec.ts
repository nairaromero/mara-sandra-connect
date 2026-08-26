// E2E: parceiro cumpre solicitação de documento com anexos (regressão dos
// bugs de acento/upsert + trigger da tarefa de análise + múltiplos arquivos
// no mesmo cumprimento, pedido dos parceiros em 2026-08-26).

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

test("parceiro cumpre solicitação com 2 anexos; tarefa de análise nasce via trigger", async ({
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

  // Modal: anexo obrigatório pro parceiro; DOIS arquivos de uma vez (frente e
  // verso). Nomes pré-preenchidos com acento ("Comprovante_de_residência.pdf",
  // o 2º com sufixo) — o upload sanitiza o path (regressão).
  await page.locator('input[type="file"]').setInputFiles([
    { name: "frente-e2e.pdf", mimeType: "application/pdf", buffer: PDF_FAKE },
    { name: "verso-e2e.pdf", mimeType: "application/pdf", buffer: PDF_FAKE },
  ]);
  await expect(page.getByLabel("Nome do arquivo 1")).toHaveValue(/Comprovante/);
  await expect(page.getByLabel("Nome do arquivo 2")).toHaveValue(/_\(2\)/);
  await page.getByRole("button", { name: "Confirmar" }).click();

  await expect(
    page.getByText("Solicitação cumprida — 2 documentos anexados"),
  ).toBeVisible({ timeout: 20_000 });

  // Banco: solicitação atendida, documento_id (legado) apontando pro 1º…
  const { data: solic } = await admin
    .from("solicitacoes_documento")
    .select("status, documento_id")
    .eq("id", solicId)
    .single();
  expect(solic!.status).toBe("atendido");
  expect(solic!.documento_id).toBeTruthy();

  // …os DOIS documentos vinculados à solicitação (N:1 novo)…
  const { data: docs } = await admin
    .from("documentos")
    .select("id, nome_arquivo")
    .eq("solicitacao_id", solicId)
    .order("created_at");
  expect(docs?.length).toBe(2);
  expect(docs![0].id).toBe(solic!.documento_id);
  expect(docs![1].nome_arquivo).toMatch(/_\(2\)/);

  // …e o trigger criou a tarefa de análise pro interno.
  const { data: tarefas } = await admin
    .from("tarefas")
    .select("titulo, metadata")
    .eq("caso_id", casoId);
  const analise = (tarefas ?? []).find(
    (t) => (t.metadata as { analise_solicitacao?: boolean })?.analise_solicitacao,
  );
  expect(analise, "tarefa de análise não foi criada pelo trigger").toBeTruthy();
  // Título leva o NOME DO CLIENTE (pedido da Naira, 2026-08-26).
  expect(analise!.titulo).toBe(`Analisar documento recebido - ${nomeCliente}`);

  // E a tarefa genérica de upload NÃO pode duplicar: documento de cumprimento
  // (solicitacao_id) é pulado pelo trigger de documentos (feedback 2026-08-26).
  const dupla = (tarefas ?? []).find(
    (t) => (t.metadata as { analise_documento_parceiro?: boolean })?.analise_documento_parceiro,
  );
  expect(dupla, "tarefa 'Analisar documentos juntados' duplicada").toBeFalsy();
});

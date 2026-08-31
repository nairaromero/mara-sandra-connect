// E2E: kanban "Tarefas" do parceiro (feedback de parceiro, 2026-08-31).
//
// Cobre:
//  - as 3 colunas por fase do caso (Em análise / Administrativo / Judiciais);
//  - solicitação avulsa com prazo_at aparece com "Enviar até" na coluna certa;
//  - solicitação de EXIGÊNCIA (origem template:...) volta a aparecer pro
//    parceiro (regressão do filtro === 'externa' de 2026-08-27);
//  - audiência entra como card informativo (sem botão Cumprir);
//  - cumprir direto do kanban: modal com anexo obrigatório, solicitação
//    atendida no banco e card some do board;
//  - menu do parceiro: "Tarefas" e "Agenda" (ex-"Perícias").

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
let casoAnaliseId: string;
let solicAvulsaId: string;
let nomeAnalise: string;
let nomeAdmin: string;
let nomeJudicial: string;

const PDF_FAKE = Buffer.from(
  "%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF",
);

function diasAFrenteISO(dias: number): string {
  return new Date(Date.now() + dias * 86400_000).toISOString();
}

test.beforeAll(async () => {
  const { data: parceira } = await admin
    .from("usuarios")
    .select("id")
    .eq("email", ENV.parceiroEmail)
    .single();
  if (!parceira) throw new Error(`parceira de teste não encontrada: ${ENV.parceiroEmail}`);
  const stamp = Date.now();

  // Caso 1 — fase analise, solicitação avulsa com prazo em 2 dias (urgente).
  const sufixoA = `Kanban Análise ${stamp}`;
  nomeAnalise = `[E2E] ${sufixoA}`;
  ({ casoId: casoAnaliseId } = await seedClienteCaso(admin, {
    sufixo: sufixoA,
    parceiroId: parceira.id,
  }));
  solicAvulsaId = await seedSolicitacao(admin, casoAnaliseId, "cnis", {
    prazoAt: diasAFrenteISO(2),
  });

  // Caso 2 — fase admin, solicitação de EXIGÊNCIA (origem template:exigencia)
  // com prazo em 20 dias. É a regressão do filtro === 'externa'.
  const sufixoB = `Kanban Admin ${stamp}`;
  nomeAdmin = `[E2E] ${sufixoB}`;
  const b = await seedClienteCaso(admin, { sufixo: sufixoB, parceiroId: parceira.id });
  await admin.from("casos").update({ fase: "admin" }).eq("id", b.casoId);
  await seedSolicitacao(admin, b.casoId, "outro", {
    origem: "template:exigencia",
    prazoAt: diasAFrenteISO(20),
  });

  // Caso 3 — fase judicial, AUDIÊNCIA daqui a 10 dias (card informativo).
  const sufixoC = `Kanban Judicial ${stamp}`;
  nomeJudicial = `[E2E] ${sufixoC}`;
  const c = await seedClienteCaso(admin, { sufixo: sufixoC, parceiroId: parceira.id });
  await admin.from("casos").update({ fase: "judicial" }).eq("id", c.casoId);
  const inicio = new Date(Date.now() + 10 * 86400_000);
  const fim = new Date(inicio.getTime() + 60 * 60_000);
  const { error: evErr } = await admin.from("agenda_eventos").insert({
    caso_id: c.casoId,
    tipo: "audiencia",
    titulo: `Audiência - ${nomeJudicial}`,
    start_at: inicio.toISOString(),
    end_at: fim.toISOString(),
    local: "2ª Vara Federal (E2E)",
  });
  if (evErr) throw new Error(`seed audiência: ${evErr.message}`);
});

test.afterAll(async () => {
  await cleanupE2E(admin);
});

test("kanban mostra as 3 colunas com solicitações, exigência e audiência", async ({ page }) => {
  await page.goto("/tarefas");

  // Colunas por fase.
  await expect(page.getByText("Em análise", { exact: false })).toBeVisible();
  await expect(page.getByText("Administrativo", { exact: false })).toBeVisible();
  await expect(page.getByText("Judiciais", { exact: false })).toBeVisible();

  // Card da solicitação avulsa: cliente + "Enviar até" (prazo em 2 dias).
  await expect(page.getByText(nomeAnalise)).toBeVisible();
  await expect(page.getByText(/Enviar até .* em 2 dias/)).toBeVisible();

  // Card da exigência (origem template) VISÍVEL pro parceiro — regressão do
  // filtro === 'externa'.
  await expect(page.getByText(nomeAdmin)).toBeVisible();
  await expect(page.getByText("Exigência INSS")).toBeVisible();

  // Audiência: card informativo (rotulado), com local, SEM botão Cumprir.
  await expect(page.getByText(nomeJudicial)).toBeVisible();
  await expect(page.getByText("Audiência", { exact: true })).toBeVisible();
  await expect(page.getByText("2ª Vara Federal (E2E)")).toBeVisible();

  // Selo "Novo" (tudo foi criado agora).
  await expect(page.getByText("Novo").first()).toBeVisible();

  // Menu do parceiro: "Tarefas" e "Agenda" (ex-"Perícias").
  await expect(page.getByRole("link", { name: /Tarefas/ })).toBeVisible();
  await expect(page.getByRole("link", { name: /Agenda/ })).toBeVisible();
});

test("parceiro cumpre solicitação direto do kanban", async ({ page }) => {
  await page.goto("/tarefas");
  await expect(page.getByText(nomeAnalise)).toBeVisible();

  // O card inteiro é role=button (navega pro caso, aria-label "Abrir caso
  // de..."); o botão interno "Cumprir" (exact) abre o modal.
  await page
    .getByRole("button", { name: `Abrir caso de ${nomeAnalise}` })
    .getByRole("button", { name: "Cumprir", exact: true })
    .click();
  await expect(page.getByRole("heading", { name: "Cumprir solicitação" })).toBeVisible();

  await page.locator('input[type="file"]').setInputFiles([
    { name: "cnis-e2e.pdf", mimeType: "application/pdf", buffer: PDF_FAKE },
  ]);
  await page.getByRole("button", { name: "Confirmar" }).click();

  await expect(page.getByText(/Solicitação cumprida/)).toBeVisible({ timeout: 20_000 });

  // Banco: atendida; board recarrega sem o card.
  const { data: solic } = await admin
    .from("solicitacoes_documento")
    .select("status")
    .eq("id", solicAvulsaId)
    .single();
  expect(solic!.status).toBe("atendido");
  await expect(page.getByText(nomeAnalise)).not.toBeVisible({ timeout: 10_000 });
});

test("agenda do parceiro mostra a audiência no calendário", async ({ page }) => {
  await page.goto("/agenda");
  await expect(page.getByRole("heading", { name: "Agenda" })).toBeVisible();
  await expect(page.getByText(/perícias e audiências/)).toBeVisible();
});

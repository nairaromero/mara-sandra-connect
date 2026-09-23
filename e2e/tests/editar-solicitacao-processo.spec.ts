// E2E: "Editar solicitação" muda processo e responsável (card #357).
//
// Pedido da Naira (2026-09-18): o diálogo de edição só mexia em
// tipo/origem/prazo/observação. Cobre aqui:
//  - com processo no caso, salvar sem escolher a frente é bloqueado;
//  - escolher o processo grava a frente no pedido (é ela que decide a coluna
//    do kanban do parceiro);
//  - trocar a origem para interna exige responsável e abre a tarefa
//    "Providenciar documentos" no nome dessa pessoa (o gatilho era só de
//    INSERT — editar não abria tarefa nenhuma).

import { test, expect } from "@playwright/test";
import { STORAGE_INTERNO } from "../auth.setup";
import { adminClient, cleanupE2E, seedClienteCaso, seedSolicitacao } from "../supabase-admin";

test.use({ storageState: STORAGE_INTERNO });

const admin = adminClient();

let casoId: string;
let solicId: string;
let processoJudicialId: string;
let internoNome: string;
let internoId: string;

test.beforeAll(async () => {
  const { data: interno } = await admin
    .from("usuarios")
    .select("id, nome, email")
    .eq("tipo", "interno")
    .eq("ativo", true)
    .order("nome")
    .limit(1)
    .single();
  if (!interno) throw new Error("nenhum interno ativo pra escolher como responsável");
  internoId = interno.id as string;
  internoNome = (interno.nome as string | null) ?? (interno.email as string);

  const seed = await seedClienteCaso(admin, { sufixo: `editar-solic ${Date.now()}` });
  casoId = seed.casoId;

  // Caso com as DUAS frentes: é o cenário em que a escolha importa.
  const { error: paErr } = await admin
    .from("processos_admin")
    .insert({ caso_id: casoId, numero_requerimento: "E2E-REQ", data_protocolo: new Date().toISOString() });
  if (paErr) throw new Error(`seed requerimento: ${paErr.message}`);
  const { data: pj, error: pjErr } = await admin
    .from("processos_judiciais")
    .insert({ caso_id: casoId, numero_processo: "0000001-11.2026.4.03.6183" })
    .select("id")
    .single();
  if (pjErr) throw new Error(`seed processo judicial: ${pjErr.message}`);
  processoJudicialId = pj.id as string;

  // Pedido externo, sem frente — como nasciam antes do card #357.
  solicId = await seedSolicitacao(admin, casoId, "comprovante_residencia");
});

test.afterAll(async () => {
  await cleanupE2E(admin);
});

test("editar solicitação: processo obrigatório, e virar interna abre a tarefa no responsável", async ({
  page,
}) => {
  await page.goto(`/casos/${casoId}`);
  const aba = page.getByRole("tab", { name: /Documentos/i }).first();
  await expect(aba).toBeVisible({ timeout: 20_000 });
  await aba.click();

  await page.getByTitle("Editar solicitação").first().click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText("Editar solicitação")).toBeVisible();

  // Caso com processo: sem escolher a frente, não salva.
  await expect(dialog.getByRole("button", { name: "Salvar" })).toBeDisabled();

  await dialog.getByLabel("Processo do pedido").click();
  await page.getByRole("option", { name: /Processo judicial 0000001/ }).click();
  await expect(dialog.getByRole("button", { name: "Salvar" })).toBeEnabled();

  // Vira interna: agora o responsável é obrigatório.
  await dialog.getByRole("combobox").filter({ hasText: /Externa|Interna/ }).click();
  await page.getByRole("option", { name: /Interna/ }).click();
  await expect(dialog.getByRole("button", { name: "Salvar" })).toBeDisabled();

  await dialog.getByLabel("Responsável na equipe").click();
  await page.getByRole("option", { name: internoNome }).click();
  await dialog.getByRole("button", { name: "Salvar" }).click();

  await expect(page.locator("[data-sonner-toast]").first()).toContainText(/atualizada/i, {
    timeout: 20_000,
  });

  // O que importa está no banco: frente, dono e a tarefa que nasceu da edição.
  await expect
    .poll(
      async () => {
        const { data } = await admin
          .from("solicitacoes_documento")
          .select("origem, responsavel_id, processo_admin_id, processo_judicial_id")
          .eq("id", solicId)
          .single();
        return data;
      },
      { timeout: 15_000 },
    )
    .toMatchObject({
      origem: "interna",
      responsavel_id: internoId,
      processo_admin_id: null,
      processo_judicial_id: processoJudicialId,
    });

  await expect
    .poll(
      async () => {
        const { data } = await admin
          .from("tarefas")
          .select("titulo, status, responsavel_id, processo_judicial_id")
          .eq("origem_ref", `solicitacao:${solicId}`);
        return data ?? [];
      },
      { timeout: 15_000 },
    )
    .toMatchObject([
      {
        status: "a_fazer",
        responsavel_id: internoId,
        processo_judicial_id: processoJudicialId,
      },
    ]);
});

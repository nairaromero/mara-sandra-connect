// E2E: o agendamento de perícia e de audiência não tem "Concluir" (#332).
// Esses dois se concluem pela tarefa de perícia e pela tarefa de audiência; o
// botão direto no agendamento concluía o evento sem pergunta nenhuma. Os
// outros tipos (aqui, reunião) continuam com o botão.

import { test, expect, type Page } from "@playwright/test";
import { STORAGE_INTERNO } from "../auth.setup";
import { adminClient, cleanupE2E, seedClienteCaso } from "../supabase-admin";
import { abrirAtividadesDoCaso } from "../tarefas";

test.use({ storageState: STORAGE_INTERNO });

const admin = adminClient();
let casoId: string;
const sufixo = Date.now();
const titulos = {
  pericia: `[E2E] Perícia agendada ${sufixo}`,
  audiencia: `[E2E] Audiência agendada ${sufixo}`,
  reuniao: `[E2E] Reunião agendada ${sufixo}`,
};

test.beforeAll(async () => {
  ({ casoId } = await seedClienteCaso(admin, { sufixo: `Agenda concluir ${sufixo}` }));
  // Daqui a 3 dias: evento futuro aparece no bloco "Agenda" da aba Atividades.
  const inicio = new Date(Date.now() + 3 * 86400_000);
  inicio.setUTCHours(13, 0, 0, 0);
  const fim = new Date(inicio.getTime() + 3600_000);
  const { error } = await admin.from("agenda_eventos").insert(
    (Object.keys(titulos) as Array<keyof typeof titulos>).map((tipo) => ({
      caso_id: casoId,
      tipo,
      titulo: titulos[tipo],
      start_at: inicio.toISOString(),
      end_at: fim.toISOString(),
    })),
  );
  if (error) throw new Error(`seed agenda: ${error.message}`);
});

test.afterAll(async () => {
  await cleanupE2E(admin);
});

async function abrirAgendamento(page: Page, titulo: string) {
  await expect(page.getByText(titulo)).toBeVisible({ timeout: 20000 });
  await page.getByText(titulo).click();
  const painel = page.getByRole("dialog").filter({ has: page.getByRole("heading", { name: "Editar agendamento" }) });
  await expect(painel).toBeVisible({ timeout: 10000 });
  return painel;
}

test("perícia e audiência não têm Concluir; reunião continua com o botão", async ({ page }) => {
  await abrirAtividadesDoCaso(page, casoId);

  for (const tipo of ["pericia", "audiencia"] as const) {
    const painel = await abrirAgendamento(page, titulos[tipo]);
    // O painel carregou (Cancelar à vista) e mesmo assim não há Concluir/Reabrir.
    await expect(painel.getByRole("button", { name: "Cancelar", exact: true })).toBeVisible();
    await expect(painel.getByRole("button", { name: "Concluir", exact: true })).toHaveCount(0);
    await expect(painel.getByRole("button", { name: "Reabrir", exact: true })).toHaveCount(0);
    await painel.getByRole("button", { name: "Cancelar", exact: true }).click();
    await expect(painel).toHaveCount(0);
  }

  // Contraprova: outro tipo segue com o botão.
  const painel = await abrirAgendamento(page, titulos.reuniao);
  await expect(painel.getByRole("button", { name: "Concluir", exact: true })).toBeVisible();

  // E nada foi concluído pelo caminho.
  const { data, error } = await admin.from("agenda_eventos").select("tipo, concluido_em").eq("caso_id", casoId);
  expect(error).toBeNull();
  expect(data?.every((e) => e.concluido_em === null)).toBe(true);
});

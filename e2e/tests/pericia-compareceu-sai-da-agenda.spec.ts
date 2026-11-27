// E2E: responder o comparecimento encerra a perícia na agenda do caso.
//
// Naira, 27/11/2026, validando no staging: depois de marcar que o cliente
// compareceu, o box "Perícia Judicial" continuava em Ativos (a perícia do teste
// era em data futura). Perícia se conclui pela tarefa dela (#332) — então a
// resposta do comparecimento dá o agendamento por realizado, e ele sai dos
// ativos. A outra perícia aberta do mesmo processo fica onde está.

import { test, expect } from "@playwright/test";
import { STORAGE_INTERNO } from "../auth.setup";
import { adminClient, cleanupE2E, seedClienteCaso } from "../supabase-admin";
import { abrirAtividadesDoCaso } from "../tarefas";

test.use({ storageState: STORAGE_INTERNO });

const admin = adminClient();
let casoId: string;
let tituloEvento: string;
let tituloOutra: string;
let tituloTarefa: string;

test.beforeAll(async () => {
  const sufixo = Date.now();
  ({ casoId } = await seedClienteCaso(admin, { sufixo: `Compareceu ${sufixo}` }));
  const jud = await admin
    .from("processos_judiciais")
    .insert({ caso_id: casoId, numero_processo: `E2E-JUD-${sufixo}` })
    .select("id")
    .single();
  if (jud.error) throw new Error(jud.error.message);

  // Duas perícias FUTURAS no mesmo processo: só a da tarefa pode sair.
  const inicio = new Date(Date.now() + 13 * 86400_000);
  inicio.setUTCHours(14, 32, 0, 0);
  const outra = new Date(Date.now() + 40 * 86400_000);
  outra.setUTCHours(13, 0, 0, 0);
  tituloEvento = `[E2E] Perícia Judicial ${sufixo}`;
  tituloOutra = `[E2E] Perícia social ${sufixo}`;
  const ev = await admin.from("agenda_eventos").insert(
    [
      [tituloEvento, inicio],
      [tituloOutra, outra],
    ].map(([titulo, quando]) => ({
      caso_id: casoId,
      processo_judicial_id: jud.data.id,
      tipo: "pericia",
      titulo,
      start_at: (quando as Date).toISOString(),
      end_at: new Date((quando as Date).getTime() + 3600_000).toISOString(),
    })),
  );
  if (ev.error) throw new Error(`seed perícia: ${ev.error.message}`);

  tituloTarefa = `[E2E] Confirmar comparecimento ${sufixo}`;
  const t = await admin.from("tarefas").insert({
    caso_id: casoId,
    processo_judicial_id: jud.data.id,
    tipo: "contato_cliente",
    status: "a_fazer",
    prioridade: 2,
    origem: "manual",
    titulo: tituloTarefa,
    metadata: {
      confirmar_comparecimento: true,
      template_aplicado: "pericia_judicial",
      pericia_em: inicio.toISOString(),
    },
  });
  if (t.error) throw new Error(`seed tarefa: ${t.error.message}`);
});

test.afterAll(async () => {
  await cleanupE2E(admin);
});

test("marcar que compareceu tira a perícia dos ativos do caso", async ({ page }) => {
  await abrirAtividadesDoCaso(page, casoId);
  await expect(page.getByText(tituloEvento, { exact: true })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText(tituloOutra, { exact: true })).toBeVisible();

  const card = page.locator("div.group").filter({ hasText: tituloTarefa }).first();
  await card.getByRole("button", { name: "Compareceu", exact: true }).click();
  await expect(page.getByText(/Comparecimento registrado/)).toBeVisible({ timeout: 20_000 });

  // Saiu dos ativos; a outra perícia do processo continua.
  await expect(page.getByText(tituloEvento, { exact: true })).toHaveCount(0);
  await expect(page.getByText(tituloOutra, { exact: true })).toBeVisible();

  const { data, error } = await admin
    .from("agenda_eventos")
    .select("titulo, concluido_em, concluido_por")
    .eq("caso_id", casoId);
  if (error) throw error;
  const daTarefa = data!.find((e) => e.titulo === tituloEvento)!;
  expect(daTarefa.concluido_em).toBeTruthy();
  expect(daTarefa.concluido_por).toBeTruthy();
  expect(data!.find((e) => e.titulo === tituloOutra)!.concluido_em).toBeNull();

  // Não some: fica em Arquivados.
  await page.getByRole("tab", { name: /Arquivados/ }).click();
  await expect(page.getByText(tituloEvento, { exact: true })).toBeVisible();
});

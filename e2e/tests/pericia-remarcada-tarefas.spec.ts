// E2E: remarcar a perícia leva as tarefas dela junto, e o "Compareceu" continua
// encerrando a perícia certa.
//
// Naira, 27/11/2026, validando no staging:
//  1. mudou a data da perícia na agenda e as tarefas "Confirmar comparecimento"
//     e "Conferir laudo" ficaram com as datas antigas;
//  2. depois de remarcar, "Compareceu" não tirou a perícia dos ativos — a
//     tarefa guardava a data ANTIGA, e com outra perícia aberta no mesmo
//     processo o sistema não sabia qual encerrar.
// As tarefas aqui são do jeito ANTIGO (sem `evento_id` nem o offset gravado):
// é o caso das que já existem em produção.

import { test, expect } from "@playwright/test";
import { STORAGE_INTERNO } from "../auth.setup";
import { adminClient, cleanupE2E, seedClienteCaso } from "../supabase-admin";
import { abrirAtividadesDoCaso } from "../tarefas";
import { TZ_BR } from "../fuso";

test.use({ storageState: STORAGE_INTERNO });

const admin = adminClient();
let casoId: string;
let eventoId: string;
let outraId: string;
let tituloEvento: string;
let tituloConfirmar: string;
let tituloConferir: string;
let original: Date;
let remarcada: Date;

const DIA = 86400_000;

/** Quarta-feira, 14:00 de Brasília, a pelo menos `min` dias. */
function quartaAFrente(min: number): Date {
  const d = new Date(Date.now() + min * DIA);
  d.setUTCHours(17, 0, 0, 0);
  while (d.getUTCDay() !== 3) d.setUTCDate(d.getUTCDate() + 1);
  return d;
}

function inputDateTimeBR(d: Date): string {
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: TZ_BR,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  })
    .format(d)
    .replace(" ", "T");
}

test.beforeAll(async () => {
  const sufixo = Date.now();
  ({ casoId } = await seedClienteCaso(admin, { sufixo: `Remarcada ${sufixo}` }));
  const jud = await admin
    .from("processos_judiciais")
    .insert({ caso_id: casoId, numero_processo: `E2E-JUD-${sufixo}` })
    .select("id")
    .single();
  if (jud.error) throw new Error(jud.error.message);

  original = quartaAFrente(14);
  remarcada = new Date(original.getTime() + 7 * DIA);
  tituloEvento = `[E2E] Perícia Judicial ${sufixo}`;
  const evs = await admin
    .from("agenda_eventos")
    .insert([
      { titulo: tituloEvento, quando: original },
      { titulo: `[E2E] Perícia social ${sufixo}`, quando: new Date(original.getTime() + 40 * DIA) },
    ].map((e) => ({
      caso_id: casoId,
      processo_judicial_id: jud.data.id,
      tipo: "pericia",
      titulo: e.titulo,
      start_at: e.quando.toISOString(),
      end_at: new Date(e.quando.getTime() + 3600_000).toISOString(),
    })))
    .select("id, titulo");
  if (evs.error) throw new Error(`seed perícias: ${evs.error.message}`);
  eventoId = evs.data.find((e) => e.titulo === tituloEvento)!.id;
  outraId = evs.data.find((e) => e.titulo !== tituloEvento)!.id;

  tituloConfirmar = `[E2E] Confirmar comparecimento ${sufixo}`;
  tituloConferir = `[E2E] Conferir laudo ${sufixo}`;
  const base = {
    caso_id: casoId,
    processo_judicial_id: jud.data.id,
    tipo: "contato_cliente",
    status: "a_fazer",
    prioridade: 2,
    origem: "manual",
  };
  const comum = {
    template_aplicado: "pericia_judicial",
    aplicado_manualmente: true,
    ancora_prazo: "agenda",
    pericia_em: original.toISOString(),
  };
  const t = await admin.from("tarefas").insert([
    {
      ...base,
      titulo: tituloConfirmar,
      due_at: new Date(original.getTime() + 1 * DIA).toISOString(),
      metadata: { ...comum, template_item_index: 1, confirmar_comparecimento: true },
    },
    {
      ...base,
      titulo: tituloConferir,
      due_at: new Date(original.getTime() + 12 * DIA).toISOString(),
      metadata: { ...comum, template_item_index: 2, acompanhamento_pericia: true },
    },
  ]);
  if (t.error) throw new Error(`seed tarefas: ${t.error.message}`);
});

test.afterAll(async () => {
  await cleanupE2E(admin);
});

async function tarefa(titulo: string) {
  const { data, error } = await admin
    .from("tarefas")
    .select("due_at, status, metadata")
    .eq("caso_id", casoId)
    .eq("titulo", titulo)
    .single();
  if (error) throw error;
  return data;
}

test("remarcar a perícia leva as tarefas junto; depois, 'Compareceu' encerra a perícia certa", async ({
  page,
}) => {
  await abrirAtividadesDoCaso(page, casoId);
  await page.getByText(tituloEvento, { exact: true }).click();
  const painel = page
    .getByRole("dialog")
    .filter({ has: page.getByRole("heading", { name: "Editar agendamento" }) });
  await expect(painel).toBeVisible({ timeout: 20_000 });

  await painel.locator("#a-start").fill(inputDateTimeBR(remarcada));
  await painel.locator("#a-end").fill(inputDateTimeBR(new Date(remarcada.getTime() + 3600_000)));
  await painel.getByRole("button", { name: "Salvar" }).click();
  await expect(page.getByText(/2 tarefas acompanharam a nova data/)).toBeVisible({
    timeout: 20_000,
  });

  // 1. As tarefas foram para a data nova: D+1 (quinta) e D+10 (sábado → segunda).
  const confirmar = await tarefa(tituloConfirmar);
  const conferir = await tarefa(tituloConferir);
  expect(new Date(confirmar.due_at).toISOString()).toBe(
    new Date(remarcada.getTime() + 1 * DIA).toISOString(),
  );
  expect(new Date(conferir.due_at).toISOString()).toBe(
    new Date(remarcada.getTime() + 12 * DIA).toISOString(),
  );
  for (const t of [confirmar, conferir]) {
    expect(new Date(t.metadata.pericia_em).toISOString()).toBe(remarcada.toISOString());
    expect(t.metadata.evento_id).toBe(eventoId);
  }

  // 2. "Compareceu": sai a perícia remarcada; a outra do mesmo processo fica.
  const card = page.locator("div.group").filter({ hasText: tituloConfirmar }).first();
  await card.getByRole("button", { name: "Compareceu", exact: true }).click();
  await expect(page.getByText(/Comparecimento registrado/)).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText(tituloEvento, { exact: true })).toHaveCount(0);

  const { data: evs, error } = await admin
    .from("agenda_eventos")
    .select("id, concluido_em")
    .eq("caso_id", casoId);
  if (error) throw error;
  expect(evs!.find((e) => e.id === eventoId)!.concluido_em).toBeTruthy();
  expect(evs!.find((e) => e.id === outraId)!.concluido_em).toBeNull();
});

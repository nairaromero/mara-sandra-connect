// E2E: perícia JUDICIAL registra LAUDO, não deferimento.
//
// Caso que a Mara apontou (25/11/2026): a tarefa "Conferir laudo da perícia
// judicial" mostrava os botões da perícia do INSS, e "Saiu — deferido" lançou
// "Resultado da perícia — DEFERIDO" e a corrente do Concedido (Análise de
// Deferimento, Baixar PA, Acompanhamento de implementação) num processo
// judicial que só tinha um laudo juntado.
//
// Prova: no judicial os botões são os do laudo; o clique fecha a tarefa, conta
// o laudo num andamento e abre a análise do laudo — e nada do Concedido nasce.
// A perícia do INSS continua com deferido/indeferido.

import { test, expect } from "@playwright/test";
import { STORAGE_INTERNO } from "../auth.setup";
import { adminClient, cleanupE2E, seedClienteCaso } from "../supabase-admin";
import { abrirAtividadesDoCaso } from "../tarefas";

test.use({ storageState: STORAGE_INTERNO });

const admin = adminClient();
let casoId: string;
let judId: string;
let tituloJud: string;
let tituloInss: string;

test.beforeAll(async () => {
  const sufixo = Date.now();
  ({ casoId } = await seedClienteCaso(admin, { sufixo: `Laudo judicial ${sufixo}` }));
  const jud = await admin
    .from("processos_judiciais")
    .insert({ caso_id: casoId, numero_processo: `E2E-JUD-${sufixo}` })
    .select("id")
    .single();
  if (jud.error) throw new Error(`seed processo judicial: ${jud.error.message}`);
  judId = jud.data.id;
  const adm = await admin
    .from("processos_admin")
    .insert({ caso_id: casoId, numero_requerimento: `E2E-REQ-${sufixo}` })
    .select("id")
    .single();
  if (adm.error) throw new Error(`seed requerimento: ${adm.error.message}`);

  tituloJud = `[E2E] Conferir laudo da perícia judicial ${sufixo}`;
  tituloInss = `[E2E] Conferir resultado da perícia ${sufixo}`;
  const base = {
    caso_id: casoId,
    tipo: "contato_cliente",
    status: "a_fazer",
    prioridade: 2,
    origem: "manual",
  };
  const { error } = await admin.from("tarefas").insert([
    {
      ...base,
      titulo: tituloJud,
      processo_judicial_id: judId,
      metadata: {
        acompanhamento_pericia: true,
        template_aplicado: "pericia_judicial",
        pericia_em: new Date(Date.now() - 20 * 86400_000).toISOString(),
      },
    },
    {
      ...base,
      titulo: tituloInss,
      processo_admin_id: adm.data.id,
      metadata: {
        acompanhamento_pericia: true,
        template_aplicado: "pericia_parceiro",
        pericia_em: new Date(Date.now() - 20 * 86400_000).toISOString(),
      },
    },
  ]);
  if (error) throw new Error(`seed tarefas: ${error.message}`);
});

test.afterAll(async () => {
  await cleanupE2E(admin);
});

test("laudo favorável não vira benefício concedido", async ({ page }) => {
  await abrirAtividadesDoCaso(page, casoId);
  await expect(page.getByText(tituloJud)).toBeVisible({ timeout: 20_000 });

  const cardJud = page.locator("div.group").filter({ hasText: tituloJud }).first();
  const cardInss = page.locator("div.group").filter({ hasText: tituloInss }).first();

  // Judicial: só laudo. INSS: segue com deferido/indeferido.
  await expect(cardJud.getByRole("button", { name: "Ainda sem laudo" })).toBeVisible();
  await expect(cardJud.getByRole("button", { name: "Parcialmente favorável" })).toBeVisible();
  await expect(cardJud.getByRole("button", { name: "Laudo desfavorável" })).toBeVisible();
  await expect(cardJud.getByRole("button", { name: /deferido/i })).toHaveCount(0);
  await expect(cardInss.getByRole("button", { name: "Saiu — deferido" })).toBeVisible();
  await expect(cardInss.getByRole("button", { name: /Laudo/ })).toHaveCount(0);

  await cardJud.getByRole("button", { name: "Laudo favorável" }).click();
  await expect(page.getByText(/Laudo registrado — análise do laudo aberta/)).toBeVisible({
    timeout: 20_000,
  });

  // O que ficou no banco.
  const { data: ands, error: e1 } = await admin
    .from("andamentos")
    .select("titulo, descricao, processo_judicial_id, visivel_parceiro, metadata")
    .eq("caso_id", casoId);
  if (e1) throw e1;
  expect(ands).toHaveLength(1);
  expect(ands![0].titulo).toMatch(/^Laudo da perícia judicial juntado — FAVORÁVEL/);
  expect(ands![0].descricao).toContain("segue até a sentença");
  expect(ands![0].processo_judicial_id).toBe(judId);
  expect(ands![0].visivel_parceiro).toBe(true);
  expect(JSON.stringify(ands)).not.toMatch(/deferid|concedid/i);

  const { data: tarefas, error: e2 } = await admin
    .from("tarefas")
    .select("titulo, status, processo_judicial_id, metadata")
    .eq("caso_id", casoId);
  if (e2) throw e2;
  const doLaudo = tarefas!.find((t) => t.titulo === tituloJud)!;
  expect(doLaudo.status).toBe("feito");
  expect(doLaudo.metadata.laudo_pericia_judicial).toBe("favoravel");

  const analise = tarefas!.filter((t) => t.metadata?.template_aplicado === "laudo_pericia_judicial");
  expect(analise).toHaveLength(1);
  expect(analise[0].titulo).toContain("Analisar laudo da perícia judicial");
  expect(analise[0].status).toBe("a_fazer");
  expect(analise[0].processo_judicial_id).toBe(judId);

  // Nada da corrente do Concedido/Indeferido.
  expect(
    tarefas!.filter((t) => ["concedido", "indeferido"].includes(t.metadata?.template_aplicado)),
  ).toHaveLength(0);
  expect(tarefas).toHaveLength(3);
});

test("laudo que demora não vira ouvidoria no INSS", async () => {
  // Perícia de 100 dias atrás nas duas frentes; origem que a rotina olha.
  const antiga = new Date(Date.now() - 100 * 86400_000).toISOString();
  const sufixo = Date.now();
  const { casoId: caso2 } = await seedClienteCaso(admin, { sufixo: `Escalonamento ${sufixo}` });
  const jud = await admin
    .from("processos_judiciais")
    .insert({ caso_id: caso2, numero_processo: `E2E-JUD2-${sufixo}` })
    .select("id")
    .single();
  if (jud.error) throw new Error(jud.error.message);
  const base = {
    caso_id: caso2,
    tipo: "contato_cliente",
    status: "a_fazer",
    prioridade: 2,
    origem: "pericia_acompanhamento",
  };
  const { error } = await admin.from("tarefas").insert([
    {
      ...base,
      titulo: `[E2E] laudo judicial antigo ${sufixo}`,
      processo_judicial_id: jud.data.id,
      metadata: { acompanhamento_pericia: true, pericia_judicial: true, pericia_em: antiga },
    },
    {
      ...base,
      titulo: `[E2E] resultado INSS antigo ${sufixo}`,
      metadata: { acompanhamento_pericia: true, pericia_em: antiga },
    },
  ]);
  if (error) throw new Error(error.message);

  const rpc = await admin.rpc("criar_alertas_escalonamento_pericia");
  if (rpc.error) throw new Error(rpc.error.message);

  const { data: alertas, error: e } = await admin
    .from("tarefas")
    .select("titulo, processo_judicial_id, metadata")
    .eq("caso_id", caso2)
    .not("metadata->>escalonamento_pericia", "is", null);
  if (e) throw e;
  // Os três do INSS (30/60/90), nenhum no processo judicial.
  expect(alertas).toHaveLength(3);
  expect(alertas!.every((a) => a.processo_judicial_id === null)).toBe(true);
});

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
let tituloTrocado: string;

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
  // Template do INSS escolhido por engano numa perícia judicial (agosto/2026).
  tituloTrocado = `[E2E] Perícia judicial com template do INSS ${sufixo}`;
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
      titulo: tituloTrocado,
      processo_judicial_id: judId,
      metadata: { acompanhamento_pericia: true, template_aplicado: "pericia_parceiro" },
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
  // Vale o processo: template do INSS num processo judicial mostra laudo.
  const cardTrocado = page.locator("div.group").filter({ hasText: tituloTrocado }).first();
  await expect(cardTrocado.getByRole("button", { name: "Laudo favorável" })).toBeVisible();
  await expect(cardTrocado.getByRole("button", { name: /deferido/i })).toHaveCount(0);

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
  expect(tarefas).toHaveLength(4);

  // A publicação chega DEPOIS do clique: entra na análise aberta, sem abrir outra.
  await publicar(casoId, judId, PUBLICACAO_DO_LAUDO);
  const depois = await analisesDoLaudo(casoId);
  expect(depois).toHaveLength(1);
  expect(depois[0].metadata.laudo_publicado_em).toBeTruthy();
  expect(depois[0].descricao).toContain("Publicação sobre o laudo chegou em");
});

// O que o tribunal publica quando o laudo é juntado (texto real, de produção).
const PUBLICACAO_DO_LAUDO =
  "ATO ORDINATÓRIO Ficam as partes intimadas a se manifestar sobre o laudo médico/social acostado aos autos. Prazo: 5 dias.";
// Texto padrão que cita "laudos" sem dizer que o laudo saiu.
const PUBLICACAO_GENERICA =
  "MANIFESTAÇÃO SOBRE DOCUMENTOS: Fica a parte autora intimada para ciência de eventuais documentos ou propostas juntados recentemente aos autos (como prontuários, laudos ou contestação, se houver). Prazo: 5 (cinco) dias.";

async function publicar(caso: string, jud: string, texto: string) {
  const { error } = await admin.from("andamentos").insert({
    caso_id: caso,
    processo_judicial_id: jud,
    origem: "djen",
    titulo: "Intimação — TRF3",
    descricao: texto,
    data_evento: new Date().toISOString(),
    visivel_parceiro: false,
  });
  if (error) throw new Error(`seed publicação: ${error.message}`);
}

async function analisesDoLaudo(caso: string) {
  const { data, error } = await admin
    .from("tarefas")
    .select("titulo, status, descricao, metadata")
    .eq("caso_id", caso)
    .eq("metadata->>analise_laudo_pericia", "true");
  if (error) throw error;
  return data!;
}

async function casoComConferencia(nome: string) {
  const sufixo = `${nome} ${Date.now()}`;
  const { casoId: caso } = await seedClienteCaso(admin, { sufixo });
  const jud = await admin
    .from("processos_judiciais")
    .insert({ caso_id: caso, numero_processo: `E2E-JUD-${Date.now()}-${nome.length}` })
    .select("id")
    .single();
  if (jud.error) throw new Error(jud.error.message);
  const titulo = `[E2E] Conferir laudo ${sufixo}`;
  const { error } = await admin.from("tarefas").insert({
    caso_id: caso,
    tipo: "contato_cliente",
    status: "a_fazer",
    prioridade: 2,
    origem: "manual",
    titulo,
    processo_judicial_id: jud.data.id,
    due_at: new Date(Date.now() + 5 * 86400_000).toISOString(),
    metadata: { acompanhamento_pericia: true, template_aplicado: "pericia_judicial" },
  });
  if (error) throw new Error(error.message);
  return { caso, jud: jud.data.id as string, titulo };
}

async function conferencia(caso: string, titulo: string) {
  const { data, error } = await admin
    .from("tarefas")
    .select("status, due_at, metadata")
    .eq("caso_id", caso)
    .eq("titulo", titulo)
    .single();
  if (error) throw error;
  return data;
}

test("publicação sobre o laudo avisa a conferência, sem concluir; e a análise é uma só", async ({
  page,
}) => {
  const { caso, jud, titulo } = await casoComConferencia("Publicação do laudo");
  await publicar(caso, jud, PUBLICACAO_DO_LAUDO);

  // Avisada e com o prazo para hoje — mas ABERTA: favorável ou não é de gente.
  const c = await conferencia(caso, titulo);
  expect(c.status).toBe("a_fazer");
  expect(c.metadata.laudo_publicado_em).toBeTruthy();
  // "Hoje": o prazo é o `now()` do BANCO, cujo relógio pode estar alguns
  // milissegundos à frente do desta máquina — daí a folga de um minuto.
  expect(new Date(c.due_at).getTime()).toBeLessThanOrEqual(Date.now() + 60_000);

  // A publicação abriu a análise, com a marca.
  expect(await analisesDoLaudo(caso)).toHaveLength(1);

  // Na tela: o aviso aparece e o clique não abre uma segunda análise.
  await abrirAtividadesDoCaso(page, caso);
  const card = page.locator("div.group").filter({ hasText: titulo }).first();
  await expect(card.getByText(/Chegou publicação sobre o laudo/)).toBeVisible({ timeout: 20_000 });
  await card.getByRole("button", { name: "Laudo favorável" }).click();
  await expect(page.getByText(/a análise do laudo já está aberta neste processo/)).toBeVisible({
    timeout: 20_000,
  });
  expect((await conferencia(caso, titulo)).status).toBe("feito");
  expect(await analisesDoLaudo(caso)).toHaveLength(1);
});

test("publicação que só cita 'laudos' não avisa nada", async () => {
  const { caso, jud, titulo } = await casoComConferencia("Publicação genérica");
  await publicar(caso, jud, PUBLICACAO_GENERICA);
  const c = await conferencia(caso, titulo);
  expect(c.metadata.laudo_publicado_em).toBeUndefined();
  expect(new Date(c.due_at).getTime()).toBeGreaterThan(Date.now());
  expect(await analisesDoLaudo(caso)).toHaveLength(0);
});

// E2E: caso do parceiro nasce como ORGANIZAÇÃO DE DOCUMENTOS e só depois vira
// análise (card #434).
//
// O que isso conserta: todo caso de parceiro caía direto na análise, e caía com
// a pasta bagunçada. Agora a conferência tem tarefa própria, e concluí-la é o
// que entrega a análise na mão de quem analisa — com a lista do que falta.

import { test, expect } from "@playwright/test";
import { STORAGE_INTERNO } from "../auth.setup";
import { ENV } from "../env";
import { clienteComo, escritorioPadrao } from "../rbac";
import { adminClient, cleanupE2E, seedClienteCaso } from "../supabase-admin";
import { abrirAtividadesDoCaso } from "../tarefas";

test.use({ storageState: STORAGE_INTERNO });

const admin = adminClient();
let casoId: string;
let parceiroId: string;
let internoId: string;

test.beforeAll(async () => {
  const { data: parceiro } = await admin
    .from("usuarios")
    .select("id")
    .eq("email", ENV.parceiroEmail)
    .single();
  if (!parceiro) throw new Error(`parceiro de teste não encontrado: ${ENV.parceiroEmail}`);
  parceiroId = parceiro.id as string;

  const { data: interno } = await admin
    .from("usuarios")
    .select("id")
    .eq("email", ENV.internoEmail)
    .single();
  if (!interno) throw new Error(`interno de teste não encontrado: ${ENV.internoEmail}`);
  internoId = interno.id as string;

  ({ casoId } = await seedClienteCaso(admin, {
    sufixo: `Organizar docs ${Date.now()}`,
    parceiroId,
  }));

  // A tarefa nasce do gatilho, no nome de quem o escritório configurou. Pra o
  // teste enxergar a tarefa em "Minhas tarefas", ela passa pro interno do E2E.
  await admin
    .from("tarefas")
    .update({ responsavel_id: internoId })
    .eq("caso_id", casoId)
    .eq("metadata->>etapa", "organizacao_documentos");
});

test.afterAll(async () => {
  await cleanupE2E(admin);
});

test("caso do parceiro abre conferência de documentos, não análise", async () => {
  const { data, error } = await admin
    .from("tarefas")
    .select("titulo, status, metadata")
    .eq("caso_id", casoId);
  expect(error, "erro ao ler as tarefas do caso").toBeFalsy();
  expect(data?.length, "deveria nascer UMA tarefa").toBe(1);
  expect(data![0].titulo).toMatch(/^Organizar documentos/);
  expect((data![0].metadata as { etapa?: string }).etapa).toBe("organizacao_documentos");
});

test("concluir a conferência entrega a análise com o que falta", async ({ page }) => {
  await abrirAtividadesDoCaso(page, casoId);
  const card = page.locator("div.group").filter({ hasText: "Organizar documentos" }).first();
  await expect(card).toBeVisible({ timeout: 20_000 });

  // A conferência não é formulário: o card resume o que a IA achou e o que
  // falta. Sem documento nenhum no caso, tudo da lista base aparece faltando.
  await expect(card.getByText(/Falta:/)).toBeVisible();
  await expect(card.getByText(/identificados/)).toBeVisible();

  await card.getByRole("button", { name: /Conferido — enviar para análise/ }).click();
  await expect(page.getByText(/Documentos conferidos — a análise/)).toBeVisible({
    timeout: 20_000,
  });

  // Banco: conferência fechada, análise aberta com os faltantes na descrição.
  await expect
    .poll(
      async () => {
        const { data } = await admin
          .from("tarefas")
          .select("titulo, status, descricao, metadata")
          .eq("caso_id", casoId)
          .order("created_at");
        return data ?? [];
      },
      { timeout: 20_000 },
    )
    .toMatchObject([
      { titulo: expect.stringMatching(/^Organizar documentos/), status: "feito" },
      {
        titulo: expect.stringMatching(/Analisar$/),
        status: "a_fazer",
        descricao: expect.stringContaining("Falta:"),
      },
    ]);

  // E o rastro no caso.
  const { data: andamentos } = await admin
    .from("andamentos")
    .select("titulo, visivel_parceiro")
    .eq("caso_id", casoId)
    .eq("titulo", "Documentos organizados");
  expect(andamentos?.length).toBe(1);
  expect(andamentos![0].visivel_parceiro, "rastro interno não vai pro parceiro").toBe(false);
});

test("a conferência não se conclui pelo status, só pelo botão", async ({ page }) => {
  const { casoId: outroCaso } = await seedClienteCaso(admin, {
    sufixo: `Organizar docs guard ${Date.now()}`,
    parceiroId,
  });
  await admin
    .from("tarefas")
    .update({ responsavel_id: internoId })
    .eq("caso_id", outroCaso)
    .eq("metadata->>etapa", "organizacao_documentos");

  await abrirAtividadesDoCaso(page, outroCaso);
  await page.getByText("Organizar documentos", { exact: false }).first().click();
  await expect(page.getByRole("heading", { name: "Editar tarefa" })).toBeVisible({
    timeout: 20_000,
  });
  await page.getByRole("combobox", { name: "Status" }).click();
  await page.getByRole("option", { name: "Feito", exact: true }).click();

  // O popup avisa que quem conclui é o checklist — e não oferece "Concluir".
  // O popup explica que quem conclui é o checklist da tarefa.
  await expect(page.getByText(/conferência dos documentos \(botão/)).toBeVisible({
    timeout: 10_000,
  });
  await expect(page.getByRole("button", { name: "Concluir tarefa" })).toHaveCount(0);
});

test("o parceiro cola o link da pasta e a conferência diz isso", async ({ page }) => {
  const { casoId: casoLink } = await seedClienteCaso(admin, {
    sufixo: `Pasta por link ${Date.now()}`,
    parceiroId,
  });
  await admin
    .from("tarefas")
    .update({ responsavel_id: internoId })
    .eq("caso_id", casoLink)
    .eq("metadata->>etapa", "organizacao_documentos");

  // Cola pela SESSÃO DO PARCEIRO: o que precisa aceitar é a RLS dele, não a do
  // service_role. Com admin aqui o teste passaria mesmo com a policy fechada.
  const comoParceiro = await clienteComo(ENV.parceiroEmail, await escritorioPadrao());
  const url = `https://1drv.ms/f/s!e2e-${Date.now()}`;
  const { error } = await comoParceiro
    .from("caso_pastas_externas")
    .insert({ caso_id: casoLink, url, rotulo: "Pasta do cliente" });
  expect(error, "o parceiro deveria poder colar o link no caso que ele indicou").toBeFalsy();

  // O rastro no caso nasce do gatilho (o parceiro não escreve em `andamentos`)
  // e é visível para ele: foi ele quem fez.
  const { data: andamentos } = await admin
    .from("andamentos")
    .select("titulo, descricao, visivel_parceiro")
    .eq("caso_id", casoLink)
    .eq("titulo", "Pasta de documentos por link");
  expect(andamentos?.length, "link colado vira andamento").toBe(1);
  expect(andamentos![0].visivel_parceiro).toBe(true);
  expect(andamentos![0].descricao).toContain(url);

  // Na conferência, o caso não parece vazio: diz onde estão os arquivos.
  await abrirAtividadesDoCaso(page, casoLink);
  const card = page.locator("div.group").filter({ hasText: "Organizar documentos" }).first();
  await expect(card).toBeVisible({ timeout: 20_000 });
  await expect(card.getByText(/o parceiro deixou uma pasta por link/)).toBeVisible();
});

test("o parceiro não cola link em caso que não é dele", async () => {
  const { casoId: casoDeOutro } = await seedClienteCaso(admin, {
    sufixo: `Pasta de outro ${Date.now()}`,
    parceiroId: null,
  });
  const comoParceiro = await clienteComo(ENV.parceiroEmail, await escritorioPadrao());
  const r = await comoParceiro
    .from("caso_pastas_externas")
    .insert({ caso_id: casoDeOutro, url: "https://1drv.ms/f/s!nao-e-meu" })
    .select();
  expect(r.data ?? [], "caso sem o parceiro não aceita link dele").toHaveLength(0);
  expect(r.error?.code, "a recusa é da RLS").toBe("42501");
});

test("documento junto com a criação do caso não abre uma segunda tarefa", async () => {
  const { casoId: casoComDoc } = await seedClienteCaso(admin, {
    sufixo: `Docs na criacao ${Date.now()}`,
    parceiroId,
  });
  // O parceiro sobe o arquivo no mesmo ato de indicar o caso. Antes da #434 o
  // gatilho só segurava a tarefa velha quando a etapa era a análise inicial —
  // com a organização no lugar dela, vinham DUAS tarefas para o mesmo lote.
  const { error } = await admin.from("documentos").insert({
    caso_id: casoComDoc,
    tipo: "outro",
    nome_arquivo: "[E2E] procuracao.pdf",
    storage_path: `e2e-organizacao/${casoComDoc}/procuracao.pdf`,
    uploaded_by: parceiroId,
  });
  expect(error, "erro ao semear o documento do parceiro").toBeFalsy();

  const { data } = await admin
    .from("tarefas")
    .select("titulo, metadata")
    .eq("caso_id", casoComDoc);
  expect(data?.length, "uma tarefa só: a conferência").toBe(1);
  expect((data![0].metadata as { etapa?: string }).etapa).toBe("organizacao_documentos");
});

test("o parceiro não apaga o link que a equipe colou", async () => {
  const { casoId: caso } = await seedClienteCaso(admin, {
    sufixo: `Pasta da equipe ${Date.now()}`,
    parceiroId,
  });
  const { data: linha } = await admin
    .from("caso_pastas_externas")
    .insert({ caso_id: caso, url: "https://1drv.ms/f/s!da-equipe", criado_por: internoId })
    .select("id")
    .single();

  const comoParceiro = await clienteComo(ENV.parceiroEmail, await escritorioPadrao());
  // Ele VÊ o link (é o caso dele) e não mexe: a tela esconde o lápis pela
  // mesma regra, e a policy é quem garante.
  const { data: visto } = await comoParceiro
    .from("caso_pastas_externas")
    .select("id")
    .eq("id", linha!.id);
  expect(visto?.length, "o parceiro enxerga o link do caso dele").toBe(1);

  const r = await comoParceiro.from("caso_pastas_externas").delete().eq("id", linha!.id).select();
  expect(r.data ?? [], "link da equipe não é dele para apagar").toHaveLength(0);
  const { count } = await admin
    .from("caso_pastas_externas")
    .select("id", { count: "exact", head: true })
    .eq("id", linha!.id);
  expect(count, "a linha continua lá").toBe(1);
});

test("a conferência diz quem juntou cada arquivo", async ({ page }) => {
  const { casoId: caso } = await seedClienteCaso(admin, {
    sufixo: `Quem juntou ${Date.now()}`,
    parceiroId,
  });
  await admin
    .from("tarefas")
    .update({ responsavel_id: internoId })
    .eq("caso_id", caso)
    .eq("metadata->>etapa", "organizacao_documentos");

  // Um arquivo de cada lado: o que o parceiro mandou e o que a equipe subiu.
  const { error } = await admin.from("documentos").insert([
    {
      caso_id: caso,
      tipo: "outro",
      nome_arquivo: "[E2E] do-parceiro.pdf",
      storage_path: `e2e-quem-juntou/${caso}/do-parceiro.pdf`,
      uploaded_by: parceiroId,
    },
    {
      caso_id: caso,
      tipo: "outro",
      nome_arquivo: "[E2E] da-equipe.pdf",
      storage_path: `e2e-quem-juntou/${caso}/da-equipe.pdf`,
      uploaded_by: internoId,
    },
  ]);
  expect(error, "erro ao semear os documentos").toBeFalsy();

  await abrirAtividadesDoCaso(page, caso);
  await page.getByText("Organizar documentos", { exact: false }).first().click();
  const folha = page.locator('[role="dialog"]').last();
  await expect(folha.getByRole("heading", { name: "Editar tarefa" })).toBeVisible({
    timeout: 20_000,
  });

  // O nome aparece nos dois; a etiqueta "parceiro" só em quem é parceiro —
  // e o join passa pela RLS de `usuarios` da pessoa logada.
  // `div.rounded-md.p-2` é a CAIXA do arquivo; sem a classe, o filtro por nome
  // sobe até o container da conferência, que contém os dois arquivos.
  const caixa = (nome: string) => folha.locator("div.rounded-md.p-2").filter({ hasText: nome });

  const doParceiro = caixa("[E2E] do-parceiro.pdf");
  await expect(doParceiro.getByText(/juntado por/)).toBeVisible();
  await expect(doParceiro.getByText("parceiro", { exact: true })).toBeVisible();

  const daEquipe = caixa("[E2E] da-equipe.pdf");
  await expect(daEquipe.getByText(/juntado por/)).toBeVisible();
  await expect(daEquipe.getByText("parceiro", { exact: true })).toHaveCount(0);
});

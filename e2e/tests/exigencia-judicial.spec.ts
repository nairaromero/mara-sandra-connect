// E2E: template "Exigência Judicial" (usuário interno).
//
// O fluxo da equipe: ler a publicação no Legalmail, colar o trecho no form,
// informar o PRAZO FATAL e salvar. O template cria andamento visível ao
// parceiro, solicitação de documento (IA reescreve em linguagem simples;
// sem chave de IA cai no texto do template — nos dois casos a data do fatal
// aparece), tarefa de acompanhamento e tarefa FATAL no dia útil anterior
// ao fatal (regra da casa: vencer no fatal é perder o prazo).

import { test, expect } from "@playwright/test";
import { STORAGE_INTERNO } from "../auth.setup";
import { cursorVisivel } from "../cursor";
import { adminClient, cleanupE2E, seedClienteCaso } from "../supabase-admin";

test.use({ storageState: STORAGE_INTERNO });

test.beforeEach(async ({ page }) => {
  await cursorVisivel(page);
});

const admin = adminClient();
let casoId: string;
let nomeCliente: string;

// Fatal numa SEXTA com folga (>= 7 dias): o dia útil anterior é quinta,
// determinístico pro assert — sem depender do dia em que o teste roda.
function proximaSexta(): { fatal: string; vesperaBR: string; fatalBR: string } {
  const d = new Date();
  d.setHours(12, 0, 0, 0);
  d.setDate(d.getDate() + 7);
  while (d.getDay() !== 5) d.setDate(d.getDate() + 1);
  const iso = (x: Date) =>
    `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(x.getDate()).padStart(2, "0")}`;
  const br = (x: Date) => iso(x).split("-").reverse().join("/");
  const vespera = new Date(d);
  vespera.setDate(vespera.getDate() - 1);
  return { fatal: iso(d), vesperaBR: br(vespera), fatalBR: br(d) };
}

test.beforeAll(async () => {
  const sufixo = `Exig Judicial ${Date.now()}`;
  nomeCliente = `[E2E] ${sufixo}`;
  ({ casoId } = await seedClienteCaso(admin, { sufixo }));
});

test.afterAll(async () => {
  await cleanupE2E(admin);
});

test("exigência judicial cria solicitação com prazo e FATAL no dia útil anterior", async ({
  page,
}) => {
  const { fatal, vesperaBR, fatalBR } = proximaSexta();

  await page.goto("/tarefas");
  await page.getByRole("button", { name: "Nova tarefa" }).click();

  // Combobox do Caso (busca por cliente).
  await page.getByRole("combobox").filter({ hasText: "Sem caso" }).click();
  await page.getByRole("option", { name: nomeCliente }).click();

  // Select do template.
  await page.getByRole("combobox").filter({ hasText: "Escolha um template" }).click();
  await page.getByRole("option", { name: "Exigência Judicial" }).click();

  // Prefill concluiu: o bloco de responsáveis lista a FATAL como extra.
  await expect(
    page.getByText("Responsáveis das outras tarefas do template"),
  ).toBeVisible();
  await expect(
    page.getByText(/FATAL - CUMPRIMENTO DE EXIGENCIA JUDICIAL/).first(),
  ).toBeVisible();

  // Campos específicos do fluxo judicial: trecho da publicação + prazo fatal.
  await page
    .getByLabel("Documentos solicitados pela Justiça")
    .fill("Intime-se a parte autora para juntar CNIS atualizado e carteira de trabalho no prazo de 15 dias.");
  await page.getByLabel("Prazo fatal (fim do prazo judicial)").fill(fatal);

  await page.getByRole("button", { name: "Salvar" }).click();

  // Verificação forte no banco (toast some rápido; ver criar-tarefa-template).
  await expect
    .poll(
      async () => {
        const { data } = await admin
          .from("tarefas")
          .select("id")
          .eq("caso_id", casoId);
        return data?.length ?? 0;
      },
      { timeout: 20_000, message: "esperando as 2 tarefas do template no banco" },
    )
    .toBe(2);

  // FATAL: dia útil anterior ao fatal, 09:00 de Brasília.
  const { data: tarefas } = await admin
    .from("tarefas")
    .select("titulo, tipo, due_at")
    .eq("caso_id", casoId);
  const fatalTarefa = tarefas!.find((t) =>
    t.titulo.startsWith("FATAL - CUMPRIMENTO DE EXIGENCIA JUDICIAL"),
  );
  expect(fatalTarefa, "tarefa FATAL não criada").toBeTruthy();
  expect(fatalTarefa!.tipo).toBe("prazo");
  const dueBR = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "America/Sao_Paulo",
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(fatalTarefa!.due_at));
  const vesperaISO = vesperaBR.split("/").reverse().join("-");
  expect(dueBR).toBe(`${vesperaISO} 09:00`);

  const aguardando = tarefas!.find((t) =>
    t.titulo.includes("Aguardando documentos do parceiro (exigência judicial)"),
  );
  expect(aguardando, "tarefa de acompanhamento não criada").toBeTruthy();

  // Solicitação ao parceiro: origem do template e data do fatal no texto
  // (presente tanto no texto da IA quanto no fallback).
  const { data: solics } = await admin
    .from("solicitacoes_documento")
    .select("descricao, status, origem")
    .eq("caso_id", casoId);
  expect(solics?.length).toBe(1);
  expect(solics![0].origem).toBe("template:exigencia_judicial");
  expect(solics![0].status).toBe("pendente");
  expect(solics![0].descricao).toContain(fatalBR);

  // Andamento visível ao parceiro.
  const { data: ands } = await admin
    .from("andamentos")
    .select("titulo, visivel_parceiro")
    .eq("caso_id", casoId);
  expect(ands?.length).toBe(1);
  expect(ands![0].visivel_parceiro).toBe(true);
  expect(ands![0].titulo).toContain("Exigência judicial");
});

// Ciclo de ATENDIMENTO (depende do estado do 1º teste): quando o parceiro
// entrega o documento, o trigger _solicitacao_atendida_cria_tarefa tem que
// produzir os 3 efeitos que o review pegou faltando (finding #1) — andamento
// visível ao parceiro, tarefa de juntada com template_aplicado (judicial SEM
// checklist de cumprimento) e a "Aguardando documentos" fechada.
test("solicitação atendida: andamento + tarefa de juntada + Aguardando fechada", async () => {
  const { data: solics } = await admin
    .from("solicitacoes_documento")
    .select("id")
    .eq("caso_id", casoId)
    .eq("status", "pendente");
  expect(solics?.length, "solicitação pendente do 1º teste sumiu").toBe(1);

  // O app do parceiro marca 'atendido' ao entregar — aqui direto no banco,
  // porque o alvo é o trigger, não a UI do parceiro.
  const { error } = await admin
    .from("solicitacoes_documento")
    .update({ status: "atendido" })
    .eq("id", solics![0].id);
  expect(error).toBeNull();

  // 1) Andamento visível ao parceiro, variante judicial ("juntar aos autos").
  await expect
    .poll(
      async () => {
        const { data } = await admin
          .from("andamentos")
          .select("id")
          .eq("caso_id", casoId)
          .eq("metadata->>etapa", "documento_recebido");
        return data?.length ?? 0;
      },
      { timeout: 15_000, message: "esperando o andamento de documento recebido" },
    )
    .toBe(1);
  const { data: ands } = await admin
    .from("andamentos")
    .select("titulo, visivel_parceiro")
    .eq("caso_id", casoId)
    .eq("metadata->>etapa", "documento_recebido");
  expect(ands![0].titulo).toBe(
    "Documento entregue pelo Parceiro — iremos juntar aos autos",
  );
  expect(ands![0].visivel_parceiro).toBe(true);

  // 2) Tarefa de juntada com template_aplicado; judicial NÃO leva o checklist
  //    cumprimento_exigencia (esse é só do INSS).
  const { data: tarefas } = await admin
    .from("tarefas")
    .select("titulo, status, metadata")
    .eq("caso_id", casoId);
  const juntada = tarefas!.find((t) =>
    t.titulo.startsWith("Cumprir Exigência Judicial - "),
  );
  expect(juntada?.titulo).toContain(nomeCliente);
  expect(juntada, "tarefa de juntada não criada pelo trigger").toBeTruthy();
  const meta = juntada!.metadata as Record<string, unknown>;
  expect(meta.template_aplicado).toBe("exigencia_judicial");
  expect(meta.cumprimento_exigencia).toBeUndefined();

  // 3) A "Aguardando documentos" do mesmo template fechou sozinha.
  const aguardando = tarefas!.find((t) =>
    t.titulo.includes("Aguardando documentos do parceiro (exigência judicial)"),
  );
  expect(aguardando!.status).toBe("feito");
});

test("calculadora de prazo: publicação + dias úteis preenche o fatal", async ({
  page,
}) => {
  await page.goto("/tarefas");
  await page.getByRole("button", { name: "Nova tarefa" }).click();
  await page.getByRole("combobox").filter({ hasText: "Sem caso" }).click();
  await page.getByRole("option", { name: nomeCliente }).click();
  await page.getByRole("combobox").filter({ hasText: "Escolha um template" }).click();
  await page.getByRole("option", { name: "Exigência Judicial" }).click();

  // Publicação numa segunda (07/09/2026); 15 dias úteis correm de terça 08
  // e fecham na segunda 28/09.
  await page.getByLabel("Publicado em").fill("2026-09-07");
  await page.getByLabel("Prazo em dias úteis", { exact: true }).click();
  await page.getByRole("option", { name: "15 dias" }).click();
  await expect(
    page.getByLabel("Prazo fatal (fim do prazo judicial)"),
  ).toHaveValue("2026-09-28");

  // Prazo fora do padrão: "Outro…" com 20 dias úteis → segunda 05/10.
  await page.getByLabel("Prazo em dias úteis", { exact: true }).click();
  await page.getByRole("option", { name: "Outro…" }).click();
  await page.getByLabel("Prazo em dias úteis (outro)").fill("20");
  await expect(
    page.getByLabel("Prazo fatal (fim do prazo judicial)"),
  ).toHaveValue("2026-10-05");
});

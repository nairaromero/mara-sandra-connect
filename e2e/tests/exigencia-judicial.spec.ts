// E2E: template "Exigência Judicial" (usuário interno).
//
// O fluxo da equipe: ler a publicação no Legalmail, colar o trecho no form,
// informar o PRAZO FATAL e salvar. O template cria andamento visível ao
// parceiro, solicitação de documento (IA reescreve em linguagem simples;
// sem chave de IA cai no texto do template), tarefa de acompanhamento e
// tarefa FATAL no dia útil anterior ao fatal (regra da casa: vencer no fatal
// é perder o prazo).
//
// O parceiro nunca vê o fatal: recebe o "enviar até" = fatal − 3 (regra da
// casa de 2026-08-31). A resposta da edge mensagem-parceiro-exigencia é SEMPRE
// simulada — o staging tem chave de IA desde 2026-09-15, e o teste dependia do
// que a IA escrevesse. A data da mensagem de verdade é posta pela própria edge
// (supabase/functions/mensagem-parceiro-exigencia/prazo.test.ts); aqui vale o
// que o front manda pra ela e grava.

import { test, expect, type Page } from "@playwright/test";
import { STORAGE_INTERNO } from "../auth.setup";
import { cursorVisivel } from "../cursor";
import { adminClient, cleanupE2E, seedClienteCaso } from "../supabase-admin";
import { abrirNovaTarefaNoCaso } from "../tarefas";

test.use({ storageState: STORAGE_INTERNO });

test.beforeEach(async ({ page }) => {
  await cursorVisivel(page);
  await simularMensagemExigencia(page);
});

// Latência realista: a edge de verdade leva segundos (ver simularSugestaoProxima).
const LATENCIA_SIMULADA_MS = 1200;

/** Responde pela edge com uma mensagem que usa a data recebida no pedido. */
async function simularMensagemExigencia(
  page: Page,
  aoPedir?: (corpoDoPedido: Record<string, unknown>) => void,
) {
  await page.route("**/functions/v1/mensagem-parceiro-exigencia", async (route) => {
    const cors = {
      "access-control-allow-origin": "*",
      "access-control-allow-headers": "*",
      "access-control-allow-methods": "POST, OPTIONS",
    };
    if (route.request().method() === "OPTIONS") {
      await route.fulfill({ status: 204, headers: cors });
      return;
    }
    const pedido = route.request().postDataJSON() as Record<string, unknown>;
    aoPedir?.(pedido);
    const data =
      typeof pedido.prazo_parceiro === "string"
        ? pedido.prazo_parceiro.split("-").reverse().join("/")
        : "(sem data)";
    await new Promise((r) => setTimeout(r, LATENCIA_SIMULADA_MS));
    await route.fulfill({
      status: 200,
      headers: { ...cors, "content-type": "application/json" },
      body: JSON.stringify({
        mensagem:
          "Olá! A Justiça pediu documentos para o processo (mensagem simulada no E2E).\n\n" +
          "1. Envie o CNIS atualizado.\n2. Envie a carteira de trabalho.\n\n" +
          `⚠️ Prazo para enviar os documentos ao escritório: *${data}*.\n\n` +
          "Providencie o quanto antes.",
      }),
    });
  });
}

const admin = adminClient();
let casoId: string;
let nomeCliente: string;

// Fatal numa SEXTA com folga (>= 7 dias): o dia útil anterior é quinta e o
// "enviar até" do parceiro (fatal − 3) é terça, sem cair em fim de semana —
// determinístico pro assert, sem depender do dia em que o teste roda.
function proximaSexta(): {
  fatal: string;
  vesperaBR: string;
  fatalBR: string;
  enviarAte: string;
  enviarAteBR: string;
} {
  const d = new Date();
  d.setHours(12, 0, 0, 0);
  d.setDate(d.getDate() + 7);
  while (d.getDay() !== 5) d.setDate(d.getDate() + 1);
  const iso = (x: Date) =>
    `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(x.getDate()).padStart(2, "0")}`;
  const br = (x: Date) => iso(x).split("-").reverse().join("/");
  const vespera = new Date(d);
  vespera.setDate(vespera.getDate() - 1);
  const enviarAte = new Date(d);
  enviarAte.setDate(enviarAte.getDate() - 3);
  return {
    fatal: iso(d),
    vesperaBR: br(vespera),
    fatalBR: br(d),
    enviarAte: iso(enviarAte),
    enviarAteBR: br(enviarAte),
  };
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
  const { fatal, vesperaBR, fatalBR, enviarAte, enviarAteBR } = proximaSexta();
  let pedidoIa: Record<string, unknown> | null = null;
  await simularMensagemExigencia(page, (pedido) => {
    pedidoIa = pedido;
  });

  await abrirNovaTarefaNoCaso(page, casoId);
  // Aberta no caso: Cliente já vem preenchido (grava caso_id).
  await expect(page.getByRole("combobox").filter({ hasText: nomeCliente })).toBeVisible();

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

  // A edge da mensagem recebe o "enviar até" do parceiro — o fatal não sai
  // do front pra ela.
  expect(pedidoIa, "a mensagem da IA não foi pedida").not.toBeNull();
  expect(pedidoIa).toMatchObject({ tipo: "judicial", prazo_parceiro: enviarAte });
  expect(pedidoIa).not.toHaveProperty("prazo_fatal");

  // Solicitação ao parceiro: origem do template, texto da IA e prazo = enviar até.
  const { data: solics } = await admin
    .from("solicitacoes_documento")
    .select("descricao, status, origem, prazo_at")
    .eq("caso_id", casoId);
  expect(solics?.length).toBe(1);
  expect(solics![0].origem).toBe("template:exigencia_judicial");
  expect(solics![0].status).toBe("pendente");
  expect(solics![0].descricao).toContain("mensagem simulada no E2E");
  expect(solics![0].descricao).toContain(enviarAteBR);
  expect(solics![0].descricao).not.toContain(fatalBR);
  const prazoBR = new Intl.DateTimeFormat("sv-SE", { timeZone: "America/Sao_Paulo" }).format(
    new Date(solics![0].prazo_at),
  );
  expect(prazoBR).toBe(enviarAte);

  // Andamento visível ao parceiro, sem o fatal
  // (migration_exigencia_judicial_sem_fatal_parceiro).
  const { data: ands } = await admin
    .from("andamentos")
    .select("titulo, descricao, visivel_parceiro")
    .eq("caso_id", casoId);
  expect(ands?.length).toBe(1);
  expect(ands![0].visivel_parceiro).toBe(true);
  expect(ands![0].titulo).toContain("Exigência judicial");
  expect(ands![0].descricao).not.toContain(fatalBR);
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
  await abrirNovaTarefaNoCaso(page, casoId);
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

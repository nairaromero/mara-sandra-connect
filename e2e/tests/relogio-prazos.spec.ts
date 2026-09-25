// E2E: relógio de prazos do caso (#397).
//
// O indeferimento chega (aqui semeado como o robô do e-mail INSS grava) e a
// Análise abre o relógio: análise D+10, montagem D+20, revisão D+25, protocolo
// D+30, limite D+40. As datas das etapas são FIXAS — a montagem aberta no dia
// 12 continua vencendo no D+20.
//
// Quem não é admin:
//   - adia com justificativa, e a tela diz quantos dias sai da etapa seguinte;
//   - nos 3 últimos dias antes do D+30 só adia até amanhã;
//   - depois do D+30 não adia: pede à Mara, e o prazo não muda até ela decidir.
// A Mara (admin) vê o pedido no radar da tela de Tarefas e aprova.

import { test, expect, type Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { ENV } from "../env";
import { STORAGE_ADMIN, STORAGE_INTERNO } from "../auth.setup";
import { cursorVisivel } from "../cursor";
import { adminClient, cleanupE2E, seedClienteCaso } from "../supabase-admin";
import { abrirTarefaNoCaso } from "../tarefas";

test.use({ storageState: STORAGE_INTERNO });
test.describe.configure({ mode: "serial" });

const admin = adminClient();
let casoId: string;
let nomeCliente: string;

// O caso foi indeferido há 12 dias: a análise já venceu (D+10) e a montagem
// aberta hoje tem só 8 dias até o D+20.
const D = -12;

test.beforeAll(async () => {
  const sufixo = `Relogio ${Date.now()}`;
  nomeCliente = `[E2E] ${sufixo}`;
  ({ casoId } = await seedClienteCaso(admin, { sufixo }));

  const { data: interno } = await admin
    .from("usuarios")
    .select("id")
    .eq("email", "e2e+interno@marasandraconnect.com")
    .single();
  const { data: proc, error: errProc } = await admin
    .from("processos_admin")
    .insert({ caso_id: casoId, numero_requerimento: "1234567890", data_protocolo: diaBR(-60) })
    .select("id")
    .single();
  if (errProc) throw new Error(`seed processo: ${errProc.message}`);

  const { error } = await admin.from("tarefas").insert({
    caso_id: casoId,
    processo_admin_id: proc.id,
    responsavel_id: interno!.id,
    tipo: "interna",
    prioridade: 1,
    titulo: `Analise de Indeferimento - ${nomeCliente}`,
    due_at: new Date().toISOString(),
    origem: "sync_inss_email",
    metadata: {
      template: "indeferido",
      analise_indeferimento: true,
      prazo_fatal: true,
      data_indeferimento: diaBR(D),
    },
  });
  if (error) throw new Error(`seed análise: ${error.message}`);
});

test.afterAll(async () => {
  await cleanupE2E(admin);
});

test.beforeEach(async ({ page }) => {
  await cursorVisivel(page);
});

test("análise abre o relógio e a montagem nasce na data fixa (D+20)", async ({ page }) => {
  const { data: relogio } = await admin
    .from("relogios_prazo")
    .select("origem_em, planejado_em, limite_em, status")
    .eq("caso_id", casoId)
    .single();
  expect(relogio).toMatchObject({
    origem_em: diaBR(D),
    planejado_em: diaBR(D + 30),
    limite_em: diaBR(D + 40),
    status: "aberto",
  });

  await abrirTarefaNoCaso(page, casoId, `Analise de Indeferimento - ${nomeCliente}`);
  await page.getByRole("button", { name: "Ajuizar (montagem de inicial)" }).click();

  await expect
    .poll(async () => (await montagem())?.due_at ?? null, {
      timeout: 15_000,
      message: "esperando a montagem no banco",
    })
    .not.toBeNull();
  const m = await montagem();
  expect(diaDoInstanteBR(m!.due_at)).toBe(diaBR(D + 20));
  expect((m!.metadata as { relogio_etapa?: string }).relogio_etapa).toBe("montagem");
});

test("adiar: justificativa, reta final e pedido à Mara", async ({ page }) => {
  const m = await montagem();
  const tituloMontagem = m!.titulo as string;
  await abrirTarefaNoCaso(page, casoId, tituloMontagem);

  // A montagem nasce sem processo (o judicial ainda não existe); o form só
  // salva com a escolha feita.
  await page.getByRole("combobox").filter({ hasText: "Escolha o processo" }).click();
  await page.getByRole("option", { name: "Cliente sem processo" }).click();

  const linha = page.getByTestId("relogio-linha");
  await expect(linha).toContainText("Montagem da inicial até " + dataBR(diaBR(D + 20)));
  await expect(linha).toContainText("Caso no dia 12 de 40");

  // 1. Dois dias depois da data da etapa: pede justificativa e avisa que sai da revisão.
  await trocarData(page, diaBR(D + 22));
  await page.getByRole("button", { name: "Salvar" }).click();
  await expect(page.getByText("Isso tira 2 dias da etapa seguinte")).toBeVisible();
  await page.getByRole("button", { name: "Manter o prazo" }).click();

  // 2. Reta final (D+28, a 2 dias do D+30): só até amanhã.
  await trocarData(page, diaBR(D + 28));
  await page.getByRole("button", { name: "Salvar" }).click();
  await expect(page.getByText("Reta final do prazo: só dá para adiar até amanhã")).toBeVisible();

  // 3. Depois do D+30: pede à Mara.
  await trocarData(page, diaBR(D + 35));
  await page.getByRole("button", { name: "Salvar" }).click();
  await expect(page.getByText("Este prazo não pode ser adiado")).toBeVisible();
  await page.getByLabel("Por que precisa de mais prazo?").fill(
    "O parceiro ainda não mandou o laudo médico.",
  );
  await page.getByRole("button", { name: "Pedir à Mara" }).click();
  await expect(page.getByText("Pedido enviado à Mara")).toBeVisible();

  const { data: pedido } = await admin
    .from("pedidos_prorrogacao")
    .select("status, ate")
    .eq("tarefa_id", m!.id)
    .single();
  expect(pedido).toMatchObject({ status: "pendente", ate: diaBR(D + 35) });
  // O prazo não andou.
  expect(diaDoInstanteBR((await montagem())!.due_at)).toBe(diaBR(D + 20));
});

test("o banco trava mesmo sem passar pela tela", async () => {
  // Mesmo update pela API, com a sessão do interno: o gatilho recusa. Sessão
  // própria (não a do storageState) e signOut LOCAL, para não derrubar a outra.
  const cli = createClient(ENV.supabaseUrl, ENV.anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { error: errLogin } = await cli.auth.signInWithPassword({
    email: ENV.internoEmail,
    password: ENV.internoPassword,
  });
  expect(errLogin).toBeNull();
  const m = await montagem();
  const longe = new Date(Date.now() + 40 * 86_400_000).toISOString();
  const { error } = await cli.from("tarefas").update({ due_at: longe }).eq("id", m!.id);
  expect(error?.code).toBe("MSC01");
  const { error: errExcluir } = await cli.from("tarefas").delete().eq("id", m!.id);
  expect(errExcluir?.code).toBe("MSC03");
  await cli.auth.signOut({ scope: "local" });
});

test("Mara aprova no radar e o prazo vai para a data pedida", async ({ browser }) => {
  const ctx = await browser.newContext({ storageState: STORAGE_ADMIN });
  const page = await ctx.newPage();
  await cursorVisivel(page);
  await page.goto("/tarefas");
  await page.getByTestId("radar-prazos").click();
  const pedido = page.getByTestId("pedido-prorrogacao").filter({ hasText: nomeCliente });
  await expect(pedido).toBeVisible();
  await pedido.getByRole("button", { name: "Aprovar até " + dataBR(diaBR(D + 35)) }).click();
  await expect(page.getByText("Prorrogação aprovada.")).toBeVisible();

  await expect
    .poll(async () => diaDoInstanteBR((await montagem())!.due_at), { timeout: 10_000 })
    .toBe(diaBR(D + 35));
  const { data: and } = await admin
    .from("andamentos")
    .select("titulo, visivel_parceiro")
    .eq("caso_id", casoId)
    .like("titulo", "Prorrogação aprovada%")
    .single();
  expect(and!.visivel_parceiro).toBe(false);
  await ctx.close();
});

test("painel de datas no topo do caso", async ({ page }) => {
  await page.goto(`/casos/${casoId}`);
  const painel = page.getByTestId("painel-datas-caso");
  await expect(painel).toContainText("Protocolo administrativo");
  await expect(painel).toContainText("nº 1234567890");
  await expect(painel).toContainText("Indeferimento");
  await expect(painel).toContainText(dataBR(diaBR(D)));
  await expect(painel.getByTestId("relogio-do-caso")).toContainText("dia 12 de 40");
  await expect(painel.getByTestId("relogio-do-caso")).toContainText(
    "liberado pela Mara até " + dataBR(diaBR(D + 35)),
  );
});

async function montagem() {
  const { data } = await admin
    .from("tarefas")
    .select("id, titulo, due_at, metadata")
    .eq("caso_id", casoId)
    .like("titulo", "Montagem da inicial%")
    .maybeSingle();
  return data as { id: string; titulo: string; due_at: string; metadata: unknown } | null;
}

async function trocarData(page: Page, dia: string) {
  await page.locator("#t-due").fill(`${dia}T18:00`);
}

/** Dia de calendário de Brasília, `n` dias a partir de hoje ("YYYY-MM-DD"). */
function diaBR(n: number): string {
  const hoje = new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
  const [y, m, d] = hoje.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

function diaDoInstanteBR(iso: string): string {
  return new Date(iso).toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
}

function dataBR(dia: string): string {
  return dia.split("-").reverse().join("/");
}

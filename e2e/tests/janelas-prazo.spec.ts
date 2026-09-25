// E2E: janelas de prazo, formulário de templates e painel judicial (#397).
//
// Janela = a tarefa nasce vencendo AMANHÃ e pode ir até um teto que o banco
// trava; no teto, quem está com ela decide pelos botões.
//   - "Aguardando documentos" das exigências: teto = fatal − 3 (prazo do
//     parceiro). No teto: pedir dilação de prazo ou não.
//   - Análise de Deferimento: teto = criação + 10. Decide: está tudo certo ou
//     entrar com revisão (corrente do requerimento administrativo).
// No formulário, o campo Data some nos templates em que a data é automática.
// No painel do caso, o processo judicial mostra a situação, e "Baixa
// definitiva" vira sugestão de encerrado que a equipe confirma.

import { test, expect } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { STORAGE_INTERNO } from "../auth.setup";
import { cursorVisivel } from "../cursor";
import { ENV } from "../env";
import { adminClient, cleanupE2E, seedClienteCaso } from "../supabase-admin";
import { abrirNovaTarefaNoCaso, abrirTarefaNoCaso } from "../tarefas";

test.use({ storageState: STORAGE_INTERNO });
test.describe.configure({ mode: "serial" });

const admin = adminClient();
let casoId: string;
let nomeCliente: string;
let internoId: string;

test.beforeAll(async () => {
  const sufixo = `Janelas ${Date.now()}`;
  nomeCliente = `[E2E] ${sufixo}`;
  ({ casoId } = await seedClienteCaso(admin, { sufixo }));
  const { data } = await admin
    .from("usuarios")
    .select("id")
    .eq("email", ENV.internoEmail)
    .single();
  internoId = data!.id as string;
});

test.afterAll(async () => {
  await cleanupE2E(admin);
});

test.beforeEach(async ({ page }) => {
  await cursorVisivel(page);
});

test("formulário: a Data some onde o sistema calcula", async ({ page }) => {
  await abrirNovaTarefaNoCaso(page, casoId);
  const escolher = async (nome: RegExp) => {
    await page.getByRole("combobox").filter({ hasText: /Escolha um template|Em Análise|Concedido|Exigência INSS/ }).first().click();
    await page.getByRole("option", { name: nome }).click();
  };

  // Em Análise só registra andamento: nem Data nem campos de tarefa.
  await escolher(/^Em Análise/);
  await expect(page.getByTestId("data-automatica")).toContainText("só registra andamento");
  await expect(page.locator("#t-due")).toHaveCount(0);
  await expect(page.locator("#t-titulo")).toHaveCount(0);

  // Concedido: vence amanhã, vai até o 10º dia.
  await escolher(/^Concedido/);
  await expect(page.getByTestId("data-automatica")).toContainText(
    `Vence amanhã (${dataBR(diaBR(1))}). Pode ser adiada até ${dataBR(diaBR(10))}`,
  );

  // Exigência INSS: fatal já vem hoje + 30; o Aguardando vai até fatal − 3.
  await escolher(/^Exigência INSS/);
  await expect(page.locator("#t-prazo-fatal-inss")).toHaveValue(diaBR(30));
  await expect(page.getByTestId("data-automatica")).toContainText(
    `Pode ser adiada até ${dataBR(recua(diaBR(27)))}`,
  );
  await expect(page.locator("#t-due")).toHaveCount(0);
});

test("aguardando documentos: trava no teto e pede a decisão da dilação", async ({ page }) => {
  // Fatal daqui a 2 dias: o teto (fatal − 3) já passou — hora de decidir.
  const titulo = `Aguardando documentos do parceiro (exigência INSS) - ${nomeCliente}`;
  const { data: ag, error } = await admin
    .from("tarefas")
    .insert({
      caso_id: casoId,
      responsavel_id: internoId,
      tipo: "interna",
      titulo,
      origem: "sync_inss_email",
      metadata: { template: "exigencia", aguardando_exigencia: true, prazo_fatal_em: diaBR(2) },
    })
    .select("id, due_at, metadata")
    .single();
  if (error) throw new Error(error.message);
  expect((ag!.metadata as { teto_em: string }).teto_em).toBe(recua(diaBR(-1)));

  // Pela API, com a sessão do interno: passar do teto é recusado.
  const cli = createClient(ENV.supabaseUrl, ENV.anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  await cli.auth.signInWithPassword({ email: ENV.internoEmail, password: ENV.internoPassword });
  const { error: errTrava } = await cli
    .from("tarefas")
    .update({ due_at: new Date(Date.now() + 5 * 86_400_000).toISOString() })
    .eq("id", ag!.id);
  expect(errTrava?.code).toBe("MSC04");
  await cli.auth.signOut({ scope: "local" });

  await abrirTarefaNoCaso(page, casoId, titulo);
  const sheet = page.getByRole("dialog");
  await expect(sheet.getByText("Documentos não chegaram — e agora?")).toBeVisible();
  await sheet.getByRole("button", { name: "Pedir dilação de prazo" }).click();
  await expect(page.getByText("Tarefa da dilação de prazo aberta.")).toBeVisible();

  const { data: dil } = await admin
    .from("tarefas")
    .select("titulo, due_at, responsavel_id")
    .eq("caso_id", casoId)
    .like("titulo", "Pedir prorrogação do prazo da exigência%")
    .single();
  expect(dil!.responsavel_id).toBe(internoId);
  expect(diaDoInstanteBR(dil!.due_at as string)).toBe(recua(diaBR(1)));
  const { data: fechada } = await admin.from("tarefas").select("status").eq("id", ag!.id).single();
  expect(fechada!.status).toBe("feito");
});

test("análise do deferimento: entrar com revisão abre a corrente do requerimento", async ({ page }) => {
  const titulo = `Analise de Deferimento - ${nomeCliente}`;
  const { data: an, error } = await admin
    .from("tarefas")
    .insert({
      caso_id: casoId,
      responsavel_id: internoId,
      tipo: "interna",
      titulo,
      origem: "sync_inss_email",
      metadata: { template: "concedido", analise_deferimento: true, prazo_fatal: true },
    })
    .select("id, due_at, metadata")
    .single();
  if (error) throw new Error(error.message);
  expect(diaDoInstanteBR(an!.due_at as string)).toBe(diaBR(1));
  expect((an!.metadata as { teto_em: string }).teto_em).toBe(diaBR(10));

  await abrirTarefaNoCaso(page, casoId, titulo);
  await page.getByRole("dialog").getByRole("button", { name: "Entrar com revisão" }).click();
  await expect(page.getByText("Revisão aberta — corrente do requerimento administrativo.")).toBeVisible();

  await expect
    .poll(async () => {
      const { data } = await admin
        .from("tarefas")
        .select("id")
        .eq("caso_id", casoId)
        .like("titulo", "Montagem do requerimento%");
      return data?.length ?? 0;
    })
    .toBe(1);
  const { data: fechada } = await admin.from("tarefas").select("status").eq("id", an!.id).single();
  expect(fechada!.status).toBe("feito");
});

test("painel do caso: processo judicial com baixa definitiva sugere encerrado", async ({ page }) => {
  const { data: proc, error } = await admin
    .from("processos_judiciais")
    .insert({
      caso_id: casoId,
      numero_processo: "5001234-56.2024.4.03.6100",
      vara: "1ª Vara Federal",
      comarca: "São Paulo",
      uf: "SP",
      data_distribuicao: diaBR(-400),
    })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  await admin.from("andamentos").insert([
    {
      caso_id: casoId,
      processo_judicial_id: proc!.id,
      origem: "datajud",
      titulo: "Trânsito em julgado (JE)",
      data_evento: `${diaBR(-40)}T00:00:00Z`,
      visivel_parceiro: false,
    },
    {
      caso_id: casoId,
      processo_judicial_id: proc!.id,
      origem: "datajud",
      titulo: "Baixa Definitiva (G2)",
      data_evento: `${diaBR(-10)}T00:00:00Z`,
      visivel_parceiro: false,
    },
  ]);

  await page.goto(`/casos/${casoId}`);
  const judicial = page.getByTestId("painel-judicial");
  await expect(judicial).toContainText("5001234-56.2024.4.03.6100");
  await expect(judicial).toContainText("Em andamento");
  await expect(judicial).toContainText("trânsito em julgado em " + dataBR(diaBR(-40)));
  await expect(judicial).toContainText("Parece encerrado");
  await judicial.getByRole("button", { name: "Confirmar encerrado" }).click();
  await expect(judicial).toContainText("Encerrado em " + dataBR(diaBR(-10)));

  const { data: depois } = await admin
    .from("processos_judiciais")
    .select("situacao, encerrado_em")
    .eq("id", proc!.id)
    .single();
  expect(depois).toMatchObject({ situacao: "encerrado", encerrado_em: diaBR(-10) });
});

/** Dia de calendário de Brasília, `n` dias a partir de hoje ("YYYY-MM-DD"). */
function diaBR(n: number): string {
  const hoje = new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
  const [y, m, d] = hoje.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

/** Sábado/domingo recuam para a sexta (mesma regra do banco). */
function recua(dia: string): string {
  const [y, m, d] = dia.split("-").map(Number);
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  const menos = dow === 6 ? 1 : dow === 0 ? 2 : 0;
  return new Date(Date.UTC(y, m - 1, d - menos)).toISOString().slice(0, 10);
}

function diaDoInstanteBR(iso: string): string {
  return new Date(iso).toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
}

function dataBR(dia: string): string {
  return dia.split("-").reverse().join("/");
}

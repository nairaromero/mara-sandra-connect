// E2E: popup ao concluir tarefa pelo "Feito" (Naira, 2026-09-02; card #306
// em 2026-09-14).
// Pela aba Atividades do caso: abrir a tarefa e pôr o Status em "Feito" abre
// o popup Concluir/Excluir (sem "Editar tarefa"); a exclusão exige motivo e
// registra no log (tarefas_excluidas.motivo). "Concluir tarefa" conclui na hora
// e abre "Próxima tarefa do caso": com sugestão da IA → "Editar tarefa
// sugerida" abre o formulário preenchido (nada é criado sem salvar); sem
// sugestão → "Criar nova tarefa" em branco; "Concluir sem criar nova tarefa"
// fecha sem criar. A nova tarefa (dali ou do botão "Nova tarefa") não fecha
// por clique fora nem Esc — só Cancelar/X.
//
// O staging não tem chave de IA: o caminho sem sugestão é o real; o com
// sugestão simula a resposta da edge sugerir-proxima-tarefa.

import { test, expect, type Page } from "@playwright/test";
import { STORAGE_INTERNO } from "../auth.setup";
import { adminClient, cleanupE2E, seedClienteCaso } from "../supabase-admin";

test.use({ storageState: STORAGE_INTERNO });

const admin = adminClient();
let casoId: string;
let tituloTarefa: string;
let tarefaId: string;

test.beforeAll(async () => {
  const sufixo = `Popup Concluir ${Date.now()}`;
  ({ casoId } = await seedClienteCaso(admin, { sufixo }));
  tituloTarefa = `[E2E] Analisar ${Date.now()}`;
  const { data, error } = await admin
    .from("tarefas")
    .insert({
      caso_id: casoId,
      tipo: "interna",
      status: "a_fazer",
      titulo: tituloTarefa,
      descricao: "tarefa de teste do popup",
      origem: "manual",
    })
    .select("id")
    .single();
  if (error) throw new Error(`seed tarefa: ${error.message}`);
  tarefaId = data.id;
});

test.afterAll(async () => {
  await admin.from("tarefas_excluidas").delete().eq("tarefa_id", tarefaId);
  await cleanupE2E(admin);
});

test("clicar Feito abre popup; excluir exige motivo e registra no log", async ({ page }) => {
  await page.goto(`/casos/${casoId}`);
  // Aba Atividades.
  await page.getByText("Atividades", { exact: true }).first().click();
  await expect(page.getByText(tituloTarefa)).toBeVisible({ timeout: 20000 });

  // Concluir é DENTRO da tarefa: abre o card e põe o Status em "Feito". O
  // menu "..." que fazia isso sem abrir saiu em 2026-09-09.
  const cardTarefa = page
    .locator("div.group")
    .filter({ hasText: tituloTarefa })
    .first();
  await cardTarefa.getByText(tituloTarefa).click();
  await expect(page.getByRole("heading", { name: "Editar tarefa" })).toBeVisible({
    timeout: 10000,
  });
  await page.getByRole("combobox", { name: "Status" }).click();
  await page.getByRole("option", { name: "Feito", exact: true }).click();

  // Popup de conclusão: "Concluir tarefa" e "Excluir com motivo"; o "Editar
  // tarefa" saiu (card #306).
  await expect(page.getByRole("heading", { name: "Concluir tarefa" })).toBeVisible();
  const popup = page.getByRole("dialog", { name: "Concluir tarefa" });
  await expect(popup.getByRole("button", { name: "Concluir tarefa", exact: true })).toBeVisible();
  await expect(popup.getByRole("button", { name: "Editar tarefa" })).toHaveCount(0);

  // Excluir sem motivo: bloqueado.
  await page.getByRole("button", { name: /Excluir com motivo/ }).click();
  await page.getByRole("button", { name: "Excluir tarefa" }).click();
  await expect(page.getByText("Escreva o motivo antes de excluir.")).toBeVisible();

  // Com motivo: exclui.
  await page
    .getByPlaceholder(/caso é judicial/)
    .fill("caso judicial — análise do Legalmail não se aplica");
  await page.getByRole("button", { name: "Excluir tarefa" }).click();
  // Toast exato (o andamento novo "Tarefa excluída: ..." também casaria o regex).
  await expect(page.getByText("Tarefa excluída.", { exact: true })).toBeVisible({ timeout: 15000 });

  // Banco: tarefa apagada, log com o motivo, e ANDAMENTO no caso com o motivo.
  // Sempre checar `error` antes do `data`: falha de query engolida viraria
  // "tarefa apagada" falso (error ignorado ≠ resultado vazio).
  const { data: viva, error: erroViva } = await admin
    .from("tarefas")
    .select("id")
    .eq("id", tarefaId)
    .maybeSingle();
  expect(erroViva).toBeNull();
  expect(viva).toBeNull();
  const { data: log, error: erroLog } = await admin
    .from("tarefas_excluidas")
    .select("motivo")
    .eq("tarefa_id", tarefaId)
    .maybeSingle();
  expect(erroLog).toBeNull();
  expect(log?.motivo).toContain("Legalmail");
  const { data: and, error: erroAnd } = await admin
    .from("andamentos")
    .select("titulo, descricao, visivel_parceiro")
    .eq("caso_id", casoId)
    .eq("metadata->>tarefa_id", tarefaId)
    .maybeSingle();
  expect(erroAnd).toBeNull();
  expect(and, "andamento do motivo não foi criado").toBeTruthy();
  expect(and!.descricao).toContain("Legalmail");
  expect(and!.visivel_parceiro).toBe(false);
});

async function seedTarefa(titulo: string): Promise<string> {
  const { data, error } = await admin
    .from("tarefas")
    .insert({ caso_id: casoId, tipo: "interna", status: "a_fazer", titulo, origem: "manual" })
    .select("id")
    .single();
  if (error) throw new Error(`seed tarefa: ${error.message}`);
  return data.id;
}

// Abre a tarefa pela aba Atividades e clica "Concluir tarefa" no popup.
async function concluirPeloPopup(page: Page, titulo: string) {
  await page.goto(`/casos/${casoId}`);
  await page.getByText("Atividades", { exact: true }).first().click();
  await expect(page.getByText(titulo)).toBeVisible({ timeout: 20000 });
  const card = page.locator("div.group").filter({ hasText: titulo }).first();
  await card.getByText(titulo).click();
  await expect(page.getByRole("heading", { name: "Editar tarefa" })).toBeVisible({
    timeout: 10000,
  });
  await page.getByRole("combobox", { name: "Status" }).click();
  await page.getByRole("option", { name: "Feito", exact: true }).click();
  await page
    .getByRole("dialog", { name: "Concluir tarefa" })
    .getByRole("button", { name: "Concluir tarefa", exact: true })
    .click();
  const proxima = page.getByRole("dialog", { name: "Próxima tarefa do caso" });
  await expect(proxima).toBeVisible({ timeout: 15000 });
  return proxima;
}

// O sheet ocupa a direita (max-w-md): o canto esquerdo é o fundo escurecido.
// Confere o data-state do sheet a cada gesto — o heading continua "visível"
// durante a animação de saída e deixaria passar um sheet que fechou.
async function clicarForaEEsc(page: Page) {
  const sheet = page.getByRole("dialog").filter({ has: page.getByRole("heading", { name: "Nova tarefa" }) });
  const altura = page.viewportSize()?.height ?? 720;
  await page.mouse.click(20, Math.round(altura / 2));
  await expect(sheet).toHaveAttribute("data-state", "open");
  await page.keyboard.press("Escape");
  await expect(sheet).toHaveAttribute("data-state", "open");
  // Tempo da animação de saída (se tivesse fechado, já teria sumido).
  await page.waitForTimeout(600);
  await expect(sheet).toHaveAttribute("data-state", "open");
}

async function statusDa(id: string): Promise<string> {
  const { data, error } = await admin.from("tarefas").select("status").eq("id", id).single();
  if (error) throw new Error(`status: ${error.message}`);
  return data.status;
}

test("sem sugestão da IA: Criar nova tarefa abre o formulário em branco", async ({ page }) => {
  const titulo = `[E2E] Proxima sem IA ${Date.now()}`;
  const id = await seedTarefa(titulo);
  const proxima = await concluirPeloPopup(page, titulo);

  // A tarefa já está concluída antes de escolher a próxima.
  await expect.poll(() => statusDa(id), { timeout: 15000 }).toBe("feito");
  await expect(proxima.getByText("Não consegui sugerir a próxima tarefa.")).toBeVisible({
    timeout: 40000,
  });
  await proxima.getByRole("button", { name: "Criar nova tarefa", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Nova tarefa" })).toBeVisible({ timeout: 10000 });
  await expect(page.locator("#t-titulo")).toHaveValue("");

  // Travado: clique fora e Esc não fecham o formulário; só Cancelar/X.
  await page.locator("#t-titulo").fill("rascunho que não pode sumir");
  await clicarForaEEsc(page);
  await expect(page.getByRole("heading", { name: "Nova tarefa" })).toBeVisible();
  await expect(page.locator("#t-titulo")).toHaveValue("rascunho que não pode sumir");
  await page.getByRole("button", { name: "Cancelar", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Nova tarefa" })).toHaveCount(0);
});

test("Nova tarefa: não existe em /tarefas; no caso, clique fora e Esc não fecham e o X fecha", async ({
  page,
}) => {
  // Saiu da tela Tarefas (2026-09-14): tarefa nova nasce no caso.
  await page.goto("/tarefas");
  await expect(page.getByRole("heading", { name: "Tarefas", level: 1 })).toBeVisible({
    timeout: 20000,
  });
  await expect(page.getByRole("button", { name: "Nova tarefa" })).toHaveCount(0);

  await page.goto(`/casos/${casoId}`);
  await page.getByText("Atividades", { exact: true }).first().click();
  await page.getByRole("button", { name: "Nova tarefa" }).click();
  await expect(page.getByRole("heading", { name: "Nova tarefa" })).toBeVisible({ timeout: 10000 });
  await page.locator("#t-titulo").fill("[E2E] rascunho travado");

  await clicarForaEEsc(page);
  await expect(page.getByRole("heading", { name: "Nova tarefa" })).toBeVisible();
  await expect(page.locator("#t-titulo")).toHaveValue("[E2E] rascunho travado");

  await page.getByRole("dialog").getByRole("button", { name: "Close" }).click();
  await expect(page.getByRole("heading", { name: "Nova tarefa" })).toHaveCount(0);
});

test("com sugestão da IA: Editar tarefa sugerida abre o formulário preenchido", async ({ page }) => {
  const titulo = `[E2E] Proxima com IA ${Date.now()}`;
  const id = await seedTarefa(titulo);
  const tituloSugerido = `[E2E] Acompanhar implantação ${Date.now()}`;
  const vence = new Date(Date.now() + 5 * 86400_000);
  vence.setUTCHours(12, 0, 0, 0); // 09:00 de Brasília
  const { data: eu } = await admin
    .from("usuarios")
    .select("id, nome")
    .eq("email", "e2e+interno@marasandraconnect.com")
    .single();

  await page.route("**/functions/v1/sugerir-proxima-tarefa", async (route) => {
    const cors = {
      "access-control-allow-origin": "*",
      "access-control-allow-headers": "*",
      "access-control-allow-methods": "POST, OPTIONS",
    };
    if (route.request().method() === "OPTIONS") {
      await route.fulfill({ status: 204, headers: cors });
      return;
    }
    expect(route.request().postDataJSON()).toEqual({ tarefa_id: id });
    await route.fulfill({
      status: 200,
      headers: { ...cors, "content-type": "application/json" },
      body: JSON.stringify({
        sugestao: {
          titulo: tituloSugerido,
          descricao: "Conferir a carta de concessão e o primeiro pagamento.",
          tipo: "contato_cliente",
          prioridade: 2,
          due_at: vence.toISOString(),
          responsavel_id: eu?.id ?? null,
          responsavel_nome: eu?.nome ?? null,
          processo_admin_id: null,
          processo_judicial_id: null,
        },
        motivo: "benefício deferido",
      }),
    });
  });

  const proxima = await concluirPeloPopup(page, titulo);
  await expect(proxima.getByText("Após essa tarefa, a outra tarefa para seguimento seria:")).toBeVisible();
  await expect(proxima.getByText(tituloSugerido)).toBeVisible();
  await expect(proxima.getByText("Sugerida pela IA")).toBeVisible();
  // Não existe atalho de criar direto: sempre abre pra conferir.
  await expect(proxima.getByRole("button", { name: /Criar tarefa sugerida/ })).toHaveCount(0);

  await proxima.getByRole("button", { name: "Editar tarefa sugerida" }).click();
  await expect(page.getByRole("heading", { name: "Nova tarefa" })).toBeVisible({ timeout: 10000 });
  await expect(page.locator("#t-titulo")).toHaveValue(tituloSugerido);
  await expect(page.locator("#t-due")).not.toHaveValue("");

  // Nada foi criado só por abrir o formulário.
  const { data: antes, error: e1 } = await admin
    .from("tarefas")
    .select("id")
    .eq("titulo", tituloSugerido);
  expect(e1).toBeNull();
  expect(antes).toHaveLength(0);

  await page.getByRole("button", { name: "Salvar" }).click();
  await expect
    .poll(
      async () => {
        const { data, error } = await admin
          .from("tarefas")
          .select("caso_id, tipo, responsavel_id")
          .eq("titulo", tituloSugerido);
        if (error) throw error;
        return data.length === 1 &&
          data[0].caso_id === casoId &&
          data[0].tipo === "contato_cliente" &&
          data[0].responsavel_id === (eu?.id ?? null)
          ? "ok"
          : JSON.stringify(data);
      },
      { timeout: 15000 },
    )
    .toBe("ok");
});

test("Concluir sem criar nova tarefa fecha e não cria nada", async ({ page }) => {
  const titulo = `[E2E] Proxima nenhuma ${Date.now()}`;
  const id = await seedTarefa(titulo);
  const { count: antes } = await admin
    .from("tarefas")
    .select("id", { count: "exact", head: true })
    .eq("caso_id", casoId);

  const proxima = await concluirPeloPopup(page, titulo);
  await proxima.getByRole("button", { name: "Concluir sem criar nova tarefa" }).click();
  await expect(proxima).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Nova tarefa" })).toHaveCount(0);

  expect(await statusDa(id)).toBe("feito");
  const { count: depois } = await admin
    .from("tarefas")
    .select("id", { count: "exact", head: true })
    .eq("caso_id", casoId);
  expect(depois).toBe(antes);
});

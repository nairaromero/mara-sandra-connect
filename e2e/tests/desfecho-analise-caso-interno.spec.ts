// E2E: desfecho da análise no caso SEM PARCEIRO (cliente interno do
// escritório) — Naira, 2026-09-03: os botões de continuação só apareciam
// quando o caso tinha parceiro indicador (a tarefa nascia com etapa
// analise_inicial_parceiro); no caso interno a etapa é analise_inicial_interno
// e a corrente morria aí.

import { test, expect } from "@playwright/test";
import { STORAGE_INTERNO } from "../auth.setup";
import { adminClient, cleanupE2E, seedClienteCaso } from "../supabase-admin";

test.use({ storageState: STORAGE_INTERNO });

const admin = adminClient();
let casoId: string;
let tarefaId: string;
let tituloTarefa: string;

test.beforeAll(async () => {
  // Sem parceiro_id = cliente interno do escritório.
  ({ casoId } = await seedClienteCaso(admin, { sufixo: `Analise Interna ${Date.now()}` }));
  tituloTarefa = `[E2E] Cliente novo - Analisar ${Date.now()}`;
  const { data, error } = await admin
    .from("tarefas")
    .insert({
      caso_id: casoId,
      tipo: "interna",
      status: "a_fazer",
      prioridade: 2,
      titulo: tituloTarefa,
      descricao: "Caso cadastrado pela equipe. Revisar dados e definir próximos passos.",
      origem: "manual",
      metadata: { origem_caso_id: casoId, etapa: "analise_inicial_interno" },
    })
    .select("id")
    .single();
  if (error) throw new Error(`seed tarefa: ${error.message}`);
  tarefaId = data.id;
});

test.afterAll(async () => {
  await cleanupE2E(admin);
});

test("caso sem parceiro mostra os desfechos e a corrente continua", async ({ page }) => {
  await page.goto(`/casos/${casoId}`);
  await page.getByText("Atividades", { exact: true }).first().click();
  await expect(page.getByText(tituloTarefa)).toBeVisible({ timeout: 20000 });

  const cardTarefa = page.locator("div.group").filter({ hasText: tituloTarefa }).first();

  // 1) Os três desfechos aparecem mesmo sem parceiro indicador.
  await expect(cardTarefa.getByRole("button", { name: "Fazer o requerimento" })).toBeVisible();
  await expect(cardTarefa.getByRole("button", { name: "Não há direito agora" })).toBeVisible();
  const btnAguardar = cardTarefa.getByRole("button", { name: "Aguardar documentação" });
  await expect(btnAguardar).toBeVisible();

  // 2) Concluir pelo "Feito" não baixa a tarefa calada: o popup manda usar o
  // desfecho (checklistPendente cobre as duas etapas da análise).
  await cardTarefa.hover();
  await cardTarefa.getByRole("button", { name: "Ações da tarefa" }).click();
  await page.getByRole("menuitem", { name: "Feito", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Concluir tarefa" })).toBeVisible();
  await expect(page.getByText("o desfecho da análise")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Concluir tarefa e adicionar outra" }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Cancelar" }).click();

  // 3) O desfecho fecha a análise e abre a próxima tarefa.
  await btnAguardar.click();
  await expect(page.getByText("Análise concluída")).toBeVisible({ timeout: 20000 });

  const { data: analise } = await admin
    .from("tarefas")
    .select("status")
    .eq("id", tarefaId)
    .single();
  expect(analise!.status).toBe("feito");

  const { data: proximas } = await admin
    .from("tarefas")
    .select("id, titulo, descricao, responsavel_id, status")
    .eq("caso_id", casoId)
    .neq("id", tarefaId);
  const aguardo = (proximas ?? []).find((t) => String(t.titulo).startsWith("Aguardando documentação"));
  expect(aguardo).toBeTruthy();
  expect(aguardo!.status).toBe("a_fazer");
  // Sem parceiro, o texto manda pedir ao cliente — não promete pedido "que
  // chega ao parceiro".
  expect(String(aguardo!.descricao)).toContain("direto ao cliente");
  // E a tarefa nasce com dono (a análise do seed não tinha responsável).
  expect(aguardo!.responsavel_id).not.toBeNull();
});

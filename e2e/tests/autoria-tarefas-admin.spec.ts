// E2E: autoria em tarefas (quem concluiu / quem excluiu), "Solicitado por"
// em Documentos pendentes e itens de admin escondidos pra interno comum.
//
// O usuário e2e interno NÃO é admin (eh_admin=false) — serve pra provar que
// Equipe/Webhooks/Auditoria somem da sidebar e que a rota redireciona.

import { test, expect } from "@playwright/test";
import { STORAGE_INTERNO } from "../auth.setup";
import { ENV } from "../env";
import { adminClient, cleanupE2E, seedClienteCaso, seedSolicitacao } from "../supabase-admin";

test.use({ storageState: STORAGE_INTERNO });

const admin = adminClient();
let casoId: string;
let internoId: string;
let tarefaConcluirId: string;
let tarefaExcluirId: string;

test.beforeAll(async () => {
  const sufixo = `Autoria ${Date.now()}`;
  ({ casoId } = await seedClienteCaso(admin, { sufixo }));

  const { data: u } = await admin
    .from("usuarios")
    .select("id")
    .eq("email", ENV.internoEmail)
    .single();
  internoId = u!.id;

  const { data: ts, error } = await admin
    .from("tarefas")
    .insert([
      {
        caso_id: casoId,
        titulo: "[E2E] tarefa pra concluir",
        tipo: "interna",
        status: "a_fazer",
        responsavel_id: internoId,
        origem: "manual",
      },
      {
        caso_id: casoId,
        titulo: "[E2E] tarefa pra excluir",
        tipo: "interna",
        status: "a_fazer",
        responsavel_id: internoId,
        origem: "manual",
      },
    ])
    .select("id, titulo");
  if (error) throw new Error(error.message);
  tarefaConcluirId = ts!.find((t) => t.titulo.includes("concluir"))!.id;
  tarefaExcluirId = ts!.find((t) => t.titulo.includes("excluir"))!.id;

  await seedSolicitacao(admin, casoId);
});

test.afterAll(async () => {
  await cleanupE2E(admin);
});

test("concluir tarefa grava quem concluiu e o card mostra", async ({ page }) => {
  await page.goto(`/casos/${casoId}`);
  await page.getByRole("tab", { name: /Atividades|Tarefas/ }).click();

  await page.getByText("[E2E] tarefa pra concluir", { exact: true }).click();
  // Sheet de edição: Status → Feito → Salvar.
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText("Editar tarefa")).toBeVisible();
  await dialog.getByRole("combobox").filter({ hasText: "A fazer" }).click();
  await page.getByRole("option", { name: "Feito", exact: true }).click();
  await dialog.getByRole("button", { name: "Salvar" }).click();

  await expect
    .poll(
      async () => {
        const { data } = await admin
          .from("tarefas")
          .select("status, status_alterado_por, status_alterado_em")
          .eq("id", tarefaConcluirId)
          .single();
        return data?.status === "feito" && data?.status_alterado_por === internoId
          ? "ok"
          : JSON.stringify(data);
      },
      { timeout: 15_000 },
    )
    .toBe("ok");

  // Concluir agora já abre a criação da PRÓXIMA tarefa ("e adicionar outra").
  // Como aqui não vamos criar outra, cancela esse sheet.
  await expect(page.getByRole("heading", { name: "Nova tarefa" })).toBeVisible({ timeout: 10_000 });
  await page.getByRole("button", { name: "Cancelar" }).click();

  // Aba Arquivados mostra "Concluída por <nome do e2e>".
  await page.getByRole("tab", { name: /Arquivados/ }).click();
  const { data: me } = await admin.from("usuarios").select("nome").eq("id", internoId).single();
  const primeiroNome = (me!.nome as string).split(/\s+/)[0].replace(/[[\]]/g, "");
  await expect(page.getByText(new RegExp(`Concluída por .*${primeiroNome}`, "i")).first()).toBeVisible();
});

test("excluir tarefa deixa rastro com quem excluiu", async ({ page }) => {
  await page.goto(`/casos/${casoId}`);
  await page.getByRole("tab", { name: /Atividades|Tarefas/ }).click();

  await page.getByText("[E2E] tarefa pra excluir", { exact: true }).click();
  const dialog = page.getByRole("dialog");
  // Excluir agora pede MOTIVO (vira andamento) — não é mais window.confirm.
  await dialog.getByRole("button", { name: "Excluir", exact: true }).click();
  await page.getByPlaceholder(/caso é judicial/).fill("removida no teste de autoria");
  await page.getByRole("button", { name: "Excluir tarefa" }).click();

  await expect
    .poll(
      async () => {
        const { data } = await admin
          .from("tarefas_excluidas")
          .select("excluida_por, titulo")
          .eq("tarefa_id", tarefaExcluirId)
          .maybeSingle();
        return data?.excluida_por === internoId ? "ok" : JSON.stringify(data);
      },
      { timeout: 15_000 },
    )
    .toBe("ok");

  // Seção "Excluídas" na aba Arquivados lista a tarefa riscada.
  await page.getByRole("tab", { name: /Arquivados/ }).click();
  await expect(page.getByRole("heading", { name: "Excluídas" })).toBeVisible();
  await expect(page.getByText("[E2E] tarefa pra excluir", { exact: true })).toBeVisible();
  await expect(page.getByText(/Excluída por/).first()).toBeVisible();
});

test("documentos pendentes mostra quem solicitou", async ({ page }) => {
  await page.goto("/documentos");
  // Solicitação seedada via service_role (sem solicitado_por, origem externa):
  // mostra "Não registrado". Basta existir a linha "Solicitado por".
  await page.getByRole("combobox").filter({ hasText: "Eu" }).click();
  await page.getByRole("option", { name: "Todos do escritório" }).click();
  await expect(page.getByText(/Solicitado por\s*Não registrado/).first()).toBeVisible();
});

test("interno comum não vê Equipe/Webhooks/Auditoria e é redirecionado", async ({ page }) => {
  await page.goto("/tarefas");
  await expect(page.getByRole("link", { name: "Etiquetas" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Equipe", exact: true })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Webhooks" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Auditoria" })).toHaveCount(0);

  await page.goto("/webhooks");
  await expect(page).not.toHaveURL(/\/webhooks$/, { timeout: 15_000 });

  await page.goto("/configuracoes");
  await expect(page.getByText("Sessão", { exact: true })).toBeVisible();
  await expect(page.getByText(/Integração Gmail/)).toHaveCount(0);
});

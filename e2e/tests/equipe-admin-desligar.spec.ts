// E2E: gestão da equipe pela UI (/equipe) — tornar/remover admin, desligar
// com migração das tarefas abertas, reativar.
//
// O e2e interno vira admin SÓ durante este spec (eh_admin=true no beforeAll,
// false no afterAll). Cria um interno descartável "[E2E] Desligável" e apaga
// no fim (auth + usuarios).

import { test, expect } from "@playwright/test";
import { STORAGE_INTERNO } from "../auth.setup";
import { ENV } from "../env";
import { adminClient, cleanupE2E, seedClienteCaso } from "../supabase-admin";

test.use({ storageState: STORAGE_INTERNO });

const admin = adminClient();
const EMAIL_ALVO = "e2e+desligavel@marasandraconnect.com";
let meuId: string;
let alvoId: string;
let casoId: string;

test.beforeAll(async () => {
  const { data: me } = await admin
    .from("usuarios")
    .select("id")
    .eq("email", ENV.internoEmail)
    .single();
  meuId = me!.id;
  await admin.from("usuarios").update({ eh_admin: true }).eq("id", meuId);

  // Interno descartável (limpa resto de execução anterior, se houver).
  const { data: lista } = await admin.auth.admin.listUsers({ perPage: 1000 });
  const antigo = lista?.users.find((u) => u.email === EMAIL_ALVO);
  if (antigo) {
    await admin.from("usuarios").delete().eq("id", antigo.id);
    await admin.auth.admin.deleteUser(antigo.id);
  }
  const { data: novo, error } = await admin.auth.admin.createUser({
    email: EMAIL_ALVO,
    password: ENV.internoPassword,
    email_confirm: true,
  });
  if (error) throw new Error(error.message);
  alvoId = novo.user!.id;
  const { error: pErr } = await admin.from("usuarios").upsert({
    id: alvoId,
    nome: "[E2E] Desligável",
    email: EMAIL_ALVO,
    tipo: "interno",
    ativo: true,
    onboarded_em: new Date().toISOString(),
  });
  if (pErr) throw new Error(pErr.message);

  ({ casoId } = await seedClienteCaso(admin, { sufixo: `Desligar ${Date.now()}` }));
  const { error: tErr } = await admin.from("tarefas").insert([
    { caso_id: casoId, titulo: "[E2E] aberta 1", tipo: "interna", status: "a_fazer", responsavel_id: alvoId, origem: "manual" },
    { caso_id: casoId, titulo: "[E2E] aberta 2", tipo: "interna", status: "fazendo", responsavel_id: alvoId, origem: "manual" },
    { caso_id: casoId, titulo: "[E2E] feita", tipo: "interna", status: "feito", responsavel_id: alvoId, origem: "manual" },
  ]);
  if (tErr) throw new Error(tErr.message);
});

test.afterAll(async () => {
  await cleanupE2E(admin);
  await admin.from("usuarios").update({ eh_admin: false }).eq("id", meuId);
  if (alvoId) {
    await admin.from("usuarios").delete().eq("id", alvoId);
    await admin.auth.admin.deleteUser(alvoId);
  }
});

test("tornar e remover admin pela UI", async ({ page }) => {
  await page.goto("/equipe");
  const linha = page.getByRole("listitem").filter({ hasText: "[E2E] Desligável" });
  await expect(linha).toBeVisible();

  await linha.getByRole("button", { name: /Ações de/ }).click();
  await page.getByRole("menuitem", { name: "Tornar admin" }).click();
  await expect(linha.getByText("admin", { exact: true })).toBeVisible();
  await expect
    .poll(async () => (await admin.from("usuarios").select("eh_admin").eq("id", alvoId).single()).data?.eh_admin)
    .toBe(true);

  await linha.getByRole("button", { name: /Ações de/ }).click();
  await page.getByRole("menuitem", { name: "Remover admin" }).click();
  await expect
    .poll(async () => (await admin.from("usuarios").select("eh_admin").eq("id", alvoId).single()).data?.eh_admin)
    .toBe(false);

  // Não dá pra remover o próprio admin (item desabilitado).
  const minha = page.getByRole("listitem").filter({ hasText: "(você)" });
  await minha.getByRole("button", { name: /Ações de/ }).click();
  await expect(page.getByRole("menuitem", { name: /Remover admin/ })).toBeDisabled();
  await page.keyboard.press("Escape");
});

test("desligar transfere tarefas abertas e bloqueia login; reativar desfaz", async ({ page }) => {
  await page.goto("/equipe");
  const linha = page.getByRole("listitem").filter({ hasText: "[E2E] Desligável" });
  await linha.getByRole("button", { name: /Ações de/ }).click();
  await page.getByRole("menuitem", { name: "Desligar da equipe" }).click();

  const dialog = page.getByRole("alertdialog");
  await expect(dialog.getByText(/2.*tarefa\(s\) aberta\(s\)/)).toBeVisible();
  // Botão Desligar travado enquanto não escolher quem assume.
  await expect(dialog.getByRole("button", { name: "Desligar", exact: true })).toBeDisabled();
  await dialog.getByRole("combobox", { name: "Quem assume as tarefas" }).click();
  await page.getByRole("option", { name: "[E2E] Interno" }).click();
  await dialog.getByRole("button", { name: "Desligar", exact: true }).click();

  // Banco: abertas foram pro e2e interno; a feita ficou com o desligado.
  await expect
    .poll(async () => {
      const { data } = await admin
        .from("tarefas")
        .select("titulo, responsavel_id, status")
        .eq("caso_id", casoId);
      const abertas = (data ?? []).filter((t) => t.status !== "feito");
      const feita = (data ?? []).find((t) => t.status === "feito");
      return abertas.every((t) => t.responsavel_id === meuId) && feita?.responsavel_id === alvoId
        ? "ok"
        : JSON.stringify(data);
    }, { timeout: 15_000 })
    .toBe("ok");

  const { data: u } = await admin
    .from("usuarios")
    .select("ativo, eh_admin, desligado_em")
    .eq("id", alvoId)
    .single();
  expect(u!.ativo).toBe(false);
  expect(u!.desligado_em).toBeTruthy();

  // Login bloqueado (banned_until).
  const { data: au } = await admin.auth.admin.getUserById(alvoId);
  expect((au.user as unknown as { banned_until?: string }).banned_until).toBeTruthy();

  // UI: saiu da lista de ativos, aparece em Desligados → Reativar.
  await expect(page.getByRole("listitem").filter({ hasText: "[E2E] Desligável" })).toHaveCount(0);
  await page.getByRole("button", { name: /Desligados/ }).click();
  const linhaDesl = page.getByRole("listitem").filter({ hasText: "[E2E] Desligável" });
  await linhaDesl.getByRole("button", { name: "Reativar" }).click();

  await expect
    .poll(async () => {
      const { data } = await admin.from("usuarios").select("ativo, desligado_em").eq("id", alvoId).single();
      return data?.ativo === true && data?.desligado_em === null ? "ok" : JSON.stringify(data);
    }, { timeout: 15_000 })
    .toBe("ok");
  const { data: au2 } = await admin.auth.admin.getUserById(alvoId);
  expect((au2.user as unknown as { banned_until?: string | null }).banned_until ?? null).toBeNull();
});

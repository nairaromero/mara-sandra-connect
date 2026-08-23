// Desligar parceiro (soft delete, issue #202): depois de desligado, o parceiro
// nao entra mais e nao ve caso nenhum — mesmo com o access token que ja tinha
// na mao. Reativar desfaz. Nada e apagado.
//
// Cria um parceiro sintetico PROPRIO (e2e+desligar@…) e apaga no fim: nao usa
// o e2e+parceiro do storageState, porque desligar derruba as sessoes e os
// refresh tokens — o parceiro.json dos outros specs deixaria de valer.
//
// Com video:  bun run e2e:video:staging

import { test, expect, type Browser, type Page } from "@playwright/test";
import { createClient, type Session } from "@supabase/supabase-js";
import { cursorVisivel } from "../cursor";
import { STORAGE_INTERNO } from "../auth.setup";
import { ENV, PROJECT_REF } from "../env";
import { adminClient, cleanupE2E, seedClienteCaso } from "../supabase-admin";

test.use({ storageState: STORAGE_INTERNO });
test.setTimeout(120_000);

const PARCEIRO_EMAIL = "e2e+desligar@marasandraconnect.com";
const PARCEIRO_NOME = "[E2E] Parceiro Desligar";
const STORAGE_KEY = `sb-${PROJECT_REF}-auth-token`;

const admin = adminClient();
let parceiroId: string;
let nomeCliente: string;

function anon() {
  return createClient(ENV.supabaseUrl, ENV.anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function loginParceiro(): Promise<{ session: Session | null; erro: string | null }> {
  const { data, error } = await anon().auth.signInWithPassword({
    email: PARCEIRO_EMAIL,
    password: ENV.parceiroPassword,
  });
  return { session: data.session ?? null, erro: error?.message ?? null };
}

// Parceiro descartavel: auth + perfil onboardado (senao cai em /boas-vindas).
async function criarParceiroDescartavel(): Promise<string> {
  await apagarParceiroDescartavel(); // sobra de run interrompido
  const { data, error } = await admin.auth.admin.createUser({
    email: PARCEIRO_EMAIL,
    password: ENV.parceiroPassword,
    email_confirm: true,
  });
  if (error || !data.user) throw new Error(`criar parceiro descartavel: ${error?.message}`);
  const agora = new Date().toISOString();
  const { error: perfilErr } = await admin.from("usuarios").upsert({
    id: data.user.id,
    email: PARCEIRO_EMAIL,
    nome: PARCEIRO_NOME,
    tipo: "parceiro",
    eh_parceiro: true,
    ativo: true,
    onboarded_em: agora,
    aceitou_termos_em: agora,
    termos_versao: "1.0-2026-06-09",
  });
  if (perfilErr) throw new Error(`perfil parceiro descartavel: ${perfilErr.message}`);
  return data.user.id;
}

async function apagarParceiroDescartavel() {
  const { data: u } = await admin
    .from("usuarios")
    .select("id")
    .eq("email", PARCEIRO_EMAIL)
    .maybeSingle();
  const { data: lista } = await admin.auth.admin.listUsers({ perPage: 1000 });
  const authUser = lista?.users.find((x) => x.email === PARCEIRO_EMAIL);
  const id = (u?.id as string | undefined) ?? authUser?.id;
  if (!id) return;
  await cleanupE2E(admin); // casos [E2E] que apontam pra ele
  await admin.from("usuarios").delete().eq("id", id);
  await admin.auth.admin.deleteUser(id);
}

// Abre uma aba LOGADA COMO O PARCEIRO (contexto separado do interno).
async function abaDoParceiro(browser: Browser, session: Session): Promise<Page> {
  const ctx = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  const page = await ctx.newPage();
  await cursorVisivel(page);
  await page.goto("/login");
  await page.evaluate(
    ([k, v]) => localStorage.setItem(k, v),
    [STORAGE_KEY, JSON.stringify(session)] as const,
  );
  return page;
}

async function moverE(page: Page, alvo: ReturnType<Page["getByRole"]>) {
  const b = await alvo.boundingBox();
  if (b) {
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 25 });
    await page.waitForTimeout(500);
  }
}

const visivel = (page: Page, texto: string) =>
  page.getByText(texto).filter({ visible: true }).first();

test.beforeAll(async () => {
  if (!ENV.parceiroPassword) throw new Error("STAGING_SYNTH_PASSWORD ausente");
  parceiroId = await criarParceiroDescartavel();
  const sufixo = `Desligar ${Date.now()}`;
  nomeCliente = `[E2E] ${sufixo}`;
  await seedClienteCaso(admin, { sufixo, parceiroId });
});

test.afterAll(async () => {
  await apagarParceiroDescartavel();
});

test("parceiro desligado nao entra nem ve caso; reativar desfaz", async ({ page, browser }) => {
  await cursorVisivel(page);

  // 1) Parceiro ativo: loga por senha e ve o caso dele.
  const antes = await loginParceiro();
  expect(antes.erro, "parceiro ativo precisa logar").toBeNull();
  const aba = await abaDoParceiro(browser, antes.session!);
  await aba.goto("/clientes");
  await expect(visivel(aba, nomeCliente)).toBeVisible({ timeout: 20_000 });
  await aba.waitForTimeout(1000);

  // 2) Interno desliga o parceiro pela tela /parceiros.
  await page.goto("/parceiros");
  const linha = page.getByRole("row", { name: new RegExp(PARCEIRO_NOME.replace(/[[\]]/g, "\\$&")) });
  await expect(linha).toBeVisible({ timeout: 20_000 });
  const btnDesligar = linha.getByRole("button", { name: "Desligar parceiro" });
  await moverE(page, btnDesligar);
  await btnDesligar.click();
  const confirmar = page.getByRole("button", { name: /^Desligar$/ });
  await moverE(page, confirmar);
  await confirmar.click();
  await expect(page.getByText(/desligado\./i).first()).toBeVisible();
  await expect(linha.getByText("Desligado")).toBeVisible();

  // 3) O parceiro, com o MESMO access token de antes, nao ve mais o caso.
  //    (RLS: parceiro_ativo()/caso_do_parceiro() falham com ativo=false.)
  await aba.reload();
  await expect(aba.getByText(nomeCliente)).toHaveCount(0, { timeout: 20_000 });
  await aba.waitForTimeout(1500);

  // 4) E nao consegue mais entrar: login por senha recusado (ban no auth).
  const depois = await loginParceiro();
  expect(depois.session).toBeNull();
  expect(depois.erro ?? "").toMatch(/banned|bloquead/i);

  // 5) Reativar pela tela: volta a logar e a ver o caso.
  const btnReativar = linha.getByRole("button", { name: "Reativar parceiro" });
  await moverE(page, btnReativar);
  await btnReativar.click();
  await expect(page.getByText(/reativado\./i).first()).toBeVisible();
  await expect(linha.getByText("Ativo")).toBeVisible();

  const deNovo = await loginParceiro();
  expect(deNovo.erro, "parceiro reativado precisa logar").toBeNull();
  const aba2 = await abaDoParceiro(browser, deNovo.session!);
  await aba2.goto("/clientes");
  await expect(visivel(aba2, nomeCliente)).toBeVisible({ timeout: 20_000 });
  await aba2.waitForTimeout(1000);

  await aba.context().close();
  await aba2.context().close();
});

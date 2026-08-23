// Desligar parceiro (soft delete, issue #202): depois de desligado, o parceiro
// nao entra mais e nao ve caso nenhum — mesmo com o access token que ja tinha
// na mao. Reativar desfaz. Nada e apagado.
//
// Usa a conta sintetica e2e+parceiro (seed-staging-contas). O teste a desliga
// e a reativa no fim; se algo quebrar no meio, o afterAll e o proprio seed
// deixam a conta de pe de novo.
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

const PARCEIRO_EMAIL = "e2e+parceiro@marasandraconnect.com";
const PARCEIRO_NOME = "[E2E] Parceiro";
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
    password: ENV.internoPassword, // mesma senha sintetica de todos
  });
  return { session: data.session ?? null, erro: error?.message ?? null };
}

async function garantirParceiroAtivo() {
  await admin
    .from("usuarios")
    .update({ ativo: true, desligado_em: null, desligado_por: null })
    .eq("id", parceiroId);
  await admin.auth.admin.updateUserById(parceiroId, { ban_duration: "none" });
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

test.beforeAll(async () => {
  const { data: p } = await admin
    .from("usuarios")
    .select("id")
    .eq("email", PARCEIRO_EMAIL)
    .single();
  if (!p) throw new Error(`${PARCEIRO_EMAIL} nao existe — rode node scripts/seed-staging-contas.mjs`);
  parceiroId = p.id as string;
  await garantirParceiroAtivo();

  const sufixo = `Desligar ${Date.now()}`;
  nomeCliente = `[E2E] ${sufixo}`;
  await seedClienteCaso(admin, { sufixo, parceiroId });
});

test.afterAll(async () => {
  await garantirParceiroAtivo();
  await cleanupE2E(admin);
});

test("parceiro desligado nao entra nem ve caso; reativar desfaz", async ({ page, browser }) => {
  await cursorVisivel(page);

  // 1) Parceiro ativo: loga por senha e ve o caso dele.
  const antes = await loginParceiro();
  expect(antes.erro, "parceiro ativo precisa logar").toBeNull();
  const aba = await abaDoParceiro(browser, antes.session!);
  await aba.goto("/clientes");
  await expect(aba.getByText(nomeCliente).filter({ visible: true }).first()).toBeVisible({ timeout: 20_000 });
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
  await expect(aba2.getByText(nomeCliente).filter({ visible: true }).first()).toBeVisible({ timeout: 20_000 });
  await aba2.waitForTimeout(1000);

  await aba.context().close();
  await aba2.context().close();
});

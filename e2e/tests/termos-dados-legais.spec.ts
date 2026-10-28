// E2E do #496: os termos que o parceiro assina citam o escritório DELE e a
// plataforma Legal Connect — não mais os dados de um escritório só.
//
// Antes, o Acordo de Tratamento de Dados, o Termo de Uso e a Política diziam
// "Mara Sandra Connect" e citavam razão social, CNPJ, endereço e foro escritos
// no código: a parceira do Canário assinaria em nome de outro escritório.
// Agora os dados vêm de escritorio_config.dados_legais (Configurações →
// Escritório) e, sem eles, a assinatura não sai.
//
// Só no banco local: mexe na versão aceita pela parceira do Canário e nos
// dados legais do Canário, e devolve os dois no fim.

import { test, expect, type Browser } from "@playwright/test";
import { ENV } from "../env";
import { adminClient } from "../supabase-admin";
import { contaDoCanario, escritorioCanario, idDe, limpezaLocal, sessaoComo, ultimaLinhaDaTrilha } from "../rbac";
import { TERMOS_VERSAO } from "../../supabase/functions/_shared/termos";

const admin = adminClient();
const PARCEIRA = contaDoCanario("parceiro");

let ESC2: string;
let PARCEIRA_ID: string;
let versaoOriginal: string | null = null;
let dadosOriginais: Record<string, unknown> = {};

async function dadosLegais(): Promise<Record<string, unknown>> {
  const { data, error } = await admin.from("escritorio_config").select("dados_legais").eq("escritorio_id", ESC2).single();
  if (error) throw new Error(`dados legais do Canário: ${error.message}`);
  return (data.dados_legais ?? {}) as Record<string, unknown>;
}
async function definirDadosLegais(dados: Record<string, unknown>) {
  const { sb } = await sessaoComo(contaDoCanario("admin"), ESC2);
  const { error } = await sb.rpc("escritorio_definir_dados_legais", { p_dados: dados });
  if (error) throw new Error(`escritorio_definir_dados_legais: ${error.message}`);
}
async function abrirBoasVindasComoParceira(browser: Browser) {
  const ctx = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  const page = await ctx.newPage();
  await page.goto("/login");
  // Preencher antes de o React assumir a página envia o formulário vazio.
  await page.waitForLoadState("networkidle");
  await page.locator('input[type="email"]').fill(PARCEIRA);
  await page.locator('input[type="password"]').first().fill(ENV.internoPassword);
  await page.locator('button[type="submit"]').first().click();
  // Versão antiga dos termos: o sistema manda para /boas-vindas.
  await expect(page).toHaveURL(/\/boas-vindas/, { timeout: 30_000 });
  return { ctx, page };
}

test.describe.serial("termos com os dados do escritório (#496)", () => {
  test.beforeAll(async () => {
    test.skip(!ENV.local, "só no banco local");
    ESC2 = await escritorioCanario();
    PARCEIRA_ID = await idDe(PARCEIRA);
    const { data, error } = await admin.from("usuarios").select("termos_versao").eq("id", PARCEIRA_ID).single();
    if (error) throw new Error(error.message);
    versaoOriginal = data.termos_versao as string | null;
    dadosOriginais = await dadosLegais();
    // Parceira que aceitou a versão anterior: precisa assinar a nova.
    const { error: e2 } = await admin.from("usuarios").update({ termos_versao: "0.9-anterior" }).eq("id", PARCEIRA_ID);
    if (e2) throw new Error(e2.message);
  });
  test.afterAll(limpezaLocal(async () => {
    if (!ESC2) return;
    await definirDadosLegais(dadosOriginais);
    await admin.from("usuarios").update({ termos_versao: versaoOriginal }).eq("id", PARCEIRA_ID);
  }));

  test("o documento cita o escritório da parceira e a Legal Connect, na versão nova", async ({ browser }) => {
    const legais = await dadosLegais();
    expect(legais.razao_social, "o seed do Canário preenche os dados legais").toBeTruthy();
    const { ctx, page } = await abrirBoasVindasComoParceira(browser);
    await expect(page.getByText(String(legais.razao_social)).first()).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText(String(legais.cnpj)).first()).toBeVisible();
    await expect(page.getByText(`versão ${TERMOS_VERSAO}`).first()).toBeVisible();
    await expect(page.getByText("Legal Connect").first()).toBeVisible();
    const corpo = await page.locator("body").innerText();
    expect(corpo).not.toMatch(/Mara Sandra|Mara Vian|Votuporanga/);
    await ctx.close();
  });

  test("sem os dados legais do escritório, a parceira não assina; a troca fica na trilha", async ({ browser }) => {
    await definirDadosLegais({ privacidade_email: "privacidade@canario.test" }); // sem razão social, CNPJ, endereço e foro
    const trilha = await ultimaLinhaDaTrilha(ESC2, "escritorio.dados_legais");
    expect(trilha?.detalhes.depois).toEqual({ privacidade_email: "privacidade@canario.test" });

    const { ctx, page } = await abrirBoasVindasComoParceira(browser);
    await expect(page.locator("[data-aceite-faltam-dados-legais]")).toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole("button", { name: /Assinar e começar/ })).toBeDisabled();
    await ctx.close();
  });

  test("quem não configura o escritório não altera os dados legais", async () => {
    const { sb } = await sessaoComo(contaDoCanario("advogado"), ESC2);
    const { error } = await sb.rpc("escritorio_definir_dados_legais", { p_dados: { razao_social: "Outra" } });
    expect(error?.code).toBe("42501");
  });
});

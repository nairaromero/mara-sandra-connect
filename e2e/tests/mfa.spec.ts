// E2E: verificação em duas etapas (TOTP) — produto e QG (migration_rbac_11).
//
// Produto: quem tem autenticador entra em AAL1 depois da senha e o /login pede
// o código; com o código certo entra, e em Configurações → Segurança consegue
// desativar (o Supabase exige AAL2 para remover o fator). QG: com
// app_config.qg_exigir_aal2 = 'true', staff sem autenticador cai na tela de
// cadastro (QR + chave), confirma o primeiro código e entra; as funções qg_*
// recusam a sessão AAL1 no banco. O código TOTP é calculado aqui (RFC 6238,
// SHA-1, 30 s) a partir da chave que a tela mostra — nunca digitamos senha.
//
// Só no banco local. Usa um usuário descartável no Canário e o qg+suporte
// (fatores removidos no fim; a config volta a 'false').

import { test, expect, type Browser, type BrowserContext } from "@playwright/test";
import { createClient, type Session, type SupabaseClient } from "@supabase/supabase-js";
import { createHmac } from "node:crypto";
import { ENV, PROJECT_REF } from "../env";
import { adminClient } from "../supabase-admin";
import { cursorVisivel } from "../cursor";

const admin = adminClient();
const DOM = "marasandraconnect.com";

// ---- TOTP (RFC 6238) ----
function base32Decode(s: string): Buffer {
  const alfabeto = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const ch of s.toUpperCase().replace(/=+$/, "").replace(/\s+/g, "")) {
    const v = alfabeto.indexOf(ch);
    if (v < 0) throw new Error(`base32 inválido: ${ch}`);
    bits += v.toString(2).padStart(5, "0");
  }
  const bytes: number[] = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(parseInt(bits.slice(i, i + 8), 2));
  return Buffer.from(bytes);
}
function totp(secret: string, agora = Date.now()): string {
  const contador = Math.floor(agora / 1000 / 30);
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(contador));
  const h = createHmac("sha1", base32Decode(secret)).update(buf).digest();
  const o = h[h.length - 1] & 0xf;
  const codigo = (((h[o] & 0x7f) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3]) % 1_000_000;
  return codigo.toString().padStart(6, "0");
}
/** Um código por janela: se a janela atual já foi usada, espera a próxima. */
let ultimaJanela = -1;
async function codigoNovo(secret: string): Promise<string> {
  let janela = Math.floor(Date.now() / 30000);
  if (janela === ultimaJanela) {
    const espera = (janela + 1) * 30000 - Date.now() + 500;
    await new Promise((r) => setTimeout(r, espera));
    janela = Math.floor(Date.now() / 30000);
  }
  ultimaJanela = janela;
  return totp(secret);
}

async function sessaoDe(email: string, escritorio?: string): Promise<{ sb: SupabaseClient; session: Session }> {
  const sb = createClient(ENV.supabaseUrl, ENV.anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: escritorio ? { headers: { "x-escritorio-id": escritorio } } : {},
  });
  const { data, error } = await sb.auth.signInWithPassword({ email, password: ENV.internoPassword });
  if (error || !data.session) throw new Error(`login ${email}: ${error?.message}`);
  return { sb, session: data.session };
}
async function contexto(browser: Browser, origem: string, session: Session, escritorio?: string): Promise<BrowserContext> {
  return browser.newContext({
    storageState: {
      cookies: [],
      origins: [{
        origin: origem,
        localStorage: [
          { name: `sb-${PROJECT_REF}-auth-token`, value: JSON.stringify(session) },
          ...(escritorio ? [{ name: "msc:escritorio_ativo", value: escritorio }] : []),
        ],
      }],
    },
  });
}
async function apagarFatores(userId: string) {
  const { data } = await admin.auth.admin.mfa.listFactors({ userId });
  for (const f of data?.factors ?? []) await admin.auth.admin.mfa.deleteFactor({ id: f.id, userId });
}

let ESC2: string;
const EMAIL = `e2e+mfa-${Date.now()}@${DOM}`;
let usuarioId: string | null = null;
let suporteId: string | null = null;

test.describe.serial("verificação em duas etapas", () => {
  test.beforeAll(async () => {
    test.skip(!ENV.local, "só no banco local");
    const { data: canario, error } = await admin.from("escritorios").select("id").eq("slug", "canario").maybeSingle();
    test.skip(!!error || !canario, "canário ausente — rode `bun run local:rbac`");
    ESC2 = canario!.id;
    // usuário descartável: advogado do Canário
    const { data: novo, error: eCria } = await admin.auth.admin.createUser({ email: EMAIL, password: ENV.internoPassword, email_confirm: true, user_metadata: { nome: "[E2E] Duas etapas" } });
    if (eCria || !novo.user) throw new Error(`criar usuário: ${eCria?.message}`);
    usuarioId = novo.user.id;
    const agora = new Date().toISOString();
    const { error: eU } = await admin.from("usuarios").upsert({ id: usuarioId, email: EMAIL, nome: "[E2E] Duas etapas", tipo: "interno", ativo: true, onboarded_em: agora, aceitou_termos_em: agora, senha_definida_em: agora });
    if (eU) throw new Error(`usuarios: ${eU.message}`);
    const { data: papel } = await admin.from("papeis").select("id").is("escritorio_id", null).eq("chave", "advogado").single();
    const { error: eM } = await admin.from("membros").insert({ escritorio_id: ESC2, usuario_id: usuarioId, papel_id: papel!.id, status: "ativo" });
    if (eM) throw new Error(`membros: ${eM.message}`);
    const { data: sup } = await admin.from("usuarios").select("id").eq("email", `qg+suporte@${DOM}`).single();
    suporteId = sup!.id;
    await apagarFatores(suporteId);
  });
  test.afterAll(async () => {
    await admin.from("app_config").upsert({ chave: "qg_exigir_aal2", valor: "false" });
    if (suporteId) await apagarFatores(suporteId);
    if (usuarioId) {
      await apagarFatores(usuarioId);
      await admin.from("membros").delete().eq("usuario_id", usuarioId);
      await admin.from("usuarios").delete().eq("id", usuarioId);
      await admin.auth.admin.deleteUser(usuarioId);
    }
  });

  test("produto: cadastro por API, código no login, desativar em Segurança", async ({ browser, baseURL }) => {
    // 1) cadastra o autenticador pela API (como a tela faria)
    const { sb } = await sessaoDe(EMAIL, ESC2);
    const enroll = await sb.auth.mfa.enroll({ factorType: "totp", friendlyName: "e2e" });
    expect(enroll.error).toBeNull();
    const secret = enroll.data!.totp.secret;
    const ch = await sb.auth.mfa.challenge({ factorId: enroll.data!.id });
    expect(ch.error).toBeNull();
    const ok = await sb.auth.mfa.verify({ factorId: enroll.data!.id, challengeId: ch.data!.id, code: await codigoNovo(secret) });
    expect(ok.error).toBeNull();

    // 2) sessão nova (AAL1) -> /login pede o código
    const { session } = await sessaoDe(EMAIL, ESC2);
    const ctx = await contexto(browser, new URL(baseURL!).origin, session, ESC2);
    const page = await ctx.newPage();
    await cursorVisivel(page);
    try {
      await page.goto("/login");
      const etapa = page.locator("[data-login-mfa]");
      await expect(etapa).toBeVisible();
      await expect(page.locator('[data-duas-etapas="confirmar"]')).toBeVisible();
      // código errado é recusado
      await page.getByLabel("Código de 6 dígitos").fill("000000");
      await page.getByRole("button", { name: "Entrar" }).click();
      await expect(page.getByRole("alert")).toContainText(/inválido|expirado/i);
      // código certo entra
      await page.getByLabel("Código de 6 dígitos").fill(await codigoNovo(secret));
      await page.getByRole("button", { name: "Entrar" }).click();
      await expect(page).toHaveURL(/\/(casos|tarefas)/, { timeout: 15000 });

      // 3) Segurança: ativa; desativar (sessão já AAL2) remove o fator
      await page.goto("/configuracoes?tab=seguranca");
      const card = page.locator("[data-card-duas-etapas]");
      await expect(card.locator("[data-mfa-status]")).toHaveAttribute("data-mfa-status", "ativa");
      await card.getByRole("button", { name: "Desativar" }).click();
      await expect(page.getByText("Verificação em duas etapas desativada.")).toBeVisible();
      await expect(card.locator("[data-mfa-status]")).toHaveAttribute("data-mfa-status", "inativa");
      const { data: fatores } = await admin.auth.admin.mfa.listFactors({ userId: usuarioId! });
      expect((fatores?.factors ?? []).filter((f) => f.status === "verified")).toHaveLength(0);
    } finally {
      await ctx.close();
    }
  });

  test("QG exige AAL2: sem autenticador cai no cadastro; com o código, entra", async ({ browser, baseURL }) => {
    const { error: eCfg } = await admin.from("app_config").upsert({ chave: "qg_exigir_aal2", valor: "true" });
    expect(eCfg).toBeNull();
    const { sb, session } = await sessaoDe(`qg+suporte@${DOM}`);
    // no banco: AAL1 é recusada
    const recusa = await sb.rpc("qg_escritorios", { p_limite: 1 });
    expect(recusa.error?.message ?? "").toMatch(/duas etapas|AAL2/i);

    const u = new URL(baseURL!);
    const origem = `${u.protocol}//qg.${u.host}`;
    const ctx = await contexto(browser, origem, session);
    const page = await ctx.newPage();
    await cursorVisivel(page);
    try {
      await page.goto(`${origem}/qg`);
      await expect(page.getByRole("heading", { name: "O QG exige verificação em duas etapas" })).toBeVisible();
      const cadastro = page.locator('[data-duas-etapas="cadastrar"]');
      await expect(cadastro).toBeVisible();
      await expect(cadastro.getByRole("img", { name: "QR do autenticador" })).toBeVisible();
      const secret = (await cadastro.locator("[data-mfa-secret]").textContent())!.trim();
      expect(secret.length).toBeGreaterThan(10);
      await page.getByLabel("Código de 6 dígitos").fill(await codigoNovo(secret));
      await page.getByRole("button", { name: "Ativar e entrar" }).click();
      // entrou: lista de escritórios
      await expect(page.getByRole("heading", { name: "Escritórios", level: 1 })).toBeVisible({ timeout: 15000 });
      await expect(page.locator("[data-contagem]").first()).toContainText("escritórios");
    } finally {
      await ctx.close();
    }
  });
});

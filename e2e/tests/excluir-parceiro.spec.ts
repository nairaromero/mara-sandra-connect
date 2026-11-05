// E2E do #202: excluir parceiro só quando não há caso nem histórico.
//
// Antes, "Cancelar convite" (a lixeira da aba Convites) apagava o parceiro
// desvinculando os casos sem perguntar, apagava os comentários dele e fazia
// tudo em passos soltos — se um falhava, os anteriores ficavam feitos. Hoje a
// aba Convites mostra 17 parceiros, todos com casos.
//
// Agora a function excluir-parceiro recusa com 409 `parceiro_com_historico` e
// a tela oferece Desligar (que preserva tudo) no lugar da lixeira.
//
// Só no banco local: cria três parceiros descartáveis no Canário e apaga tudo
// no fim.

import { test, expect } from "@playwright/test";
import { ENV } from "../env";
import { adminClient, cpfValido } from "../supabase-admin";
import {
  chamadorComo,
  contaDoCanario,
  escritorioCanario,
  escritorioPadrao,
  limpezaLocal,
  ultimaLinhaDaTrilha,
} from "../rbac";

const admin = adminClient();
const DOM = "marasandraconnect.com";
const MARCA = "[E2E excluir]";
const CONTAS = {
  comCaso: { email: `e2e+excluir-com-caso@${DOM}`, nome: `${MARCA} Com Caso` },
  semNada: { email: `e2e+excluir-sem-nada@${DOM}`, nome: `${MARCA} Sem Nada` },
  dois: { email: `e2e+excluir-dois@${DOM}`, nome: `${MARCA} Dois Escritorios` },
};

let ESC1: string;
let ESC2: string;
let PAPEL_PARCEIRO: string;
const ids: Record<keyof typeof CONTAS, string> = { comCaso: "", semNada: "", dois: "" };
let CASO = "";
let CLIENTE = "";

async function criarParceiro(chave: keyof typeof CONTAS, escritorios: string[]) {
  const c = CONTAS[chave];
  const { data, error } = await admin.auth.admin.createUser({ email: c.email, password: ENV.internoPassword, email_confirm: true });
  if (error || !data.user) throw new Error(`createUser ${c.email}: ${error?.message}`);
  ids[chave] = data.user.id;
  // Convite pendente: sem primeiro acesso (aparece na aba Convites).
  const { error: eU } = await admin.from("usuarios").upsert({
    id: data.user.id, email: c.email, nome: c.nome, tipo: "parceiro", eh_parceiro: true, ativo: true,
    onboarded_em: null, termos_versao: null, escritorio_origem_id: escritorios[0],
  });
  if (eU) throw new Error(`usuarios ${c.email}: ${eU.message}`);
  for (const esc of escritorios) {
    const { data: ja } = await admin.from("membros").select("id").eq("usuario_id", data.user.id).eq("escritorio_id", esc).maybeSingle();
    if (ja) continue;
    const { error: eM } = await admin.from("membros").insert({ escritorio_id: esc, usuario_id: data.user.id, papel_id: PAPEL_PARCEIRO, status: "ativo" });
    if (eM) throw new Error(`membros ${c.email}: ${eM.message}`);
  }
}

async function limpar() {
  if (CASO) await admin.from("casos").delete().eq("id", CASO);
  if (CLIENTE) await admin.from("clientes").delete().eq("id", CLIENTE);
  const { data: lista } = await admin.auth.admin.listUsers({ perPage: 1000 });
  for (const c of Object.values(CONTAS)) {
    const u = lista?.users.find((x) => x.email === c.email);
    if (!u) continue;
    await admin.from("membros").delete().eq("usuario_id", u.id);
    await admin.from("usuarios").delete().eq("id", u.id);
    await admin.auth.admin.deleteUser(u.id);
  }
}

test.describe.serial("excluir parceiro: só sem caso nem histórico (#202)", () => {
  test.beforeAll(async () => {
    test.skip(!ENV.local, "só no banco local");
    ESC1 = await escritorioPadrao();
    ESC2 = await escritorioCanario();
    const { data: papel, error } = await admin.from("papeis").select("id").eq("chave", "parceiro").is("escritorio_id", null).single();
    if (error) throw new Error(`papel parceiro: ${error.message}`);
    PAPEL_PARCEIRO = papel.id;
    await limpar();
    await criarParceiro("comCaso", [ESC2]);
    await criarParceiro("semNada", [ESC2]);
    await criarParceiro("dois", [ESC1, ESC2]);
    const { data: cli, error: eC } = await admin.from("clientes").insert({ escritorio_id: ESC2, nome: `${MARCA} Cliente`, cpf: cpfValido() }).select("id").single();
    if (eC) throw new Error(`cliente: ${eC.message}`);
    CLIENTE = cli.id;
    const { data: caso, error: eCaso } = await admin.from("casos").insert({
      escritorio_id: ESC2, cliente_id: CLIENTE, parceiro_id: ids.comCaso, fase: "analise", tipo_beneficio: "Outro",
    }).select("id").single();
    if (eCaso) throw new Error(`caso: ${eCaso.message}`);
    CASO = caso.id;
  });
  test.afterAll(limpezaLocal(async () => {
    if (ESC2) await limpar();
  }));

  test("na aba Convites, quem tem caso ganha Desligar; a lixeira fica só para quem não tem", async ({ browser }) => {
    const ctx = await browser.newContext({ storageState: { cookies: [], origins: [] } });
    const page = await ctx.newPage();
    await page.goto("/login");
    await page.waitForLoadState("networkidle");
    await page.locator('input[type="email"]').fill(contaDoCanario("admin"));
    await page.locator('input[type="password"]').first().fill(ENV.internoPassword);
    await page.locator('button[type="submit"]').first().click();
    await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 30_000 });
    await page.goto("/parceiros?tab=convites");
    const linhaComCaso = page.locator("li").filter({ hasText: CONTAS.comCaso.nome });
    const linhaSemNada = page.locator("li").filter({ hasText: CONTAS.semNada.nome });
    await expect(linhaComCaso).toBeVisible({ timeout: 20_000 });
    await expect(linhaComCaso).toContainText("1 caso(s)");
    await expect(linhaComCaso.getByRole("button", { name: "Desligar parceiro" })).toBeVisible();
    await expect(linhaComCaso.getByRole("button", { name: "Cancelar convite" })).toHaveCount(0);
    await expect(linhaSemNada.getByRole("button", { name: "Cancelar convite" })).toBeVisible();
    await expect(linhaSemNada.getByRole("button", { name: "Desligar parceiro" })).toHaveCount(0);
    await ctx.close();
  });

  test("com caso: o servidor recusa e nada muda", async () => {
    const chamar = await chamadorComo(contaDoCanario("admin"), ESC2);
    const r = await chamar("excluir-parceiro", { usuario_id: ids.comCaso, confirmar: true });
    expect(r.status, r.texto).toBe(409);
    expect(r.json?.codigo).toBe("parceiro_com_historico");
    expect(String(r.json?.error)).toMatch(/Desligar/);
    const { data: caso } = await admin.from("casos").select("parceiro_id").eq("id", CASO).single();
    expect(caso!.parceiro_id, "o caso continua com o parceiro").toBe(ids.comCaso);
    const { data: u } = await admin.from("usuarios").select("id").eq("id", ids.comCaso).maybeSingle();
    expect(u).toBeTruthy();
  });

  test("sem caso nem histórico: apaga cadastro e login, e a trilha registra depois", async () => {
    const chamar = await chamadorComo(contaDoCanario("admin"), ESC2);
    const r = await chamar("excluir-parceiro", { usuario_id: ids.semNada, confirmar: true });
    expect(r.status, r.texto).toBe(200);
    expect(r.json?.excluido).toBe(true);
    const { data: u } = await admin.from("usuarios").select("id").eq("id", ids.semNada).maybeSingle();
    expect(u).toBeNull();
    const trilha = await ultimaLinhaDaTrilha(ESC2, "parceiro.excluido");
    expect(trilha?.recurso_id).toBe(ids.semNada);
    expect(trilha?.detalhes.nome).toBe(CONTAS.semNada.nome);
  });

  test("sem histórico aqui, mas com vínculo em outro escritório: sai só deste, a conta fica", async () => {
    const chamar = await chamadorComo(contaDoCanario("admin"), ESC2);
    const r = await chamar("excluir-parceiro", { usuario_id: ids.dois, confirmar: true });
    expect(r.status, r.texto).toBe(200);
    expect(r.json?.conta_preservada).toBe(true);
    const { data: vinc } = await admin.from("membros").select("escritorio_id").eq("usuario_id", ids.dois);
    expect(vinc!.map((v) => v.escritorio_id)).toEqual([ESC1]);
    const { data: u } = await admin.from("usuarios").select("id").eq("id", ids.dois).maybeSingle();
    expect(u).toBeTruthy();
  });
});

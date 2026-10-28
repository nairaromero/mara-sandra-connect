// E2E do #503: quem é o procurador nos e-mails do INSS é do escritório.
//
// Antes, a lista era fixa no código com nomes de pessoas do escritório padrão.
// Agora contam o marcador "(procurador)", a equipe interna ativa e os nomes
// "como o INSS escreve" que o escritório cadastra (Integrações → Gmail do
// INSS). Aqui: a lista é salva pela RPC (com as travas), a caixa do Canário é
// conectada pelo Google SIMULADO e o processador roda em dry_run com nomes
// diferentes no e-mail — sem criar andamento nem tarefa.
//
// Só no banco local, com o mock dos provedores (:8787). Devolve tudo no fim.

import { test, expect } from "@playwright/test";
import { ENV } from "../env";
import { adminClient } from "../supabase-admin";
import {
  chamadorComo,
  contaDoCanario,
  escritorioCanario,
  limpezaLocal,
  segredoDeSistemaLocal,
  sessaoComo,
  ultimaLinhaDaTrilha,
} from "../rbac";

const admin = adminClient();
const MOCK = "http://localhost:8787";
const PROCURADOR = "Fulana Procuradora de Teste";
let ESC2: string;
let extrasOriginais: Record<string, unknown> = {};
let clienteOriginal = "";

async function configurarEmail(clienteNome: string) {
  const r = await fetch(`${MOCK}/_config`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ cliente_nome: clienteNome }),
  });
  const j = (await r.json()) as { config: { cliente_nome: string } };
  return j.config;
}

/** A classificação do e-mail simulado, em dry_run (não escreve andamento nem tarefa). */
async function classificar(clienteNome: string): Promise<string> {
  await configurarEmail(clienteNome);
  const chamar = await chamadorComo(contaDoCanario("admin"), ESC2);
  const r = await chamar("inss-email-processor", { dias: 7, limite: 5, dry_run: true });
  expect(r.status, r.texto.slice(0, 300)).toBe(200);
  const achado = JSON.stringify(r.json).match(/"classificacao":"([^"]+)"/);
  expect(achado, `sem classificação na resposta: ${r.texto.slice(0, 300)}`).toBeTruthy();
  return achado![1];
}

test.describe.serial("procurador nos e-mails do INSS (#503)", () => {
  test.beforeAll(async () => {
    test.skip(!ENV.local || !segredoDeSistemaLocal(), "só no banco local");
    const vivo = await fetch(`${MOCK}/_health`).then((r) => r.ok).catch(() => false);
    test.skip(!vivo, "mock dos provedores (:8787) fora do ar");
    ESC2 = await escritorioCanario();
    const { data, error } = await admin.from("escritorio_config").select("extras").eq("escritorio_id", ESC2).single();
    if (error) throw new Error(error.message);
    extrasOriginais = (data.extras ?? {}) as Record<string, unknown>;
    const h = (await fetch(`${MOCK}/_health`).then((r) => r.json())) as { config: { cliente_nome: string } };
    clienteOriginal = h.config.cliente_nome;
  });
  test.afterAll(limpezaLocal(async () => {
    if (!ESC2) return;
    await admin.from("escritorio_config").update({ extras: extrasOriginais }).eq("escritorio_id", ESC2);
    await admin.from("usuario_gmail_oauth").delete().eq("escritorio_id", ESC2);
    await admin.from("inss_email_log").delete().eq("escritorio_id", ESC2).eq("dry_run", true);
    if (clienteOriginal) await configurarEmail(clienteOriginal);
  }));

  test("a lista é do escritório: salva com travas, auditada, e só por quem gerencia integrações", async () => {
    const { sb } = await sessaoComo(contaDoCanario("admin"), ESC2);
    const sozinho = await sb.rpc("escritorio_definir_inss_procuradores", { p_nomes: ["Fulana"] });
    expect(sozinho.error?.message, "um nome só casaria com cliente").toMatch(/sobrenome/);

    const ok = await sb.rpc("escritorio_definir_inss_procuradores", { p_nomes: [`  ${PROCURADOR} `, PROCURADOR.toUpperCase(), ""] });
    expect(ok.error, ok.error?.message).toBeNull();
    expect(ok.data).toEqual([PROCURADOR]);
    const trilha = await ultimaLinhaDaTrilha(ESC2, "escritorio.inss_procuradores");
    expect(trilha?.detalhes.depois).toEqual([PROCURADOR]);

    const adv = await sessaoComo(contaDoCanario("advogado"), ESC2);
    const negado = await adv.sb.rpc("escritorio_definir_inss_procuradores", { p_nomes: ["Outra Pessoa"] });
    expect(negado.error?.code).toBe("42501");
  });

  test("o processador reconhece o procurador do escritório — e não confunde cliente", async ({ browser }) => {
    // Conecta a caixa do Canário pelo Google simulado (mesmo fluxo da tela).
    const ctx = await browser.newContext({ storageState: { cookies: [], origins: [] } });
    const page = await ctx.newPage();
    await page.goto("/login");
    await page.waitForLoadState("networkidle");
    await page.locator('input[type="email"]').fill(contaDoCanario("admin"));
    await page.locator('input[type="password"]').first().fill(ENV.internoPassword);
    await page.locator('button[type="submit"]').first().click();
    await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 30_000 });
    await page.goto("/configuracoes?tab=integracoes");
    const gm = page.locator("[data-card-gmail]");
    await gm.getByRole("button", { name: /Conectar Gmail/ }).first().click();
    await page.locator("#permitir").click({ timeout: 20_000 });
    // O callback grava a caixa e devolve para o APP_URL das functions (a :8080
    // do dev local), não para a porta da suíte: a prova é a linha no banco.
    await expect
      .poll(async () => (await admin.from("usuario_gmail_oauth").select("escritorio_id").eq("escritorio_id", ESC2)).data?.length ?? 0, { timeout: 20_000 })
      .toBe(1);
    await page.goto("/configuracoes?tab=integracoes");
    await expect(page.locator("[data-card-gmail]")).toContainText(/Conectado como/i, { timeout: 20_000 });
    // O cartão novo mostra a lista salva.
    await expect(page.locator("[data-procuradores-cadastrados]")).toHaveValue(PROCURADOR);
    await ctx.close();

    expect(await classificar(PROCURADOR.toUpperCase())).toBe("cliente_eh_procurador");
    expect(await classificar("BELTRANO DE TAL (PROCURADOR)")).toBe("cliente_eh_procurador");
    expect(await classificar("JOANA REIS CAMARGO")).not.toBe("cliente_eh_procurador");
    // O primeiro nome do procurador sozinho NÃO basta (era o furo do "naira").
    expect(await classificar("FULANA SILVA SANTOS")).not.toBe("cliente_eh_procurador");
  });
});

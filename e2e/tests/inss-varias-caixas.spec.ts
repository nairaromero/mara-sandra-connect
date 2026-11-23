// E2E: várias caixas de e-mail do INSS por escritório (pedido da Naira, 17/11/2026).
//
// O que prova:
//   · quem gerencia integrações conecta mais de uma caixa pelo Google SIMULADO;
//     conectar de novo a mesma caixa só renova o acesso (não vira terceira linha);
//   · o status lista todas, só para quem gerencia integrações, e só as do
//     escritório ativo; desconectar idem (advogado e outro escritório não apagam);
//   · o processador lê TODAS as caixas; caixa com acesso quebrado não impede a
//     leitura das outras;
//   · o mesmo e-mail em duas caixas não é processado duas vezes (Message-ID);
//   · desconectar é pela RPC `gmail_inss_desconectar` (o DELETE direto não
//     apaga nada): quem gerencia integrações desconecta inclusive a caixa que
//     OUTRA pessoa conectou, e conectar e desconectar deixam trilha;
//   · a caixa que a rotina não conseguiu ler aparece com o aviso no card.
//
// Só no banco local, com o mock dos provedores (:8787). Devolve tudo no fim.
import { test, expect, type Page } from "@playwright/test";
import { ENV } from "../env";
import { adminClient } from "../supabase-admin";
import {
  chamadorComo, contaDoCanario, contaPadrao, escritorioCanario, escritorioPadrao, idDoCanario, limpezaLocal, segredoDeSistemaLocal, sessaoComo, ultimaLinhaDaTrilha,
} from "../rbac";

const admin = adminClient();
const MOCK = "http://localhost:8787";
const CAIXA_A = "inss@canario-advocacia.com.br";
const CAIXA_B = "inss.filial@canario-advocacia.com.br";
let ESC2: string;
let ESC1: string;
let emailOriginal = "";
let msgId = "";

async function configurarMock(config: Record<string, unknown>) {
  const r = await fetch(`${MOCK}/_config`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(config) });
  if (!r.ok) throw new Error(`mock /_config: HTTP ${r.status}`);
}
async function caixasNoBanco() {
  const { data, error } = await admin.from("usuario_gmail_oauth").select("id, email_conectado").eq("escritorio_id", ESC2).order("connected_at").order("id");
  if (error) throw new Error(`lendo caixas: ${error.message}`);
  return data ?? [];
}
async function limpar() {
  if (!ESC2) return;
  const e1 = await admin.from("usuario_gmail_oauth").delete().eq("escritorio_id", ESC2);
  if (e1.error) throw new Error(`limpeza das caixas: ${e1.error.message}`);
  const e2 = await admin.from("inss_email_log").delete().eq("escritorio_id", ESC2).or("dry_run.eq.true,gmail_message_id.eq.e2e-outra-caixa");
  if (e2.error) throw new Error(`limpeza do log: ${e2.error.message}`);
  if (emailOriginal) await configurarMock({ gmail_email: emailOriginal });
}
/** Clica no botão de conectar, autoriza no Google simulado e espera a caixa aparecer no banco. */
async function conectar(page: Page, botao: RegExp, esperadas: number) {
  await page.goto("/configuracoes?tab=integracoes&abrir=gmail");
  await page.locator("[data-card-gmail]").getByRole("button", { name: botao }).click();
  await page.locator("#permitir").click({ timeout: 20_000 });
  // O callback devolve para o APP_URL das functions, não para a porta da suíte: a prova é o banco.
  await expect.poll(async () => (await caixasNoBanco()).length, { timeout: 20_000 }).toBe(esperadas);
}

test.describe.serial("várias caixas do INSS por escritório", () => {
  test.beforeAll(async () => {
    test.skip(!ENV.local || !segredoDeSistemaLocal(), "só no banco local");
    const saude = await fetch(`${MOCK}/_health`).then((r) => (r.ok ? r.json() : null)).catch(() => null) as { config: { gmail_email: string; msg_id: string } } | null;
    test.skip(!saude, "mock dos provedores (:8787) fora do ar");
    emailOriginal = saude!.config.gmail_email;
    msgId = saude!.config.msg_id;
    ESC2 = await escritorioCanario();
    ESC1 = await escritorioPadrao();
    await limpar();
  });
  test.afterAll(limpezaLocal(limpar));

  test("o admin conecta duas caixas; reconectar a mesma não cria a terceira; a tela lista as duas", async ({ browser }) => {
    const ctx = await browser.newContext({ storageState: { cookies: [], origins: [] } });
    const page = await ctx.newPage();
    try {
      await page.goto("/login");
      await page.waitForLoadState("networkidle");
      await page.locator('input[type="email"]').fill(contaDoCanario("admin"));
      await page.locator('input[type="password"]').first().fill(ENV.internoPassword);
      await page.locator('button[type="submit"]').first().click();
      await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 30_000 });

      await configurarMock({ gmail_email: CAIXA_A });
      await conectar(page, /Conectar Gmail/, 1);
      await configurarMock({ gmail_email: CAIXA_B });
      await conectar(page, /Conectar outra caixa/, 2);
      // a mesma caixa de novo (com maiúsculas, como o Google às vezes devolve): renova, não duplica
      await configurarMock({ gmail_email: CAIXA_A.toUpperCase() });
      await conectar(page, /Conectar outra caixa/, 2);
      expect((await caixasNoBanco()).map((c) => c.email_conectado).sort()).toEqual([CAIXA_A, CAIXA_B].sort());
      // quem ligou a leitura de qual caixa fica na trilha do escritório
      const conectou = await ultimaLinhaDaTrilha(ESC2, "integracao.caixa_conectada");
      expect(conectou?.detalhes?.caixa, "a última conexão foi a renovação da caixa A").toBe(CAIXA_A);

      await page.goto("/configuracoes?tab=integracoes&abrir=gmail");
      await expect(page.locator("[data-caixa-gmail]")).toHaveCount(2);
      await expect(page.locator(`[data-caixa-gmail="${CAIXA_A}"]`)).toContainText("por você");
      await expect(page.locator(`[data-caixa-gmail="${CAIXA_B}"]`)).toContainText(CAIXA_B);
    } finally {
      await ctx.close();
    }
  });

  test("status e desconexão: só quem gerencia integrações, só do próprio escritório", async () => {
    const duas = await caixasNoBanco();
    test.skip(duas.length !== 2, "depende das duas caixas conectadas");
    const adm = await sessaoComo(contaDoCanario("admin"), ESC2);
    const st = await adm.sb.rpc("gmail_inss_status");
    expect(st.error).toBeNull();
    expect((st.data as Array<{ id: string; email_conectado: string }>).map((c) => c.email_conectado).sort()).toEqual([CAIXA_A, CAIXA_B].sort());
    expect((st.data as Array<{ id: string }>).every((c) => /^[0-9a-f-]{36}$/.test(c.id))).toBe(true);

    // advogado não vê nem apaga — nem pela RPC, nem direto na tabela
    const adv = await sessaoComo(contaDoCanario("advogado"), ESC2);
    expect((await adv.sb.rpc("gmail_inss_status")).error?.code).toBe("42501");
    expect((await adv.sb.rpc("gmail_inss_desconectar", { p_id: duas[0].id })).error?.code).toBe("42501");
    await adv.sb.from("usuario_gmail_oauth").delete().eq("id", duas[0].id);
    // o admin do OUTRO escritório não vê as caixas daqui nem apaga pelo id
    const fora = await sessaoComo(contaPadrao("admin"), ESC1);
    const stFora = await fora.sb.rpc("gmail_inss_status");
    expect(stFora.error).toBeNull();
    expect((stFora.data as Array<{ email_conectado: string }>).some((c) => [CAIXA_A, CAIXA_B].includes(c.email_conectado))).toBe(false);
    // "não encontrado" (P0002): o PostgREST devolve sem o código — vale a recusa e, logo abaixo, o estado
    expect((await fora.sb.rpc("gmail_inss_desconectar", { p_id: duas[0].id })).error, "caixa de outro escritório não se desconecta").toBeTruthy();
    await fora.sb.from("usuario_gmail_oauth").delete().eq("id", duas[0].id);
    // a porta é a RPC: o DELETE direto não apaga nem para o admin do próprio escritório
    await adm.sb.from("usuario_gmail_oauth").delete().eq("id", duas[0].id);
    expect(await caixasNoBanco(), "ninguém apagou por fora da RPC").toHaveLength(2);
  });

  test("o processador lê todas as caixas; o mesmo e-mail em duas caixas não é processado duas vezes; caixa quebrada não derruba as outras", async () => {
    const duas = await caixasNoBanco();
    test.skip(duas.length !== 2, "depende das duas caixas conectadas");
    const chamar = await chamadorComo(contaDoCanario("admin"), ESC2);
    const rodar = async () => {
      const r = await chamar("inss-email-processor", { dias: 7, limite: 5, dry_run: true });
      expect(r.status, r.texto.slice(0, 300)).toBe(200);
      return r.json as { caixas: Array<{ caixa: string; mensagens_listadas: number; error?: string }>; mensagens_listadas: number; resultados: Array<{ pulado_por_dedup: boolean }> };
    };
    const primeira = await rodar();
    expect(primeira.caixas.map((c) => [c.caixa, c.mensagens_listadas, c.error ?? null]).sort()).toEqual([[CAIXA_A, 1, null], [CAIXA_B, 1, null]].sort());
    expect(primeira.mensagens_listadas).toBe(2);
    expect(primeira.resultados.map((r) => r.pulado_por_dedup), "em simulação nada foi processado de verdade ainda").toEqual([false, false]);

    // este e-mail JÁ foi processado de verdade pela outra caixa (outro id de Gmail, mesmo Message-ID)
    const semente = await admin.from("inss_email_log").insert({
      escritorio_id: ESC2, gmail_message_id: "e2e-outra-caixa", rfc_message_id: `<inss-${msgId}@mock.inss.gov.br>`, caixa: CAIXA_A,
      assunto: "E2E", dry_run: false, pulado_por_dedup: false, qtd_tarefas: 0, tarefas_criadas: [],
    });
    expect(semente.error, semente.error?.message).toBeNull();
    const segunda = await rodar();
    expect(segunda.resultados.map((r) => r.pulado_por_dedup), "o Message-ID barra o e-mail repetido nas duas caixas").toEqual([true, true]);

    // acesso de uma caixa quebrado (credencial ilegível): a outra é lida e a resposta diz qual falhou
    const quebrada = duas.find((c) => c.email_conectado === CAIXA_B)!;
    const estrago = await admin.from("usuario_gmail_oauth").update({ refresh_cipher: "AAAA", refresh_iv: "AAAA" }).eq("id", quebrada.id);
    expect(estrago.error).toBeNull();
    const terceira = await rodar();
    const porCaixa = Object.fromEntries(terceira.caixas.map((c) => [c.caixa, c]));
    expect(porCaixa[CAIXA_A].mensagens_listadas).toBe(1);
    expect(porCaixa[CAIXA_A].error).toBeUndefined();
    expect(porCaixa[CAIXA_B].error, "a caixa quebrada aparece com o erro").toBeTruthy();
  });

  test("o admin desconecta pela tela a caixa que OUTRA pessoa conectou; a outra fica, com o aviso da leitura que falhou", async ({ browser }) => {
    const duas = await caixasNoBanco();
    test.skip(duas.length !== 2, "depende das duas caixas conectadas");
    // A caixa B passa a ser "de outra pessoa" (era o caso que apagava zero linhas e dizia "desconectada"),
    // e a caixa A fica com a marca que a rotina grava quando o Google recusa o acesso.
    const outraPessoa = await idDoCanario("advogado");
    const troca = await admin.from("usuario_gmail_oauth").update({ usuario_id: outraPessoa }).eq("id", duas.find((c) => c.email_conectado === CAIXA_B)!.id);
    expect(troca.error, troca.error?.message).toBeNull();
    const marca = await admin.from("usuario_gmail_oauth")
      .update({ ultimo_erro: "O Google recusou o acesso desta caixa (revogado ou expirado). Conecte a caixa de novo.", ultimo_erro_em: new Date().toISOString() })
      .eq("id", duas.find((c) => c.email_conectado === CAIXA_A)!.id);
    expect(marca.error, marca.error?.message).toBeNull();
    const ctx = await browser.newContext({ storageState: { cookies: [], origins: [] } });
    const page = await ctx.newPage();
    try {
      await page.goto("/login");
      await page.waitForLoadState("networkidle");
      await page.locator('input[type="email"]').fill(contaDoCanario("admin"));
      await page.locator('input[type="password"]').first().fill(ENV.internoPassword);
      await page.locator('button[type="submit"]').first().click();
      await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 30_000 });
      await page.goto("/configuracoes?tab=integracoes&abrir=gmail");
      await expect(page.locator(`[data-caixa-gmail="${CAIXA_B}"]`)).not.toContainText("por você");
      await expect(page.locator(`[data-caixa-gmail="${CAIXA_A}"] [data-caixa-gmail-erro]`)).toContainText("Conecte a caixa de novo");
      await expect(page.locator(`[data-caixa-gmail="${CAIXA_B}"] [data-caixa-gmail-erro]`)).toHaveCount(0);
      page.once("dialog", (d) => void d.accept());
      await page.locator(`[data-caixa-gmail="${CAIXA_B}"]`).getByRole("button", { name: "Desconectar" }).click();
      await expect(page.locator("[data-caixa-gmail]")).toHaveCount(1);
      expect((await caixasNoBanco()).map((c) => c.email_conectado)).toEqual([CAIXA_A]);
      const desconectou = await ultimaLinhaDaTrilha(ESC2, "integracao.caixa_desconectada");
      expect([desconectou?.detalhes?.caixa, desconectou?.detalhes?.conectada_por]).toEqual([CAIXA_B, outraPessoa]);
    } finally {
      await ctx.close();
    }
  });
});

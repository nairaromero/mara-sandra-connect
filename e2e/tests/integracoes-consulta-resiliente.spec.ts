// #544: a página só mostra "Gerar contrato" / "Enviar para assinatura" depois
// de saber que o escritório tem o ZapSign (RPC minhas_integracoes). Uma falha
// passageira ou uma resposta presa escondia os botões até recarregar a página,
// sem aviso. Agora: tempo limite de 10 s, duas novas tentativas (2 s e 5 s) e,
// se ainda falhar, aviso com "Tentar de novo".
// Só lê (a falha é simulada no navegador): roda no local e no staging.
import { test, expect, type Page } from "@playwright/test";
import { STORAGE_ADMIN } from "../auth.setup";
import { adminClient } from "../supabase-admin";
import { ENV } from "../env";

test.use({ storageState: STORAGE_ADMIN });

let casoId = "";
test.beforeAll(async () => {
  const admin = adminClient();
  const { data: usuario, error: eU } = await admin.from("usuarios").select("id").eq("email", ENV.adminEmail ?? "e2e+admin@marasandraconnect.com").single();
  if (eU) throw new Error(`conta de admin: ${eU.message}`);
  const { data: vinculos } = await admin.from("membros").select("escritorio_id").eq("usuario_id", usuario.id);
  const { data: zap, error: eZ } = await admin.from("escritorio_integracoes").select("escritorio_id").eq("tipo", "zapsign").eq("ativo", true)
    .in("escritorio_id", (vinculos ?? []).map((v) => v.escritorio_id));
  if (eZ) throw new Error(`integrações: ${eZ.message}`);
  test.skip(!zap?.length, "nenhum escritório do admin com o ZapSign ligado");
  const { data: caso } = await admin.from("casos").select("id").eq("escritorio_id", zap![0].escritorio_id).order("created_at", { ascending: false }).limit(1).single();
  casoId = caso!.id;
});

/** Simula a consulta das integrações: `respostas[n]` decide o n-ésimo pedido; acabou a lista, passa normal. */
async function simular(page: Page, respostas: Array<"erro" | "presa">) {
  const pedidos: number[] = [];
  const t0 = Date.now();
  await page.route(/\/rest\/v1\/rpc\/minhas_integracoes/, async (r) => {
    const n = pedidos.push(Date.now() - t0) - 1;
    const modo = respostas[n];
    if (modo === "erro") return r.fulfill({ status: 503, contentType: "application/json", body: '{"message":"indisponível (simulado)"}' });
    if (modo === "presa") return; // nunca responde: só o tempo limite do sistema solta
    return r.continue();
  });
  return pedidos;
}

const abrirCaso = (page: Page) => page.goto(`/casos/${casoId}?tab=documentos`);

test("falha passageira: o sistema tenta de novo sozinho e o botão aparece, sem aviso", async ({ page }) => {
  const pedidos = await simular(page, ["erro"]);
  await abrirCaso(page);
  await expect(page.locator("[data-gerar-contrato]")).toBeVisible({ timeout: 15_000 });
  await expect(page.locator("[data-integracoes-erro]")).toHaveCount(0);
  expect(pedidos.length).toBe(2);
});

test("consulta presa: passa do tempo limite, tenta de novo e o botão aparece", async ({ page }) => {
  const pedidos = await simular(page, ["presa"]);
  await abrirCaso(page);
  await expect(page.locator("[data-gerar-contrato]")).toBeVisible({ timeout: 25_000 });
  expect(pedidos.length).toBe(2);
  expect(pedidos[1] - pedidos[0], "a 2ª tentativa vem depois do tempo limite (10 s) + a espera (2 s)").toBeGreaterThanOrEqual(11_500);
});

test("falha que não passa: aviso na tela e 'Tentar de novo' traz o botão", async ({ page }) => {
  const pedidos = await simular(page, ["erro", "erro", "erro"]);
  await abrirCaso(page);
  const aviso = page.locator("[data-integracoes-erro]");
  await expect(aviso).toBeVisible({ timeout: 15_000 });
  await expect(aviso).toContainText("Não consegui verificar as integrações do escritório.");
  await expect(page.locator("[data-gerar-contrato]")).toHaveCount(0);
  expect(pedidos.length, "a primeira e as duas novas tentativas").toBe(3);
  await page.locator("[data-integracoes-tentar]").click();
  await expect(page.locator("[data-gerar-contrato]")).toBeVisible({ timeout: 10_000 });
  await expect(aviso).toHaveCount(0);
});

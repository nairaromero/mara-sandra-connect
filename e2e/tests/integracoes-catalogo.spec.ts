// E2E: catálogo de integrações (Configurações → Integrações).
//
// O que prova:
//   · a aba abre como uma lista (grupos e linhas), sem nenhum formulário aberto;
//   · "Integrar"/"Configurar" abre a configuração NA linha, uma por vez, e o
//     endereço guarda qual está aberta (?abrir=legalmail) — link direto funciona;
//   · "Abrir todas" mostra tudo (é o endereço que as outras specs usam);
//   · o grupo recolhe e esconde as linhas dele;
//   · o estado da linha é o DO ESCRITÓRIO ativo e muda quando a credencial é
//     salva ali mesmo, sem recarregar a página.
//
// Só no banco local com o seed (`bun run local:rbac`).
import { test, expect, type Browser, type BrowserContext } from "@playwright/test";
import type { Session } from "@supabase/supabase-js";
import { ENV, PROJECT_REF } from "../env";
import { adminClient } from "../supabase-admin";
import { cursorVisivel } from "../cursor";
import { contaDoCanario, escritorioCanario, limpezaLocal, sessaoComo } from "../rbac";

const admin = adminClient();
let ESC2: string;

async function limpar() {
  if (!ESC2) return;
  const { error } = await admin.from("escritorio_integracoes").delete().eq("escritorio_id", ESC2).eq("tipo", "ti");
  if (error) throw new Error(`limpeza de escritorio_integracoes: ${error.message}`);
}
async function contexto(browser: Browser, baseURL: string, session: Session, escritorioId: string): Promise<BrowserContext> {
  return browser.newContext({
    storageState: {
      cookies: [],
      origins: [{ origin: new URL(baseURL).origin, localStorage: [
        { name: `sb-${PROJECT_REF}-auth-token`, value: JSON.stringify(session) },
        { name: "msc:escritorio_ativo", value: escritorioId },
      ] }],
    },
  });
}

test.describe("Integrações: catálogo por escritório", () => {
  test.beforeAll(async () => {
    test.skip(!ENV.local, "só no banco local");
    ESC2 = await escritorioCanario();
    await limpar();
  });
  test.afterAll(limpezaLocal(limpar));

  test("lista em grupos, configuração na linha, endereço próprio e estado do escritório", async ({ browser, baseURL }) => {
    const { session } = await sessaoComo(contaDoCanario("admin"));
    const ctx = await contexto(browser, baseURL!, session, ESC2);
    const page = await ctx.newPage();
    await cursorVisivel(page);
    const linha = (id: string) => page.locator(`[data-integracao-linha="${id}"]`);
    const cards = page.locator("[data-catalogo-integracoes] [data-card-integracao]");
    try {
      await page.goto("/configuracoes?tab=integracoes");
      await expect(page.locator("[data-catalogo-integracoes]")).toContainText("Canário");
      await expect(page.locator("[data-integracoes-grupo]")).toHaveCount(4);
      await expect(page.locator("[data-integracao-linha]")).toHaveCount(7);
      await expect(cards, "nada aberto ao chegar").toHaveCount(0);

      // sem credencial neste escritório: "Não configurada" e o botão convida a integrar
      await expect(linha("ti").locator("[data-integracao-linha-estado]")).toHaveAttribute("data-integracao-linha-estado", "nao_configurada");
      await linha("ti").getByRole("button", { name: "Integrar" }).click();
      await expect(page).toHaveURL(/tab=integracoes&abrir=ti$/);
      await expect(page.locator('[data-card-integracao="ti"]')).toBeVisible();
      await expect(cards).toHaveCount(1);

      // salvar ali mesmo muda o estado da linha, sem recarregar
      await page.locator("#ti-segredo").fill("token-de-teste-do-catalogo");
      await page.locator('[data-card-integracao="ti"]').getByRole("button", { name: "Salvar" }).click();
      await expect(linha("ti").locator("[data-integracao-linha-estado]")).toHaveAttribute("data-integracao-linha-estado", "ativa");
      await expect(linha("ti").getByRole("button", { name: "Fechar" })).toHaveAttribute("aria-expanded", "true");

      // abrir outra fecha a primeira (uma por vez)
      await linha("legalmail").locator("[data-integracao-abrir]").click();
      await expect(page).toHaveURL(/abrir=legalmail$/);
      await expect(page.locator('[data-card-integracao="legalmail"]')).toBeVisible();
      await expect(page.locator('[data-card-integracao="ti"]')).toHaveCount(0);

      // o endereço abre direto na integração (link que se manda para alguém)
      await page.goto("/configuracoes?tab=integracoes&abrir=ti");
      await expect(page.locator('[data-card-integracao="ti"]')).toBeVisible();
      await expect(page.locator('[data-card-integracao="ti"] [data-integracao-estado]')).toHaveText("ativo");

      // fechar volta à lista; "Abrir todas" mostra tudo
      await linha("ti").getByRole("button", { name: "Fechar" }).click();
      await expect(page).toHaveURL(/tab=integracoes$/);
      await expect(cards).toHaveCount(0);
      await page.locator("[data-integracoes-todas]").click();
      await expect(page).toHaveURL(/abrir=todas$/);
      await expect(page.locator('[data-card-integracao="legalmail"]')).toBeVisible();
      await expect(page.locator('[data-card-integracao="zapsign"]')).toBeVisible();
      await page.locator("[data-integracoes-todas]").click();
      await expect(cards).toHaveCount(0);

      // recolher o grupo esconde as linhas dele; os outros ficam
      await page.locator('[data-integracoes-grupo="processos"]').getByRole("button", { name: /Processos e andamentos/ }).click();
      await expect(linha("legalmail")).toHaveCount(0);
      await expect(linha("zapsign")).toBeVisible();

      // quem não gerencia integrações não chega aqui: cai em Perfil
      const adv = await sessaoComo(contaDoCanario("advogado"));
      const ctxAdv = await contexto(browser, baseURL!, adv.session, ESC2);
      const pAdv = await ctxAdv.newPage();
      try {
        await pAdv.goto("/configuracoes?tab=integracoes&abrir=zapsign");
        await expect(pAdv.locator("[data-catalogo-integracoes]")).toHaveCount(0);
      } finally {
        await ctxAdv.close();
      }
    } finally {
      await ctx.close();
    }
  });
});

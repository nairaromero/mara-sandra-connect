// E2E: em /equipe, TODA pessoa mostra o papel na etiqueta — inclusive advogado.
//
// Por que esta spec existe (achado da Naira, 28/09, olhando a lista em
// produção): a etiqueta escondia o papel `advogado`
// (`!u.eh_admin && u.papel !== "advogado"`). Era herança de antes do RBAC,
// quando interno ERA advogado por padrão e a etiqueta servia só para marcar a
// exceção — financeiro, assistente.
//
// Com o RBAC, advogado é um papel entre quatro, e esconder a etiqueta fazia
// "é advogado" parecer "está sem papel": na lista, a pessoa aparecia só com
// "ativo", ao lado de colegas marcados "financeiro" e "assistente". Foi
// exatamente essa leitura que levou a suspeitar de um papel faltando no menu.
//
// Só no banco local/staging com o seed do Canário (`bun run local:rbac`).
import { test, expect, type Browser } from "@playwright/test";
import { PROJECT_REF } from "../env";
import { adminClient } from "../supabase-admin";
import { sessaoComo } from "../rbac";
import { cursorVisivel } from "../cursor";

const admin = adminClient();
const DOM = "marasandraconnect.com";
let ESC2: string;

/** A linha de uma pessoa na lista de internos. */
const linhaDe = (page: import("@playwright/test").Page, nome: string) =>
  page.locator("li").filter({ hasText: nome }).first();

async function abrirEquipe(browser: Browser, baseURL: string) {
  const { session } = await sessaoComo(`canario+admin@${DOM}`);
  const ctx = await browser.newContext({
    storageState: {
      cookies: [],
      origins: [{
        origin: new URL(baseURL).origin,
        localStorage: [
          { name: `sb-${PROJECT_REF}-auth-token`, value: JSON.stringify(session) },
          { name: "msc:escritorio_ativo", value: ESC2 },
        ],
      }],
    },
  });
  const page = await ctx.newPage();
  await cursorVisivel(page);
  await page.goto("/equipe");
  await page.getByText("Elisa").first().waitFor({ timeout: 30000 });
  return { ctx, page };
}

test.describe("equipe: a etiqueta mostra o papel de todo mundo", () => {
  test.beforeAll(async () => {
    const { data: esc, error } = await admin.from("escritorios").select("id").eq("slug", "canario").maybeSingle();
    test.skip(!!error || !esc, "escritório Canário ausente — rode `bun run local:rbac`");
    ESC2 = esc!.id as string;
  });

  test("advogado aparece com etiqueta, como assistente e financeiro", async ({ browser, baseURL }) => {
    const { ctx, page } = await abrirEquipe(browser, baseURL!);
    try {
      // é ESTA a asserção que falha com o código antigo
      await expect(
        linhaDe(page, "Diego").getByText("advogado", { exact: true }),
        "quem é advogado precisa dizer que é advogado",
      ).toBeVisible();

      // e os vizinhos seguem como sempre
      await expect(linhaDe(page, "Elisa").getByText("assistente", { exact: true })).toBeVisible();
      await expect(linhaDe(page, "Fábio").getByText("financeiro", { exact: true })).toBeVisible();
    } finally {
      await ctx.close();
    }
  });

  test("admin mostra só a etiqueta de admin, sem repetir o papel", async ({ browser, baseURL }) => {
    const { ctx, page } = await abrirEquipe(browser, baseURL!);
    try {
      const carla = linhaDe(page, "Carla");
      await expect(carla.getByText("admin", { exact: true })).toBeVisible();
      await expect(
        carla.getByText("administrador", { exact: true }),
        "a etiqueta dourada já diz; não repete o papel",
      ).toHaveCount(0);
    } finally {
      await ctx.close();
    }
  });

  test("ninguém fica sem etiqueta de papel", async ({ browser, baseURL }) => {
    const { ctx, page } = await abrirEquipe(browser, baseURL!);
    try {
      const { data: membros, error } = await admin
        .from("membros")
        .select("papel:papeis!inner(chave), usuario:usuarios!membros_usuario_id_fkey(nome)")
        .eq("escritorio_id", ESC2)
        .eq("status", "ativo");
      if (error) throw new Error(`membros: ${error.message}`);

      const internos = (membros ?? []).filter(
        (m) => (m.papel as { chave?: string } | null)?.chave !== "parceiro",
      );
      expect(internos.length, "o seed precisa ter internos").toBeGreaterThan(2);

      for (const m of internos) {
        const chave = (m.papel as { chave?: string }).chave!;
        const nome = ((m.usuario as { nome?: string }).nome ?? "").split(" ")[0];
        const esperado = chave === "admin" ? "admin" : chave;
        await expect(
          linhaDe(page, nome).getByText(esperado, { exact: true }),
          `${nome} (${chave}) precisa mostrar a etiqueta`,
        ).toBeVisible();
      }
    } finally {
      await ctx.close();
    }
  });
});

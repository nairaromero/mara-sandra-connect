// E2E: glossário com busca (/glossario e /qg/glossario).
//
// O que pode quebrar sem ninguém notar: a busca deixar de achar por sinônimo
// ou por permissão; a matriz de um papel vir vazia porque o embed
// papeis -> papel_permissoes -> permissoes mudou; termo técnico vazar para o
// parceiro; o link "veja também" apontar para termo que a pessoa não vê.
//
// A parte de permissões só é conferida onde as migrations do RBAC existem
// (banco local com `bun run local:rbac`); sem elas o card mostra o erro, e o
// teste confere que NÃO fingiu "nenhuma permissão".

import { test, expect, type Page } from "@playwright/test";
import { STORAGE_ADMIN, STORAGE_PARCEIRO } from "../auth.setup";
import { cursorVisivel } from "../cursor";
import { adminClient } from "../supabase-admin";

const admin = adminClient();

async function temRbac(): Promise<boolean> {
  const { error } = await admin.from("papeis").select("chave").limit(1);
  return !error;
}

async function buscar(page: Page, texto: string) {
  const campo = page.getByRole("textbox", { name: "Buscar no glossário" });
  await campo.fill(texto);
  // a busca vai para a URL (?q=), que é o que permite mandar link de um termo
  await expect.poll(() => new URL(page.url()).searchParams.get("q")).toBe(texto);
}

test.describe("glossário — equipe (admin)", () => {
  test.use({ storageState: STORAGE_ADMIN });

  test("abre pela sidebar, busca por papel e mostra as permissões lidas do banco", async ({ page }) => {
    await page.goto("/tarefas");
    await cursorVisivel(page);
    await page.getByRole("link", { name: "Glossário" }).first().click();
    await expect(page).toHaveURL(/\/glossario$/);
    await expect(page.getByRole("heading", { name: "Glossário", level: 1 })).toBeVisible();

    // sem busca: as categorias aparecem, inclusive a técnica (é interno)
    await expect(page.getByRole("heading", { name: "Papéis e acessos" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Ambientes e técnica" })).toBeVisible();

    await buscar(page, "assistente");
    const card = page.locator("article#assistente");
    await expect(card).toBeVisible();
    await expect(card.getByRole("heading", { name: "Assistente", level: 3 })).toBeVisible();
    // categorias sem resultado somem
    await expect(page.getByRole("heading", { name: "Ambientes e técnica" })).toHaveCount(0);

    if (await temRbac()) {
      const perms = card.locator("[data-permissoes-de=assistente]");
      await expect(perms).toBeVisible();
      // o que a matriz de §4.3 dá ao assistente, com o escopo certo
      await expect(perms.getByText("Criar, editar e concluir tarefas")).toBeVisible();
      await expect(perms.getByText("só o que está atribuído a mim").first()).toBeVisible();
      await expect(perms.getByText("acesso interno")).toBeVisible();
      // e o que NÃO dá
      await expect(perms.getByText("Ver repasses")).toHaveCount(0);
      await expect(perms.getByText("Convidar, definir papel, desligar e reativar pessoas")).toHaveCount(0);
    } else {
      // banco sem RBAC: erro na cara, não "nenhuma permissão"
      await expect(card.getByText("Não consegui carregar as permissões")).toBeVisible();
      await expect(card.getByText("Nenhuma permissão.")).toHaveCount(0);
    }
  });

  test("acha por permissão e por sinônimo; link de termo e 'veja também' funcionam", async ({ page }) => {
    await page.goto("/glossario?q=repasse");
    await cursorVisivel(page);
    await expect(page.locator("article#repasse")).toBeVisible();
    await expect(page.getByRole("textbox", { name: "Buscar no glossário" })).toHaveValue("repasse");

    // sinônimo: "captador" é o Parceiro
    await buscar(page, "captador");
    await expect(page.locator("article#parceiro")).toBeVisible();

    if (await temRbac()) {
      // permissão: "trilha de auditoria" só está na descrição da permissão auditoria:ler
      await buscar(page, "trilha de auditoria");
      await expect(page.locator("article#admin")).toBeVisible();
      await expect(page.locator("article#advogado")).toHaveCount(0);
    }

    // nada encontrado: aviso, sem categoria vazia
    await buscar(page, "xyzzy-nao-existe");
    await expect(page.getByText("Nenhum termo com")).toBeVisible();
    await expect(page.locator("article")).toHaveCount(0);

    // "veja também" limpa a busca e leva ao termo
    await buscar(page, "percentual");
    const percentual = page.locator("article#percentual-parceiro");
    await expect(percentual).toBeVisible();
    await percentual.getByRole("button", { name: "Repasse" }).click();
    await expect(page.getByRole("textbox", { name: "Buscar no glossário" })).toHaveValue("");
    await expect(page.locator("article#repasse")).toBeInViewport();
  });
});

test.describe("glossário — parceiro", () => {
  test.use({ storageState: STORAGE_PARCEIRO });

  test("vê o glossário sem os termos técnicos nem os de equipe", async ({ page }) => {
    await page.goto("/glossario");
    await cursorVisivel(page);
    await expect(page.getByRole("heading", { name: "Glossário", level: 1 })).toBeVisible();
    await expect(page.locator("article#parceiro")).toBeVisible();
    await expect(page.locator("article#repasse")).toBeVisible();
    // interno-only e técnico não aparecem
    await expect(page.getByRole("heading", { name: "Ambientes e técnica" })).toHaveCount(0);
    await expect(page.locator("article#token-mcp")).toHaveCount(0);
    await expect(page.locator("article#equipe")).toHaveCount(0);
    // e o "veja também" do Administrador não oferece o que o parceiro não vê
    await buscar(page, "administrador");
    const adminCard = page.locator("article#admin");
    await expect(adminCard).toBeVisible();
    await expect(adminCard.getByRole("button", { name: "Equipe" })).toHaveCount(0);
    await expect(adminCard.getByRole("button", { name: "Acesso de suporte" })).toBeVisible();
  });
});

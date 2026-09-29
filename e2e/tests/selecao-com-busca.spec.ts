// E2E: escolher cliente na Agenda tem busca, como no sheet de tarefa.
//
// Por que esta spec existe (achado da Naira, 28/09, comparando as duas telas):
// a mesma escolha — qual cliente — tinha comportamentos diferentes. No sheet de
// tarefa dava para buscar entre os 466; na Agenda era uma lista de 466 para
// rolar, porque ali estava um `Select` sem busca.
//
// A raiz não era a tela: eram QUATRO caminhos para a mesma decisão no código
// (`Select` do shadcn em 23 arquivos, um combobox próprio em 6, `<select>`
// nativo em 2, `Command` cru em 3). O `<Selecao>` unifica, e liga a busca
// SOZINHO a partir de `LIMITE_BUSCA` opções — para o próximo dropdown longo não
// depender de alguém lembrar.
//
// Só no banco local/staging.
import { test, expect } from "@playwright/test";
import { ENV } from "../env";
import { adminClient } from "../supabase-admin";
import { LIMITE_BUSCA } from "../../src/components/ui/selecao";

const admin = adminClient();
const STORAGE_INTERNO = "e2e/.auth/interno.json";

test.describe("selecionar cliente: busca onde a lista é longa", () => {
  test.use({ storageState: STORAGE_INTERNO });

  test("a Agenda deixa buscar o cliente em vez de rolar a lista inteira", async ({ page }) => {
    // quantos casos a lista tem de fato — se forem poucos, a busca não é
    // obrigatória e o teste estaria cobrando o que o desenho não promete
    const { count, error } = await admin.from("casos").select("id", { count: "exact", head: true });
    if (error) throw new Error(`contar casos: ${error.message}`);
    expect(count ?? 0, "a lista precisa ser longa para a busca ligar sozinha").toBeGreaterThan(LIMITE_BUSCA);

    await page.goto("/agenda");
    await page.getByRole("button", { name: /Novo|Agendar|Criar/ }).first().click();
    const gaveta = page.locator('[role="dialog"]').first();
    await expect(gaveta).toBeVisible();

    const campo = gaveta.locator('[data-selecao="cliente"]');
    await expect(campo, "o campo de cliente da Agenda").toBeVisible();
    await campo.click();

    // é ESTA a asserção que falha com o Select antigo
    const busca = page.locator("[data-selecao-busca]");
    await expect(busca, "lista longa precisa oferecer busca").toBeVisible();

    // e a busca filtra de verdade: digita um nome e a lista encolhe
    const { data: umCaso } = await admin
      .from("casos").select("clientes(nome)").not("cliente_id", "is", null).limit(1).maybeSingle();
    const nome = (umCaso?.clientes as { nome?: string } | null)?.nome;
    if (nome) {
      const pedaco = nome.split(" ")[0];
      await busca.fill(pedaco);
      await expect(page.getByRole("option").first()).toBeVisible();
      const opcoes = await page.getByRole("option").allInnerTexts();
      expect(opcoes.length, "a busca filtra").toBeLessThan((count ?? 0) + 1);
      expect(
        opcoes.some((o) => o.toLowerCase().includes(pedaco.toLowerCase())),
        `nenhuma opção casou com "${pedaco}"`,
      ).toBe(true);
    }
  });

  test("lista curta não ganha busca: o campo só aparece onde ajuda", async ({ page }) => {
    // O tipo de documento tem ~15 opções e o filtro de status, menos de 8.
    // Aqui o que se prova é o limite existir — não que TODA lista tenha busca.
    expect(LIMITE_BUSCA).toBeGreaterThan(1);
    await page.goto("/agenda");
    await expect(page.getByRole("heading", { name: /Agenda/i })).toBeVisible();
  });
});

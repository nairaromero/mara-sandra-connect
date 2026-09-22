// E2E: listas que carregavam com `.limit(n)` fixo — e o PostgREST corta em
// 1.000 linhas SEM avisar — passaram a paginar até o fim (/processos) ou a
// carregar POR_PAGINA por vez com "Mostrar mais" (publicações, conversas).
//
// /processos: cria 1.100 processos judiciais num caso sem parceiro (assim o
// gatilho de webhook não enfileira nada) e confere que a tela conta TODOS —
// antes, mostraria 1.000 e ninguém saberia. Limpa no fim, mesmo se falhar.
// Publicações e conversas usam o que a cópia do staging já tem (> 200 linhas).

import { test, expect } from "@playwright/test";
import { STORAGE_ADMIN } from "../auth.setup";
import { cursorVisivel } from "../cursor";
import { ENV } from "../env";
import { adminClient, escritorioE2E } from "../supabase-admin";

const admin = adminClient();
const MARCA = "E2E-PAG-";
const QTD = 1100;

async function limpar() {
  const { error } = await admin.from("processos_judiciais").delete().like("numero_processo", `${MARCA}%`);
  if (error) throw new Error(`limpeza de processos_judiciais falhou: ${error.message}`);
}

test.describe("listas sem corte silencioso", () => {
  test.use({ storageState: STORAGE_ADMIN });

  test("/processos conta mais de 1.000 processos", async ({ page }) => {
    test.skip(!ENV.local, "cria 1.100 linhas: só no banco local");
    test.setTimeout(120_000); // 1.100 inserts + a tela carregar tudo
    const esc = await escritorioE2E(admin);
    test.skip(!esc, "sem escritório padrão (migrations do RBAC ausentes)");
    const { data: caso, error } = await admin
      .from("casos")
      .select("id")
      .eq("escritorio_id", esc!)
      .is("parceiro_id", null)
      .limit(1)
      .maybeSingle();
    if (error) throw new Error(error.message);
    test.skip(!caso, "sem caso sem parceiro no escritório padrão");

    const { count: antes, error: eAntes } = await admin
      .from("processos_judiciais")
      .select("id", { count: "exact", head: true })
      .eq("escritorio_id", esc!);
    if (eAntes) throw new Error(eAntes.message);

    await limpar();
    try {
      const linhas = Array.from({ length: QTD }, (_, i) => ({
        caso_id: caso!.id,
        numero_processo: `${MARCA}${String(i).padStart(5, "0")}`,
        uf: "SP",
      }));
      for (let i = 0; i < linhas.length; i += 500) {
        const { error: eIns } = await admin.from("processos_judiciais").insert(linhas.slice(i, i + 500));
        if (eIns) throw new Error(`insert: ${eIns.message}`);
      }
      const esperado = (antes ?? 0) + QTD;

      await page.goto("/processos");
      await cursorVisivel(page);
      // o badge "N judiciais" tem que bater com processos_judiciais do
      // escritório — antes, travava em 1.000 sem aviso
      const badge = page.getByText(/^\d+ judiciais$/);
      await expect(badge).toBeVisible({ timeout: 60000 });
      await expect(badge).toHaveText(`${esperado} judiciais`);
    } finally {
      await limpar();
    }
  });

  test("/publicacoes carrega 200 por vez e 'Mostrar mais' traz as antigas", async ({ page }) => {
    const { count, error } = await admin.from("publicacoes_dje").select("id", { count: "exact", head: true });
    if (error) throw new Error(error.message);
    test.skip((count ?? 0) <= 200, "precisa de mais de 200 publicações no banco");
    await page.goto("/publicacoes");
    await cursorVisivel(page);
    const contagem = page.locator("[data-contagem]").first();
    await expect(contagem).toHaveText(/^mostrando 200 publicações$/);
    await page.getByRole("button", { name: "Mostrar mais 200" }).click();
    await expect(contagem).toHaveText(new RegExp(`^mostrando ${Math.min(400, count!)} publicações$`));
    if (count! <= 400) await expect(page.getByRole("button", { name: "Mostrar mais 200" })).toHaveCount(0);
  });

  test("/conversas carrega 200 comentários por vez", async ({ page }) => {
    const { count, error } = await admin.from("comentarios").select("id", { count: "exact", head: true }).eq("rascunho", false);
    if (error) throw new Error(error.message);
    test.skip((count ?? 0) <= 200, "precisa de mais de 200 comentários no banco");
    await page.goto("/conversas");
    await cursorVisivel(page);
    const contagem = page.locator("[data-contagem]").first();
    await expect(contagem).toHaveText(/^mostrando 200 comentários$/);
    await page.getByRole("button", { name: "Mostrar mais 200" }).click();
    await expect(contagem).toHaveText(new RegExp(`^mostrando ${Math.min(400, count!)} comentários$`));
  });
});

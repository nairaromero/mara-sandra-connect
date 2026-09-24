// E2E: QG com busca e paginação (migration_rbac_06).
//
// `qg_escritorios` e `qg_membros` passaram a devolver uma página (10 por
// padrão) com `total`, busca sem acento e filtro de status. O que este teste
// segura: página respeita limite/offset; total é o do recorte, não da página;
// busca acha por nome sem acento e por e-mail; quem não é staff continua
// recusado; e na tela o paginador (1–10 de N, próxima/última, itens por
// página) troca de página no banco e o contador acompanha.
//
// Só roda no banco LOCAL com as migrations do RBAC e o seed (`bun run local:rbac`).

import { test, expect, type Browser } from "@playwright/test";
import { createClient, type Session, type SupabaseClient } from "@supabase/supabase-js";
import { ENV, PROJECT_REF } from "../env";
import { adminClient } from "../supabase-admin";
import { cursorVisivel } from "../cursor";

const admin = adminClient();
const DOM = "marasandraconnect.com";

async function como(email: string): Promise<{ sb: SupabaseClient; session: Session }> {
  const sb = createClient(ENV.supabaseUrl, ENV.anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await sb.auth.signInWithPassword({ email, password: ENV.internoPassword });
  if (error || !data.session) throw new Error(`login ${email}: ${error?.message}`);
  return { sb, session: data.session };
}

/** Sessão do QG no host qg.localhost (origem própria: o localStorage é por origem). */
async function contextoQG(browser: Browser, baseURL: string, session: Session) {
  const u = new URL(baseURL);
  const origem = `${u.protocol}//qg.${u.host}`;
  const ctx = await browser.newContext({
    storageState: {
      cookies: [],
      origins: [{ origin: origem, localStorage: [{ name: `sb-${PROJECT_REF}-auth-token`, value: JSON.stringify(session) }] }],
    },
  });
  return { ctx, origem };
}

let ESC1: string;
let ESC2: string;

test.describe("QG paginado", () => {
  test.beforeAll(async () => {
    test.skip(!ENV.local, "só no banco local");
    const { data: escs, error } = await admin.from("escritorios").select("id, slug, padrao_sistema");
    test.skip(!!error, "migrations do RBAC não aplicadas — rode `bun run local:rbac`");
    ESC1 = escs!.find((e) => e.padrao_sistema)!.id;
    const canario = escs!.find((e) => e.slug === "canario");
    test.skip(!canario, "escritório canário ausente — rode `bun run local:rbac`");
    ESC2 = canario!.id;
  });

  test("API: página, total, busca sem acento e filtro; não-staff recusado", async () => {
    const { sb: dono } = await como(`qg+dono@${DOM}`);

    // escritórios: limite 1 devolve 1 linha, mas o total é o do recorte
    const um = await dono.rpc("qg_escritorios", { p_limite: 1 });
    expect(um.error).toBeNull();
    expect(um.data).toHaveLength(1);
    expect(um.data![0].total).toBeGreaterThanOrEqual(2);
    expect(um.data![0].padrao_sistema, "o padrão do sistema vem primeiro").toBe(true);

    // busca sem acento e por slug
    const busca = await dono.rpc("qg_escritorios", { p_busca: "CANÁR" });
    expect(busca.error).toBeNull();
    expect(busca.data!.map((e: { slug: string }) => e.slug)).toEqual(["canario"]);
    expect(busca.data![0].total).toBe(1);

    // filtro de status que não bate -> vazio, sem erro
    const nada = await dono.rpc("qg_escritorios", { p_status: "encerrado", p_busca: "canario" });
    expect(nada.error).toBeNull();
    expect(nada.data).toEqual([]);

    // membros do escritório 1: mais de 10 ativos -> duas páginas distintas
    const p1 = await dono.rpc("qg_membros", { p_escritorio_id: ESC1, p_limite: 5, p_offset: 0 });
    const p2 = await dono.rpc("qg_membros", { p_escritorio_id: ESC1, p_limite: 5, p_offset: 5 });
    expect(p1.error ?? p2.error).toBeNull();
    expect(p1.data).toHaveLength(5);
    expect(p2.data).toHaveLength(5);
    const ids1 = p1.data!.map((m: { usuario_id: string }) => m.usuario_id);
    const ids2 = p2.data!.map((m: { usuario_id: string }) => m.usuario_id);
    expect(ids1.filter((id: string) => ids2.includes(id)), "páginas não se sobrepõem").toEqual([]);
    expect(p1.data![0].total).toBeGreaterThan(10);
    // só metadado: nada de cliente
    expect(Object.keys(p1.data![0]).sort()).toEqual(
      ["desde", "email", "mfa", "nome", "papel", "papel_nome", "status", "tipo_acesso", "total", "ultimo_acesso", "usuario_id"],
    );

    // busca por e-mail e filtro de status
    const porEmail = await dono.rpc("qg_membros", { p_escritorio_id: ESC1, p_busca: "rbac+assistente", p_status: "todos" });
    expect(porEmail.error).toBeNull();
    expect(porEmail.data!.map((m: { email: string }) => m.email)).toEqual([`rbac+assistente@${DOM}`]);
    const desativados = await dono.rpc("qg_membros", { p_escritorio_id: ESC2, p_status: "desativado" });
    expect(desativados.error).toBeNull();
    for (const m of desativados.data as Array<{ status: string }>) expect(m.status).toBe("desativado");

    // admin de escritório não é staff
    const { sb: cAdmin } = await como(`canario+admin@${DOM}`);
    const r = await cAdmin.rpc("qg_escritorios", { p_limite: 1 });
    expect(r.error?.code).toBe("42501");
    const r2 = await cAdmin.rpc("qg_membros", { p_escritorio_id: ESC2 });
    expect(r2.error?.code).toBe("42501");
  });

  test("tela: 10 por página, próxima/última, itens por página e busca", async ({ browser, baseURL }) => {
    const { session } = await como(`qg+dono@${DOM}`);
    const { ctx, origem } = await contextoQG(browser, baseURL!, session);
    const page = await ctx.newPage();
    await cursorVisivel(page);
    try {
      await page.goto(`${origem}/qg/escritorios/${ESC1}`);
      const contagem = page.locator("[data-contagem]").first();
      await expect(contagem).toHaveText(/^1–10 de \d+ pessoas$/);
      const total = Number((await contagem.textContent())!.match(/de (\d+)/)![1]);
      expect(total).toBeGreaterThan(10);
      await expect(page.getByText(`Quem usa o sistema (${total})`)).toBeVisible();

      // próxima página: 11–20, e o número 2 fica marcado como atual
      await page.getByRole("button", { name: "Próxima página" }).first().click();
      await expect(contagem).toHaveText(new RegExp(`^11–${Math.min(20, total)} de ${total} pessoas$`));
      await expect(page.getByRole("button", { name: "Página 2" })).toHaveAttribute("aria-current", "page");

      // última página
      const ultima = Math.ceil(total / 10);
      await page.getByRole("button", { name: "Última página" }).first().click();
      await expect(contagem).toHaveText(new RegExp(`^${(ultima - 1) * 10 + 1}–${total} de ${total} pessoas$`));
      await expect(page.getByRole("button", { name: "Próxima página" }).first()).toBeDisabled();

      // itens por página: 25 -> volta pra página 1 com 25
      await page.getByRole("combobox", { name: "Itens por página" }).first().click();
      await page.getByRole("option", { name: "25" }).click();
      await expect(contagem).toHaveText(new RegExp(`^1–${Math.min(25, total)} de ${total} pessoas$`));

      // busca vai ao banco: acha pelo e-mail, e o total acompanha o recorte
      await page.getByRole("textbox", { name: "Buscar pessoa" }).fill("rbac+financeiro");
      await expect(contagem).toHaveText(/^1–1 de 1 pessoas$/);
      await expect(page.getByText(`rbac+financeiro@${DOM}`)).toBeVisible();

      // lista de escritórios: busca sem acento
      await page.goto(`${origem}/qg`);
      await page.getByRole("textbox", { name: "Buscar escritório" }).fill("canár");
      await expect(page.locator("[data-contagem]").first()).toHaveText(/^1–1 de 1 escritórios$/);
      // (o card "Pede atenção" também linka o Canário: olha só a tabela)
      await expect(page.getByRole("table").getByRole("link", { name: "Canário Advocacia" })).toBeVisible();
    } finally {
      await ctx.close();
    }
  });
});

// E2E: a tela só oferece o que o papel pode (limpeza fina dos botões, lote RBAC).
//
// O banco já barra tudo isso; o que se confere aqui é que a tela não oferece o
// botão que ia falhar. Financeiro (só casos:ler + repasses:ler) abre o caso e
// não vê ações, contato nem documentos para mexer; as páginas de gestão fecham
// ou devolvem para /casos. Assistente edita e envia, mas não apaga documento
// nem gerencia comercial/etiquetas. Advogado, no mesmo caso, apaga — prova que
// o gate vem da permissão do vínculo, não de uma página quebrada.
//
// Sessões via API injetadas no localStorage (nunca digita senha). Só no banco
// local com o seed (`bun run local:rbac`). Cria um documento no caso do Kleber
// (só a linha, sem arquivo no storage) e apaga no fim.

import { test, expect, type Browser, type BrowserContext } from "@playwright/test";
import { createClient, type Session } from "@supabase/supabase-js";
import { ENV, PROJECT_REF } from "../env";
import { adminClient } from "../supabase-admin";
import { cursorVisivel } from "../cursor";

const admin = adminClient();
const DOM = "marasandraconnect.com";
const CLIENTE = "Kleber Antunes Siqueira";
const NOME_DOC = "[E2E telas] comprovante.pdf";

async function sessao(email: string): Promise<Session> {
  const sb = createClient(ENV.supabaseUrl, ENV.anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await sb.auth.signInWithPassword({ email, password: ENV.internoPassword });
  if (error || !data.session) throw new Error(`login ${email}: ${error?.message}`);
  return data.session;
}

/** Contexto do produto logado como a pessoa, já no Canário. */
async function contexto(browser: Browser, baseURL: string, email: string, escritorioId: string): Promise<BrowserContext> {
  const session = await sessao(email);
  return browser.newContext({
    storageState: {
      cookies: [],
      origins: [
        {
          origin: new URL(baseURL).origin,
          localStorage: [
            { name: `sb-${PROJECT_REF}-auth-token`, value: JSON.stringify(session) },
            { name: "msc:escritorio_ativo", value: escritorioId },
          ],
        },
      ],
    },
  });
}

let ESC2: string;
let CASO: string;

async function limpar() {
  const { error } = await admin.from("documentos").delete().eq("nome_arquivo", NOME_DOC);
  if (error) throw new Error(`limpeza de documentos falhou: ${error.message}`);
}

test.describe.serial("telas: só o que o papel pode", () => {
  test.beforeAll(async () => {
    test.skip(!ENV.local, "só no banco local");
    const { data: canario, error } = await admin.from("escritorios").select("id").eq("slug", "canario").maybeSingle();
    test.skip(!!error || !canario, "escritório canário ausente — rode `bun run local:rbac`");
    ESC2 = canario!.id;
    const { data: cliente } = await admin.from("clientes").select("id").eq("escritorio_id", ESC2).eq("nome", CLIENTE).maybeSingle();
    test.skip(!cliente, `cliente ${CLIENTE} ausente no Canário — rode \`bun run local:rbac\``);
    const { data: caso } = await admin.from("casos").select("id").eq("cliente_id", cliente!.id).order("created_at", { ascending: false }).limit(1).maybeSingle();
    test.skip(!caso, "caso do Kleber ausente");
    CASO = caso!.id;
    await limpar();
    const { error: eDoc } = await admin.from("documentos").insert({
      caso_id: CASO,
      escritorio_id: ESC2,
      tipo: "outro",
      nome_arquivo: NOME_DOC,
      storage_path: `e2e-telas/${CASO}/comprovante.pdf`,
    });
    if (eDoc) throw new Error(`documento de teste: ${eDoc.message}`);
  });
  test.afterAll(async () => {
    if (ESC2) await limpar();
  });

  test("financeiro: consulta o caso sem ações, contato ou documentos; gestão fecha", async ({ browser, baseURL }) => {
    const ctx = await contexto(browser, baseURL!, `canario+financeiro@${DOM}`, ESC2);
    const page = await ctx.newPage();
    await cursorVisivel(page);

    await page.goto(`/casos/${CASO}`);
    await expect(page.getByText(CLIENTE).first()).toBeVisible();
    await expect(page.locator('[aria-label="Ações do caso"]'), "sem casos:editar não há menu de ações").toHaveCount(0);
    await expect(page.getByText(/^\s*Telefone:\s*$/), "sem clientes:ler_contato não há telefone").toHaveCount(0);
    await expect(page.getByText(/^\s*E-mail:\s*$/)).toHaveCount(0);
    await expect(page.getByText(/Senha MEU INSS/), "sem senha_inss:ler não há bloco da senha").toHaveCount(0);

    await page.goto(`/casos/${CASO}?tab=documentos`);
    await expect(page.getByRole("tab", { name: /Documentos/ })).toHaveAttribute("data-state", "active");
    await expect(page.locator('[aria-label="Renomear documento"]'), "sem documentos:enviar").toHaveCount(0);
    await expect(page.locator('[aria-label="Deletar documento"]'), "sem documentos:excluir").toHaveCount(0);

    await page.goto("/comercial");
    await expect(page.getByText("Área restrita a quem gerencia o comercial.")).toBeVisible();
    await page.goto("/etiquetas");
    await expect(page.getByText("Área restrita a quem gerencia etiquetas.")).toBeVisible();
    for (const rota of ["/processos", "/casos/novo", "/publicacoes", "/parceiros"]) {
      await page.goto(rota);
      // o guard manda para /casos; para o interno a home pode seguir para /tarefas
      await expect(page, `${rota} devolve para /casos`).toHaveURL(/\/(casos|tarefas)$/);
    }

    await page.goto("/agenda");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(page.getByRole("button", { name: "Novo evento" }), "sem agenda:gerenciar não cria evento").toHaveCount(0);
    await ctx.close();
  });

  test("assistente: edita e envia, mas não apaga documento nem gerencia comercial/etiquetas", async ({ browser, baseURL }) => {
    const ctx = await contexto(browser, baseURL!, `canario+assistente@${DOM}`, ESC2);
    const page = await ctx.newPage();
    await cursorVisivel(page);

    await page.goto(`/casos/${CASO}`);
    await expect(page.getByText(CLIENTE).first()).toBeVisible();
    await expect(page.locator('[aria-label="Ações do caso"]')).toBeVisible();
    await expect(page.getByText(/^\s*Telefone:\s*$/).first()).toBeVisible();
    await expect(page.getByText(/Senha MEU INSS/).first(), "assistente tem senha_inss:ler").toBeVisible();

    await page.goto(`/casos/${CASO}?tab=documentos`);
    await expect(page.getByText(NOME_DOC)).toBeVisible();
    await expect(page.locator('[aria-label="Renomear documento"]').first()).toBeVisible();
    await expect(page.locator('[aria-label="Deletar documento"]'), "assistente não tem documentos:excluir").toHaveCount(0);

    await page.goto("/comercial");
    await expect(page.getByText("Área restrita a quem gerencia o comercial.")).toBeVisible();
    await page.goto("/etiquetas");
    await expect(page.getByText("Área restrita a quem gerencia etiquetas.")).toBeVisible();
    await page.goto("/processos");
    await expect(page, "tem processos:ler: fica").toHaveURL(/\/processos$/);
    await ctx.close();
  });

  test("advogado: no mesmo caso apaga documento e gerencia etiquetas", async ({ browser, baseURL }) => {
    const ctx = await contexto(browser, baseURL!, `canario+advogado@${DOM}`, ESC2);
    const page = await ctx.newPage();
    await cursorVisivel(page);

    await page.goto(`/casos/${CASO}?tab=documentos`);
    await expect(page.getByText(NOME_DOC)).toBeVisible();
    await expect(page.locator('[aria-label="Deletar documento"]').first()).toBeVisible();

    await page.goto("/etiquetas");
    await expect(page).toHaveURL(/\/etiquetas$/);
    await expect(page.getByText("Área restrita a quem gerencia etiquetas.")).toHaveCount(0);
    await page.goto("/comercial");
    await expect(page.getByText("Área restrita a quem gerencia o comercial.")).toHaveCount(0);
    await ctx.close();
  });
});

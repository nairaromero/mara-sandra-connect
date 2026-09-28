// E2E: marcar NÃO salva — só o botão Salvar escreve — e o "i" explica a permissão.
//
// Por que esta spec existe (pedido da Naira, 2026-09-28): até 28/09 cada clique
// no checkbox gravava na hora. Marcar e desmarcar por engano escrevia duas
// linhas na Auditoria, e não dava para montar um conjunto de mudanças e revisar
// antes de aplicar.
//
// O que se prova aqui, contra o BANCO e não só contra a tela:
//   · marcar não grava (o banco continua sem ajuste enquanto a tela mostra "não salvo");
//   · marcar e desmarcar volta ao zero — não sobra pendência nem chamada;
//   · Salvar grava, e só então o ajuste existe;
//   · permissão sensível pergunta na hora de SALVAR, não a cada marcação;
//   · fechar com mudança pendente avisa em vez de perder calada;
//   · o "i" mostra o texto que está no banco (`permissoes.detalhe`).
//
// Só no banco local/staging com o seed do Canário (`bun run local:rbac`).
import { test, expect, type Browser } from "@playwright/test";
import { ENV, PROJECT_REF } from "../env";
import { adminClient } from "../supabase-admin";
import { idDe as idDeEmail, sessaoComo } from "../rbac";
import { cursorVisivel } from "../cursor";

const admin = adminClient();
const DOM = "marasandraconnect.com";

let ESC2: string;
let idAssistente: string;

/** Quantos ajustes individuais a pessoa tem HOJE, no banco. */
async function ajustesNoBanco(usuarioId: string): Promise<number> {
  const { data: m, error: eM } = await admin
    .from("membros").select("id").eq("escritorio_id", ESC2).eq("usuario_id", usuarioId).maybeSingle();
  if (eM) throw new Error(`membro: ${eM.message}`);
  if (!m) throw new Error("pessoa sem vínculo no Canário");
  const { count, error } = await admin
    .from("membro_permissoes").select("permissao", { count: "exact", head: true }).eq("membro_id", m.id);
  if (error) throw new Error(`ajustes: ${error.message}`);
  return count ?? 0;
}

async function limpar() {
  const { error } = await admin.from("membro_permissoes").delete().eq("escritorio_id", ESC2);
  if (error) throw new Error(`limpeza de ajustes: ${error.message}`);
}

/** A gaveta de permissões da assistente, aberta como a admin do Canário. */
async function abrirPainel(browser: Browser, baseURL: string) {
  const { session } = await sessaoComo(`canario+admin@${DOM}`);
  const ctx = await browser.newContext({
    // O `use.video` do config só alcança o contexto do fixture; este é criado à
    // mão (precisa da sessão em runtime), então o vídeo se pede aqui. Com
    // PW_VIDEO=1 o run que PASSA vira registro de validação, como diz o
    // e2e/README.md.
    ...(process.env.PW_VIDEO === "1"
      ? { recordVideo: { dir: "test-results/video-permissoes", size: { width: 1280, height: 800 } } }
      : {}),
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
  await page.getByRole("button", { name: /Ações de Elisa/ }).click();
  await page.getByRole("menuitem", { name: "Permissões" }).click();
  const painel = page.locator("[data-permissoes-sheet]");
  await expect(painel).toBeVisible();
  return { ctx, page, painel };
}

test.describe.serial("permissões: salvar explícito e explicação", () => {
  test.beforeAll(async () => {
    const { data: esc, error } = await admin.from("escritorios").select("id").eq("slug", "canario").maybeSingle();
    test.skip(!!error || !esc, "escritório Canário ausente — rode `bun run local:rbac`");
    ESC2 = esc!.id as string;
    idAssistente = await idDeEmail(`canario+assistente@${DOM}`);
    await limpar();
  });
  test.afterAll(limpar);

  test("marcar não grava; marcar e desmarcar não deixa nada para salvar", async ({ browser, baseURL }) => {
    const { ctx, page, painel } = await abrirPainel(browser, baseURL!);
    try {
      const linha = painel.locator('[data-permissao="comercial:gerenciar"]');
      const salvar = painel.locator("[data-salvar-permissoes]");
      await expect(salvar, "sem mudança, não há o que salvar").toBeDisabled();

      await linha.getByRole("checkbox").click();
      await expect(linha.locator("[data-nao-salvo]"), "a tela avisa que está pendente").toBeVisible();
      await expect(salvar).toBeEnabled();
      await expect(salvar).toHaveText(/Salvar 1 mudança/);

      // o banco não foi tocado — é o coração do pedido
      expect(await ajustesNoBanco(idAssistente), "marcar não pode gravar").toBe(0);

      // desmarcar devolve ao estado do servidor: a pendência some
      await linha.getByRole("checkbox").click();
      await expect(linha.locator("[data-nao-salvo]")).toHaveCount(0);
      await expect(salvar, "voltar ao original não deixa mudança").toBeDisabled();
      expect(await ajustesNoBanco(idAssistente)).toBe(0);
    } finally {
      await ctx.close();
    }
  });

  test("Salvar grava, e a permissão sensível só pergunta na hora de salvar", async ({ browser, baseURL }) => {
    const { ctx, page, painel } = await abrirPainel(browser, baseURL!);
    try {
      const linha = painel.locator('[data-permissao="auditoria:ler"]');
      await linha.getByRole("checkbox").click();

      // marcar uma sensível NÃO abre a confirmação: ela é do salvamento
      await expect(
        page.getByText(/permissão sensível/i),
        "a confirmação não pode interromper quem ainda está montando o conjunto",
      ).toHaveCount(0);
      expect(await ajustesNoBanco(idAssistente)).toBe(0);

      await painel.locator("[data-salvar-permissoes]").click();
      await expect(page.getByText(/Conceder uma permissão sensível/i)).toBeVisible();
      await page.getByRole("button", { name: /Conceder e salvar/ }).click();

      await expect(linha.locator("[data-ajustada]"), "agora sim, o ajuste existe").toBeVisible();
      await expect(linha.locator("[data-nao-salvo]")).toHaveCount(0);
      expect(await ajustesNoBanco(idAssistente), "o banco recebeu o ajuste").toBe(1);
    } finally {
      await ctx.close();
    }
  });

  test("fechar com mudança pendente avisa antes de perder", async ({ browser, baseURL }) => {
    const { ctx, page, painel } = await abrirPainel(browser, baseURL!);
    try {
      await painel.locator('[data-permissao="etiquetas:gerenciar"]').getByRole("checkbox").click();
      await painel.getByRole("button", { name: "Fechar" }).click();
      // pelo título, não por texto solto: "Sair sem salvar" também é o botão
      await expect(page.getByRole("heading", { name: /Sair sem salvar/i })).toBeVisible();
      await page.getByRole("button", { name: /Continuar editando/ }).click();
      await expect(painel, "continuar editando mantém a gaveta aberta").toBeVisible();

      // descartar limpa a pendência sem tocar no banco
      await painel.locator("[data-descartar]").click();
      await expect(painel.locator("[data-nao-salvo]")).toHaveCount(0);
      expect(await ajustesNoBanco(idAssistente), "descartar não grava nem apaga").toBe(1);
    } finally {
      await ctx.close();
    }
  });

  test('o "i" mostra a explicação que está no banco', async ({ browser, baseURL }) => {
    const { data: perm, error } = await admin
      .from("permissoes").select("detalhe").eq("chave", "casos:ler").maybeSingle();
    if (error) throw new Error(`ler o detalhe: ${error.message}`);
    expect(perm?.detalhe, "a permissão precisa ter explicação cadastrada").toBeTruthy();
    // um pedaço distintivo, para não passar por coincidência com a descrição curta
    const trecho = (perm!.detalhe as string).slice(0, 40);

    const { ctx, page, painel } = await abrirPainel(browser, baseURL!);
    try {
      await painel.locator('[data-detalhe="casos:ler"]').click();
      const texto = page.locator("[data-detalhe-texto]");
      await expect(texto).toBeVisible();
      await expect(texto).toContainText(trecho);
    } finally {
      await ctx.close();
    }
  });

  test("o botão de voltar ao papel diz por que está apagado", async ({ browser, baseURL }) => {
    // Sem ajuste, o botão fica desabilitado — e um `title` no próprio botão
    // desabilitado não aparece (o navegador não dispara mouse nele). A
    // explicação mora no invólucro.
    await limpar();
    const { ctx, painel } = await abrirPainel(browser, baseURL!);
    try {
      const botao = painel.locator("[data-voltar-ao-papel]");
      await expect(botao, "sem ajuste, não há o que desfazer").toBeDisabled();
      const involucro = painel.locator("[data-voltar-ao-papel-dica]");
      await expect(involucro).toHaveAttribute("title", /já está no padrão do papel/);

      // com um ajuste, o botão abre e o texto muda para o que ele vai fazer
      const linha = painel.locator('[data-permissao="etiquetas:gerenciar"]');
      await linha.getByRole("checkbox").click();
      await painel.locator("[data-salvar-permissoes]").click();
      await expect(linha.locator("[data-ajustada]")).toBeVisible();
      await expect(botao).toBeEnabled();
      await expect(involucro).toHaveAttribute("title", /Desfaz 1 ajuste/);
    } finally {
      await ctx.close();
      await limpar();
    }
  });

  test("toda permissão tem explicação — nenhuma fica com o texto de fallback", async () => {
    const { data, error } = await admin.from("permissoes").select("chave, detalhe");
    if (error) throw new Error(`permissões: ${error.message}`);
    const sem = (data ?? []).filter((p) => !p.detalhe || !String(p.detalhe).trim());
    expect(
      sem.length,
      sem.length === 0 ? "" : `sem explicação: ${sem.map((p) => p.chave).join(", ")}`,
    ).toBe(0);
  });
});

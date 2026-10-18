// E2E: a lista do <Selecao> rola dentro de painel modal (card #300).
//
// Por que esta spec existe: Sheet e Dialog (Radix) travam a rolagem da página
// com o react-remove-scroll, que cancela wheel/touchmove em tudo que está FORA
// do conteúdo do painel. A lista do <Selecao> vive num portal — fora, portanto
// — e roda do mouse, trackpad e toque não rolavam: quem procurava um cliente
// rolando não chegava aos últimos. O conserto é `modal` no <Popover>, num
// ponto só. Sem ele, AC-1, AC-2, AC-7 e AC-8 falham.
//
// Também cobre o que o conserto não pode quebrar (busca, seleção, foco) e o
// aviso quando a consulta de casos falha — antes era `.catch(() => {})` e o
// seletor aparecia vazio, calado.
//
// Só no banco local/staging (o cleanup apaga os [E2E]).
import { test, expect, type Locator, type Page } from "@playwright/test";
import { STORAGE_INTERNO } from "../auth.setup";
import {
  adminClient,
  cleanupE2E,
  escritorioE2E,
  seedClienteCaso,
  seedSolicitacao,
} from "../supabase-admin";
import { abrirNovaTarefaNoCaso } from "../tarefas";

test.use({ storageState: STORAGE_INTERNO });

const admin = adminClient();

/** A lista mostra ~9 opções por vez (max-h 300px): abaixo disto não há o que rolar. */
const MINIMO_DE_CASOS = 20;
const PASSO_RODA = 400;

let escritorio: string | null;
let casoId: string;
let nomeCliente: string;
let nomeOutroCliente: string;
let sufixoBusca: string;

/** O último nome que `listarCasosResumo` põe na lista: a mesma ordem, lida de trás. */
async function ultimoClienteDaLista(): Promise<string> {
  const q = admin
    .from("casos")
    .select("id, cliente:clientes(nome)")
    .order("created_at", { ascending: true })
    .order("id", { ascending: false })
    .limit(1);
  const { data, error } = await (escritorio ? q.eq("escritorio_id", escritorio) : q).maybeSingle();
  if (error) throw new Error(`último caso: ${error.message}`);
  if (!data) throw new Error("nenhum caso no banco");
  return (data.cliente as { nome?: string | null } | null)?.nome ?? "(sem nome)";
}

test.beforeAll(async () => {
  escritorio = await escritorioE2E(admin);
  sufixoBusca = `Rolagem ${Date.now()}`;
  nomeCliente = `[E2E] ${sufixoBusca} A`;
  nomeOutroCliente = `[E2E] ${sufixoBusca} B`;
  ({ casoId } = await seedClienteCaso(admin, { sufixo: `${sufixoBusca} A` }));
  await seedClienteCaso(admin, { sufixo: `${sufixoBusca} B` });
  await seedSolicitacao(admin, casoId, "comprovante_residencia");

  // Lista longa de verdade: completa até o mínimo quando o banco tem poucos casos.
  const q = admin.from("casos").select("id", { count: "exact", head: true });
  const { count, error } = await (escritorio ? q.eq("escritorio_id", escritorio) : q);
  if (error) throw new Error(`contar casos: ${error.message}`);
  for (let i = count ?? 0; i < MINIMO_DE_CASOS; i++) {
    await seedClienteCaso(admin, { sufixo: `${sufixoBusca} extra ${i}` });
  }
});

test.afterAll(async () => {
  await cleanupE2E(admin);
});

const scrollTop = (lista: Locator) => lista.evaluate((el) => el.scrollTop);

/** Abre o seletor de cliente do painel aberto e devolve a lista (role=listbox). */
async function abrirSeletorDeCliente(page: Page): Promise<Locator> {
  await page.locator('[data-selecao="cliente"]').click();
  const lista = page.getByRole("listbox");
  await expect(lista).toBeVisible();
  return lista;
}

/** Roda do mouse sobre a lista, delta suficiente para chegar ao fim. */
async function rolarComRoda(page: Page, lista: Locator) {
  const caixa = await lista.boundingBox();
  if (!caixa) throw new Error("a lista não tem caixa na tela");
  await page.mouse.move(caixa.x + caixa.width / 2, caixa.y + caixa.height / 2);
  const altura = await lista.evaluate((el) => el.scrollHeight);
  for (let i = 0; i < Math.ceil(altura / PASSO_RODA) + 2; i++) {
    await page.mouse.wheel(0, PASSO_RODA);
  }
}

/** Arrasta o dedo de baixo para cima sobre a lista, quantas vezes precisar. */
async function arrastarDedo(page: Page, lista: Locator) {
  const caixa = await lista.boundingBox();
  if (!caixa) throw new Error("a lista não tem caixa na tela");
  const cdp = await page.context().newCDPSession(page);
  const x = caixa.x + caixa.width / 2;
  const yBaixo = caixa.y + caixa.height - 16;
  const yCima = caixa.y + 16;
  const altura = await lista.evaluate((el) => el.scrollHeight);
  const arrastos = Math.ceil(altura / (yBaixo - yCima)) + 2;
  for (let i = 0; i < arrastos; i++) {
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [{ x, y: yBaixo }],
    });
    for (let y = yBaixo; y > yCima; y -= 20) {
      await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x, y }] });
    }
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  }
  await cdp.detach();
}

/**
 * A última opção da lista, pelo nome que o banco diz ser o último — e a
 * conferência de que a tela concorda (senão a spec estaria rolando até um
 * item que não é o fim). Homônimos: a última delas.
 */
async function ultimaOpcao(page: Page): Promise<Locator> {
  const ultimo = await ultimoClienteDaLista();
  await expect(page.getByRole("option").last(), "o fim da lista é o que o banco diz").toHaveText(
    ultimo,
  );
  return page.getByRole("option", { name: ultimo, exact: true }).last();
}

/**
 * Responde 500 à consulta de `listarCasosResumo` (casos com nome do cliente,
 * sem filtro de id) e só a ela — a tela do caso lê `casos` com outro `select`
 * e o enriquecimento das tarefas filtra por `id`; os dois precisam continuar.
 */
const consultaDeCasos = (url: URL) =>
  url.pathname.endsWith("/rest/v1/casos") &&
  (url.searchParams.get("select") ?? "").startsWith("id,cliente:clientes") &&
  !url.searchParams.has("id");

/** A consulta de responsáveis (`listarInternosAtivos`). */
const consultaDeInternos = (url: URL) => url.pathname.endsWith("/rest/v1/usuarios_escritorio");

async function derrubarConsultaDeCasos(page: Page) {
  await derrubar(page, consultaDeCasos);
}

async function derrubar(page: Page, alvo: (url: URL) => boolean) {
  await page.route(
    alvo,
    async (route) => {
      const cors = {
        "access-control-allow-origin": "*",
        "access-control-allow-headers": "*",
        "access-control-allow-methods": "GET, OPTIONS",
      };
      if (route.request().method() === "OPTIONS") {
        await route.fulfill({ status: 204, headers: cors });
        return;
      }
      await route.fulfill({
        status: 500,
        headers: { ...cors, "content-type": "application/json" },
        body: JSON.stringify({
          code: "XX000",
          message: "falha simulada pela spec",
          details: null,
          hint: null,
        }),
      });
    },
  );
}

const toastDeErroDeClientes = (page: Page) =>
  page.locator("[data-sonner-toast]").filter({ hasText: /carregar a lista de clientes/i });

test.describe("rolar a lista do seletor dentro de painel modal", () => {
  test("AC-1: no painel de tarefa, a roda do mouse leva ao último cliente", async ({ page }) => {
    await abrirNovaTarefaNoCaso(page, casoId);
    const lista = await abrirSeletorDeCliente(page);
    const ultima = await ultimaOpcao(page);
    await expect(ultima, "a lista precisa ser longa para a rolagem contar").not.toBeInViewport();
    expect(await scrollTop(lista)).toBe(0);

    await rolarComRoda(page, lista);

    await expect(ultima).toBeInViewport();
    await expect.poll(() => scrollTop(lista)).toBeGreaterThan(0);
  });

  test("AC-7: no diálogo de editar solicitação, a lista longa rola com a roda", async ({
    page,
  }) => {
    await page.goto(`/casos/${casoId}`);
    const aba = page.getByRole("tab", { name: /Documentos/i }).first();
    await expect(aba).toBeVisible({ timeout: 20_000 });
    await aba.click();
    await page.getByTitle("Editar solicitação").first().click();
    const dialog = page.locator('[role="dialog"]').filter({ hasText: "Editar solicitação" });
    await expect(dialog).toBeVisible();

    // Tipo de documento: 30+ opções, "Outro" sempre por último.
    await dialog.getByRole("combobox").filter({ hasText: "Comprovante de residência" }).click();
    const lista = page.getByRole("listbox");
    await expect(lista).toBeVisible();
    const ultima = page.getByRole("option", { name: "Outro", exact: true });
    await expect(ultima).not.toBeInViewport();

    await rolarComRoda(page, lista);

    await expect(ultima).toBeInViewport();
    await expect.poll(() => scrollTop(lista)).toBeGreaterThan(0);
  });

  test("AC-8: no painel da Agenda, a roda do mouse leva ao último cliente", async ({ page }) => {
    await page.goto("/agenda");
    await page.getByRole("button", { name: /Novo evento/ }).click();
    await expect(page.locator('[role="dialog"]').first()).toBeVisible();
    const lista = await abrirSeletorDeCliente(page);
    const ultima = await ultimaOpcao(page);
    await expect(ultima).not.toBeInViewport();

    await rolarComRoda(page, lista);

    await expect(ultima).toBeInViewport();
  });
});

test.describe("toque", () => {
  test.use({ hasTouch: true, isMobile: true });

  test("AC-2: arrastar o dedo sobre a lista rola até o último cliente", async ({ page }) => {
    await abrirNovaTarefaNoCaso(page, casoId);
    const lista = await abrirSeletorDeCliente(page);
    const ultima = await ultimaOpcao(page);
    await expect(ultima).not.toBeInViewport();
    expect(await scrollTop(lista)).toBe(0);

    await arrastarDedo(page, lista);

    await expect.poll(() => scrollTop(lista)).toBeGreaterThan(0);
    await expect(ultima).toBeInViewport();
  });
});

test.describe("o conserto não quebra o resto do seletor", () => {
  test("AC-3: buscar filtra as opções e escolher fecha a lista com o nome no campo", async ({
    page,
  }) => {
    await abrirNovaTarefaNoCaso(page, casoId);
    const campo = page.locator('[data-selecao="cliente"]');
    // aberto pelo caso, o cliente dele já vem escolhido
    await expect(campo).toContainText(nomeCliente);
    await abrirSeletorDeCliente(page);

    const busca = page.locator("[data-selecao-busca]");
    await busca.fill(sufixoBusca);
    await expect(page.getByRole("option").first()).toBeVisible();
    const opcoes = await page.getByRole("option").allInnerTexts();
    expect(opcoes.length).toBeGreaterThan(0);
    for (const o of opcoes) expect(o.toLowerCase()).toContain(sufixoBusca.toLowerCase());

    await page.getByRole("option", { name: nomeOutroCliente, exact: true }).click();
    await expect(page.getByRole("listbox")).toBeHidden();
    await expect(campo).toContainText(nomeOutroCliente);
  });

  test.describe("painel com rolagem própria", () => {
    // Baixo de propósito: o formulário de tarefa precisa rolar para o teste
    // ter uma posição de rolagem para guardar.
    test.use({ viewport: { width: 1280, height: 500 } });

    test("AC-4: abrir o seletor foca a busca e não rola o painel", async ({ page }) => {
      await abrirNovaTarefaNoCaso(page, casoId);
      const painel = page.locator('[role="dialog"]').filter({ hasText: "Nova tarefa" });
      // O painel entra deslizando pela direita. Medido durante a animação, o
      // campo ainda está fora da tela e o próprio clique do Playwright rola o
      // painel para alcançá-lo — era o que zerava a rolagem: o teste media a
      // rolagem do teste, não a do app. Espera a animação acabar.
      await painel.evaluate((el) =>
        Promise.all(el.getAnimations({ subtree: true }).map((a) => a.finished)),
      );
      const antes = await painel.evaluate((el) => {
        const campo = el.querySelector('[data-selecao="cliente"]');
        if (!campo) throw new Error("seletor de cliente ausente no painel");
        el.scrollTop = 8;
        const r = campo.getBoundingClientRect();
        // À vista e sem nada por cima: o clique não precisa rolar nada.
        const noPonto = document.elementFromPoint(r.left + 10, r.top + r.height / 2);
        if (noPonto?.closest('[data-selecao="cliente"]') !== campo) {
          throw new Error("o campo não está à vista: o clique rolaria o painel");
        }
        return el.scrollTop;
      });
      expect(antes, "o painel precisa estar rolado para o teste valer").toBeGreaterThan(0);

      await abrirSeletorDeCliente(page);

      const busca = page.locator("[data-selecao-busca]");
      await expect(busca).toBeFocused();
      expect(
        await busca.evaluate(
          (el) =>
            document.activeElement === el && !!el.closest("[data-radix-popper-content-wrapper]"),
        ),
        "o foco vai para a busca dentro do popover",
      ).toBe(true);
      expect(await painel.evaluate((el) => el.scrollTop)).toBe(antes);
    });
  });
});

/** O aviso que FICA no painel (o toast some): diz o que falhou e oferece tentar de novo. */
const avisoDeCarga = (page: Page, texto: RegExp) =>
  page.locator("[data-aviso-carga]").filter({ hasText: texto });

test.describe("quando a consulta de casos falha, o painel avisa", () => {
  test("AC-5: painel de tarefa — aviso no lugar e 'Tentar de novo' carrega a lista", async ({ page }) => {
    await derrubarConsultaDeCasos(page);
    await abrirNovaTarefaNoCaso(page, casoId);
    await expect(toastDeErroDeClientes(page)).toBeVisible({ timeout: 20_000 });
    const aviso = avisoDeCarga(page, /lista de clientes/);
    await expect(aviso).toBeVisible();

    // A consulta volta: "Tentar de novo" carrega e o aviso some.
    await page.unroute(consultaDeCasos);
    await aviso.getByRole("button", { name: "Tentar de novo" }).click();
    await expect(aviso).toBeHidden({ timeout: 20_000 });
    await abrirSeletorDeCliente(page);
    await expect(page.getByRole("option", { name: nomeOutroCliente, exact: true })).toBeAttached();
  });

  test("AC-6: painel da Agenda", async ({ page }) => {
    await derrubarConsultaDeCasos(page);
    await page.goto("/agenda");
    await page.getByRole("button", { name: /Novo evento/ }).click();
    await expect(page.locator('[role="dialog"]').first()).toBeVisible();
    await expect(toastDeErroDeClientes(page)).toBeVisible({ timeout: 20_000 });
    await expect(avisoDeCarga(page, /lista de clientes/)).toBeVisible();
  });

  test("responsáveis: a falha também aparece no painel (antes era `.catch(() => {})`)", async ({ page }) => {
    await derrubar(page, consultaDeInternos);
    await abrirNovaTarefaNoCaso(page, casoId);
    await expect(avisoDeCarga(page, /lista de responsáveis/)).toBeVisible({ timeout: 20_000 });
  });
});

test.describe("fora de painel, o seletor não trava a página (revisão do #460)", () => {
  test("com a lista aberta a página segue clicável e acessível", async ({ page }) => {
    await page.goto("/publicacoes");
    const contagem = page.locator("[data-contagem]").first();
    await expect(contagem).toBeVisible({ timeout: 20_000 });
    await page.getByRole("combobox", { name: "Itens por página" }).first().click();
    await expect(page.getByRole("listbox")).toBeVisible();

    // `modal` travaria o body e esconderia o resto da tela do leitor de tela.
    const corpo = await page.evaluate(() => ({
      pointer: getComputedStyle(document.body).pointerEvents,
      overflow: getComputedStyle(document.body).overflow,
    }));
    expect(corpo.pointer).not.toBe("none");
    expect(corpo.overflow).not.toBe("hidden");
    await expect(page.getByRole("button", { name: "Próxima página" }).first()).toBeVisible();
  });
});

// Filme-explicação do #437: por que o board segurava card de lote grande.
//
// A área afetada NÃO é o app — é o board (GitHub Projects) e o próprio GitHub.
// Os dois são públicos, então este filme mostra as telas de verdade, sem
// sessão: nada aqui é maquete. O que ele prova, mostra; o que ele explica,
// narra por cima da tela real.
//
// Rodar da raiz (não precisa de banco nem de app no ar):
//   node e2e/demo/roteiros/board-sync-paginacao.cjs
//
// Depois, o MP4 único:
//   node e2e/demo/montar-filme.cjs board-sync-paginacao paginacao --legendado
const fs = require("fs");
const path = require("path");
const { narrar: narrarBase, abrirEstudio, tentar } = require("../helpers.cjs");

const BOARD = "https://github.com/users/nairaromero/projects/1";
const REPO = "https://github.com/nairaromero/mara-sandra-connect";
const PR_LOTE = 396; // o lote do RBAC, 195 arquivos — o PR que travava o board
const PR_FIX = 438; // este conserto

const legendas = [];
const inicioClipe = new WeakMap();
let clipesAbertos = 0;
async function narrar(page, texto, ms = 3600) {
  const c = inicioClipe.get(page);
  if (c) legendas.push({ clipe: c.clipe, inicio_ms: Date.now() - c.t0, dur_ms: ms, texto });
  return narrarBase(page, texto, ms);
}

const provas = [];
function registrar(o, ok, detalhe) {
  provas.push({ o, ok, detalhe });
  console.log(`  ${ok ? "✓" : "✘"} ${o} — ${detalhe}`);
}

(async () => {
  const estudio = await abrirEstudio("board-sync-paginacao");
  const still = estudio.still;

  // sem storageState: o board e o repositório são públicos
  const parte = async () => {
    const p = await estudio.novaParte();
    inicioClipe.set(p.page, { clipe: clipesAbertos++, t0: Date.now() });
    return p;
  };

  // O GitHub carrega muita coisa depois do HTML; esperar a rede parar evita
  // filmar esqueleto cinza no lugar do conteúdo.
  const assentar = async (page, ms = 2500) => {
    await page.waitForLoadState("networkidle").catch(() => {});
    await page.waitForTimeout(ms);
  };

  try {
    // ================= ATO 1 · ONDE O CARD VIVE =================
    {
      const { page, fechar } = await parte();
      await page.goto(BOARD);
      await assentar(page, 3500);
      await narrar(page, "O board do Legal Connect. Um card atravessa as colunas até Produção.", 4200);
      await still(page, "1-board");

      const colunas = ["Backlog", "Lote atual", "Em revisão", "Validar no staging", "Produção"];
      const faltando = [];
      for (const c of colunas) {
        if (!(await page.getByText(c, { exact: false }).count())) faltando.push(c);
      }
      registrar(
        "board público abre e mostra as colunas",
        faltando.length === 0,
        faltando.length ? `coluna(s) ausente(s): ${faltando.join(", ")}` : colunas.join(" · "),
      );

      await narrar(page, "A última porta é 'Validar no staging' → 'Produção'. É lá que o script decide.", 4200);
      await narrar(page, "Ele só deixa passar se o commit está na main E as migrations do PR estão aplicadas.", 4600);
      await still(page, "1-board-colunas");
      await fechar();
    }

    // ================= ATO 2 · O PR QUE TRAVAVA =================
    {
      const { page, fechar } = await parte();
      await page.goto(`${REPO}/pull/${PR_LOTE}/files`);
      await assentar(page, 4000);
      await narrar(page, "Para saber quais migrations um PR carrega, o script pede a lista de arquivos.", 4400);
      await narrar(page, "Este é o lote do RBAC. Repare no número de arquivos.", 3800);
      await still(page, "2-pr396-arquivos");

      // O próprio GitHub anuncia o total — é o mesmo `totalCount` que o script lê.
      const corpo = await page.locator("body").innerText();
      const m = corpo.match(/(\d+)\s+changed files?/i) || corpo.match(/Files changed\s*(\d+)/i);
      registrar(
        "o GitHub anuncia o total de arquivos do PR #396",
        !!m && Number(m[1]) === 195,
        m ? `a página diz ${m[1]} arquivos` : "não achei a contagem na página",
      );

      await narrar(page, "195. E a API entrega em páginas de 100 — o script lia a primeira e parava.", 4800);
      await narrar(page, "Vendo 100 de 195, ele escrevia 'migrations não conferidas' e segurava o card.", 4800);
      await still(page, "2-pr396-total");
      await fechar();
    }

    // ================= ATO 3 · A RECUSA ESTAVA CERTA =================
    {
      const { page, fechar } = await parte();
      await page.goto(`${REPO}/pull/${PR_LOTE}/files`);
      await assentar(page, 3500);
      await narrar(page, "E a recusa estava certa: afirmar que não há migration no que não se leu é chutar.", 5000);
      await narrar(page, "Um card iria pra Produção com migration não aplicada — a funcionalidade quebrada no ar.", 5000);

      // O filtro do próprio GitHub mostra onde as migrations moram.
      await tentar("filtrar a lista pelos arquivos de migration", async () => {
        const filtro = page
          .getByPlaceholder(/Filter changed files|Filter files/i)
          .or(page.locator('input[aria-label*="Filter" i]'))
          .first();
        await filtro.click({ timeout: 8000 });
        await filtro.fill("sql-migrations");
        await page.waitForTimeout(2500);
        await narrar(page, "As 20 migrations do lote, filtradas pelo próprio GitHub.", 3800);
        await still(page, "3-migrations-do-lote");
      });
      await fechar();
    }

    // ================= ATO 4 · O CONSERTO =================
    {
      const { page, fechar } = await parte();
      await page.goto(`${REPO}/pull/${PR_FIX}/files`);
      await assentar(page, 4000);
      await narrar(page, "O conserto não é afrouxar a recusa. É pedir a página seguinte.", 4400);
      await still(page, "4-diff");

      const texto = await page.locator("body").innerText();
      const marcas = ["completarArquivos", "hasNextPage", "migrations não conferidas"];
      const ausentes = marcas.filter((x) => !texto.includes(x));
      registrar(
        "o diff mostra o laço novo E a recusa mantida",
        ausentes.length === 0,
        ausentes.length ? `não vi no diff: ${ausentes.join(", ")}` : marcas.join(" · "),
      );

      await narrar(page, "Um laço até hasNextPage ser falso. A recusa fica — só vira o caso raro.", 4800);
      await narrar(page, "Se a paginação falhar, o erro sobe e o card continua segurado. Nunca vira 'tudo certo'.", 5200);
      await still(page, "4-diff-recusa");
      await fechar();
    }

    // ================= ATO 5 · A RÉGUA =================
    {
      const { page, fechar } = await parte();
      await page.goto(`${REPO}/blob/fix/board-sync-paginacao/e2e/unit/board-sync-pagina.test.ts`);
      await assentar(page, 3500);
      await narrar(page, "A régua guarda as duas metades: virar a página, e manter a recusa.", 4600);
      await narrar(page, "Tirar uma sem a outra é o que dói — e cada uma foi sabotada para provar que acusa.", 5000);
      await still(page, "5-regua");

      const texto = await page.locator("body").innerText();
      registrar(
        "a régua está publicada e cobra os dois lados",
        texto.includes("hasNextPage") && texto.includes("migrations não conferidas"),
        "o arquivo da régua abre no GitHub com as duas cobranças",
      );
      await fechar();
    }

    // ================= ATO 6 · O BOARD HOJE =================
    {
      const { page, fechar } = await parte();
      await page.goto(BOARD);
      await assentar(page, 3500);
      await narrar(page, "Os cards que estavam presos já foram movidos à mão pela Naira.", 4200);
      await narrar(page, "Daqui pra frente, lote grande não trava mais: o script responde sozinho.", 4600);
      await still(page, "6-board-hoje");
      await fechar();
    }
  } finally {
    const clipes = await estudio.encerrar();
    fs.writeFileSync(path.join(estudio.saida, "legendas.json"), JSON.stringify({ legendas }, null, 2));
    fs.writeFileSync(path.join(estudio.saida, "provas.json"), JSON.stringify(provas, null, 2));
    const ok = provas.filter((p) => p.ok).length;
    console.log(`\nconferências: ${ok} ok · ${provas.length - ok} falhou`);
    console.log(`clipes: ${clipes.length} | saída: ${estudio.saida}`);
    if (provas.some((p) => !p.ok)) process.exitCode = 1;
  }
})();

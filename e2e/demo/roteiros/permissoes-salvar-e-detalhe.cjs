// Filme da feature #416: MARCAR NÃO SALVA — o botão Salvar é que grava — e cada
// permissão ganhou um "i" com o que ela faz e o que NÃO cobre.
//
//   Ato 0  Abertura
//   Ato 1  A gaveta de permissões: o que vem do papel, grupo por grupo
//   Ato 2  O "i": o que a permissão alcança — e onde ela para
//   Ato 3  Marcar não grava: a linha fica "não salvo" e o banco não muda
//   Ato 4  Montar o conjunto e salvar: a sensível pergunta na hora de gravar
//   Ato 5  Sair sem salvar: o sistema avisa em vez de perder calado
//   Ato 6  O efeito real: a assistente abre a Auditoria
//   Ato 7  Fechamento
//
// Gravado contra o ambiente LOCAL: a feature ainda não está na `staging`
// (PR #417). Pré: `bun run local:copiar && bun run local:rbac`, e o app servido
// com o banco local — a :8080 costuma estar ocupada por um vite apontando pro
// STAGING, então suba noutra porta e diga qual:
//
//   bash scripts/ambiente-local.sh app --port 8096
//   DEMO_BASE_URL=http://localhost:8096 node e2e/demo/roteiros/permissoes-salvar-e-detalhe.cjs
//
// Depois, o MP4 único com legenda:
//   node e2e/demo/montar-filme.cjs permissoes-salvar-e-detalhe permissoes --legendado
//
// Devolve o Canário ao estado de antes no finally.
const fs = require("fs");
const path = require("path");
const { ler, deslizar, clicar, tentar, narrar: narrarBase, abrirEstudio } = require("../helpers.cjs");
const { BASE, DOM, admin, sessao, estadoNavegador, esc, fechar } = require("../local.cjs");

// ---------- legendas (SRT): instante de cada fala, relativo ao clipe ----------
const legendas = [];
const inicioClipe = new WeakMap();
let clipesAbertos = 0;
async function narrar(page, texto, ms = 3400) {
  const c = inicioClipe.get(page);
  if (c) legendas.push({ clipe: c.clipe, inicio_ms: Date.now() - c.t0, dur_ms: ms, texto });
  return narrarBase(page, texto, ms);
}

const ATOS = (process.env.ATOS || "0,1,2,3,4,5,6,7").split(",").map((s) => s.trim());
const ato = (n) => ATOS.includes(String(n));

(async () => {
  const { data: canario } = await admin.from("escritorios").select("id, nome").eq("slug", "canario").maybeSingle();
  if (!canario) throw new Error("escritório Canário ausente — rode `bun run local:rbac`");
  const ESC2 = canario.id;
  const u = async (local) => {
    const { data } = await admin.from("usuarios").select("id, nome").eq("email", `${local}@${DOM}`).maybeSingle();
    if (!data) throw new Error(`conta ${local}@${DOM} ausente — rode \`bun run local:rbac\``);
    return data;
  };
  const carla = await u("canario+admin");
  const elisa = await u("canario+assistente");

  const estudio = await abrirEstudio(process.env.SAIDA || "permissoes-salvar-e-detalhe");
  const { still } = estudio;
  const sessoes = {};
  const parte = async (email) => {
    let st = { cookies: [], origins: [] };
    if (email) {
      if (!sessoes[email]) sessoes[email] = await sessao(email);
      st = estadoNavegador(sessoes[email].session, ESC2);
    }
    const t0 = Date.now();
    const nova = await estudio.novaParte(st);
    inicioClipe.set(nova.page, { clipe: clipesAbertos++, t0 });
    return nova;
  };

  async function cartao(page, titulo, sub, ms = 4600) {
    const c = inicioClipe.get(page);
    if (c) legendas.push({ clipe: c.clipe, inicio_ms: Date.now() - c.t0, dur_ms: ms, texto: `${titulo}. ${sub}` });
    await page.setContent(`<!doctype html><html><body style="margin:0;background:#16110c;color:#fcfaf6;font-family:-apple-system,'Segoe UI',Roboto,sans-serif;height:100vh;display:flex;align-items:center;justify-content:center">
      <div style="max-width:920px;text-align:center;padding:40px"><div style="font-size:13px;letter-spacing:.2em;text-transform:uppercase;color:#af7c00;margin-bottom:18px">Legal Connect · ajuste de permissões</div>
      <div style="font-family:Georgia,serif;font-size:44px;line-height:1.15;margin-bottom:20px">${esc(titulo)}</div>
      <div style="font-size:19px;line-height:1.5;color:#ded6c9">${esc(sub)}</div></div></body></html>`);
    await page.waitForTimeout(ms);
  }
  async function painel(page, titulo, corpoHtml, ms = 5200) {
    await page.setContent(`<!doctype html><html><body style="margin:0;background:#f7f4ee;color:#1c1917;font-family:-apple-system,'Segoe UI',Roboto,sans-serif;padding:40px">
      <div style="max-width:980px;margin:0 auto">
        <div style="font-size:12px;letter-spacing:.18em;text-transform:uppercase;color:#8a6d1f;margin-bottom:10px">O que o banco responde neste instante</div>
        <h1 style="font-family:Georgia,serif;font-size:30px;margin:0 0 18px">${esc(titulo)}</h1>${corpoHtml}</div>
      <style>table{border-collapse:collapse;width:100%;background:#fff;border:1px solid #e3ddd1;border-radius:10px;overflow:hidden}
      th,td{padding:10px 13px;text-align:left;border-bottom:1px solid #eee7da;font-size:15px}
      th{background:#f0ebe0;font-size:12px;text-transform:uppercase;letter-spacing:.08em;color:#6b6a63}
      .nao{color:#b91c1c;font-weight:600}.ok{color:#15803d;font-weight:600}</style></body></html>`);
    await page.waitForTimeout(ms);
  }

  /** Quantos ajustes individuais a assistente tem no banco, agora. */
  async function ajustes() {
    const { data: m } = await admin.from("membros").select("id").eq("escritorio_id", ESC2).eq("usuario_id", elisa.id).single();
    const { count } = await admin.from("membro_permissoes").select("permissao", { count: "exact", head: true }).eq("membro_id", m.id);
    return count ?? 0;
  }

  /** Abre /equipe como a admin e escancara a gaveta da assistente. */
  async function abrirGaveta(page) {
    await page.goto(`${BASE}/equipe`);
    await page.getByText("Elisa").first().waitFor({ timeout: 25000 });
    await clicar(page, page.getByRole("button", { name: /Ações de Elisa/ }).first());
    await clicar(page, page.getByRole("menuitem", { name: /^Permissões/ }).first());
    const gaveta = page.locator("[data-permissoes-sheet]");
    await gaveta.waitFor({ timeout: 20000 });
    return gaveta;
  }

  const gravados = [];

  try {
    // ================= ATO 0 =================
    if (ato(0)) {
      const { page } = await parte(null);
      await cartao(page, "Ajustar permissão deixou de ser um clique perdido",
        "Duas mudanças na gaveta de permissões: marcar não grava mais sozinho, e cada permissão explica o que faz — e onde para.", 6200);
      await fechar(page);
      gravados.push("abertura");
    }

    // ================= ATO 1 · A GAVETA =================
    if (ato(1)) {
      const { page } = await parte(carla.nome ? `canario+admin@${DOM}` : `canario+admin@${DOM}`);
      const gaveta = await abrirGaveta(page);
      await narrar(page, "Carla administra o Canário. Elisa é assistente — e o papel dela já dá um conjunto de permissões.", 4200);
      await ler(page, 1500);
      await still(page, "ato1-01-gaveta");
      await narrar(page, "A lista vem do banco, grupo por grupo. O que está marcado é o que o papel dá.", 3800);
      await deslizar(page, gaveta.locator('li[data-permissao="casos:ler"]'));
      await ler(page, 2000);
      await still(page, "ato1-02-grupos");
      await narrar(page, "E o rodapé avisa: nada é gravado até você salvar.", 3400);
      await ler(page, 2200);
      await still(page, "ato1-03-rodape");
      await fechar(page);
      gravados.push("ato1");
    }

    // ================= ATO 2 · O "i" =================
    if (ato(2)) {
      const { page } = await parte(`canario+admin@${DOM}`);
      const gaveta = await abrirGaveta(page);
      await narrar(page, "Antes, a tela dizia só 'Ver casos'. Decidir conceder a partir de três palavras é chute.", 4400);
      const linha = gaveta.locator('li[data-permissao="casos:ler"]');
      await deslizar(page, linha);
      await clicar(page, linha.locator('[data-detalhe="casos:ler"]'));
      await page.locator("[data-detalhe-texto]").first().waitFor({ timeout: 10000 });
      await narrar(page, "Agora o 'i' conta o que a permissão alcança — e, principalmente, onde ela para.", 4200);
      await ler(page, 5000);
      await still(page, "ato2-01-detalhe-casos");
      await page.keyboard.press("Escape");

      const sens = gaveta.locator('li[data-permissao="clientes:excluir"]');
      await deslizar(page, sens);
      await clicar(page, sens.locator('[data-detalhe="clientes:excluir"]'));
      await page.locator("[data-detalhe-texto]").first().waitFor({ timeout: 10000 });
      await narrar(page, "Nas sensíveis, o texto diz o tamanho do estrago: apaga o cliente e tudo que é dele, sem desfazer.", 4800);
      await ler(page, 5000);
      await still(page, "ato2-02-detalhe-sensivel");
      await page.keyboard.press("Escape");
      await fechar(page);
      gravados.push("ato2");
    }

    // ================= ATO 3 · MARCAR NÃO GRAVA =================
    if (ato(3)) {
      const { page } = await parte(`canario+admin@${DOM}`);
      const gaveta = await abrirGaveta(page);
      const antes = await ajustes();
      const linha = gaveta.locator('li[data-permissao="comercial:gerenciar"]');
      await deslizar(page, linha);
      await narrar(page, "Carla marca o Comercial para a Elisa.", 3000);
      await clicar(page, linha.getByRole("checkbox").first());
      await linha.locator("[data-nao-salvo]").waitFor({ timeout: 10000 });
      await narrar(page, "A linha fica NÃO SALVO, e o botão passa a dizer quantas mudanças esperam.", 4200);
      await ler(page, 2500);
      await still(page, "ato3-01-nao-salvo");

      const durante = await ajustes();
      await painel(page, "O clique não chegou ao banco",
        `<table><tr><th>Momento</th><th>Ajustes da Elisa no banco</th></tr>
         <tr><td>Antes de marcar</td><td>${antes}</td></tr>
         <tr><td>Depois de marcar, sem salvar</td><td class="${durante === antes ? "ok" : "nao"}">${durante}${durante === antes ? " — nada mudou" : " — VAZOU"}</td></tr></table>
         <p style="margin-top:16px;font-size:16px;color:#44403c">Até 28/09 este clique já teria gravado. Marcar e desmarcar por engano escrevia duas linhas na Auditoria.</p>`, 6000);

      // o painel é um setContent: voltar é navegar de novo, não goBack
      const gaveta2 = await abrirGaveta(page);
      const linha2 = gaveta2.locator('li[data-permissao="comercial:gerenciar"]');
      await deslizar(page, linha2);
      await narrar(page, "E desmarcar não deixa resto: voltar ao que estava some com a pendência.", 4200);
      await clicar(page, linha2.getByRole("checkbox").first());
      await clicar(page, linha2.getByRole("checkbox").first());
      await ler(page, 2200);
      await still(page, "ato3-02-sem-pendencia");
      await fechar(page);
      gravados.push("ato3");
    }

    // ================= ATO 4 · SALVAR =================
    if (ato(4)) {
      const { page } = await parte(`canario+admin@${DOM}`);
      const gaveta = await abrirGaveta(page);
      await narrar(page, "Agora o caminho inteiro: Carla monta o conjunto antes de gravar.", 3800);
      const etiq = gaveta.locator('li[data-permissao="etiquetas:gerenciar"]');
      await deslizar(page, etiq);
      await clicar(page, etiq.getByRole("checkbox").first());
      const aud = gaveta.locator('li[data-permissao="auditoria:ler"]');
      await deslizar(page, aud);
      await clicar(page, aud.getByRole("checkbox").first());
      await narrar(page, "Duas mudanças pendentes — e nenhuma pergunta ainda, para não interromper quem está montando.", 4600);
      await ler(page, 2500);
      await still(page, "ato4-01-duas-pendentes");

      await clicar(page, page.locator("[data-salvar-permissoes]"));
      await page.getByRole("alertdialog").waitFor({ timeout: 15000 });
      await narrar(page, "É no salvar que a sensível pergunta, dizendo o que a pessoa passa a poder.", 4400);
      await ler(page, 4200);
      await still(page, "ato4-02-confirmacao");
      await clicar(page, page.getByRole("button", { name: /Conceder e salvar/ }).first());
      await aud.locator("[data-ajustada]").waitFor({ timeout: 20000 });
      await narrar(page, "Gravado. As duas viram ajuste, e cada uma deixou linha na Auditoria.", 4000);
      await ler(page, 2500);
      await still(page, "ato4-03-salvo");
      await fechar(page);
      gravados.push("ato4");
    }

    // ================= ATO 5 · SAIR SEM SALVAR =================
    if (ato(5)) {
      const { page } = await parte(`canario+admin@${DOM}`);
      const gaveta = await abrirGaveta(page);
      const linha = gaveta.locator('li[data-permissao="templates:gerenciar"]');
      await deslizar(page, linha);
      await clicar(page, linha.getByRole("checkbox").first());
      await narrar(page, "E se fechar com mudança pendente?", 3000);
      await clicar(page, gaveta.getByRole("button", { name: "Fechar" }).first());
      await page.getByRole("alertdialog").waitFor({ timeout: 15000 });
      await narrar(page, "O sistema avisa em vez de perder calado. Dá para voltar e continuar.", 4200);
      await ler(page, 3800);
      await still(page, "ato5-01-sair-sem-salvar");
      await clicar(page, page.getByRole("button", { name: /Continuar editando/ }).first());
      await clicar(page, page.locator("[data-descartar]"));
      await narrar(page, "Ou descartar de propósito — que também não toca no banco.", 3800);
      await ler(page, 2200);
      await still(page, "ato5-02-descartado");
      await fechar(page);
      gravados.push("ato5");
    }

    // ================= ATO 6 · O EFEITO REAL =================
    if (ato(6)) {
      await tentar("a Elisa abrindo a Auditoria", async () => {
        const { page } = await parte(`canario+assistente@${DOM}`);
        await page.goto(`${BASE}/auditoria`);
        await page.getByRole("heading", { name: /Auditoria/i }).first().waitFor({ timeout: 25000 });
        await narrar(page, "Elisa continua assistente — não virou administradora.", 3600);
        await ler(page, 1800);
        // A trilha da plataforma é OUTRO card, abaixo do log de senha do INSS.
        // Sem rolar até ele, o still pegava "0 eventos" enquanto a narração
        // dizia o contrário — erro já cometido antes, aqui não se repete.
        const trilha = page.locator("[data-trilha-plataforma]");
        const linhaTrilha = trilha.getByText(/Ajustou uma permissão por pessoa/).first();
        await linhaTrilha.waitFor({ timeout: 25000 });
        // rolar até a LINHA, não até o card: a lista é longa e o card começa
        // em eventos antigos — o still pegava a parte errada da trilha
        await deslizar(page, linhaTrilha);
        await narrar(page, "E a permissão que Carla salvou vale na hora: a trilha abre e mostra o que acabou de acontecer.", 5000);
        await ler(page, 4000);
        await still(page, "ato6-01-auditoria");
        await fechar(page);
        gravados.push("ato6");
      });
    }

    // ================= ATO 7 · FECHAMENTO =================
    if (ato(7)) {
      const { page } = await parte(null);
      await cartao(page, "O que muda no dia a dia",
        "Marcar vira intenção, não gravação. O conjunto é revisado antes de valer. E cada permissão diz onde termina — que é o que se precisa saber para decidir.", 7000);
      await fechar(page);
      gravados.push("fechamento");
    }
  } finally {
    console.log("\ndevolvendo o Canário ao estado de antes…");
    const passo = async (rotulo, f) => { try { await f(); console.log(`  ok  ${rotulo}`); } catch (e) { console.log(`  (!) ${rotulo}: ${String(e.message).slice(0, 120)}`); } };
    await passo("ajustes da Elisa desfeitos", async () => {
      const c = await sessao(`canario+admin@${DOM}`, ESC2);
      const { error } = await c.sb.rpc("resetar_permissoes_do_membro", { p_usuario_id: elisa.id });
      if (error) throw new Error(error.message);
    });
    await passo("conferência: nenhum ajuste sobrou", async () => {
      const n = await ajustes();
      if (n !== 0) throw new Error(`ainda há ${n} ajuste(s)`);
    });

    const clipes = await estudio.encerrar();
    fs.writeFileSync(path.join(estudio.saida, "legendas.json"), JSON.stringify({ legendas }, null, 2));
    console.log(`\natos gravados: ${gravados.join(", ") || "nenhum"}`);
    console.log(`clipes: ${clipes.length} | saída: ${estudio.saida}`);
    console.log("monte com: node e2e/demo/montar-filme.cjs permissoes-salvar-e-detalhe permissoes --legendado");
  }
})().catch((e) => { console.error("FALHA:", e); process.exit(1); });

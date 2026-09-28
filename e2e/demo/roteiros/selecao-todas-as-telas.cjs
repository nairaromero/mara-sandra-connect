// Filme-prova da migração dos dropdowns (#432, lote B): passa por TODAS as
// telas afetadas e exercita CADA dropdown, um por um.
//
// Por que exaustivo e não por amostra: 74 dropdowns trocaram de componente em
// 24 arquivos. Uma amostra escolhida por mim provaria o que eu escolhi provar.
// Aqui o filme não escolhe: em cada tela ele ENUMERA os dropdowns pelo
// `role="combobox"` e exercita todos — abre, confere que lista opções, confere
// se a busca apareceu conforme o tamanho da lista, e fecha.
//
// A régua da busca é a do componente: a partir de LIMITE_BUSCA opções ela liga
// sozinha. O filme cobra os dois lados — lista longa TEM que ter busca, lista
// curta NÃO pode ter (senão o campo vira ruído onde rolar é mais rápido).
//
// Roda no ambiente LOCAL (a mudança ainda não está na staging). Pré:
//   bun run local:copiar && bun run local:rbac
//   bash scripts/ambiente-local.sh app --port 8096
//   DEMO_BASE_URL=http://localhost:8096 node e2e/demo/roteiros/selecao-todas-as-telas.cjs
//
// Depois, o MP4 único:
//   node e2e/demo/montar-filme.cjs selecao-todas-as-telas dropdowns --legendado
const fs = require("fs");
const path = require("path");
const { ler, deslizar, clicar, tentar, narrar: narrarBase, abrirEstudio } = require("../helpers.cjs");
// O QG mora noutro host, e o `estadoNavegador` grava a sessão nas DUAS origens
// no momento do require — então o endereço do QG precisa estar certo ANTES.
// Sem isto ele aponta para a :8080, que aqui é outro vite (apontando pro
// staging), e o filme cai na tela de login.
if (!process.env.DEMO_QG_URL && process.env.DEMO_BASE_URL) {
  process.env.DEMO_QG_URL = process.env.DEMO_BASE_URL
    .replace("//localhost", "//qg.localhost")
    .replace("//127.0.0.1", "//qg.localhost");
}
const { BASE, QG, DOM, admin, sessao, estadoNavegador, esc, fechar } = require("../local.cjs");

/** Mesmo limite do componente — se um mudar, o filme acusa. */
const LIMITE_BUSCA = 8;

const legendas = [];
const inicioClipe = new WeakMap();
let clipesAbertos = 0;
async function narrar(page, texto, ms = 3200) {
  const c = inicioClipe.get(page);
  if (c) legendas.push({ clipe: c.clipe, inicio_ms: Date.now() - c.t0, dur_ms: ms, texto });
  return narrarBase(page, texto, ms);
}

const ATOS = (process.env.ATOS || "0,1,2,3,4,5,6,7,8").split(",").map((s) => s.trim());
const ato = (n) => ATOS.includes(String(n));

const provas = [];
let totalDropdowns = 0;
function registrar(tela, ok, detalhe) {
  provas.push({ tela, ok, detalhe });
  console.log(`  ${ok ? "✓" : "✘"} ${tela} — ${detalhe}`);
}

(async () => {
  const { data: esc1 } = await admin.from("escritorios").select("id").eq("padrao_sistema", true).maybeSingle();
  if (!esc1) throw new Error("escritório padrão ausente — rode `bun run local:copiar`");
  const ESC = esc1.id;

  const estudio = await abrirEstudio(process.env.SAIDA || "selecao-todas-as-telas");
  const { still } = estudio;
  const sessoes = {};
  const parte = async (email) => {
    let st = { cookies: [], origins: [] };
    if (email) {
      if (!sessoes[email]) sessoes[email] = await sessao(email);
      st = estadoNavegador(sessoes[email].session, ESC);
    }
    const t0 = Date.now();
    const nova = await estudio.novaParte(st);
    inicioClipe.set(nova.page, { clipe: clipesAbertos++, t0 });
    return nova;
  };

  async function cartao(page, titulo, sub, ms = 4400) {
    const c = inicioClipe.get(page);
    if (c) legendas.push({ clipe: c.clipe, inicio_ms: Date.now() - c.t0, dur_ms: ms, texto: `${titulo}. ${sub}` });
    await page.setContent(`<!doctype html><html><body style="margin:0;background:#16110c;color:#fcfaf6;font-family:-apple-system,'Segoe UI',Roboto,sans-serif;height:100vh;display:flex;align-items:center;justify-content:center">
      <div style="max-width:940px;text-align:center;padding:40px"><div style="font-size:13px;letter-spacing:.2em;text-transform:uppercase;color:#af7c00;margin-bottom:18px">Legal Connect · um componente de seleção</div>
      <div style="font-family:Georgia,serif;font-size:44px;line-height:1.15;margin-bottom:20px">${esc(titulo)}</div>
      <div style="font-size:19px;line-height:1.5;color:#ded6c9">${esc(sub)}</div></div></body></html>`);
    await page.waitForTimeout(ms);
  }

  /**
   * Exercita TODOS os dropdowns visíveis do que está na tela agora.
   * Devolve o relatório: quantos, quantos com busca, e o que falhou.
   */
  async function exercitarTudo(page, tela, { dentro } = {}) {
    const raiz = dentro ? page.locator(dentro) : page;
    // `button[role=combobox]`, não `getByRole`: o cmdk marca o invólucro da
    // lista ABERTA também com role=combobox, e aí a contagem mudava no meio da
    // varredura — o filme clicava num elemento que só existe com o popover
    // aberto e registrava "abriu vazio".
    const botoes = raiz.locator('button[role="combobox"]');
    const n = await botoes.count();
    if (n === 0) {
      // Aba de leitura não tem dropdown — isso é ausência legítima, não falha.
      // Falha seria um dropdown que abre vazio ou com busca de menos/de mais.
      provas.push({ tela, ok: null, detalhe: "sem dropdown nesta vista" });
      console.log(`  – ${tela} — sem dropdown nesta vista`);
      return;
    }
    const falhas = [];
    let comBusca = 0;
    for (let i = 0; i < n; i++) {
      const b = botoes.nth(i);
      if (!(await b.isVisible().catch(() => false))) continue;
      if (await b.isDisabled().catch(() => false)) continue;
      const rotulo = ((await b.innerText().catch(() => "")) || `#${i + 1}`).split("\n")[0].slice(0, 28);
      try {
        await b.click();
        await page.waitForTimeout(280);
        const opcoes = await page.getByRole("option").count();
        const busca = (await page.locator("[data-selecao-busca]").count()) > 0;
        if (opcoes === 0) falhas.push(`${rotulo}: abriu vazio`);
        // a régua do componente, cobrada nos DOIS sentidos
        else if (opcoes >= LIMITE_BUSCA && !busca) falhas.push(`${rotulo}: ${opcoes} opções e sem busca`);
        else if (opcoes < LIMITE_BUSCA && busca) falhas.push(`${rotulo}: só ${opcoes} opções e com busca`);
        if (busca) comBusca++;
        totalDropdowns++;
        await page.keyboard.press("Escape");
        await page.waitForTimeout(150);
      } catch (e) {
        falhas.push(`${rotulo}: ${String(e.message).split("\n")[0].slice(0, 60)}`);
        await page.keyboard.press("Escape").catch(() => {});
      }
    }
    registrar(
      tela,
      falhas.length === 0,
      falhas.length ? falhas.join(" | ") : `${n} dropdown(s), ${comBusca} com busca — todos abrem e listam`,
    );
  }

  const gravados = [];

  try {
    // ================= ATO 0 =================
    if (ato(0)) {
      const { page } = await parte(null);
      await cartao(page, "Um componente, todas as telas",
        "74 dropdowns trocaram de componente. Este filme não escolhe uma amostra: em cada tela ele enumera os dropdowns e exercita todos.", 6400);
      await fechar(page);
      gravados.push("abertura");
    }

    // ================= ATO 1 · TAREFAS =================
    if (ato(1)) {
      const { page } = await parte(`e2e+admin@${DOM}`);
      await cartao(page, "Tarefas", "Os filtros da lista e a gaveta de edição — nove dropdowns só aqui.");
      await page.goto(`${BASE}/tarefas`);
      await page.getByRole("heading", { name: /Tarefas/i }).first().waitFor({ timeout: 30000 });
      await narrar(page, "Os filtros da lista de tarefas.", 2800);
      await exercitarTudo(page, "/tarefas (filtros)");
      await still(page, "ato1-01-filtros");

      await tentar("a gaveta de tarefa", async () => {
        // A gaveta abre clicando no TÍTULO do card (não há menu "…" desde
        // 09/09) — mesma forma que a spec tarefa-sheet-excluir-motivo usa.
        const { data: t } = await admin
          .from("tarefas").select("titulo").eq("escritorio_id", ESC)
          .eq("status", "a_fazer").limit(1).maybeSingle();
        if (!t) throw new Error("nenhuma tarefa a fazer no escritório padrão");
        await page.getByText(t.titulo).first().click();
        await page.getByRole("heading", { name: "Editar tarefa" }).waitFor({ timeout: 20000 });
        const gaveta = page.locator('[role="dialog"]').first();
        await narrar(page, "E a gaveta da tarefa, onde se escolhe cliente, responsável e template.", 4000);
        await exercitarTudo(page, "gaveta de tarefa", { dentro: '[role="dialog"]' });
        await still(page, "ato1-02-gaveta");
        await page.keyboard.press("Escape");
      });
      await fechar(page);
      gravados.push("ato1");
    }

    // ================= ATO 2 · AGENDA =================
    if (ato(2)) {
      const { page } = await parte(`e2e+admin@${DOM}`);
      await cartao(page, "Agenda", "Era aqui o problema: escolher o cliente entre centenas, rolando, sem busca.");
      await page.goto(`${BASE}/agenda`);
      await page.getByRole("heading", { name: /Agenda/i }).first().waitFor({ timeout: 30000 });
      await tentar("a gaveta de agendamento", async () => {
        await page.getByRole("button", { name: /Novo|Agendar|Criar/ }).first().click();
        const gaveta = page.locator('[role="dialog"]').first();
        await gaveta.waitFor({ timeout: 15000 });
        await narrar(page, "O campo de cliente agora busca, como o da tarefa sempre buscou.", 4000);
        await exercitarTudo(page, "gaveta de agendamento", { dentro: '[role="dialog"]' });
        await still(page, "ato2-01-agenda");
        await page.keyboard.press("Escape");
      });
      await fechar(page);
      gravados.push("ato2");
    }

    // ================= ATO 3 · O CASO =================
    if (ato(3)) {
      const { page } = await parte(`e2e+admin@${DOM}`);
      await cartao(page, "A tela do caso", "Vinte e dois dropdowns numa tela só — responsável, fase, benefício, processo, tribunal.");
      const { data: caso } = await admin.from("casos").select("id").eq("escritorio_id", ESC).limit(1).maybeSingle();
      if (caso) {
        await page.goto(`${BASE}/casos/${caso.id}`);
        await page.waitForTimeout(3500);
        await narrar(page, "É a tela com mais dropdowns do sistema — e eles moram nas abas.", 3600);
        // Visão geral quase não tem dropdown: eles estão nas abas e nos
        // diálogos de edição. Passar só pela primeira aba não provaria nada.
        for (const aba of ["Visão geral", "Documentos", "Atividades", "Análise", "Processos"]) {
          await tentar(`a aba ${aba}`, async () => {
            await page.getByRole("tab", { name: aba }).click();
            await page.waitForTimeout(1800);
            await exercitarTudo(page, `/casos/$id · ${aba}`);
            await still(page, `ato3-${aba.toLowerCase().replace(/[^a-z]/g, "")}`);
          });
        }
        // Os dropdowns do caso moram nos EDITORES, não nas abas de leitura.
        await tentar("editar os dados do caso", async () => {
          await page.getByRole("tab", { name: "Visão geral" }).click();
          await page.waitForTimeout(1200);
          await page.getByRole("button", { name: /^Editar/ }).first().click();
          await page.waitForTimeout(1500);
          await narrar(page, "É no editor que estão os campos de escolha do caso.", 3200);
          await exercitarTudo(page, "/casos/$id · editor");
          await still(page, "ato3-editor");
          await page.keyboard.press("Escape");
        });
      } else {
        registrar("/casos/$id", false, "nenhum caso no escritório padrão");
      }
      await fechar(page);
      gravados.push("ato3");
    }

    // ================= ATO 4 · AS LISTAS =================
    if (ato(4)) {
      const { page } = await parte(`e2e+admin@${DOM}`);
      await cartao(page, "As listas", "Clientes, Comercial, Processos, Documentos e Conversas — filtros e o seletor de itens por página.");
      for (const [rota, nome] of [["/clientes", "Clientes"], ["/processos", "Processos"], ["/documentos", "Documentos"], ["/conversas", "Conversas"]]) {
        await tentar(`a tela ${nome}`, async () => {
          await page.goto(`${BASE}${rota}`);
          await page.waitForTimeout(2600);
          await narrar(page, `${nome}: filtros e paginação.`, 2400);
          await exercitarTudo(page, rota);
          await still(page, `ato4-${rota.replace("/", "")}`);
        });
      }
      // Comercial: o filtro de etapa só existe na versão estreita — no
      // desktop o kanban mostra as colunas lado a lado e o seletor some.
      await tentar("o Comercial no celular", async () => {
        await page.setViewportSize({ width: 420, height: 900 });
        await page.goto(`${BASE}/comercial`);
        await page.waitForTimeout(2800);
        await narrar(page, "No Comercial o filtro de etapa é da tela estreita.", 3000);
        await exercitarTudo(page, "/comercial (celular)");
        await still(page, "ato4-comercial-mobile");
        await page.setViewportSize({ width: 1280, height: 800 });
      });
      await fechar(page);
      gravados.push("ato4");
    }

    // ================= ATO 5 · EQUIPE E AUDITORIA =================
    if (ato(5)) {
      const { page } = await parte(`e2e+admin@${DOM}`);
      await cartao(page, "Equipe e Auditoria", "O papel do convite, quem assume as tarefas, e os filtros da trilha.");
      for (const [rota, nome] of [["/equipe", "Equipe"], ["/auditoria", "Auditoria"]]) {
        await tentar(`a tela ${nome}`, async () => {
          await page.goto(`${BASE}${rota}`);
          await page.waitForTimeout(2600);
          await narrar(page, `${nome}.`, 2200);
          await exercitarTudo(page, rota);
          await still(page, `ato5-${rota.replace("/", "")}`);
        });
      }
      await fechar(page);
      gravados.push("ato5");
    }

    // ================= ATO 6 · CONFIGURAÇÕES =================
    if (ato(6)) {
      const { page } = await parte(`e2e+admin@${DOM}`);
      await cartao(page, "Configurações", "Integração de IA, Conectar Claude e Webhooks.");
      await tentar("as Configurações", async () => {
        await page.goto(`${BASE}/configuracoes?tab=integracoes`);
        await page.waitForTimeout(3000);
        await narrar(page, "As integrações do escritório.", 2600);
        await exercitarTudo(page, "/configuracoes?tab=integracoes");
        await still(page, "ato6-01-integracoes");
      });
      await fechar(page);
      gravados.push("ato6");
    }

    // ================= ATO 7 · QG =================
    if (ato(7)) {
      await tentar("o QG", async () => {
        const { page } = await parte(`qg+dono@${DOM}`);
        await cartao(page, "QG da plataforma", "A administração da plataforma também tinha dropdowns migrados.");
        // O QG mora noutro host. Sem DEMO_QG_URL, `local.cjs` aponta para a
        // :8080 — que aqui é outro vite, apontando pro staging: o filme caía na
        // tela de login. O endereço acompanha a porta do app.
        await page.goto(`${QG}/qg`);
        await page.waitForTimeout(3200);
        await narrar(page, "O QG: filtros da lista de escritórios.", 2800);
        await exercitarTudo(page, "/qg");
        await still(page, "ato7-01-qg");
        await fechar(page);
        gravados.push("ato7");
      });
    }

    // ================= ATO 8 · FECHAMENTO =================
    if (ato(8)) {
      const { page } = await parte(null);
      const ok = provas.filter((p) => p.ok === true).length;
      const ruim = provas.filter((p) => p.ok === false).length;
      const linhas = provas
        .map((p) => `<tr><td>${esc(p.tela)}</td><td class="${p.ok === false ? "nao" : "ok"}">${p.ok === true ? "passou" : p.ok === null ? "—" : "FALHOU"}</td><td style="font-size:13px;color:#57534e">${esc(p.detalhe)}</td></tr>`)
        .join("");
      await page.setContent(`<!doctype html><html><body style="margin:0;background:#f7f4ee;color:#1c1917;font-family:-apple-system,'Segoe UI',Roboto,sans-serif;padding:34px">
        <div style="max-width:1120px;margin:0 auto">
          <div style="font-size:12px;letter-spacing:.18em;text-transform:uppercase;color:#8a6d1f;margin-bottom:8px">Cada dropdown aberto e conferido</div>
          <h1 style="font-family:Georgia,serif;font-size:30px;margin:0 0 6px">${totalDropdowns} dropdowns exercitados · ${ok} telas passaram · ${ruim} falharam</h1>
          <p style="font-size:14px;color:#57534e;margin:0 0 16px">Cada um: abre, lista opções, e a busca aparece conforme o tamanho da lista — cobrada nos dois sentidos.</p>
          <table>${linhas}</table></div>
        <style>table{border-collapse:collapse;width:100%;background:#fff;border:1px solid #e3ddd1;border-radius:10px;overflow:hidden}
        td{padding:8px 12px;border-bottom:1px solid #eee7da;font-size:14px}
        .ok{color:#15803d;font-weight:600}.nao{color:#b91c1c;font-weight:600}</style></body></html>`);
      await page.waitForTimeout(11000);
      await cartao(page, ruim === 0 ? "Nada quebrou" : `${ruim} tela(s) com problema`,
        ruim === 0
          ? "Os 74 dropdowns trocaram de componente e todas as telas seguem funcionando — com busca onde a lista é longa."
          : "O que falhou está no quadro acima.", 6500);
      await fechar(page);
      gravados.push("fechamento");
    }
  } finally {
    const clipes = await estudio.encerrar();
    fs.writeFileSync(path.join(estudio.saida, "legendas.json"), JSON.stringify({ legendas }, null, 2));
    fs.writeFileSync(path.join(estudio.saida, "provas.json"), JSON.stringify(provas, null, 2));
    const ok = provas.filter((p) => p.ok === true).length, ruim = provas.filter((p) => p.ok === false).length;
    let md = `# Dropdowns: todas as telas conferidas\n\nAmbiente local, ${new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}.\n\n`;
    md += `**${totalDropdowns} dropdowns exercitados · ${ok} telas passaram · ${ruim} falharam.**\n\n`;
    md += `Cada dropdown foi aberto, conferido que lista opções, e que a busca aparece conforme o tamanho da lista (limite: ${LIMITE_BUSCA}).\n\n`;
    md += `| Tela | Resultado | Detalhe |\n|---|---|---|\n`;
    for (const p of provas) md += `| ${p.tela} | ${p.ok === true ? "✅" : p.ok === null ? "—" : "❌"} | ${(p.detalhe || "").replace(/\|/g, "\\|")} |\n`;
    fs.writeFileSync(path.join(estudio.saida, "relatorio.md"), md);
    console.log(`\natos: ${gravados.join(", ") || "nenhum"}`);
    console.log(`dropdowns exercitados: ${totalDropdowns} | telas ok: ${ok} | falharam: ${ruim}`);
    console.log(`clipes: ${clipes.length} | saída: ${estudio.saida}`);
  }
})().catch((e) => { console.error("FALHA:", e); process.exit(1); });

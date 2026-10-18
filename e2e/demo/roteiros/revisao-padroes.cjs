// Filme-prova da revisão de padrões do #397: os quatro consertos, na tela.
//
// O que cada ato prova, e por que ele existe:
//
//   1. GATE — quem não tem `tarefas:gerenciar` recebia o formulário de pedido
//      de prorrogação e só descobria no ENVIO que o servidor recusa. A situação
//      não é hipotética: qualquer interno VÊ tarefas (policy
//      `tarefas_select_interno`), e a permissão se tira por pessoa (#399).
//   2. GLOSSÁRIO — os conceitos novos (relógio, reta final, prorrogação,
//      janela) não existiam lá. E o parceiro continua sem vê-los.
//   3. RADAR PAGINADO — a lista vinha inteira. Com 30 relógios: 25 numa página,
//      5 na outra, e os números do BOTÃO vindos do total, não da página.
//   4. TÚNEL — erro de leitura não pode virar "não tem nada". Aqui o filme
//      DERRUBA a consulta de propósito (route → 500) e mostra a tela dizendo
//      que não conseguiu ler, em vez de sumir calada.
//
// Pré: pilha local de pé, migrations do #397 aplicadas, app numa porta livre.
//   bash scripts/ambiente-local.sh app --port 8098
//   DEMO_BASE_URL=http://localhost:8098 node e2e/demo/roteiros/revisao-padroes.cjs
//
// Depois, o MP4 único:
//   node e2e/demo/montar-filme.cjs revisao-padroes revisao --legendado
const fs = require("fs");
const path = require("path");
const { narrar: narrarBase, abrirEstudio, cpfValido } = require("../helpers.cjs");
const { BASE, DOM, admin, sessao, estadoNavegador, fechar } = require("../local.cjs");

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
  const { data: canario } = await admin.from("escritorios").select("id").eq("slug", "canario").maybeSingle();
  if (!canario) throw new Error("escritório Canário ausente — rode `bun run local:rbac`");
  const ESC2 = canario.id;
  const { data: padrao } = await admin.from("escritorios").select("id").eq("padrao_sistema", true).single();
  const ESC1 = padrao.id;

  const marca = `Rev ${String(Date.now()).slice(-6)}`;
  const criados = { clientes: [], casos: [] };
  let permissaoTirada = false;

  const estudio = await abrirEstudio("revisao-padroes");
  const still = estudio.still;
  const parte = async (email, escritorio) => {
    const s = await sessao(email);
    const p = await estudio.novaParte(estadoNavegador(s.session, escritorio));
    inicioClipe.set(p.page, { clipe: clipesAbertos++, t0: Date.now() });
    return p;
  };

  const { data: assistente } = await admin
    .from("usuarios").select("id, nome").eq("email", `canario+assistente@${DOM}`).single();

  /** Cria caso + relógio + tarefa da etapa, tudo no escritório pedido. */
  const cenarioRelogio = async (escritorioId, responsavelId, rotulo) => {
    const { data: cli, error: e1 } = await admin
      .from("clientes").insert({ nome: `[REV] ${marca} ${rotulo}`, cpf: cpfValido(), escritorio_id: escritorioId })
      .select("id").single();
    if (e1) throw new Error(`cliente: ${e1.message}`);
    criados.clientes.push(cli.id);
    const { data: caso, error: e2 } = await admin
      .from("casos").insert({ cliente_id: cli.id, tipo_beneficio: "Auxílio-acidente", escritorio_id: escritorioId })
      .select("id").single();
    if (e2) throw new Error(`caso: ${e2.message}`);
    criados.casos.push(caso.id);
    const hoje = new Date().toISOString().slice(0, 10);
    const { data: etapas, error: e3 } = await admin.rpc("relogio_etapas", { p_tipo: "judicial", p_origem: hoje });
    if (e3) throw new Error(`etapas: ${e3.message}`);
    const mais = (n) => new Date(Date.now() + n * 86400_000).toISOString().slice(0, 10);
    const { data: rel, error: e4 } = await admin.from("relogios_prazo").insert({
      escritorio_id: escritorioId, caso_id: caso.id, tipo: "judicial",
      origem_em: hoje, etapas, planejado_em: mais(5), limite_em: mais(8),
    }).select("id").single();
    if (e4) throw new Error(`relógio: ${e4.message}`);
    const titulo = `Montagem da inicial - ${marca} ${rotulo}`;
    const { error: e5 } = await admin.from("tarefas").insert({
      caso_id: caso.id, escritorio_id: escritorioId, tipo: "interna", titulo,
      responsavel_id: responsavelId, status: "a_fazer",
      due_at: new Date(Date.now() + 2 * 86400_000).toISOString(),
      metadata: { relogio_id: rel.id, relogio_etapa: "montagem" },
    });
    if (e5) throw new Error(`tarefa: ${e5.message}`);
    return { casoId: caso.id, titulo };
  };

  const abrirTarefa = async (page, casoId, titulo) => {
    await page.goto(`${BASE}/casos/${casoId}`);
    await page.waitForTimeout(2200);
    await page.getByText("Atividades", { exact: true }).first().click();
    await page.getByText(titulo).first().waitFor({ state: "visible", timeout: 20000 });
    await page.locator("div.group").filter({ hasText: titulo }).first().getByText(titulo).click();
    await page.getByRole("heading", { name: "Editar tarefa" }).waitFor({ timeout: 10000 });
    await page.waitForTimeout(700);
  };

  /** Empurra o prazo MUITO para a frente e tenta salvar.
   *
   * Espera o `relogio-linha` antes: o aviso de prorrogação só existe quando a
   * tela JÁ carregou o relógio (`if (relogio && relogioRef && tarefa)`). Sem
   * esperar, o filme salvava antes da consulta voltar e nada acontecia — e a
   * culpa pareceria do produto. */
  const tentarAdiarMuito = async (page) => {
    await page
      .getByTestId("relogio-linha")
      .first()
      .waitFor({ state: "visible", timeout: 15000 })
      .catch(() => {});
    const campo = page.getByLabel(/Prazo|Vence|Data/i).first();
    const longe = new Date(Date.now() + 120 * 86400_000);
    const iso = `${longe.toISOString().slice(0, 10)}T09:00`;
    await campo.fill(iso).catch(async () => {
      await page.locator('input[type="datetime-local"]').first().fill(iso);
    });
    await page.waitForTimeout(500);
    await page.getByRole("button", { name: /^Salvar/ }).first().click();
    await page.waitForTimeout(2200);
  };

  try {
    // ================= ATO 1 · O GATE QUE JÁ EXISTIA =================
    // A revisão tinha acusado "tarefa-sheet sem gate de escrita". ERRADO: o
    // gate está lá, com outro nome (`usePodeAcao`), e por isso o grep não
    // achou. Este ato mostra o gate real funcionando — e é a razão de o
    // `podeChamar` que eu havia acrescentado ter sido removido: ele nunca
    // reprovaria ninguém que o `podeMexer` já não tivesse reprovado antes.
    {
      const cen = await cenarioRelogio(ESC2, assistente.id, "gate");

      const c = await sessao(`canario+admin@${DOM}`, ESC2);
      const r = await c.sb.rpc("definir_permissao_do_membro", {
        p_usuario_id: assistente.id, p_permissao: "tarefas:gerenciar", p_estado: "remover",
      });
      if (r.error) throw new Error(`tirar permissão: ${r.error.message}`);
      permissaoTirada = true;

      const { page } = await parte(`canario+assistente@${DOM}`, ESC2);
      await narrar(page, "Esta pessoa é interna: ela VÊ as tarefas do escritório.", 4000);
      await abrirTarefa(page, cen.casoId, cen.titulo);
      await narrar(page, "Mas a permissão de gerenciar tarefas foi tirada dela.", 3800);
      const salvarSem = await page.getByRole("button", { name: "Salvar" }).count();
      const fecharSem = await page.getByRole("button", { name: "Fechar" }).count();
      await narrar(page, "A tela não oferece Salvar — só Fechar. Nada a preencher à toa.", 4600);
      await still(page, "1-sem-permissao");
      registrar(
        "sem a permissão, a tela não oferece a escrita",
        salvarSem === 0 && fecharSem > 0,
        `botão Salvar: ${salvarSem} · botão Fechar: ${fecharSem}`,
      );
      await fechar(page);

      const r2 = await c.sb.rpc("definir_permissao_do_membro", {
        p_usuario_id: assistente.id, p_permissao: "tarefas:gerenciar", p_estado: "papel",
      });
      if (r2.error) throw new Error(`devolver permissão: ${r2.error.message}`);
      permissaoTirada = false;

      const p2 = await parte(`canario+assistente@${DOM}`, ESC2);
      await narrar(p2.page, "Com a permissão de volta, o Salvar aparece.", 4000);
      await abrirTarefa(p2.page, cen.casoId, cen.titulo);
      const salvarCom = await p2.page.getByRole("button", { name: "Salvar" }).count();
      await narrar(p2.page, "E aí sim ela empurra o prazo além do limite do relógio…", 4200);
      await tentarAdiarMuito(p2.page);
      const corpo2 = await p2.page.locator("body").innerText();
      // A tela NÃO usa a palavra "prorrogação" aqui: o diálogo diz "Este prazo
      // não pode ser adiado" e o botão é "Pedir à Mara". Procurar o jargão em
      // vez do que está escrito reprovava um produto que estava certo.
      const abriu = /Este prazo não pode ser adiado/i.test(corpo2) && /Pedir à Mara/i.test(corpo2);
      await narrar(p2.page, "…e o sistema barra: passar do limite só com a Mara aprovando.", 4600);
      await still(p2.page, "1-com-permissao");
      registrar(
        "com a permissão, escreve e o pedido de prorrogação aparece",
        salvarCom > 0 && abriu,
        `botão Salvar: ${salvarCom} · diálogo "Pedir à Mara" na tela: ${abriu ? "sim" : "NÃO"}`,
      );
      await fechar(p2.page);
    }

    // ================= ATO 2 · O GLOSSÁRIO =================
    {
      const { page } = await parte(`canario+advogado@${DOM}`, ESC2);
      await page.goto(`${BASE}/glossario?q=rel%C3%B3gio`);
      await page.waitForTimeout(2500);
      await narrar(page, "Os conceitos novos entraram no glossário — eram zero.", 4000);
      const texto = await page.locator("body").innerText();
      const termos = ["Relógio de prazos", "Reta final", "Pedido de prorrogação", "Janela de prazo"];
      await page.goto(`${BASE}/glossario`);
      await page.waitForTimeout(2500);
      const todos = await page.locator("body").innerText();
      const faltando = termos.filter((t) => !todos.includes(t));
      await narrar(page, "Relógio de prazos, reta final, pedido de prorrogação e janela.", 4400);
      await still(page, "2-glossario-interno");
      registrar(
        "os 4 termos novos estão no glossário da equipe",
        faltando.length === 0,
        faltando.length ? `faltando: ${faltando.join(", ")}` : termos.join(" · "),
      );
      await fechar(page);

      const p2 = await parte(`canario+parceiro@${DOM}`, ESC2);
      await p2.page.goto(`${BASE}/glossario`);
      await p2.page.waitForTimeout(2500);
      const doParceiro = await p2.page.locator("body").innerText();
      const vazou = termos.filter((t) => doParceiro.includes(t));
      await narrar(p2.page, "E o parceiro não vê nenhum deles: são termos internos.", 4200);
      await still(p2.page, "2-glossario-parceiro");
      registrar(
        "nenhum termo interno vaza para o parceiro",
        vazou.length === 0,
        vazou.length ? `VAZOU: ${vazou.join(", ")}` : "nenhum dos 4 aparece",
      );
      await fechar(p2.page);
      void texto;
    }

    // ================= ATO 3 · O RADAR PAGINADO =================
    {
      // 30 relógios no escritório padrão: 25 numa página, 5 na outra
      const { data: cli } = await admin
        .from("clientes").insert({ nome: `[REV] ${marca} radar`, cpf: cpfValido(), escritorio_id: ESC1 })
        .select("id").single();
      criados.clientes.push(cli.id);
      const hoje = new Date().toISOString().slice(0, 10);
      const { data: etapas } = await admin.rpc("relogio_etapas", { p_tipo: "judicial", p_origem: hoje });
      const mais = (n) => new Date(Date.now() + n * 86400_000).toISOString().slice(0, 10);
      for (let i = 0; i < 30; i++) {
        const { data: caso } = await admin
          .from("casos").insert({ cliente_id: cli.id, tipo_beneficio: "Auxílio-acidente", escritorio_id: ESC1 })
          .select("id").single();
        criados.casos.push(caso.id);
        const { error } = await admin.from("relogios_prazo").insert({
          escritorio_id: ESC1, caso_id: caso.id, tipo: "judicial",
          origem_em: hoje, etapas, planejado_em: mais(30), limite_em: mais(40),
        });
        if (error) throw new Error(`relógio ${i}: ${error.message}`);
      }

      const { page } = await parte(`e2e+admin@${DOM}`, ESC1);
      await page.goto(`${BASE}/tarefas`);
      await page.waitForTimeout(3000);
      await narrar(page, "O radar da Mara com 30 relógios abertos.", 3600);
      const botao = page.getByTestId("radar-prazos");
      const textoBotao = (await botao.innerText()).replace(/\n/g, " ");
      await botao.click();
      await page.waitForTimeout(2500);
      const p1 = await page.getByTestId("radar-linha").count();
      const corpo1 = await page.locator("body").innerText();
      await narrar(page, "A lista vem por página — não mais inteira de uma vez.", 4200);
      await still(page, "3-radar-p1");

      await page.getByRole("button", { name: "Página 2" }).first().click();
      await page.waitForTimeout(2200);
      const p2n = await page.getByTestId("radar-linha").count();
      const corpo2 = await page.locator("body").innerText();
      const botaoP2 = corpo2.split("\n").filter((l) => /Prazos dos casos/.test(l)).join(" ");
      await narrar(page, "Na página 2, o número do botão continua o do TOTAL.", 4400);
      await still(page, "3-radar-p2");

      registrar(
        "o radar pagina e os totais do botão não mudam de página",
        p1 === 25 && p2n === 5 && /30/.test(textoBotao) && /30/.test(botaoP2),
        `página 1: ${p1} linhas · página 2: ${p2n} · botão p1: "${textoBotao.slice(0, 40)}" · botão p2: "${botaoP2.slice(0, 40)}"`,
      );
      void corpo1;
      await fechar(page);
    }

    // ================= ATO 4 · O TÚNEL =================
    {
      const { page } = await parte(`e2e+admin@${DOM}`, ESC1);
      // Derruba a consulta do radar DE PROPÓSITO. É a prova do princípio dos
      // túneis: erro não pode virar "não tem nada".
      await page.route("**/rpc/radar_prazos*", (rota) =>
        rota.fulfill({ status: 500, contentType: "application/json", body: '{"message":"falha simulada pelo filme"}' }),
      );
      await page.goto(`${BASE}/tarefas`);
      await page.waitForTimeout(3000);
      await narrar(page, "Agora o filme DERRUBA a consulta do radar de propósito.", 4200);
      const corpo = await page.locator("body").innerText();
      const avisou = /Não consegui ler o radar/i.test(corpo);
      const sumiuCalado = !avisou && !/Prazos dos casos/.test(corpo);
      await narrar(page, "A tela diz que não conseguiu ler — em vez de sumir calada.", 4600);
      await narrar(page, "Sumir calada seria o mesmo que dizer 'nenhum prazo em risco'.", 4600);
      await still(page, "4-erro-aparece");
      registrar(
        "falha de leitura aparece, não vira 'nada a mostrar'",
        avisou,
        avisou ? "a tela mostrou o aviso de erro" : sumiuCalado ? "o radar SUMIU calado" : "nem aviso nem radar",
      );
      await fechar(page);
    }
  } finally {
    console.log("\ndevolvendo o ambiente…");
    if (permissaoTirada) {
      try {
        const c = await sessao(`canario+admin@${DOM}`, ESC2);
        await c.sb.rpc("definir_permissao_do_membro", {
          p_usuario_id: assistente.id, p_permissao: "tarefas:gerenciar", p_estado: "papel",
        });
        console.log("  ok  permissão do assistente devolvida");
      } catch (e) {
        console.log(`  (!) permissão do assistente: ${String(e.message).slice(0, 120)}`);
      }
    }
    if (criados.casos.length) {
      await admin.from("relogios_prazo").delete().in("caso_id", criados.casos);
      await admin.from("tarefas").delete().in("caso_id", criados.casos);
      await admin.from("casos").delete().in("id", criados.casos);
    }
    if (criados.clientes.length) await admin.from("clientes").delete().in("id", criados.clientes);
    const { data: sobra } = await admin.from("clientes").select("id").like("nome", `[REV] ${marca}%`);
    const { data: relSobra } = await admin.from("relogios_prazo").select("id");
    console.log(`  cliente(s) do filme restante(s): ${(sobra ?? []).length}`);
    console.log(`  relógio(s) no banco: ${(relSobra ?? []).length}`);

    const clipes = await estudio.encerrar();
    fs.writeFileSync(path.join(estudio.saida, "legendas.json"), JSON.stringify({ legendas }, null, 2));
    fs.writeFileSync(path.join(estudio.saida, "provas.json"), JSON.stringify(provas, null, 2));
    const ok = provas.filter((p) => p.ok).length;
    console.log(`\nconferências: ${ok} ok · ${provas.length - ok} falhou`);
    console.log(`clipes: ${clipes.length} | saída: ${estudio.saida}`);
    if (provas.some((p) => !p.ok) || provas.length === 0) process.exitCode = 1;
  }
})();

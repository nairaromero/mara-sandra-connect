// Filme-prova da resolução do conflito em `src/lib/tarefas/aplicador.ts` (#397
// × staging): o que ela conserta, mostrado na tela.
//
// A trava de duplicação de corrente tem DOIS jeitos de estar errada, e eles
// são opostos:
//
//   LARGA demais  → o requerimento 1 bloqueia o 2, e uma tarefa que devia
//                   nascer some. Era o estado da staging (trava do CASO).
//   ESTREITA demais → a mesma corrente abre duas vezes no mesmo processo, e a
//                   tarefa nasce em dobro.
//
// Provar só um lado não prova nada: dá para passar em qualquer um dos dois
// sozinho quebrando o outro. O filme mostra os dois no mesmo caso, com os
// mesmos dois requerimentos.
//
// A terceira metade não tem tela: a consulta da trava passa por `lerLista`
// (túnel de src/lib/leitura.ts). Com `const { data }`, falha de consulta
// devolvia nulo, a trava não disparava e o template era aplicado DUAS vezes —
// a proteção sumia em silêncio. Quem cobra isso é a régua
// `e2e/unit/leituras-checadas.test.ts`, e o filme só narra.
//
// Pré: pilha local de pé e as 3 migrations do #397 aplicadas.
//   bash scripts/ambiente-local.sh app --port 8096
//   DEMO_BASE_URL=http://localhost:8096 node e2e/demo/roteiros/dedup-por-processo.cjs
//
// Depois, o MP4 único:
//   node e2e/demo/montar-filme.cjs dedup-por-processo dedup --legendado
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

const TITULO_MONTAGEM = "Montagem da inicial%";

(async () => {
  const { data: escritorio } = await admin
    .from("escritorios")
    .select("id")
    .eq("padrao_sistema", true)
    .maybeSingle();
  if (!escritorio) throw new Error("escritório padrão ausente — rode `bun run local:copiar`");
  const ESC = escritorio.id;

  // Rótulo curto de propósito: o card da lista TRUNCA títulos longos, e aí a
  // busca por texto exato não acha a tarefa. Custou duas voltas descobrir.
  const marca = `Dedup ${String(Date.now()).slice(-6)}`;
  const nomeCliente = `[DEMO] ${marca}`;
  let clienteId = null;
  let casoId = null;

  const estudio = await abrirEstudio("dedup-por-processo");
  const still = estudio.still;
  const parte = async (email) => {
    const s = await sessao(email);
    const p = await estudio.novaParte(estadoNavegador(s.session, ESC));
    inicioClipe.set(p.page, { clipe: clipesAbertos++, t0: Date.now() });
    return p;
  };

  /** Quantas montagens abertas existem NESTE requerimento. */
  const montagensDo = async (processoAdminId) => {
    const { data, error } = await admin
      .from("tarefas")
      .select("id")
      .eq("caso_id", casoId)
      .eq("processo_admin_id", processoAdminId)
      .eq("status", "a_fazer")
      .like("titulo", TITULO_MONTAGEM);
    // erro não pode virar zero: seria o mesmo defeito que o filme investiga
    if (error) throw new Error(`contagem de montagens: ${error.message}`);
    return data.length;
  };

  // Mesmos seletores de `e2e/tarefas.ts` (abrirTarefaNoCaso), que é o que as
  // specs usam: "Atividades" por texto exato, e o card pelo `div.group` que o
  // contém. A 1ª versão deste filme inventou os seus e não achou a tarefa
  // quando a lista cresceu — o clique precisa do card, não de qualquer texto.
  const abrirTarefa = async (page, titulo) => {
    await page.goto(`${BASE}/casos/${casoId}`);
    await page.waitForTimeout(2000);
    await page.getByText("Atividades", { exact: true }).first().click();
    await page.getByText(titulo).first().waitFor({ state: "visible", timeout: 20000 });
    await page.locator("div.group").filter({ hasText: titulo }).first().getByText(titulo).click();
    await page.getByRole("heading", { name: "Editar tarefa" }).waitFor({ timeout: 10000 });
    await page.waitForTimeout(800);
  };

  const ajuizar = async (page) => {
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Ajuizar (montagem de inicial)" })
      .click();
    await page.waitForTimeout(2200);
  };

  try {
    // ---------- cenário: um caso, DOIS requerimentos ----------
    const { data: cli, error: errCli } = await admin
      .from("clientes")
      .insert({ nome: nomeCliente, cpf: cpfValido(), escritorio_id: ESC })
      .select("id")
      .single();
    if (errCli) throw new Error(`cliente: ${errCli.message}`);
    clienteId = cli.id;
    const { data: caso, error: errCaso } = await admin
      .from("casos")
      .insert({ cliente_id: clienteId, tipo_beneficio: "Auxílio-acidente", escritorio_id: ESC })
      .select("id")
      .single();
    if (errCaso) throw new Error(`caso: ${errCaso.message}`);
    casoId = caso.id;
    const { data: procs, error: errProc } = await admin
      .from("processos_admin")
      .insert([
        { caso_id: casoId, numero_requerimento: "9990000001", escritorio_id: ESC },
        { caso_id: casoId, numero_requerimento: "9990000002", escritorio_id: ESC },
      ])
      .select("id, numero_requerimento");
    if (errProc) throw new Error(`processos: ${errProc.message}`);
    const req1 = procs.find((p) => p.numero_requerimento === "9990000001").id;
    const req2 = procs.find((p) => p.numero_requerimento === "9990000002").id;

    const { data: eu } = await admin
      .from("usuarios")
      .select("id")
      .eq("email", `e2e+interno@${DOM}`)
      .single();

    const semearAnalise = async (rotulo, processoAdminId) => {
      const titulo = `Analise de Indeferimento - ${marca} ${rotulo}`;
      const { error } = await admin.from("tarefas").insert({
        caso_id: casoId,
        escritorio_id: ESC,
        tipo: "interna",
        titulo,
        responsavel_id: eu.id,
        processo_admin_id: processoAdminId,
        metadata: { template: "indeferido", analise_indeferimento: true },
      });
      if (error) throw new Error(`seed ${rotulo}: ${error.message}`);
      return titulo;
    };

    // Rótulos que NÃO são prefixo um do outro. Com "R1" e "R1b", o
    // `filter({ hasText })` do card casava com os dois e o clique caía no
    // errado: parecia que o sistema concluía a tarefa irmã. Não concluía — era
    // o roteiro clicando no lugar errado. Custou três voltas.
    const tAlfa = await semearAnalise("alfa", req1);
    const tBeta = await semearAnalise("beta", req1);
    const tGama = await semearAnalise("gama", req2);

    // ================= ATO 1 · o caso com duas frentes =================
    {
      const { page } = await parte(`e2e+interno@${DOM}`);
      await page.goto(`${BASE}/casos/${casoId}`);
      await page.waitForTimeout(3000);
      await narrar(page, "Um caso com DOIS requerimentos — duas frentes correndo ao mesmo tempo.", 4400);
      await narrar(page, "A trava que impede abrir a mesma corrente duas vezes vive aqui.", 4200);
      await still(page, "1-caso-duas-frentes");
      await fechar(page);
    }

    // ================= ATO 2 · larga demais faz SUMIR tarefa =================
    {
      const { page } = await parte(`e2e+interno@${DOM}`);
      await narrar(page, "Primeiro: abrir a montagem da inicial no requerimento 1.", 4000);
      await abrirTarefa(page, tAlfa);
      await ajuizar(page);
      await still(page, "2-montagem-no-r1");
      const r1 = await montagensDo(req1);

      await narrar(page, "Agora a MESMA ação no requerimento 2. Antes, a trava do caso recusava aqui.", 5000);
      await abrirTarefa(page, tGama);
      await ajuizar(page);
      await still(page, "2-montagem-no-r2");
      const r2 = await montagensDo(req2);

      registrar(
        "um requerimento não bloqueia o outro",
        r1 === 1 && r2 === 1,
        `montagens abertas — R1: ${r1}, R2: ${r2} (esperado 1 e 1)`,
      );
      await narrar(page, "As duas frentes têm a sua montagem. Nenhuma tarefa sumiu.", 4000);
      await fechar(page);
    }

    // ================= ATO 3 · estreita demais faz NASCER EM DOBRO =========
    {
      const { page } = await parte(`e2e+interno@${DOM}`);
      await narrar(page, "O outro lado: repetir a ação no MESMO requerimento 1.", 4200);
      await abrirTarefa(page, tBeta);
      await ajuizar(page);
      await page.waitForTimeout(1500);
      const corpo = await page.locator("body").innerText();
      const recusou = /já está aberta neste processo/i.test(corpo);
      await narrar(page, "A trava recusa: a corrente já está aberta NESTE processo.", 4200);
      await still(page, "3-recusa-no-mesmo-processo");
      const r1depois = await montagensDo(req1);

      registrar(
        "a mesma corrente não abre duas vezes no mesmo processo",
        recusou && r1depois === 1,
        `recusa na tela: ${recusou ? "sim" : "NÃO"} · montagens no R1: ${r1depois} (esperado 1)`,
      );
      await fechar(page);
    }

    // ================= ATO 4 · a metade sem tela =================
    {
      const { page } = await parte(`e2e+interno@${DOM}`);
      await page.goto(`${BASE}/casos/${casoId}`);
      await page.waitForTimeout(2500);
      await narrar(page, "Falta uma terceira metade, e ela não tem tela.", 4000);
      await narrar(page, "A consulta da trava passa pelo túnel lerLista: falha estoura.", 4600);
      await narrar(page, "Antes, falha virava lista vazia — a trava não disparava e nascia em dobro, calado.", 5400);
      await still(page, "4-terceira-metade");
      await fechar(page);
    }
  } finally {
    // devolve tudo: o filme não deixa caso de demonstração no banco
    console.log("\nlimpando o cenário…");
    if (casoId) {
      await admin.from("tarefas").delete().eq("caso_id", casoId);
      await admin.from("processos_admin").delete().eq("caso_id", casoId);
      await admin.from("casos").delete().eq("id", casoId);
    }
    if (clienteId) await admin.from("clientes").delete().eq("id", clienteId);
    const { data: sobrou } = await admin.from("clientes").select("id").eq("nome", nomeCliente);
    console.log(`  cliente de demonstração restante: ${(sobrou ?? []).length}`);

    const clipes = await estudio.encerrar();
    fs.writeFileSync(path.join(estudio.saida, "legendas.json"), JSON.stringify({ legendas }, null, 2));
    fs.writeFileSync(path.join(estudio.saida, "provas.json"), JSON.stringify(provas, null, 2));
    const ok = provas.filter((p) => p.ok).length;
    console.log(`\nconferências: ${ok} ok · ${provas.length - ok} falhou`);
    console.log(`clipes: ${clipes.length} | saída: ${estudio.saida}`);
    if (provas.some((p) => !p.ok) || provas.length === 0) process.exitCode = 1;
  }
})();

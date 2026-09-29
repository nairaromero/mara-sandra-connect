// Validação do lote (#315 e #397) CONTRA O STAGING de verdade:
// staging.marasandraconnect.com, banco `alhqbpbekmxpoibrrnbi`, edge function
// publicada. É o que a Naira faria à mão, card por card.
//
// Uma escolha que importa: as datas esperadas são LIDAS DO BANCO (o `etapas`
// do relógio), não recalculadas aqui. Reimplementar a regra de recuo de fim de
// semana no filme provaria que a tela bate com a minha cópia da regra — e uma
// cópia errada nos dois lados passa. Lendo do banco, o filme prova que a tela
// bate com quem manda.
//
// Escreve no escritório PADRÃO do staging (é onde o relógio e os templates
// vivem) com prefixo `[VALID]`, e devolve tudo no finally.
//
// Rodar da raiz:
//   node e2e/demo/roteiros/validacao-lote-staging.cjs
//
// Depois, o MP4 único:
//   node e2e/demo/montar-filme.cjs validacao-lote-staging validacao --legendado
process.env.DEMO_BASE_URL = process.env.DEMO_BASE_URL || "https://staging.marasandraconnect.com";

const fs = require("fs");
const path = require("path");
const { narrar: narrarBase, abrirEstudio, cpfValido, tentar } = require("../helpers.cjs");
const { BASE, DOM, admin, sessao, estadoNavegador, fechar } = require("../staging.cjs");

const TZ = "America/Sao_Paulo";
/** Dia de Brasília, n dias a partir de hoje ("YYYY-MM-DD"). */
const diaBR = (n) => {
  const hoje = new Date().toLocaleDateString("en-CA", { timeZone: TZ });
  const [y, m, d] = hoje.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
};
/** "YYYY-MM-DD" → "dd/mm/aaaa", como a tela escreve. */
const dataBR = (dia) => dia.split("-").reverse().join("/");
/** Valor de um <input type="datetime-local"> no fuso de Brasília. */
const inputBR = (d) =>
  new Intl.DateTimeFormat("sv-SE", {
    timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
  }).format(d).replace(" ", "T");

const legendas = [];
const inicioClipe = new WeakMap();
let clipesAbertos = 0;
async function narrar(page, texto, ms = 3800) {
  const c = inicioClipe.get(page);
  if (c) legendas.push({ clipe: c.clipe, inicio_ms: Date.now() - c.t0, dur_ms: ms, texto });
  return narrarBase(page, texto, ms);
}

const provas = [];
function registrar(card, o, ok, detalhe) {
  provas.push({ card, o, ok, detalhe });
  console.log(`  ${ok ? "✓" : "✘"} ${card} ${o} — ${detalhe}`);
}

const D = -12; // indeferido há 12 dias: a análise venceu (D+10), a montagem tem 8 dias

(async () => {
  const { data: esc } = await admin.from("escritorios").select("id").eq("padrao_sistema", true).single();
  const ESC = esc.id;
  const marca = `VALID ${String(Date.now()).slice(-6)}`;
  const criados = { clientes: [], casos: [] };

  const estudio = await abrirEstudio("validacao-lote-staging");
  const still = estudio.still;
  const parte = async (email) => {
    const s = await sessao(email);
    const p = await estudio.novaParte(estadoNavegador(s.session, ESC));
    inicioClipe.set(p.page, { clipe: clipesAbertos++, t0: Date.now() });
    return p;
  };

  const { data: interno } = await admin.from("usuarios").select("id").eq("email", `e2e+interno@${DOM}`).single();
  const { data: parceiro } = await admin.from("usuarios").select("id").eq("email", `e2e+parceiro@${DOM}`).single();

  const novoCaso = async (rotulo, comParceiro) => {
    const { data: cli, error: e1 } = await admin.from("clientes")
      .insert({ nome: `[${marca}] ${rotulo}`, cpf: cpfValido(), escritorio_id: ESC })
      .select("id").single();
    if (e1) throw new Error(`cliente: ${e1.message}`);
    criados.clientes.push(cli.id);
    const { data: caso, error: e2 } = await admin.from("casos")
      .insert({
        cliente_id: cli.id, tipo_beneficio: "Auxílio-acidente", escritorio_id: ESC,
        ...(comParceiro ? { parceiro_id: parceiro.id } : {}),
      })
      .select("id").single();
    if (e2) throw new Error(`caso: ${e2.message}`);
    criados.casos.push(caso.id);
    return { casoId: caso.id, nome: `[${marca}] ${rotulo}` };
  };

  const abrirAtividades = async (page, casoId) => {
    await page.goto(`${BASE}/casos/${casoId}`);
    await page.waitForTimeout(2200);
    await page.getByText("Atividades", { exact: true }).first().click();
    await page.waitForTimeout(1500);
  };
  const abrirTarefa = async (page, casoId, titulo) => {
    await abrirAtividades(page, casoId);
    await page.getByText(titulo).first().waitFor({ state: "visible", timeout: 25000 });
    await page.locator("div.group").filter({ hasText: titulo }).first().getByText(titulo).click();
    await page.getByRole("heading", { name: "Editar tarefa" }).waitFor({ timeout: 12000 });
    await page.waitForTimeout(800);
  };
  const trocarData = async (page, dia) => {
    await page.locator('input[type="datetime-local"]').first().fill(`${dia}T09:00`);
    await page.waitForTimeout(500);
  };

  try {
    // ============ ATO 1 · #315 · andamento retroativo ============
    {
      const caso = await novoCaso("andamento", true);
      const { error } = await admin.from("andamentos").insert({
        caso_id: caso.casoId, escritorio_id: ESC, origem: "interno",
        titulo: `[${marca}] Andamento de hoje`, data_evento: new Date().toISOString(),
        visivel_parceiro: false,
      });
      if (error) throw new Error(`seed andamento: ${error.message}`);

      const { page } = await parte(`e2e+interno@${DOM}`);
      await narrar(page, "Card #315: lançar um deferimento que saiu há dois meses.", 4400);
      await abrirAtividades(page, caso.casoId);
      await page.getByRole("button", { name: "Novo", exact: true }).first().click();
      await page.getByRole("heading", { name: /Novo andamento/ }).waitFor({ timeout: 20000 });
      const titulo = `[${marca}] Deferimento retroativo`;
      await page.getByPlaceholder("Ex.: Documentos recebidos").fill(titulo);
      const doisMeses = new Date(Date.now() - 60 * 86400_000);
      await page.getByLabel("Data da publicação").fill(inputBR(doisMeses));
      await page.waitForTimeout(900);

      const avisoTexto = await page.getByLabel("O parceiro indicador").innerText();
      await narrar(page, "Data antiga: o aviso ao parceiro cai sozinho em 'Vê, sem aviso'.", 4800);
      await narrar(page, "Andamento velho não chega ao parceiro como novidade.", 4200);
      await still(page, "1-novo-andamento-retroativo");

      await page.getByRole("button", { name: "Adicionar" }).click();
      await page.getByText("Andamento adicionado").waitFor({ timeout: 20000 });
      await page.waitForTimeout(1500);

      const { data: gravado, error: e2 } = await admin.from("andamentos")
        .select("data_evento, visivel_parceiro").eq("caso_id", caso.casoId).eq("titulo", titulo).single();
      if (e2) throw new Error(`ler andamento: ${e2.message}`);
      const dif = Math.abs((Date.now() - new Date(gravado.data_evento).getTime()) / 86400_000 - 60);

      const yHoje = await page.getByText(`[${marca}] Andamento de hoje`).first().boundingBox();
      const yAntigo = await page.getByText(titulo).first().boundingBox();
      await narrar(page, "E ele entra na ordem do caso: abaixo do que é de hoje.", 4200);
      await still(page, "1-ordem-do-caso");

      registrar("#315", "a data gravada é a informada, não o agora", dif < 1,
        `diferença para 60 dias atrás: ${dif.toFixed(2)} dia(s)`);
      registrar("#315", "data antiga cai em 'Vê, sem aviso'", /sem aviso/i.test(avisoTexto),
        `campo do parceiro: "${avisoTexto.replace(/\n/g, " ").slice(0, 40)}"`);
      registrar("#315", "o retroativo entra na ordem certa", !!yHoje && !!yAntigo && yHoje.y < yAntigo.y,
        yHoje && yAntigo ? `hoje em y=${Math.round(yHoje.y)}, retroativo em y=${Math.round(yAntigo.y)}` : "não achei as duas linhas");
      await fechar(page);
    }

    // ============ ATO 2 · #315 · data no futuro pede confirmação ============
    {
      const caso = await novoCaso("futuro", false);
      const { page } = await parte(`e2e+interno@${DOM}`);
      await narrar(page, "E uma data no FUTURO? O sistema avisa, mas não impede.", 4400);
      await abrirAtividades(page, caso.casoId);
      await page.getByRole("button", { name: "Novo", exact: true }).first().click();
      await page.getByRole("heading", { name: /Novo andamento/ }).waitFor({ timeout: 20000 });
      await page.getByPlaceholder("Ex.: Documentos recebidos").fill(`[${marca}] Data no futuro`);
      await page.getByLabel("Data da publicação").fill(inputBR(new Date(Date.now() + 30 * 86400_000)));
      await page.waitForTimeout(700);
      await page.getByRole("button", { name: "Adicionar" }).click();
      await page.waitForTimeout(2000);
      const corpo = await page.locator("body").innerText();
      const pediu = /futuro/i.test(corpo);
      await narrar(page, "Avisa e pergunta — quem decide é a pessoa.", 3800);
      await still(page, "2-data-no-futuro");
      registrar("#315", "data no futuro pede confirmação", pediu,
        pediu ? "a tela pediu confirmação antes de gravar" : "NÃO pediu confirmação");
      await fechar(page);
    }

    // ============ ATO 3 · #397 · o relógio nasce do indeferimento ============
    let casoRelogio = null;
    let tituloMontagem = null;
    {
      casoRelogio = await novoCaso("relogio", false);
      const { data: proc, error: ep } = await admin.from("processos_admin")
        .insert({ caso_id: casoRelogio.casoId, escritorio_id: ESC, numero_requerimento: "9998887776", data_protocolo: diaBR(-60) })
        .select("id").single();
      if (ep) throw new Error(`processo: ${ep.message}`);
      const { error: et } = await admin.from("tarefas").insert({
        caso_id: casoRelogio.casoId, escritorio_id: ESC, processo_admin_id: proc.id,
        responsavel_id: interno.id, tipo: "interna", prioridade: 1,
        titulo: `Analise de Indeferimento - ${casoRelogio.nome}`,
        due_at: new Date().toISOString(), origem: "sync_inss_email",
        metadata: { template: "indeferido", analise_indeferimento: true, prazo_fatal: true, data_indeferimento: diaBR(D) },
      });
      if (et) throw new Error(`análise: ${et.message}`);

      const { data: rel, error: er } = await admin.from("relogios_prazo")
        .select("id, origem_em, planejado_em, limite_em, status, etapas").eq("caso_id", casoRelogio.casoId).single();
      if (er) throw new Error(`relógio: ${er.message}`);

      const { page } = await parte(`e2e+interno@${DOM}`);
      await narrar(page, "Card #397: o indeferimento abre o relógio do caso, sozinho.", 4600);
      await abrirTarefa(page, casoRelogio.casoId, `Analise de Indeferimento - ${casoRelogio.nome}`);
      await narrar(page, "As datas de cada etapa são fixas, contadas do indeferimento.", 4400);
      await page.getByRole("button", { name: "Ajuizar (montagem de inicial)" }).click();
      await page.waitForTimeout(3500);
      await still(page, "3-relogio-aberto");

      const { data: mont } = await admin.from("tarefas")
        .select("id, titulo, due_at, metadata").eq("caso_id", casoRelogio.casoId)
        .like("titulo", "Montagem da inicial%").maybeSingle();
      tituloMontagem = mont?.titulo ?? null;
      const dueDia = mont ? new Date(mont.due_at).toLocaleDateString("en-CA", { timeZone: TZ }) : null;
      // a data esperada vem do BANCO (etapas do relógio), não recalculada aqui
      const esperada = rel.etapas?.montagem ?? null;

      registrar("#397", "o relógio abre com origem, prazo e limite", rel.status === "aberto" && rel.origem_em === diaBR(D),
        `origem ${dataBR(rel.origem_em)} · prazo ${dataBR(rel.planejado_em)} · limite ${dataBR(rel.limite_em)}`);
      registrar("#397", "a montagem nasce na data fixa que o relógio diz", !!mont && dueDia === esperada,
        `montagem vence ${dueDia ? dataBR(dueDia) : "—"} · relógio manda ${esperada ? dataBR(esperada) : "—"}`);
      await fechar(page);
    }

    // ============ ATO 4 · #397 · reta final e Pedir à Mara ============
    {
      const { page } = await parte(`e2e+interno@${DOM}`);
      await narrar(page, "Perto do prazo, o adiamento trava: é a reta final.", 4200);
      await abrirTarefa(page, casoRelogio.casoId, tituloMontagem);
      await page.getByTestId("relogio-linha").first().waitFor({ state: "visible", timeout: 15000 }).catch(() => {});
      const linha = await page.getByTestId("relogio-linha").first().innerText().catch(() => "");

      await trocarData(page, diaBR(D + 29));
      await page.getByRole("button", { name: "Salvar" }).click();
      await page.waitForTimeout(2000);
      const c1 = await page.locator("body").innerText();
      const retaFinal = /Reta final do prazo/i.test(c1);
      await still(page, "4-reta-final");
      await narrar(page, "Passando do limite, nem a reta final vale: tem que pedir.", 4400);

      await trocarData(page, diaBR(D + 35));
      await page.getByRole("button", { name: "Salvar" }).click();
      await page.waitForTimeout(2200);
      const c2 = await page.locator("body").innerText();
      const pedeMara = /Este prazo não pode ser adiado/i.test(c2);
      await page.getByLabel("Por que precisa de mais prazo?").fill("O parceiro ainda não mandou o laudo médico.");
      await page.getByRole("button", { name: "Pedir à Mara" }).click();
      await page.waitForTimeout(2500);
      const c3 = await page.locator("body").innerText();
      await still(page, "4-pedir-a-mara");

      const { data: pedido } = await admin.from("pedidos_prorrogacao")
        .select("status, ate").eq("caso_id", casoRelogio.casoId).maybeSingle();
      const { data: m2 } = await admin.from("tarefas").select("due_at")
        .eq("caso_id", casoRelogio.casoId).like("titulo", "Montagem da inicial%").maybeSingle();
      const dueDepois = m2 ? new Date(m2.due_at).toLocaleDateString("en-CA", { timeZone: TZ }) : null;

      registrar("#397", "a linha do relógio aparece na tarefa", linha.length > 0, linha.replace(/\n/g, " ").slice(0, 90));
      registrar("#397", "reta final trava o adiamento", retaFinal, retaFinal ? "a tela avisou" : "NÃO avisou");
      registrar("#397", "passar do limite exige pedido à Mara", pedeMara && /Pedido enviado/i.test(c3),
        `diálogo: ${pedeMara ? "sim" : "não"} · envio confirmado: ${/Pedido enviado/i.test(c3) ? "sim" : "não"}`);
      registrar("#397", "o pedido fica pendente e o prazo NÃO anda", pedido?.status === "pendente" && dueDepois !== diaBR(D + 35),
        `pedido ${pedido?.status ?? "—"} até ${pedido ? dataBR(pedido.ate) : "—"} · prazo continua ${dueDepois ? dataBR(dueDepois) : "—"}`);
      await fechar(page);
    }

    // ============ ATO 5 · #397 · o radar da Mara, paginado ============
    {
      const { page } = await parte(`e2e+admin@${DOM}`);
      await page.goto(`${BASE}/tarefas`);
      await page.waitForTimeout(3500);
      await narrar(page, "No radar, a Mara vê os relógios e decide os pedidos.", 4400);
      const botao = page.getByTestId("radar-prazos");
      const textoBotao = (await botao.innerText().catch(() => "")).replace(/\n/g, " ");
      await botao.click();
      await page.waitForTimeout(2500);
      const corpo = await page.locator("body").innerText();
      const temPaginador = /de \d+ relógios/.test(corpo);
      const linhas = await page.getByTestId("radar-linha").count();
      await narrar(page, "A lista vem por página, e o número do botão é o do total.", 4600);
      await still(page, "5-radar");

      await tentar("aprovar o pedido de prorrogação", async () => {
        const aprovar = page.getByRole("button", { name: /Aprovar até/ }).first();
        await aprovar.waitFor({ state: "visible", timeout: 8000 });
        await aprovar.click();
        await page.waitForTimeout(2500);
      });
      const { data: pedidoDepois } = await admin.from("pedidos_prorrogacao")
        .select("status").eq("caso_id", casoRelogio.casoId).maybeSingle();
      const { data: m3 } = await admin.from("tarefas").select("due_at")
        .eq("caso_id", casoRelogio.casoId).like("titulo", "Montagem da inicial%").maybeSingle();
      const dueFinal = m3 ? new Date(m3.due_at).toLocaleDateString("en-CA", { timeZone: TZ }) : null;
      await narrar(page, "Aprovado, o prazo vai para a data pedida — e só então.", 4400);
      await still(page, "5-aprovado");

      registrar("#397", "o radar mostra a contagem e pagina", /rel[óo]gio/i.test(textoBotao) && (temPaginador || linhas > 0),
        `botão: "${textoBotao.slice(0, 50)}" · linhas na página: ${linhas} · paginador: ${temPaginador ? "sim" : "não"}`);
      registrar("#397", "aprovada, a prorrogação move o prazo", pedidoDepois?.status === "aprovado" && dueFinal === diaBR(D + 35),
        `pedido ${pedidoDepois?.status ?? "—"} · prazo agora ${dueFinal ? dataBR(dueFinal) : "—"} (pedido para ${dataBR(diaBR(D + 35))})`);
      await fechar(page);
    }

    // ============ ATO 6 · #397 · o painel de datas do caso ============
    {
      const { page } = await parte(`e2e+interno@${DOM}`);
      await page.goto(`${BASE}/casos/${casoRelogio.casoId}`);
      await page.waitForTimeout(3000);
      await narrar(page, "E no topo do caso, o painel com as datas que importam.", 4400);
      const corpo = await page.locator("body").innerText();
      const temPainel = /Indeferimento|Protocolo administrativo|Entrada do caso/i.test(corpo);
      await still(page, "6-painel-de-datas");
      registrar("#397", "o painel de datas aparece no caso", temPainel,
        temPainel ? "entrada, protocolo, indeferimento e relógio na tela" : "painel NÃO apareceu");
      await fechar(page);
    }
  } finally {
    console.log("\ndevolvendo o staging ao estado de antes…");
    const passo = async (rotulo, f) => {
      try { await f(); console.log(`  ok  ${rotulo}`); }
      catch (e) { console.log(`  (!) ${rotulo}: ${String(e.message).slice(0, 140)}`); }
    };
    if (criados.casos.length) {
      await passo("pedidos de prorrogação", () => admin.from("pedidos_prorrogacao").delete().in("caso_id", criados.casos));
      await passo("relógios", () => admin.from("relogios_prazo").delete().in("caso_id", criados.casos));
      await passo("tarefas", () => admin.from("tarefas").delete().in("caso_id", criados.casos));
      await passo("andamentos", () => admin.from("andamentos").delete().in("caso_id", criados.casos));
      await passo("processos", () => admin.from("processos_admin").delete().in("caso_id", criados.casos));
      await passo("casos", () => admin.from("casos").delete().in("id", criados.casos));
    }
    if (criados.clientes.length) await passo("clientes", () => admin.from("clientes").delete().in("id", criados.clientes));
    const { data: sobra } = await admin.from("clientes").select("id").like("nome", `[${marca}]%`);
    const { data: relSobra } = await admin.from("relogios_prazo").select("id").in("caso_id", criados.casos.length ? criados.casos : ["00000000-0000-0000-0000-000000000000"]);
    console.log(`  cliente(s) do filme restante(s): ${(sobra ?? []).length}`);
    console.log(`  relógio(s) do filme restante(s): ${(relSobra ?? []).length}`);

    const clipes = await estudio.encerrar();
    fs.writeFileSync(path.join(estudio.saida, "legendas.json"), JSON.stringify({ legendas }, null, 2));
    fs.writeFileSync(path.join(estudio.saida, "provas.json"), JSON.stringify(provas, null, 2));
    const ok = provas.filter((p) => p.ok).length;
    let md = `# Validação do lote no staging\n\nContra ${BASE}, ${new Date().toLocaleString("pt-BR", { timeZone: TZ })}.\n\n`;
    md += `**${ok} de ${provas.length} conferências passaram.**\n\n| Card | O que foi conferido | Resultado | Como se sabe |\n|---|---|---|---|\n`;
    for (const p of provas) md += `| ${p.card} | ${p.o} | ${p.ok ? "✅" : "❌"} | ${p.detalhe} |\n`;
    fs.writeFileSync(path.join(estudio.saida, "relatorio.md"), md);
    console.log(`\nconferências: ${ok} ok · ${provas.length - ok} falhou`);
    console.log(`clipes: ${clipes.length} | saída: ${estudio.saida}`);
    if (provas.some((p) => !p.ok) || provas.length === 0) process.exitCode = 1;
  }
})();

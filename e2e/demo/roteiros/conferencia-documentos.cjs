// Filme do card #434 — conferência de documentos antes da análise do caso.
// Gravado no AMBIENTE LOCAL (cópia do staging), sem provedor externo nenhum:
// a feature é toda banco + tela.
//
//   Ato 1  O caso do parceiro chega e abre CONFERÊNCIA, não análise: a tarefa
//          nasce no nome de quem organiza, com o checklist já marcando o que
//          veio junto.
//   Ato 2  A conferência: o que falta é marcado, o recado é escrito, e concluir
//          entrega a análise — o pedido do que falta continua com a pessoa.
//   Ato 3  Do lado de quem analisa: a tarefa chega pronta, sabendo o que falta,
//          e os três desfechos de sempre estão lá (requerimento, aguardando
//          documentação, sem direito).
//
// Pré-requisitos: banco local com a migration do #434
// (`node scripts/msc-sql.mjs --local --file planning/sql-migrations/migration_organizacao_documentos.sql`)
// e o app no ar (`bun run dev:local`). Rodar da raiz:
//   node e2e/demo/roteiros/conferencia-documentos.cjs
//
// Sessões vêm por API (nunca digita senha). As contas sintéticas ganham nome
// apresentável só durante a filmagem e são restauradas no finally, junto com
// os responsáveis do escritório e todo o dado de cena.

const fs = require("fs");
const path = require("path");
const { ler, deslizar, clicar, tentar, narrar: narrarBase, abrirEstudio, cpfValido } = require("../helpers.cjs");
const { BASE, DOM, admin, sessao, estadoNavegador, esc, fechar } = require("../local.cjs");

// ---------- legendas (SRT): instante de cada narração, relativo ao clipe ----------
const legendas = [];
const inicioClipe = new WeakMap();
let clipesAbertos = 0;
async function narrar(page, texto, ms = 3400) {
  const c = inicioClipe.get(page);
  if (c) legendas.push({ clipe: c.clipe, inicio_ms: Date.now() - c.t0, dur_ms: ms, texto });
  return narrarBase(page, texto, ms);
}

const MARCA = "[Filme]";
const CLIENTE = "Marlene Aparecida dos Santos";

// Nomes de cena: as contas sintéticas viram gente enquanto a câmera roda.
const ELENCO = [
  { email: `e2e+interno@${DOM}`, cena: "Mariane Fernandes" },
  { email: `e2e+admin@${DOM}`, cena: "Dra. Mara Vian" },
  { email: `e2e+parceiro@${DOM}`, cena: "Silva & Costa Advogados" },
];

async function cartao(page, titulo, sub, ms = 3800) {
  const c = inicioClipe.get(page);
  if (c) legendas.push({ clipe: c.clipe, inicio_ms: Date.now() - c.t0, dur_ms: ms, texto: `${titulo}. ${sub}` });
  await page.setContent(`<!doctype html><html><body style="margin:0;background:#16110c;color:#fcfaf6;font-family:-apple-system,'Segoe UI',Roboto,sans-serif;height:100vh;display:flex;align-items:center;justify-content:center">
    <div style="max-width:900px;text-align:center;padding:40px">
      <div style="font-size:13px;letter-spacing:.2em;text-transform:uppercase;color:#af7c00;margin-bottom:18px">Legal Connect · conferência de documentos</div>
      <div style="font-family:Georgia,serif;font-size:44px;line-height:1.15;margin-bottom:20px">${esc(titulo)}</div>
      <div style="font-size:19px;line-height:1.5;color:#d8cfc2">${esc(sub)}</div>
    </div></body></html>`);
  await page.waitForTimeout(ms);
}

(async () => {
  const estudio = await abrirEstudio("conferencia-documentos");
  const inicio = new Date().toISOString();
  const nomesAntes = new Map();
  let respAntes = null;
  let escritorioId = null;
  let clienteId = null;
  let casoId = null;
  const gravados = [];

  async function parte(papelEmail, escritorio) {
    const s = await sessao(papelEmail, escritorio);
    // O estúdio repassa direto ao Playwright: objeto = estado, string = caminho.
    const { page } = await estudio.novaParte(estadoNavegador(s.session, escritorio));
    // Clipe é 0-based: é o índice que o gerador de SRT usa nos offsets.
    inicioClipe.set(page, { clipe: clipesAbertos++, t0: Date.now() });
    return page;
  }

  try {
    // ---------------- cenário ----------------
    const { data: elenco } = await admin
      .from("usuarios")
      .select("id, nome, email")
      .in("email", ELENCO.map((e) => e.email));
    if (!elenco || elenco.length < 3) throw new Error("contas sintéticas ausentes (rode seed-staging-contas)");
    const acha = (email) => elenco.find((u) => u.email === email);
    const mariane = acha(`e2e+interno@${DOM}`);
    const mara = acha(`e2e+admin@${DOM}`);
    const parceiro = acha(`e2e+parceiro@${DOM}`);

    for (const p of ELENCO) {
      const u = acha(p.email);
      nomesAntes.set(u.id, u.nome);
      await admin.from("usuarios").update({ nome: p.cena }).eq("id", u.id);
    }

    const { data: esc1 } = await admin
      .from("escritorios")
      .select("id")
      .eq("padrao_sistema", true)
      .single();
    escritorioId = esc1.id;

    const { data: cfg } = await admin
      .from("escritorio_config")
      .select("responsaveis")
      .eq("escritorio_id", escritorioId)
      .single();
    respAntes = cfg?.responsaveis ?? {};
    await admin
      .from("escritorio_config")
      .update({
        responsaveis: {
          ...respAntes,
          organiza_documentos: mariane.id,
          analise: mara.id,
        },
      })
      .eq("escritorio_id", escritorioId);

    // O caso do parceiro — é o insert que dispara a corrente.
    const { data: cliente } = await admin
      .from("clientes")
      .insert({ nome: `${MARCA} ${CLIENTE}`, cpf: cpfValido(), escritorio_id: escritorioId })
      .select("id")
      .single();
    clienteId = cliente.id;
    const { data: caso } = await admin
      .from("casos")
      .insert({
        cliente_id: clienteId,
        tipo_beneficio: "Auxílio-doença",
        parceiro_id: parceiro.id,
        escritorio_id: escritorioId,
      })
      .select("id")
      .single();
    casoId = caso.id;

    // O que o parceiro mandou: dois documentos certos, e só.
    for (const d of [
      { tipo: "procuracao", nome: "procuracao-assinada.pdf" },
      { tipo: "rg_cpf", nome: "IMG_20260928_documento.jpg" },
    ]) {
      await admin.from("documentos").insert({
        caso_id: casoId,
        tipo: d.tipo,
        nome_arquivo: d.nome,
        storage_path: `${casoId}/${d.nome}`,
        uploaded_by: parceiro.id,
        visivel_parceiro: true,
      });
    }

    // ---------------- Ato 1: a tarefa que nasce ----------------
    {
      const page = await parte(`e2e+interno@${DOM}`, escritorioId);
      await cartao(
        page,
        "O caso do parceiro chega",
        "Antes, ele caía direto na análise — e caía com a pasta bagunçada.",
      );
      await page.goto(`${BASE}/casos/${casoId}`);
      await narrar(page, "O parceiro indicou uma cliente nova. O caso nasce aqui.");
      await ler(page, 2200);
      await estudio.still(page, "ato1-01-caso");

      await clicar(page, page.getByText("Atividades", { exact: true }).first());
      await narrar(page, "A primeira tarefa não é analisar: é conferir os documentos.");
      await ler(page, 2600);
      await estudio.still(page, "ato1-02-tarefa");

      await narrar(page, "Ela já nasce no nome de quem organiza — a Mariane.");
      await ler(page, 2600);
      await estudio.still(page, "ato1-03-dono");
      await fechar(page);
      gravados.push("ato1");
    }

    // ---------------- Ato 2: a conferência ----------------
    {
      const page = await parte(`e2e+interno@${DOM}`, escritorioId);
      await cartao(
        page,
        "A conferência",
        "O que já chegou vem marcado. Ela resolve o resto e o caso segue.",
      );
      await page.goto(`${BASE}/casos/${casoId}`);
      await clicar(page, page.getByText("Atividades", { exact: true }).first());
      await narrar(page, "Procuração e documento pessoal chegaram — o sistema já marcou.");
      await ler(page, 3000);
      await estudio.still(page, "ato2-01-checklist");

      const card = page.locator("div.group").filter({ hasText: "Organizar documentos" }).first();
      await narrar(page, "Falta CNIS, contrato e comprovante de residência.");
      await ler(page, 2600);

      await tentar("marcar não se aplica", async () => {
        await clicar(page, card.getByRole("button", { name: "não se aplica" }).first());
        await narrar(page, "O que não cabe neste caso sai da lista.");
        await ler(page, 2000);
      });
      await estudio.still(page, "ato2-02-marcado");

      await narrar(page, "Ela conclui. O que falta vai junto, anotado — o caso não fica parado.");
      await clicar(page, card.getByRole("button", { name: /Concluir organização/ }));
      await page.getByText(/Documentos organizados/).first().waitFor({ timeout: 20000 });
      await ler(page, 3000);
      await estudio.still(page, "ato2-03-concluido");
      await fechar(page);
      gravados.push("ato2");
    }

    // ---------------- Ato 3: a análise chega pronta ----------------
    {
      const page = await parte(`e2e+admin@${DOM}`, escritorioId);
      await cartao(
        page,
        "A análise chega pronta",
        "Quem analisa recebe a tarefa sabendo o que falta — e o que falta já foi pedido.",
      );
      await page.goto(`${BASE}/casos/${casoId}`);
      await clicar(page, page.getByText("Atividades", { exact: true }).first());
      await narrar(page, "Do outro lado, a análise já está no nome da Dra. Mara.");
      await ler(page, 3000);
      await estudio.still(page, "ato3-01-analise");
      await narrar(page, "Ela chega com a lista do que ficou faltando.");
      await ler(page, 2600);

      // O card certo é o "Cliente novo - ... - Analisar". O caso também tem a
      // tarefa de conferir o que o parceiro juntou (outro gatilho, de sempre),
      // e um clique em "Analisar" solto abria a errada — foi assim no take 1.
      const analise = page
        .locator("div.group")
        .filter({ hasText: "Cliente novo" })
        .first();
      await tentar("abrir a análise", async () => {
        await clicar(page, analise.getByText("Cliente novo", { exact: false }).first());
        await page.getByRole("heading", { name: "Editar tarefa" }).waitFor({ timeout: 15000 });
        await narrar(page, "A descrição diz o que falta e que já foi solicitado ao parceiro.");
        await ler(page, 3400);
        await estudio.still(page, "ato3-02-descricao");
        await narrar(page, "E os três desfechos de sempre continuam aqui.");
        await ler(page, 3200);
        await estudio.still(page, "ato3-03-desfechos");
      });
      await fechar(page);
      gravados.push("ato3");
    }
  } finally {
    // ---------------- limpeza (sempre) ----------------
    const passo = async (rotulo, fn) => {
      try {
        const r = await fn();
        if (r?.error) console.warn(`limpeza ${rotulo}:`, r.error.message);
      } catch (e) {
        console.warn(`limpeza ${rotulo}:`, e.message);
      }
    };
    if (casoId) {
      for (const t of ["tarefas", "andamentos", "documentos", "solicitacoes_documento", "notificacoes"]) {
        await passo(t, () => admin.from(t).delete().eq("caso_id", casoId));
      }
      await passo("tarefas_excluidas", () => admin.from("tarefas_excluidas").delete().eq("caso_id", casoId));
      await passo("casos", () => admin.from("casos").delete().eq("id", casoId));
    }
    if (clienteId) await passo("clientes", () => admin.from("clientes").delete().eq("id", clienteId));
    for (const [id, nome] of nomesAntes) {
      await passo(`nome ${nome}`, () => admin.from("usuarios").update({ nome }).eq("id", id));
    }
    if (respAntes && escritorioId) {
      await passo("responsáveis do escritório", () =>
        admin.from("escritorio_config").update({ responsaveis: respAntes }).eq("escritorio_id", escritorioId),
      );
    }
    console.log("cenário desde", inicio, "removido");

    const clipes = await estudio.encerrar();
    fs.writeFileSync(
      path.join(estudio.saida, "legendas.json"),
      JSON.stringify({ clipes: clipes.length, legendas }, null, 2),
    );
    console.log("clipes:", clipes.length, "| gravados:", gravados.join(", "));
    console.log("saida:", estudio.saida);
  }
})().catch((e) => {
  console.error("FALHA:", e);
  process.exit(1);
});

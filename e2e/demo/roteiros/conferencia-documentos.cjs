// Filme do card #434 — a pasta do parceiro, a IA que lê e a conferência.
// Gravado no AMBIENTE LOCAL (cópia do staging). A única coisa de fora é a IA,
// que lê os arquivos de verdade com a chave do escritório.
//
//   Ato 1  O parceiro indica o caso e não anexa nada: ele cola o link da pasta
//          do OneDrive. O link passa a viver no caso.
//   Ato 2  Do lado do escritório: o link aparece no topo da aba Documentos, e a
//          tarefa de organizar diz que não houve juntada — mas tem link. A
//          equipe baixa de lá e sobe os arquivos aqui.
//   Ato 3  A conferência: a IA lê os arquivos e diz o que cada um é; a pessoa
//          confere, corrige o que a IA errou e conclui — a análise sai pronta
//          no nome de quem analisa.
//
// Pré-requisitos: banco local com as migrations do #434
//   node scripts/msc-sql.mjs --local --file planning/sql-migrations/migration_organizacao_documentos.sql
//   node scripts/msc-sql.mjs --local --file planning/sql-migrations/migration_documentos_leitura_ia.sql
//   node scripts/msc-sql.mjs --local --file planning/sql-migrations/migration_pasta_externa_parceiro.sql
// o app no ar (`bun run dev:local`) e uma chave de IA ativa no escritório.
// Rodar da raiz:
//   node e2e/demo/roteiros/conferencia-documentos.cjs
//
// Sessões vêm por API (nunca digita senha). As contas sintéticas ganham nome
// apresentável só durante a filmagem e são restauradas no finally, junto com
// os responsáveis do escritório e todo o dado de cena.

const fs = require("fs");
const path = require("path");
const { ler, clicar, tentar, narrar: narrarBase, abrirEstudio, cpfValido } = require("../helpers.cjs");
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
const LINK = "https://1drv.ms/f/s!ApastaDaMarlene";

// Os arquivos como o parceiro manda: nome que não diz nada e, dentro, o
// documento de verdade. Quem descobre o que cada um é — no filme e na vida —
// é a IA. Gerados aqui para o filme não depender de arquivo na máquina.
const ARQUIVOS = [
  {
    nome: "documento (1).pdf",
    linhas: [
      "PROCURACAO AD JUDICIA ET EXTRA",
      `OUTORGANTE: ${CLIENTE}, brasileira, CPF 123.456.789-00.`,
      "OUTORGADA: Mara Sandra Vian Advocacia, OAB/MT 12.345.",
      "PODERES: representar a outorgante perante o INSS e a Justica Federal,",
      "requerer beneficios, firmar acordos e dar quitacao.",
      "Cuiaba, 12 de outubro de 2026.",
    ],
  },
  {
    nome: "CONT 01.pdf",
    linhas: [
      "CONTRATO DE HONORARIOS ADVOCATICIOS",
      `CONTRATANTE: ${CLIENTE}`,
      "CONTRATADA: Mara Sandra Vian Advocacia",
      "OBJETO: pedido de auxilio por incapacidade temporaria junto ao INSS.",
      "HONORARIOS: 30% sobre o proveito economico obtido.",
      "Data: 12/10/2026",
    ],
  },
  {
    nome: "extrato-3.pdf",
    linhas: [
      "CNIS - CADASTRO NACIONAL DE INFORMACOES SOCIAIS",
      `Segurado: ${CLIENTE}   NIT: 1.234.567.890`,
      "Vinculos:",
      "  01/2008 a 11/2013  SUPERMERCADO BOM PRECO LTDA",
      "  03/2014 a 08/2021  INDUSTRIA DE ALIMENTOS SANTA RITA",
      "  09/2021 a 04/2026  CONTRIBUINTE INDIVIDUAL",
      "Emitido em 12/10/2026 pelo Meu INSS.",
    ],
  },
];

/** PDF de uma página com linhas de texto — o bastante para a IA ler. */
function pdfSimples(linhas) {
  const corpo = linhas
    .map((l, i) => `BT /F1 11 Tf 56 ${780 - i * 18} Td (${l.replace(/([()\\])/g, "\\$1")}) Tj ET`)
    .join("\n");
  const objetos = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
    `<< /Length ${corpo.length} >>\nstream\n${corpo}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let pdf = "%PDF-1.4\n";
  const offsets = [];
  objetos.forEach((o, i) => {
    offsets.push(pdf.length);
    pdf += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = pdf.length;
  pdf += `xref\n0 ${objetos.length + 1}\n0000000000 65535 f \n`;
  for (const o of offsets) pdf += `${String(o).padStart(10, "0")} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objetos.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf, "latin1");
}

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
      <div style="font-size:13px;letter-spacing:.2em;text-transform:uppercase;color:#af7c00;margin-bottom:18px">Legal Connect · organização de documentos</div>
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
  const caminhosStorage = [];

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

    // ---------------- Ato 1: o parceiro deixa o link ----------------
    {
      const page = await parte(`e2e+parceiro@${DOM}`, escritorioId);
      await cartao(
        page,
        "O parceiro não anexa nada",
        "Ele tem tudo numa pasta do OneDrive. Antes, esse link vivia no WhatsApp.",
      );
      await page.goto(`${BASE}/casos/${casoId}`);
      await clicar(page, page.getByRole("tab", { name: /Documentos/ }));
      await narrar(page, "Do lado do parceiro, o caso não tem arquivo nenhum.");
      await ler(page, 2400);
      await estudio.still(page, "ato1-01-sem-arquivo");

      await clicar(page, page.getByRole("button", { name: /colar o link/ }));
      await page.getByPlaceholder("https://1drv.ms/f/…").fill(LINK);
      await page.getByPlaceholder(/Como chamar esta pasta/).fill("Documentos da Marlene");
      await narrar(page, "Ele cola o link da pasta — é o que ele tem em mãos.");
      await ler(page, 2600);
      await clicar(page, page.getByRole("button", { name: "Salvar", exact: true }));
      await page.getByText("Pasta por link").first().waitFor({ timeout: 15000 });
      await narrar(page, "O link passa a viver no caso, no topo dos documentos.");
      await ler(page, 3000);
      await estudio.still(page, "ato1-02-link-colado");
      await fechar(page);
      gravados.push("ato1");
    }

    // ---------------- Ato 2: o escritório acha o link sem procurar ----------------
    {
      const page = await parte(`e2e+interno@${DOM}`, escritorioId);
      await cartao(
        page,
        "Do lado do escritório",
        "A tarefa já diz onde estão os arquivos — e quem organiza não procura no WhatsApp.",
      );
      await page.goto(`${BASE}/casos/${casoId}`);
      await clicar(page, page.getByRole("tab", { name: /Atividades/ }));
      await narrar(page, "A primeira tarefa não é analisar: é organizar os documentos.");
      await ler(page, 2800);
      await estudio.still(page, "ato2-01-tarefa");

      const cartaoTarefa = page.locator("div.group").filter({ hasText: "Organizar documentos" }).first();
      await cartaoTarefa.scrollIntoViewIfNeeded();
      await narrar(page, "E ela avisa: não veio arquivo, veio um link.");
      await ler(page, 3000);
      await estudio.still(page, "ato2-02-aviso-do-link");

      await clicar(page, page.getByRole("tab", { name: /Documentos/ }));
      await narrar(page, "O link está no topo da aba Documentos, com o nome que o parceiro deu.");
      await ler(page, 3200);
      await estudio.still(page, "ato2-03-link-no-topo");
      await fechar(page);
      gravados.push("ato2");
    }

    // Entre os atos: o que a equipe faz à mão — baixa da pasta e sobe aqui.
    for (const a of ARQUIVOS) {
      const conteudo = pdfSimples(a.linhas);
      const storagePath = `${casoId}/${a.nome}`;
      const up = await admin.storage.from("documentos").upload(storagePath, conteudo, {
        contentType: "application/pdf",
        upsert: true,
      });
      if (up.error) throw new Error(`subir ${a.nome}: ${up.error.message}`);
      caminhosStorage.push(storagePath);
      const ins = await admin.from("documentos").insert({
        caso_id: casoId,
        escritorio_id: escritorioId,
        tipo: "outro",
        nome_arquivo: a.nome,
        storage_path: storagePath,
        tamanho_bytes: conteudo.length,
        uploaded_by: mariane.id,
        visivel_parceiro: true,
      });
      if (ins.error) throw new Error(`registrar ${a.nome}: ${ins.error.message}`);
    }

    // ---------------- Ato 3: a IA lê e a pessoa confere ----------------
    {
      const page = await parte(`e2e+interno@${DOM}`, escritorioId);
      await cartao(
        page,
        "A IA lê, a pessoa confere",
        "Três arquivos com nome que não diz nada. A tarefa mostra só as exceções.",
      );
      await page.goto(`${BASE}/casos/${casoId}`);
      await clicar(page, page.getByRole("tab", { name: /Atividades/ }));
      await clicar(page, page.getByText("Organizar documentos", { exact: false }).first());
      await page.getByRole("heading", { name: "Editar tarefa" }).waitFor({ timeout: 15000 });
      // Tudo dentro da folha: o card da lista tem os mesmos botões atrás dela.
      const folha = page.locator('[role="dialog"]').last();
      await narrar(page, "Os arquivos chegaram da pasta: nomes como 'documento (1)' e 'CONT 01'.");
      await ler(page, 3400);
      await estudio.still(page, "ato3-01-por-ler");

      await tentar("ler com a IA", async () => {
        await clicar(page, folha.getByRole("button", { name: /Ler \d+ novo/ }));
        await narrar(page, "A IA abre cada arquivo e diz o que ele é.", 4000);
        await folha.getByText(/Identificados pela IA/).waitFor({ timeout: 120000 });
        await ler(page, 3000);
        await estudio.still(page, "ato3-02-identificados");
      });

      await narrar(page, "Procuração, contrato de honorários e CNIS — sem ninguém abrir arquivo.");
      await ler(page, 3600);
      await estudio.still(page, "ato3-03-lista");

      await narrar(page, "A IA erra, então a conferência continua existindo: a pessoa corrige aqui.");
      await ler(page, 3400);

      await narrar(page, "O que falta vai anotado — documento faltando não segura o caso.");
      await ler(page, 3000);
      await clicar(page, folha.getByRole("button", { name: /Conferido — enviar para análise/ }));
      await page.getByText(/Documentos conferidos/).first().waitFor({ timeout: 20000 });
      await ler(page, 3000);
      await estudio.still(page, "ato3-04-concluido");
      await fechar(page);
      gravados.push("ato3");
    }

    // ---------------- Ato 4: a análise chega pronta ----------------
    {
      const page = await parte(`e2e+admin@${DOM}`, escritorioId);
      await cartao(
        page,
        "A análise chega pronta",
        "Quem analisa recebe a pasta organizada e a lista do que ficou faltando.",
      );
      await page.goto(`${BASE}/casos/${casoId}`);
      await clicar(page, page.getByRole("tab", { name: /Atividades/ }));
      await narrar(page, "Do outro lado, a análise já está no nome da Dra. Mara.");
      await ler(page, 3000);
      await estudio.still(page, "ato4-01-analise");

      const analise = page.locator("div.group").filter({ hasText: "Cliente novo" }).first();
      await tentar("abrir a análise", async () => {
        await clicar(page, analise.getByText("Cliente novo", { exact: false }).first());
        await page.getByRole("heading", { name: "Editar tarefa" }).waitFor({ timeout: 15000 });
        await narrar(page, "A descrição diz o que falta e que já foi pedido ao parceiro.");
        await ler(page, 3400);
        await estudio.still(page, "ato4-02-descricao");
        await narrar(page, "E os três desfechos de sempre continuam aqui.");
        await ler(page, 3200);
        await estudio.still(page, "ato4-03-desfechos");
      });
      await fechar(page);
      gravados.push("ato4");
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
    if (caminhosStorage.length) {
      await passo("storage", () => admin.storage.from("documentos").remove(caminhosStorage));
    }
    if (casoId) {
      for (const t of [
        "tarefas",
        "andamentos",
        "documentos",
        "caso_pastas_externas",
        "solicitacoes_documento",
        "notificacoes",
      ]) {
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

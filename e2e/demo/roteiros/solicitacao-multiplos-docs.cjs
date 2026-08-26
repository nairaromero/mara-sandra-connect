// Filme: solicitações de documento repaginadas (lote de 2026-08-26/27).
//   Ato 1 (equipe): UMA solicitação pedindo TRÊS documentos (com o flash no
//                   campo que abre pro próximo) + solicitação interna com
//                   responsável virando tarefa da pessoa.
//   Ato 2 (parceiro): cumpre a pendência — cada arquivo já nasce com o tipo
//                     na ordem do pedido; dá pra trocar tipo e nome.
//   Ato 3 (equipe): solicitação atendida lista os anexos; tarefa única de
//                   análise com todos os documentos na descrição.
//
// Rodar da raiz: node e2e/demo/roteiros/solicitacao-multiplos-docs.cjs
// (antes: PLAYWRIGHT_BASE_URL=https://staging.marasandraconnect.com bunx
//  playwright test site-publico --grep privacidade  — renova as sessões na
//  ORIGEM do staging; sem isso o estúdio cai na tela de login.)

const {
  BASE, adminStaging, cpfValido, ler, deslizar, clicar, tentar, abrirEstudio,
  narrar,
} = require("../helpers.cjs");

const PDF_FAKE = Buffer.from(
  "%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF",
);

(async () => {
  const admin = adminStaging();

  // ----- dados de cena -----
  const { data: parceira, error: pErr } = await admin
    .from("usuarios").select("id, nome").eq("email", "e2e+parceiro@marasandraconnect.com").single();
  if (pErr || !parceira) throw new Error(`parceiro sintetico nao encontrado: ${pErr?.message}`);
  const nomeParceiroOriginal = parceira.nome;
  await admin.from("usuarios").update({ nome: "Silva & Costa Advogados" }).eq("id", parceira.id);

  const { data: interna } = await admin
    .from("usuarios").select("id, nome").eq("email", "e2e+interno@marasandraconnect.com").single();
  const nomeInternoOriginal = interna?.nome ?? null;
  if (interna) {
    await admin.from("usuarios").update({ nome: "Equipe Mara Vian" }).eq("id", interna.id);
  }

  const { data: cliente, error: cErr } = await admin
    .from("clientes")
    .insert({ nome: "Roberto Nunes Farias", cpf: cpfValido() })
    .select("id").single();
  if (cErr) throw new Error(`seed cliente: ${cErr.message}`);
  const clienteId = cliente.id;

  const { data: caso, error: kErr } = await admin
    .from("casos")
    .insert({
      cliente_id: clienteId,
      tipo_beneficio: "Aposentadoria por idade",
      fase: "analise",
      parceiro_id: parceira.id,
    })
    .select("id").single();
  if (kErr) throw new Error(`seed caso: ${kErr.message}`);
  const casoId = caso.id;
  console.log("seed ok — caso:", casoId);

  const estudio = await abrirEstudio("solicitacao-multiplos-docs");
  const { still } = estudio;

  try {
    // ============ ATO 1 — equipe pede 3 documentos num pedido só ============
    const ato1 = await estudio.novaParte("interno");
    const p1 = ato1.page;
    await p1.goto(`${BASE}/casos/${casoId}`);
    await p1.getByText("Roberto Nunes Farias").first().waitFor({ timeout: 20000 });
    await clicar(p1, p1.getByText("Documentos", { exact: true }).first());
    await narrar(p1, "NOVIDADE: uma solicitação só pode pedir VÁRIOS documentos de uma vez.");
    await ler(p1, 2500);

    await clicar(p1, p1.getByRole("button", { name: "Nova solicitação" }));
    await ler(p1, 1200);

    // 1º documento
    await clicar(p1, p1.getByRole("combobox", { name: /tipo|Selecione/i }).first()
      .or(p1.getByText("Selecione ou busque o tipo...").first()));
    await ler(p1, 600);
    await clicar(p1, p1.getByRole("option", { name: "RG / CPF" }));
    await ler(p1, 1200);
    await narrar(p1, "Escolheu o primeiro documento? 'Adicionar outro' abre espaço pro próximo — com um brilho mostrando onde.");
    await clicar(p1, p1.getByRole("button", { name: "Adicionar outro documento" }));
    await ler(p1, 2200); // flash dourado no campo
    await still(p1, "ato1-01-flash");

    // 2º documento
    await clicar(p1, p1.getByText("Selecione ou busque o tipo...").first());
    await ler(p1, 500);
    await clicar(p1, p1.getByRole("option", { name: "CNIS", exact: true }));
    await ler(p1, 800);
    await clicar(p1, p1.getByRole("button", { name: "Adicionar outro documento" }));
    await ler(p1, 1200);

    // 3º documento
    await clicar(p1, p1.getByText("Selecione ou busque o tipo...").first());
    await ler(p1, 500);
    await clicar(p1, p1.getByRole("option", { name: "Comprovante de residência" }));
    await ler(p1, 1500);
    await still(p1, "ato1-02-tres-docs");

    await narrar(p1, "Um clique, UM pedido — com os três documentos dentro.");
    await clicar(p1, p1.getByRole("button", { name: /Criar solicitação \(3 documentos\)/ }));
    await p1.getByText(/Solicitação criada \(3 documentos\)/).waitFor({ timeout: 20000 });
    await ler(p1, 2000);
    const cardPedido = p1.getByText(/RG \/ CPF, CNIS, Comprovante de residência/).first();
    await cardPedido.waitFor({ timeout: 15000 });
    await deslizar(p1, cardPedido);
    await narrar(p1, "A pendência é uma só, listando tudo que falta.");
    await ler(p1, 4000);
    await still(p1, "ato1-03-pedido-unico");

    // ---- Interna com responsável → tarefa da pessoa ----
    await tentar("solicitacao interna com responsavel", async () => {
      await clicar(p1, p1.getByRole("button", { name: "Nova solicitação" }));
      await ler(p1, 1000);
      await clicar(p1, p1.getByText("Selecione ou busque o tipo...").first());
      await ler(p1, 500);
      await clicar(p1, p1.getByRole("option", { name: "CTPS", exact: true }));
      await ler(p1, 800);
      await narrar(p1, "E quando é o ESCRITÓRIO que providencia: escolhe quem da equipe — e a tarefa abre no nome da pessoa.");
      await clicar(p1, p1.getByRole("combobox").filter({ hasText: "Externa" }).first());
      await ler(p1, 600);
      await clicar(p1, p1.getByRole("option", { name: /Interna/ }));
      await ler(p1, 800);
      await clicar(p1, p1.getByRole("combobox", { name: "Responsável na equipe" }));
      await ler(p1, 600);
      await clicar(p1, p1.getByRole("option", { name: "Equipe Mara Vian" }));
      await ler(p1, 1200);
      await still(p1, "ato1-04-interna");
      await clicar(p1, p1.getByRole("button", { name: /^Criar solicitação$/ }));
      await p1.getByText(/tarefa aberta pro responsável/).waitFor({ timeout: 20000 });
      await ler(p1, 2500);
      await still(p1, "ato1-05-interna-criada");
    });
    await ato1.fechar();

    // ============ ATO 2 — parceiro cumpre com os tipos na ordem ============
    const ato2 = await estudio.novaParte("parceiro");
    const p2 = ato2.page;
    await p2.goto(`${BASE}/documentos`);
    await p2.getByText("Roberto Nunes Farias").first().waitFor({ timeout: 20000 });
    await narrar(p2, "No painel do parceiro, o pedido chega como UMA pendência com a lista.");
    await ler(p2, 3000);
    await still(p2, "ato2-01-painel");

    // Duas pendências do Roberto no painel (a de 3 docs e a interna de CTPS):
    // o card certo é o MENOR div que contém o texto da lista E um botão
    // Cumprir (.last() = mais interno; take 1 e 2 cumpriram a errada por
    // pegar o container externo).
    const cardCerto = p2
      .locator("div")
      .filter({ hasText: /RG \/ CPF, CNIS/ })
      .filter({ has: p2.getByRole("button", { name: "Cumprir" }) })
      .last();
    await clicar(p2, cardCerto.getByRole("button", { name: "Cumprir" }).first());
    await ler(p2, 1500);
    await p2.locator('input[type="file"]').setInputFiles([
      { name: "rg-cpf.jpg", mimeType: "image/jpeg", buffer: PDF_FAKE },
      { name: "cnis.pdf", mimeType: "application/pdf", buffer: PDF_FAKE },
      { name: "conta-luz.pdf", mimeType: "application/pdf", buffer: PDF_FAKE },
    ]);
    await ler(p2, 1800);
    await narrar(p2, "Cada arquivo já nasce com o TIPO na ordem do pedido — e dá pra trocar tipo e nome, um a um.");
    await ler(p2, 4000);
    await still(p2, "ato2-02-tipos-na-ordem");

    await clicar(p2, p2.getByRole("button", { name: "Confirmar" }));
    await p2.getByText("Solicitação cumprida — 3 documentos anexados").waitFor({ timeout: 30000 });
    await narrar(p2, "Três documentos, um cumprimento só.");
    await ler(p2, 4000);
    await still(p2, "ato2-03-cumprido");
    await ato2.fechar();

    // ============ ATO 3 — equipe recebe tudo junto ============
    const ato3 = await estudio.novaParte("interno");
    const p3 = ato3.page;
    await p3.goto(`${BASE}/casos/${casoId}`);
    await p3.getByText("Roberto Nunes Farias").first().waitFor({ timeout: 20000 });
    await clicar(p3, p3.getByText("Documentos", { exact: true }).first());
    const acordeao = p3.getByRole("button", { name: /Solicitações cumpridas/ }).first();
    await acordeao.waitFor({ timeout: 15000 });
    await deslizar(p3, acordeao);
    await clicar(p3, acordeao);
    const anexos = p3.getByText(/3 arquivos:/).first();
    await anexos.waitFor({ timeout: 15000 });
    await deslizar(p3, anexos);
    await narrar(p3, "Na equipe: a solicitação atendida mostra os TRÊS arquivos, cada um com o tipo certo.");
    await ler(p3, 5000);
    await still(p3, "ato3-01-anexos");

    await tentar("tarefas do fluxo", async () => {
      await p3.goto(`${BASE}/tarefas`);
      const busca = p3.getByPlaceholder(/Buscar t/).first();
      await busca.waitFor({ timeout: 20000 });
      await deslizar(p3, busca);
      await busca.pressSequentially("Roberto", { delay: 55 });
      await ler(p3, 1800);
      const analise = p3.getByText(/Analisar documento recebido - Roberto/).first();
      await analise.waitFor({ timeout: 10000 });
      await deslizar(p3, analise);
      await narrar(p3, "UMA tarefa de análise com tudo dentro — e a de 'Providenciar' aberta no nome de quem ficou responsável.");
      await ler(p3, 4500);
      await still(p3, "ato3-02-tarefas");
    });
    await ato3.fechar();
  } finally {
    const clipes = await estudio.encerrar();
    console.log("clipes:", clipes);

    // ----- limpeza total -----
    try {
      const { data: docs } = await admin.from("documentos").select("storage_path").eq("caso_id", casoId);
      const paths = (docs ?? []).map((d) => d.storage_path).filter(Boolean);
      if (paths.length) await admin.storage.from("documentos").remove(paths);
      for (const tabela of [
        "documentos", "solicitacoes_documento", "tarefas", "tarefas_excluidas",
        "notificacoes", "andamentos",
      ]) {
        const { error } = await admin.from(tabela).delete().eq("caso_id", casoId);
        if (error) console.log(`limpeza ${tabela}:`, error.message);
      }
      await admin.from("casos").delete().eq("id", casoId);
      await admin.from("clientes").delete().eq("id", clienteId);
      await admin.from("usuarios").update({ nome: nomeParceiroOriginal }).eq("id", parceira.id);
      if (interna && nomeInternoOriginal) {
        await admin.from("usuarios").update({ nome: nomeInternoOriginal }).eq("id", interna.id);
      }
      console.log("limpeza ok (nomes restaurados)");
    } catch (e) {
      console.log("LIMPEZA FALHOU — apagar na mao: caso", casoId, "cliente", clienteId, e.message);
    }
  }
})();

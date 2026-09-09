// Roteiro do filme: a escada do responsável automático de tarefa.
// (migration_responsavel_automatico_tarefas — pedido da Naira, 2026-09-09:
//  "quando o parceiro manda documentos, a tarefa fica sem responsável").
//
// Cinco clientes, um por degrau da escada — A, B, C, D, E na ordem:
//   Ato 1-3  DEGRAU 1: quem PEDIU o documento     -> Ana Lúcia   (ciclo completo)
//   Ato 4    DEGRAU 2: dono do caso               -> Benedito    (Mariane)
//   Ato 5    DEGRAU 3: dono de fato do caso       -> Cleusa      (Naira)
//   Ato 6    DEGRAU 4: override por configuração  -> Divino      (Sebastião)
//   Ato 7    DEGRAU 5: padrão do escritório       -> Elza        (Mara)
//
// Rodar da raiz: node e2e/demo/roteiros/responsavel-automatico.cjs
// Montagem (MP4 único) e entrega: ver .claude/skills/video-demo/SKILL.md.

const {
  BASE, adminStaging, cpfValido, ler, deslizar, clicar, tentar,
  narrar, limparNarracao, abrirEstudio,
} = require("../helpers.cjs");

const PDF_FAKE = Buffer.from(
  "%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF",
);

const CHAVE_CFG = "tarefa_analise_responsavel_id";

const EQUIPE = {
  mara: "marasandra.adv@gmail.com",
  beatriz: "advocacia.beatrizsan@outlook.com",
  mariane: "marianefer@gmail.com",
  naira: "nairaromerovian@gmail.com",
  sebastiao: "sebastiao.correa2308@gmail.com",
};

(async () => {
  const admin = adminStaging();

  // ---------------- elenco ----------------
  const { data: parceira, error: pErr } = await admin
    .from("usuarios").select("id, nome")
    .eq("email", "e2e+parceiro@marasandraconnect.com").single();
  if (pErr || !parceira) throw new Error(`parceiro sintetico nao encontrado: ${pErr?.message}`);
  const nomeParceiroOriginal = parceira.nome;
  await admin.from("usuarios").update({ nome: "Silva & Costa Advogados" }).eq("id", parceira.id);

  const { data: interna } = await admin
    .from("usuarios").select("id, nome")
    .eq("email", "e2e+interno@marasandraconnect.com").single();
  const nomeInternoOriginal = interna?.nome ?? null;
  if (interna) {
    await admin.from("usuarios").update({ nome: "Equipe Mara Vian" }).eq("id", interna.id);
  }

  const equipe = {};
  for (const [apelido, email] of Object.entries(EQUIPE)) {
    const { data } = await admin.from("usuarios").select("id, nome").eq("email", email).single();
    if (!data) throw new Error(`interno nao encontrado no staging: ${email}`);
    equipe[apelido] = data;
  }

  // ---------------- cenário: 5 casos, um por degrau ----------------
  const CASOS = [
    { chave: "a", nome: "Ana Lúcia Ferreira",       beneficio: "Aposentadoria por idade" },
    { chave: "b", nome: "Benedito Ramos Teixeira",  beneficio: "Auxílio-doença" },
    { chave: "c", nome: "Cleusa Antunes de Moraes", beneficio: "Pensão por morte" },
    { chave: "d", nome: "Divino Barbosa da Rocha",  beneficio: "Aposentadoria por idade" },
    { chave: "e", nome: "Elza Monteiro Pacheco",    beneficio: "Salário-maternidade" },
  ];

  const cena = {};
  for (const c of CASOS) {
    const { data: cli, error: cErr } = await admin
      .from("clientes").insert({ nome: c.nome, cpf: cpfValido() }).select("id").single();
    if (cErr) throw new Error(`seed cliente ${c.nome}: ${cErr.message}`);
    const { data: caso, error: kErr } = await admin
      .from("casos")
      .insert({
        cliente_id: cli.id,
        tipo_beneficio: c.beneficio,
        fase: "analise",
        parceiro_id: parceira.id,
      })
      .select("id").single();
    if (kErr) throw new Error(`seed caso ${c.nome}: ${kErr.message}`);
    // O caso nasce com a tarefa "Cliente novo - Analisar", que por 10 minutos
    // suprime a de documentos (regra do próprio trigger). Aqui os casos
    // representam processos que JÁ existem, então a de abertura sai de cena.
    await admin.from("tarefas").delete().eq("caso_id", caso.id);
    cena[c.chave] = { ...c, clienteId: cli.id, casoId: caso.id };
  }

  // Upload do parceiro = o gesto que dispara _documento_parceiro_cria_tarefa.
  async function parceiroSobeDocumento(casoId, nomeArquivo) {
    const { error } = await admin.from("documentos").insert({
      caso_id: casoId,
      tipo: "outro",
      nome_arquivo: nomeArquivo,
      storage_path: `demo/${casoId}/${nomeArquivo}`,
      uploaded_by: parceira.id,
      visivel_parceiro: true,
    });
    if (error) throw new Error(`documento em ${casoId}: ${error.message}`);
  }

  // DEGRAU 2 — dono explícito do caso.
  await admin.from("casos")
    .update({ responsavel_id: equipe.mariane.id }).eq("id", cena.b.casoId);
  await parceiroSobeDocumento(cena.b.casoId, "Laudo_medico_Benedito.pdf");

  // DEGRAU 3 — sem dono definido, mas alguém já cuida do caso.
  await admin.from("tarefas").insert({
    caso_id: cena.c.casoId,
    tipo: "interna",
    status: "a_fazer",
    prioridade: 2,
    responsavel_id: equipe.naira.id,
    due_at: new Date(Date.now() + 3 * 86400_000).toISOString(),
    titulo: `Analisar CNIS e montar a inicial - ${cena.c.nome}`,
    descricao: "Conferir vínculos no CNIS e preparar a petição inicial.",
  });
  await parceiroSobeDocumento(cena.c.casoId, "Certidao_obito_Cleusa.pdf");

  // DEGRAU 4 — a chave de configuração manda enquanto existir.
  await admin.from("app_config")
    .upsert({ chave: CHAVE_CFG, valor: equipe.sebastiao.id }, { onConflict: "chave" });
  await parceiroSobeDocumento(cena.d.casoId, "Comprovante_residencia_Divino.pdf");
  await admin.from("app_config").delete().eq("chave", CHAVE_CFG);

  // DEGRAU 5 — nada definido: cai no padrão do escritório.
  await parceiroSobeDocumento(cena.e.casoId, "CTPS_Elza.pdf");

  console.log("seed ok:", Object.fromEntries(
    Object.entries(cena).map(([k, v]) => [k, v.casoId]),
  ));

  const estudio = await abrirEstudio("responsavel-automatico");
  const { still } = estudio;

  // Abre a tarefa na lista e mostra o campo Responsável do painel.
  async function mostrarDonoDaTarefa(page, textoBusca, regexTitulo, rotuloStill) {
    const busca = page.getByPlaceholder(/Buscar t/).first();
    await busca.waitFor({ timeout: 20000 });
    await deslizar(page, busca);
    await busca.fill("");
    await busca.pressSequentially(textoBusca, { delay: 45 });
    await ler(page, 1600);
    const linha = page.getByText(regexTitulo).first();
    await linha.waitFor({ timeout: 15000 });
    await deslizar(page, linha);
    await ler(page, 1500);
    await still(page, `${rotuloStill}-lista`);
    await clicar(page, linha);
    const campo = page.getByText("Responsável", { exact: true }).first();
    await campo.waitFor({ timeout: 15000 });
    await deslizar(page, campo);
    await ler(page, 3200);
    await still(page, `${rotuloStill}-responsavel`);
  }

  try {
    // ============ ATO 1 — a equipe pede o documento ao parceiro ============
    const ato1 = await estudio.novaParte("interno");
    const p1 = ato1.page;
    await p1.goto(`${BASE}/casos/${cena.a.casoId}`);
    await p1.getByText(cena.a.nome).first().waitFor({ timeout: 25000 });
    await narrar(p1, "DEGRAU 1 — quem pede o documento é quem confere quando ele chega.");
    await ler(p1, 2600);
    await still(p1, "ato1-01-caso");

    await clicar(p1, p1.getByText("Documentos", { exact: true }).first());
    await ler(p1, 1200);
    await narrar(p1, "A equipe abre uma solicitação de documento para o parceiro.");
    await clicar(p1, p1.getByRole("button", { name: "Nova solicitação" }));
    await ler(p1, 1400);
    await still(p1, "ato1-02-nova-solicitacao");

    await clicar(p1, p1.getByRole("combobox").filter({ hasText: "Selecione ou busque o tipo" }));
    await ler(p1, 700);
    await p1.getByPlaceholder(/Buscar tipo/).fill("CNIS");
    await ler(p1, 700);
    await clicar(p1, p1.getByRole("option", { name: "CNIS" }).first());
    await ler(p1, 1200);
    await still(p1, "ato1-03-tipo");

    await clicar(p1, p1.getByRole("button", { name: /Criar solicita/ }));
    await p1.getByText(/Solicitação criada/).waitFor({ timeout: 25000 });
    await narrar(p1, "Pedido registrado. O banco guarda QUEM pediu — é a chave do degrau 1.");
    await ler(p1, 3000);
    await still(p1, "ato1-04-criada");
    await limparNarracao(p1);
    await ato1.fechar();

    // ============ ATO 2 — o parceiro cumpre pela aba dele ============
    const ato2 = await estudio.novaParte("parceiro");
    const p2 = ato2.page;
    await p2.goto(`${BASE}/tarefas`);
    await p2.getByRole("heading", { name: "Tarefas" }).waitFor({ timeout: 25000 });
    await narrar(p2, "Do lado do parceiro: é aqui que ele manda os documentos.");
    await ler(p2, 2600);
    await still(p2, "ato2-01-kanban");

    const card = p2.getByRole("button", { name: `Abrir caso de ${cena.a.nome}` });
    await card.waitFor({ timeout: 25000 });
    await deslizar(p2, card);
    await ler(p2, 1800);
    await clicar(p2, card.getByRole("button", { name: "Cumprir", exact: true }));
    await p2.getByRole("heading", { name: "Cumprir solicitação" }).waitFor({ timeout: 12000 });
    await narrar(p2, "Ele anexa o CNIS e envia. Este é o gesto que gerava tarefa órfã.");
    await ler(p2, 1400);
    await p2.locator('input[type="file"]').setInputFiles({
      name: "CNIS_Ana_Lucia_Ferreira.pdf",
      mimeType: "application/pdf",
      buffer: PDF_FAKE,
    });
    await ler(p2, 1800);
    await still(p2, "ato2-02-anexo");
    await clicar(p2, p2.getByRole("button", { name: "Confirmar" }));
    await p2.getByText(/Solicitação cumprida/).waitFor({ timeout: 30000 });
    await narrar(p2, "Enviado.");
    await ler(p2, 2400);
    await still(p2, "ato2-03-cumprido");
    await limparNarracao(p2);
    await ato2.fechar();

    // ============ ATO 3 — DEGRAU 1: volta pra quem pediu ============
    const ato3 = await estudio.novaParte("interno");
    const p3 = ato3.page;
    await p3.goto(`${BASE}/tarefas`);
    await narrar(p3, "DEGRAU 1 — a tarefa nasceu e foi direto pra quem pediu o documento.");
    await mostrarDonoDaTarefa(
      p3, "Ana Lúcia Ferreira", /Analisar documento recebido - Ana Lúcia Ferreira/, "ato3-degrau1",
    );
    await narrar(p3, "Antes desta correção, este campo vinha vazio: “Sem responsável”.");
    await ler(p3, 3200);
    await limparNarracao(p3);
    await ato3.fechar();

    // ============ ATO 4 — DEGRAU 2: o dono do caso ============
    const ato4 = await estudio.novaParte("interno");
    const p4 = ato4.page;
    await p4.goto(`${BASE}/casos/${cena.b.casoId}`);
    await p4.getByText(cena.b.nome).first().waitFor({ timeout: 25000 });
    await narrar(p4, "DEGRAU 2 — o caso agora tem dono, e o dono é quem recebe o trabalho.");
    await ler(p4, 2600);
    await still(p4, "ato4-01-caso");
    await tentar("campo Responsável pelo caso", async () => {
      await clicar(p4, p4.getByRole("button", { name: "Editar", exact: true }).first());
      await p4.getByText("Dados do caso", { exact: true }).first()
        .waitFor({ timeout: 15000 });
      await ler(p4, 900);
      const campo = p4.getByText("Responsável pelo caso").first();
      await campo.waitFor({ timeout: 15000 });
      await deslizar(p4, campo);
      await narrar(p4, "Campo novo na tela do caso: quem, na equipe, cuida deste processo.");
      await ler(p4, 3600);
      await still(p4, "ato4-02-campo-responsavel");
      await clicar(p4, p4.getByRole("button", { name: "Cancelar" }).first());
      await ler(p4, 900);
    });
    await p4.goto(`${BASE}/tarefas`);
    await narrar(p4, "O parceiro juntou documentos neste caso. A tarefa foi pra dona dele.");
    await mostrarDonoDaTarefa(
      p4, "Benedito Ramos", /Analisar documentos juntados pelo parceiro - Benedito/, "ato4-degrau2",
    );
    await limparNarracao(p4);
    await ato4.fechar();

    // ============ ATO 5 — DEGRAU 3: quem já cuida do caso ============
    const ato5 = await estudio.novaParte("interno");
    const p5 = ato5.page;
    await p5.goto(`${BASE}/tarefas`);
    await narrar(p5, "DEGRAU 3 — caso sem dono definido, mas alguém já está tocando ele.");
    await mostrarDonoDaTarefa(
      p5, "Cleusa Antunes", /Analisar CNIS e montar a inicial - Cleusa/, "ato5-01-tarefa-existente",
    );
    await narrar(p5, "Esta tarefa antiga é da Naira. É esse rastro que o banco lê.");
    await ler(p5, 3000);
    await p5.goto(`${BASE}/tarefas`);
    await narrar(p5, "E a tarefa nova do documento foi para a mesma pessoa.");
    await mostrarDonoDaTarefa(
      p5, "Cleusa Antunes", /Analisar documentos juntados pelo parceiro - Cleusa/, "ato5-degrau3",
    );
    await limparNarracao(p5);
    await ato5.fechar();

    // ============ ATO 6 — DEGRAU 4: a configuração ============
    const ato6 = await estudio.novaParte("interno");
    const p6 = ato6.page;
    await p6.goto(`${BASE}/tarefas`);
    await narrar(p6, "DEGRAU 4 — dá pra apontar um destino padrão por configuração.");
    await ler(p6, 2400);
    await mostrarDonoDaTarefa(
      p6, "Divino Barbosa", /Analisar documentos juntados pelo parceiro - Divino/, "ato6-degrau4",
    );
    await narrar(p6, "Aqui a configuração apontava para o Sebastião — e a tarefa nasceu dele.");
    await ler(p6, 3400);
    await narrar(p6, "Trocar o destino é uma linha de configuração, sem mexer no código.");
    await ler(p6, 3200);
    await limparNarracao(p6);
    await ato6.fechar();

    // ============ ATO 7 — DEGRAU 5: o padrão do escritório ============
    const ato7 = await estudio.novaParte("interno");
    const p7 = ato7.page;
    await p7.goto(`${BASE}/tarefas`);
    await narrar(p7, "DEGRAU 5 — cliente novo, caso zerado, nenhuma pista de quem cuida.");
    await ler(p7, 2400);
    await mostrarDonoDaTarefa(
      p7, "Elza Monteiro", /Analisar documentos juntados pelo parceiro - Elza/, "ato7-degrau5",
    );
    await narrar(p7, "Ainda assim tem dono: cai na Mara, o padrão do escritório.");
    await ler(p7, 3400);
    await narrar(p7, "Nenhum dos cinco caminhos termina em “Sem responsável”.");
    await ler(p7, 3600);
    await limparNarracao(p7);
    await ato7.fechar();
  } finally {
    const clipes = await estudio.encerrar();
    console.log("clipes:", clipes);

    // ---------------- limpeza total ----------------
    try {
      await admin.from("app_config").delete().eq("chave", CHAVE_CFG);
      for (const c of Object.values(cena)) {
        const { data: docs } = await admin
          .from("documentos").select("storage_path").eq("caso_id", c.casoId);
        const paths = (docs ?? []).map((d) => d.storage_path).filter(Boolean);
        if (paths.length) await admin.storage.from("documentos").remove(paths);
        for (const tabela of [
          "documentos", "solicitacoes_documento", "tarefas", "tarefas_excluidas",
          "notificacoes", "andamentos",
        ]) {
          const { error } = await admin.from(tabela).delete().eq("caso_id", c.casoId);
          if (error) console.log(`limpeza ${tabela} (${c.nome}):`, error.message);
        }
        await admin.from("casos").delete().eq("id", c.casoId);
        await admin.from("clientes").delete().eq("id", c.clienteId);
      }
      await admin.from("usuarios").update({ nome: nomeParceiroOriginal }).eq("id", parceira.id);
      if (interna && nomeInternoOriginal) {
        await admin.from("usuarios").update({ nome: nomeInternoOriginal }).eq("id", interna.id);
      }
      console.log("limpeza ok (nomes restaurados, chave de config removida)");
    } catch (e) {
      console.log("LIMPEZA FALHOU — apagar na mao:", JSON.stringify(cena), e.message);
    }
  }
})();

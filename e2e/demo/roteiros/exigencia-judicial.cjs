// Roteiro-modelo do filme de demonstração (skill /video-demo).
// História: Exigência Judicial de ponta a ponta.
//   Ato 1 (equipe): aplica o template no caso — publicação, prazo, salvar;
//                   mostra tarefas, andamento "visível parceiro" e a
//                   solicitação reescrita pela IA.
//   Ato 2 (parceiro): vê o caso, lê o pedido mastigado e cumpre com anexo.
//   Ato 3 (equipe): a tarefa "Documento entregue — juntar aos autos" nasceu.
//
// Rodar da raiz: node e2e/demo/roteiros/exigencia-judicial.cjs
// Montagem (MP4 único) e entrega: ver .claude/skills/video-demo/SKILL.md.

const {
  BASE, adminStaging, cpfValido, ler, deslizar, clicar, tentar, abrirEstudio,
} = require("../helpers.cjs");

const PUBLICACAO = `INTIMAÇÃO — Processo nº 5001234-56.2026.4.03.6183 (Procedimento Comum)
AUTORA: MARIA APARECIDA DA SILVA — RÉU: INSTITUTO NACIONAL DO SEGURO SOCIAL — INSS

Vistos. Intime-se a parte autora para que, no prazo de 15 (quinze) dias, junte aos autos:
a) CNIS atualizado;
b) cópia integral da CTPS (páginas de identificação e contratos de trabalho);
c) comprovante de residência atualizado em nome da autora;
sob pena de julgamento do feito no estado em que se encontra.
Intime-se. São Paulo, 21 de agosto de 2026.`;

const PDF_FAKE = Buffer.from(
  "%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF",
);

(async () => {
  const admin = adminStaging();

  // ----- dados de cena: cliente com nome verossímil, caso ligado ao parceiro
  // sintético; nomes das contas ficam apresentáveis SÓ durante a filmagem. -----
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
    .insert({ nome: "Maria Aparecida da Silva", cpf: cpfValido() })
    .select("id").single();
  if (cErr) throw new Error(`seed cliente: ${cErr.message}`);
  const clienteId = cliente.id;

  const { data: caso, error: kErr } = await admin
    .from("casos")
    .insert({
      cliente_id: clienteId,
      tipo_beneficio: "Auxílio-doença",
      fase: "analise",
      parceiro_id: parceira.id,
    })
    .select("id").single();
  if (kErr) throw new Error(`seed caso: ${kErr.message}`);
  const casoId = caso.id;
  console.log("seed ok — caso:", casoId);

  const estudio = await abrirEstudio("exigencia-judicial");
  const { still } = estudio;

  try {
    // ================= ATO 1 — equipe aplica o template =================
    const ato1 = await estudio.novaParte("interno");
    const p1 = ato1.page;
    await p1.goto(`${BASE}/casos/${casoId}`);
    await p1.getByText("Maria Aparecida da Silva").first().waitFor({ timeout: 20000 });
    await ler(p1, 2500);
    await still(p1, "ato1-01-caso");

    await clicar(p1, p1.getByText("Atividades", { exact: true }).first());
    await ler(p1, 1500);
    await clicar(p1, p1.getByRole("button", { name: "Nova tarefa" }));
    await ler(p1, 1500);

    await clicar(p1, p1.getByRole("combobox").filter({ hasText: "Escolha um template" }));
    await ler(p1, 800);
    await clicar(p1, p1.getByRole("option", { name: "Exigência Judicial" }));
    await ler(p1, 2200); // banner "2 tarefas + 1 andamento + 1 solicitação"
    await still(p1, "ato1-02-template");

    const campoPub = p1.getByLabel("Documentos solicitados pela Justiça");
    await deslizar(p1, campoPub);
    await campoPub.fill(PUBLICACAO);
    await ler(p1, 2200);
    await still(p1, "ato1-03-publicacao");

    await clicar(p1, p1.getByLabel("Prazo em dias úteis", { exact: true }));
    await ler(p1, 700);
    await clicar(p1, p1.getByRole("option", { name: "15 dias" }));
    await ler(p1, 2200); // fatal calculado aparece
    await deslizar(p1, p1.getByLabel("Prazo fatal (fim do prazo judicial)"));
    await ler(p1, 1500);
    await still(p1, "ato1-04-prazo");

    await clicar(p1, p1.getByRole("button", { name: "Salvar" }));
    // A IA reescreve a solicitação DURANTE o save (o botão vira spinner e o
    // nome acessível "Salvar" some antes da hora). O sinal confiável de
    // conclusão é o sheet FECHAR — espere o Cancelar sumir. NUNCA navegue
    // com o save em andamento: aborta os inserts no meio.
    await p1.getByRole("button", { name: "Cancelar" })
      .waitFor({ state: "hidden", timeout: 120000 });
    await ler(p1, 2000);
    await still(p1, "ato1-05-salvo");

    // Tarefas + andamento "visível parceiro" na aba Atividades
    await p1.reload();
    await p1.getByText("Maria Aparecida da Silva").first().waitFor({ timeout: 20000 });
    await clicar(p1, p1.getByText("Atividades", { exact: true }).first());
    const fatal = p1.getByText(/FATAL - CUMPRIMENTO DE EXIGENCIA JUDICIAL/).first();
    await fatal.waitFor({ timeout: 20000 });
    await deslizar(p1, fatal);
    await ler(p1, 3000);
    await still(p1, "ato1-06-tarefas");

    // Solicitação mastigada na aba Documentos (fallback: página /documentos)
    let mostrouSolic = false;
    await tentar("solicitacao na aba Documentos", async () => {
      await clicar(p1, p1.getByText("Documentos", { exact: true }).first());
      const ola = p1.getByText(/Olá!/).first();
      await ola.waitFor({ timeout: 12000 });
      await deslizar(p1, ola);
      await ler(p1, 5000);
      mostrouSolic = true;
    });
    if (!mostrouSolic) {
      await p1.goto(`${BASE}/documentos`);
      await tentar("solicitacao em /documentos", async () => {
        const ola = p1.getByText(/Olá!/).first();
        await ola.waitFor({ timeout: 12000 });
        await deslizar(p1, ola);
        await ler(p1, 5000);
      });
    }
    await still(p1, "ato1-07-solicitacao");
    await ato1.fechar();

    // ================= ATO 2 — parceiro recebe e cumpre =================
    const ato2 = await estudio.novaParte("parceiro");
    const p2 = ato2.page;
    await p2.goto(`${BASE}/casos/${casoId}`);
    await p2.getByText("Maria Aparecida da Silva").first().waitFor({ timeout: 20000 });
    await ler(p2, 3000);
    await still(p2, "ato2-01-caso-parceiro");

    await p2.goto(`${BASE}/documentos`);
    await p2.getByText("Maria Aparecida da Silva").first().waitFor({ timeout: 20000 });
    await ler(p2, 2000);
    await tentar("mensagem mastigada na visao do parceiro", async () => {
      const ola = p2.getByText(/Olá!/).first();
      await ola.waitFor({ timeout: 8000 });
      await deslizar(p2, ola);
      await ler(p2, 5000);
    });
    await still(p2, "ato2-02-pendencia");

    await clicar(
      p2,
      p2.locator("div").filter({ hasText: "Maria Aparecida da Silva" })
        .getByRole("button", { name: "Cumprir" }).first(),
    );
    await ler(p2, 1500);
    await p2.locator('input[type="file"]').setInputFiles({
      name: "CNIS_Maria_Aparecida.pdf",
      mimeType: "application/pdf",
      buffer: PDF_FAKE,
    });
    await ler(p2, 2000);
    await still(p2, "ato2-03-anexo");
    await clicar(p2, p2.getByRole("button", { name: "Confirmar" }));
    await p2.getByText(/Solicitação cumprida — \d+ documento/).waitFor({ timeout: 30000 });
    await ler(p2, 3000);
    await still(p2, "ato2-04-cumprido");
    await ato2.fechar();

    // ================= ATO 3 — equipe vê o retorno =================
    const ato3 = await estudio.novaParte("interno");
    const p3 = ato3.page;
    await p3.goto(`${BASE}/tarefas`);
    const busca = p3.getByPlaceholder(/Buscar t/).first();
    await busca.waitFor({ timeout: 20000 });
    await ler(p3, 1500);
    await deslizar(p3, busca);
    await busca.pressSequentially("Documento entregue", { delay: 55 });
    await ler(p3, 1800);
    const tarefaRetorno = p3.getByText(/Documento entregue — juntar aos autos/).first();
    await tarefaRetorno.waitFor({ timeout: 15000 });
    await deslizar(p3, tarefaRetorno);
    await ler(p3, 2000);
    await still(p3, "ato3-01-lista");
    await clicar(p3, tarefaRetorno);
    await tentar("descricao da tarefa de retorno", async () => {
      await p3.getByText(/Peticionar a juntada/).first().waitFor({ timeout: 8000 });
    });
    await ler(p3, 4000);
    await still(p3, "ato3-02-tarefa");
    await ato3.fechar();
  } finally {
    const clipes = await estudio.encerrar();
    console.log("clipes:", clipes);

    // ----- limpeza total do seed (filhos → caso → cliente → nomes) -----
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

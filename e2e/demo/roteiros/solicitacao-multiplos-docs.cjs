// Filme: cumprimento de exigência com VÁRIOS documentos (pedido dos
// parceiros, 2026-08-26).
//   Ato 1 (equipe): o pedido de RG/CPF pendente no caso — um documento que
//                   naturalmente tem frente e verso.
//   Ato 2 (parceiro): cumpre a pendência anexando DOIS arquivos de uma vez,
//                     vê os nomes automáticos, remove um 3º adicionado por
//                     engano e confirma.
//   Ato 3 (equipe): a solicitação atendida lista os dois arquivos juntos.
//
// Rodar da raiz: node e2e/demo/roteiros/solicitacao-multiplos-docs.cjs

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

  const { error: sErr } = await admin.from("solicitacoes_documento").insert({
    caso_id: casoId,
    tipo: "rg_cpf",
    descricao: "Precisamos do RG do Roberto — frente e verso, legíveis.",
    status: "pendente",
    origem: "externa",
  });
  if (sErr) throw new Error(`seed solicitacao: ${sErr.message}`);
  console.log("seed ok — caso:", casoId);

  const estudio = await abrirEstudio("solicitacao-multiplos-docs");
  const { still } = estudio;

  try {
    // ================= ATO 1 — o pedido pendente =================
    const ato1 = await estudio.novaParte("interno");
    const p1 = ato1.page;
    await p1.goto(`${BASE}/casos/${casoId}`);
    await p1.getByText("Roberto Nunes Farias").first().waitFor({ timeout: 20000 });
    await narrar(p1, "A equipe pediu ao parceiro o RG do cliente — um documento que tem frente e verso.");
    await ler(p1, 2500);
    await still(p1, "ato1-01-caso");

    await clicar(p1, p1.getByText("Documentos", { exact: true }).first());
    const pedido = p1.getByText(/frente e verso, legíveis/).first();
    await pedido.waitFor({ timeout: 15000 });
    await deslizar(p1, pedido);
    await narrar(p1, "A pendência fica registrada no caso, aguardando o parceiro.");
    await ler(p1, 3500);
    await still(p1, "ato1-02-pendencia");
    await ato1.fechar();

    // ================= ATO 2 — parceiro cumpre com 2 arquivos =================
    const ato2 = await estudio.novaParte("parceiro");
    const p2 = ato2.page;
    await p2.goto(`${BASE}/documentos`);
    await p2.getByText("Roberto Nunes Farias").first().waitFor({ timeout: 20000 });
    await narrar(p2, "No painel do parceiro, a pendência do Roberto está aguardando.");
    await ler(p2, 3000);
    await still(p2, "ato2-01-painel");

    await clicar(
      p2,
      p2.locator("div").filter({ hasText: "Roberto Nunes Farias" })
        .getByRole("button", { name: "Cumprir" }).first(),
    );
    await ler(p2, 1200);
    await narrar(p2, "NOVIDADE: agora dá pra anexar VÁRIOS arquivos no mesmo cumprimento.");
    await ler(p2, 2200);

    // Frente e verso de uma vez só.
    await p2.locator('input[type="file"]').setInputFiles([
      { name: "rg-frente.jpg", mimeType: "image/jpeg", buffer: PDF_FAKE },
      { name: "rg-verso.jpg", mimeType: "image/jpeg", buffer: PDF_FAKE },
    ]);
    await ler(p2, 1800);
    await narrar(p2, "Cada arquivo ganha um nome automático — dá pra ajustar um a um.");
    await ler(p2, 3000);
    await still(p2, "ato2-02-dois-arquivos");

    // Um 3º entrou por engano — o X remove sem recomeçar.
    await p2.locator('input[type="file"]').setInputFiles([
      { name: "foto-do-gato.jpg", mimeType: "image/jpeg", buffer: PDF_FAKE },
    ]);
    await ler(p2, 1500);
    await narrar(p2, "Entrou um arquivo errado? O X remove só ele, sem recomeçar tudo.");
    await ler(p2, 1500);
    await still(p2, "ato2-03-arquivo-errado");
    await clicar(p2, p2.getByRole("button", { name: "Remover arquivo 3" }));
    await ler(p2, 2000);

    await clicar(p2, p2.getByRole("button", { name: "Confirmar" }));
    await p2.getByText("Solicitação cumprida — 2 documentos anexados").waitFor({ timeout: 30000 });
    await narrar(p2, "Pronto: os dois arquivos subiram juntos, num cumprimento só.");
    await ler(p2, 4500);
    await still(p2, "ato2-04-cumprido");
    await ato2.fechar();

    // ================= ATO 3 — equipe vê os anexos juntos =================
    const ato3 = await estudio.novaParte("interno");
    const p3 = ato3.page;
    await p3.goto(`${BASE}/casos/${casoId}`);
    await p3.getByText("Roberto Nunes Farias").first().waitFor({ timeout: 20000 });
    await clicar(p3, p3.getByText("Documentos", { exact: true }).first());
    // As atendidas moram no acordeão "Solicitações cumpridas" — abrir antes.
    const acordeao = p3.getByRole("button", { name: /Solicitações cumpridas/ }).first();
    await acordeao.waitFor({ timeout: 15000 });
    await deslizar(p3, acordeao);
    await narrar(p3, "O pedido cumprido vai pro histórico de solicitações do caso.");
    await ler(p3, 1500);
    await clicar(p3, acordeao);
    const anexos = p3.getByText(/2 arquivos:/).first();
    await anexos.waitFor({ timeout: 15000 });
    await deslizar(p3, anexos);
    await narrar(p3, "Na equipe, a solicitação atendida mostra os DOIS arquivos juntos, prontos pra usar.");
    await ler(p3, 5000);
    await still(p3, "ato3-01-anexos");

    await tentar("tarefa de analise", async () => {
      await p3.goto(`${BASE}/tarefas`);
      const busca = p3.getByPlaceholder(/Buscar t/).first();
      await busca.waitFor({ timeout: 20000 });
      await deslizar(p3, busca);
      await busca.pressSequentially("Roberto", { delay: 55 });
      await ler(p3, 1500);
      const tarefa = p3.getByText(/Analisar documento|documento/i).first();
      await tarefa.waitFor({ timeout: 8000 });
      await deslizar(p3, tarefa);
      await narrar(p3, "E a tarefa de conferência nasce sozinha pra equipe, como sempre.");
      await ler(p3, 3500);
      await still(p3, "ato3-02-tarefa");
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

// Filme de demonstração (skill /video-demo): as duas funções de IA que o front
// chama continuam atendendo a equipe depois do #375 (auth nas edge functions).
// IA DE VERDADE — nada de simular a resposta: é justamente o que a suíte E2E
// não prova (lá as duas respostas são simuladas).
//   Ato 1 (equipe): conclui uma tarefa do caso → a IA sugere a próxima →
//                   "Editar tarefa sugerida" → salva.
//   Ato 2 (equipe): template Exigência Judicial → a IA escreve o pedido ao
//                   parceiro em linguagem simples, com "enviar até" = fatal − 3.
//   Ato 3 (parceiro): vê o pedido — sem a data fatal.
//
// Rodar da raiz: node e2e/demo/roteiros/ia-apos-autenticacao.cjs

const {
  BASE, adminStaging, cpfValido, ler, deslizar, clicar, tentar, abrirEstudio,
  narrar, limparNarracao,
} = require("../helpers.cjs");

const CLIENTE = "Cláudia Regina Morais";
const TAREFA = "Protocolar requerimento de aposentadoria no INSS";

const DESPACHO = `INTIMAÇÃO — Processo nº 5004321-10.2026.4.03.6183 (Procedimento Comum)
AUTORA: CLÁUDIA REGINA MORAIS — RÉU: INSTITUTO NACIONAL DO SEGURO SOCIAL — INSS

Vistos. Intime-se a parte autora para que, no prazo de 15 (quinze) dias, junte aos autos:
a) CNIS atualizado;
b) cópia integral da CTPS (páginas de identificação e contratos de trabalho);
c) PPP da empresa Metalúrgica Paulista Ltda.;
sob pena de julgamento do feito no estado em que se encontra.
Intime-se. São Paulo, 16 de setembro de 2026.`;

const diaBR = (iso) =>
  new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo" }).format(new Date(iso));

async function irPara(page, url) {
  for (let t = 1; ; t++) {
    try {
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });
      return;
    } catch (e) {
      if (t >= 2) throw e;
    }
  }
}

(async () => {
  const admin = adminStaging();

  // ----- contas sintéticas com nome apresentável SÓ durante a filmagem -----
  const { data: parceira, error: pErr } = await admin
    .from("usuarios").select("id, nome").eq("email", "e2e+parceiro@marasandraconnect.com").single();
  if (pErr || !parceira) throw new Error(`parceiro sintetico nao encontrado: ${pErr?.message}`);
  const { data: interna, error: iErr } = await admin
    .from("usuarios").select("id, nome").eq("email", "e2e+interno@marasandraconnect.com").single();
  if (iErr || !interna) throw new Error(`interno sintetico nao encontrado: ${iErr?.message}`);
  const nomeParceiroOriginal = parceira.nome;
  const nomeInternoOriginal = interna.nome;
  await admin.from("usuarios").update({ nome: "Silva & Costa Advogados" }).eq("id", parceira.id);
  await admin.from("usuarios").update({ nome: "Equipe Mara Vian" }).eq("id", interna.id);

  // ----- dados de cena -----
  const { data: cliente, error: cErr } = await admin
    .from("clientes").insert({ nome: CLIENTE, cpf: cpfValido() }).select("id").single();
  if (cErr) throw new Error(`seed cliente: ${cErr.message}`);
  const clienteId = cliente.id;
  let casoId = null;

  const resultado = { sugestao: null, mensagem: null };
  const estudio = await abrirEstudio("ia-apos-autenticacao");
  const { still } = estudio;

  try {
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
    casoId = caso.id;

    const { error: tErr } = await admin.from("tarefas").insert({
      caso_id: casoId,
      tipo: "interna",
      status: "a_fazer",
      titulo: TAREFA,
      descricao: "Documentação completa: CNIS, CTPS e RG conferidos. Protocolar pelo Meu INSS.",
      origem: "manual",
      responsavel_id: interna.id,
      due_at: new Date(Date.now() + 86400_000).toISOString(),
    });
    if (tErr) throw new Error(`seed tarefa: ${tErr.message}`);
    console.log("seed ok — caso:", casoId);
    await new Promise((r) => setTimeout(r, 1500));

    // ================= ATO 1 — sugestão da próxima tarefa =================
    const ato1 = await estudio.novaParte("interno");
    const p1 = ato1.page;
    await irPara(p1, `${BASE}/casos/${casoId}`);
    await p1.getByText(CLIENTE).first().waitFor({ timeout: 30000 });
    await narrar(p1, "Depois do reforço de segurança nas funções (#375): a IA continua atendendo a equipe?", 3800);
    await narrar(p1, "Parte 1 — ao concluir uma tarefa do caso, a IA sugere qual é a próxima.", 3400);

    await clicar(p1, p1.getByText("Atividades", { exact: true }).first());
    const cardTarefa = p1.getByText(TAREFA).first();
    await cardTarefa.waitFor({ timeout: 20000 });
    await ler(p1, 1200);
    await still(p1, "ato1-01-caso");
    await clicar(p1, cardTarefa);
    await p1.getByRole("heading", { name: "Editar tarefa" }).waitFor({ timeout: 15000 });
    await narrar(p1, "O requerimento foi protocolado: a tarefa vai para Feito.", 2600);

    await clicar(p1, p1.getByRole("combobox", { name: "Status" }));
    await ler(p1, 600);
    await clicar(p1, p1.getByRole("option", { name: "Feito", exact: true }));
    const popup = p1.getByRole("dialog", { name: "Concluir tarefa" });
    await popup.waitFor({ timeout: 15000 });
    await ler(p1, 1500);
    await clicar(p1, popup.getByRole("button", { name: "Concluir tarefa", exact: true }));

    const proxima = p1.getByRole("dialog", { name: "Próxima tarefa do caso" });
    await proxima.waitFor({ timeout: 20000 });
    await narrar(p1, "Agora a IA lê o caso — tarefas, andamentos, fase — e propõe o passo seguinte…", 1500);
    await still(p1, "ato1-02-ia-pensando");

    const ok = proxima.getByText("Sugerida pela IA");
    const falhou = proxima.getByText("Não consegui sugerir a próxima tarefa.");
    await ok.or(falhou).first().waitFor({ timeout: 90000 });
    if (await falhou.isVisible().catch(() => false)) {
      resultado.sugestao = "FALHOU: " + (await proxima.innerText()).replace(/\s+/g, " ").slice(0, 300);
      await narrar(p1, "A IA não respondeu nesta tomada.", 3000);
      await still(p1, "ato1-03-falhou");
    } else {
      resultado.sugestao = (await proxima.innerText()).replace(/\s+/g, " ").slice(0, 400);
      await narrar(p1, "Respondeu: a sugestão vem com título, descrição, prazo e responsável.", 5500);
      await still(p1, "ato1-03-sugestao");

      await narrar(p1, "Nada é criado sozinho: 'Editar tarefa sugerida' abre o formulário para conferir.", 2800);
      await clicar(p1, proxima.getByRole("button", { name: "Editar tarefa sugerida" }));
      await p1.getByRole("heading", { name: "Nova tarefa" }).waitFor({ timeout: 15000 });
      await ler(p1, 3500);
      await still(p1, "ato1-04-form-preenchido");
      const tituloSugerido = await p1.locator("#t-titulo").inputValue().catch(() => "");
      await clicar(p1, p1.getByRole("button", { name: "Salvar" }));
      await p1.getByRole("heading", { name: "Nova tarefa" }).waitFor({ state: "hidden", timeout: 30000 });
      await limparNarracao(p1);

      await irPara(p1, `${BASE}/casos/${casoId}`);
      await p1.getByText(CLIENTE).first().waitFor({ timeout: 30000 });
      await clicar(p1, p1.getByText("Atividades", { exact: true }).first());
      await tentar("nova tarefa na lista", async () => {
        const nova = p1.getByText(tituloSugerido, { exact: false }).first();
        await nova.waitFor({ timeout: 15000 });
        await nova.evaluate((el) => el.scrollIntoView({ block: "center", behavior: "smooth" }));
        await ler(p1, 800);
        await deslizar(p1, nova);
      });
      await narrar(p1, "Salva: a próxima tarefa já está no caso.", 3500);
      await still(p1, "ato1-05-nova-tarefa");
    }
    await limparNarracao(p1);
    await ato1.fechar();

    // ================= ATO 2 — mensagem da exigência judicial =================
    const ato2 = await estudio.novaParte("interno");
    const p2 = ato2.page;
    await irPara(p2, `${BASE}/casos/${casoId}`);
    await p2.getByText(CLIENTE).first().waitFor({ timeout: 30000 });
    await narrar(p2, "Parte 2 — chegou uma exigência do juiz. A IA escreve o pedido ao parceiro.", 3400);

    await clicar(p2, p2.getByText("Atividades", { exact: true }).first());
    await ler(p2, 900);
    await clicar(p2, p2.getByRole("button", { name: "Nova tarefa" }));
    await p2.getByRole("heading", { name: "Nova tarefa" }).waitFor({ timeout: 15000 });
    await clicar(p2, p2.getByRole("combobox").filter({ hasText: "Escolha um template" }));
    await ler(p2, 700);
    await clicar(p2, p2.getByRole("option", { name: "Exigência Judicial" }));
    await ler(p2, 2000);
    await still(p2, "ato2-01-template");

    await narrar(p2, "A equipe cola o trecho da publicação, do jeito que veio do Legalmail.", 1200);
    const campoPub = p2.getByLabel("Documentos solicitados pela Justiça");
    await deslizar(p2, campoPub);
    await campoPub.fill(DESPACHO);
    await ler(p2, 2200);
    await still(p2, "ato2-02-despacho");

    await narrar(p2, "Publicado em 18/09, prazo de 15 dias úteis: o sistema calcula o prazo fatal.", 1200);
    const campoPublicado = p2.getByLabel("Publicado em");
    await deslizar(p2, campoPublicado);
    await campoPublicado.fill("2026-09-18");
    await ler(p2, 700);
    await clicar(p2, p2.getByLabel("Prazo em dias úteis", { exact: true }));
    await ler(p2, 600);
    await clicar(p2, p2.getByRole("option", { name: "15 dias" }));
    const campoFatal = p2.getByLabel("Prazo fatal (fim do prazo judicial)");
    await deslizar(p2, campoFatal);
    const fatalISO = await campoFatal.inputValue();
    const fatalBR = fatalISO.split("-").reverse().join("/");
    await narrar(p2, `Prazo fatal: ${fatalBR}. Essa data é da equipe — o parceiro não a vê.`, 3400);
    await still(p2, "ato2-03-prazo");

    await narrar(p2, "Salvar. Durante o salvamento a IA reescreve o pedido em linguagem simples…", 1200);
    await clicar(p2, p2.getByRole("button", { name: "Salvar" }));
    // A IA roda DENTRO do save; o sinal honesto de fim é o sheet fechar.
    // Nunca navegar antes: aborta os inserts no meio.
    await p2.getByRole("button", { name: "Cancelar" }).waitFor({ state: "hidden", timeout: 120000 });
    const avisoFallback = await p2.getByText(/IA indisponível/).first().isVisible().catch(() => false);
    await ler(p2, 1500);
    await still(p2, "ato2-04-salvo");

    const { data: solic, error: sErr } = await admin
      .from("solicitacoes_documento").select("descricao, prazo_at").eq("caso_id", casoId).single();
    if (sErr) throw new Error(`ler solicitacao: ${sErr.message}`);
    const { data: fatalT } = await admin
      .from("tarefas").select("due_at, metadata").eq("caso_id", casoId)
      .like("titulo", "FATAL - CUMPRIMENTO DE EXIGENCIA JUDICIAL%").maybeSingle();
    const enviarAte = solic.prazo_at ? diaBR(solic.prazo_at) : "?";
    resultado.mensagem = {
      fallback: avisoFallback,
      prazo_fatal: fatalBR,
      texto_cita_o_fatal: solic.descricao?.includes(fatalBR) ?? false,
      enviar_ate: enviarAte,
      tarefa_fatal_vence: fatalT?.due_at ? diaBR(fatalT.due_at) : "?",
      descricao: solic.descricao,
    };

    await irPara(p2, `${BASE}/casos/${casoId}`);
    await p2.getByText(CLIENTE).first().waitFor({ timeout: 30000 });
    await clicar(p2, p2.getByText("Atividades", { exact: true }).first());
    await tentar("tarefas do template", async () => {
      const fatal = p2.getByText(/FATAL - CUMPRIMENTO DE EXIGENCIA JUDICIAL/).first();
      await fatal.waitFor({ timeout: 20000 });
      await deslizar(p2, fatal);
      await fatal.evaluate((el) => el.scrollIntoView({ block: "center", behavior: "smooth" }));
      await narrar(p2, `Para a equipe: a tarefa FATAL vence ${resultado.mensagem.tarefa_fatal_vence}, o dia útil anterior ao fatal (${fatalBR}).`, 4200);
      await still(p2, "ato2-05-tarefas");
    });

    await tentar("solicitacao na aba Documentos", async () => {
      await clicar(p2, p2.getByText("Documentos", { exact: true }).first());
      const ola = p2.getByText(/Olá!/).first();
      await ola.waitFor({ timeout: 15000 });
      await ola.evaluate((el) => el.scrollIntoView({ block: "start", behavior: "smooth" }));
      await ler(p2, 800);
      await deslizar(p2, ola);
      await narrar(
        p2,
        `O pedido que a IA escreveu para o parceiro: "enviar até ${enviarAte}" — 3 dias antes do fatal, que não aparece no texto.`,
        7000,
      );
      await still(p2, "ato2-06-mensagem-ia");
    });
    await limparNarracao(p2);
    await ato2.fechar();

    // ================= ATO 3 — a visão do parceiro =================
    const ato3 = await estudio.novaParte("parceiro");
    const p3 = ato3.page;
    await irPara(p3, `${BASE}/documentos`);
    await p3.getByText(CLIENTE).first().waitFor({ timeout: 30000 });
    await narrar(p3, `Entrando como o parceiro: o pedido chega no quadro dele, com "enviar até ${enviarAte}".`, 4200);
    await still(p3, "ato3-01-kanban");
    await tentar("mensagem na visao do parceiro", async () => {
      await clicar(p3, p3.getByText(CLIENTE).first());
      await p3.getByRole("heading", { name: CLIENTE }).or(p3.getByText(CLIENTE)).first()
        .waitFor({ timeout: 20000 });
      await ler(p3, 1200);
      await clicar(p3, p3.getByText("Documentos", { exact: true }).first());
      const ola = p3.getByText(/Olá!/).first();
      await ola.waitFor({ timeout: 15000 });
      await ola.evaluate((el) => el.scrollIntoView({ block: "start", behavior: "smooth" }));
      await ler(p3, 800);
      await deslizar(p3, ola);
      await narrar(p3, "No caso, o parceiro lê o pedido em linguagem simples. O prazo fatal fica só com a equipe.", 7000);
      await still(p3, "ato3-02-mensagem");
    });
    await limparNarracao(p3);
    await ato3.fechar();
  } finally {
    const clipes = await estudio.encerrar();
    console.log("clipes:", clipes);
    console.log("RESULTADO:", JSON.stringify(resultado, null, 2));

    // ----- limpeza total (filhos → caso → cliente → nomes) -----
    try {
      if (casoId) {
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
        const { error: ce } = await admin.from("casos").delete().eq("id", casoId);
        if (ce) console.log("limpeza casos:", ce.message);
      }
      const { error: cle } = await admin.from("clientes").delete().eq("id", clienteId);
      if (cle) console.log("limpeza clientes:", cle.message);
      console.log("limpeza ok — caso", casoId, "cliente", clienteId);
    } catch (e) {
      console.log("LIMPEZA FALHOU — apagar na mao: caso", casoId, "cliente", clienteId, e.message);
    } finally {
      await admin.from("usuarios").update({ nome: nomeParceiroOriginal }).eq("id", parceira.id);
      await admin.from("usuarios").update({ nome: nomeInternoOriginal }).eq("id", interna.id);
      console.log("nomes restaurados");
    }
  }
})();

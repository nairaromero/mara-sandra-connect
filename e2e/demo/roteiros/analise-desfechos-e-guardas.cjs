// Filme 2: OS OUTROS DESFECHOS DA ANÁLISE + AS GUARDAS (lote 2026-09-01)
//   Cena 1 — "Aguardar documentação": tarefa de aguardo + andamento ao parceiro.
//   Cena 2 — "Não há direito agora": motivo obrigatório → andamento visível;
//            a visão do PARCEIRO lendo o motivo.
//   Cena 3 — Guarda do Kanban: concluir por fora é bloqueado com orientação.
//   Cena 4 — Template "Em Análise" consertado: só-andamento salva direto.

const {
  BASE, adminStaging, cpfValido, ler, deslizar, clicar, tentar, abrirEstudio,
  narrar, limparNarracao,
} = require("../helpers.cjs");

(async () => {
  const admin = adminStaging();
  const { data: parceira } = await admin
    .from("usuarios").select("id, nome").eq("email", "e2e+parceiro@marasandraconnect.com").single();
  const nomeParceiroOriginal = parceira.nome;
  await admin.from("usuarios").update({ nome: "Silva & Costa Advogados" }).eq("id", parceira.id);
  const { data: interna } = await admin
    .from("usuarios").select("id, nome").eq("email", "e2e+interno@marasandraconnect.com").single();
  const nomeInternoOriginal = interna?.nome ?? null;
  if (interna) await admin.from("usuarios").update({ nome: "Equipe Mara Vian" }).eq("id", interna.id);

  const casos = [];
  async function seed(nome) {
    const { data: cl } = await admin.from("clientes").insert({ nome, cpf: cpfValido() }).select("id").single();
    const { data: ca } = await admin.from("casos").insert({
      cliente_id: cl.id, tipo_beneficio: "Aposentadoria por tempo de contribuição",
      fase: "analise", parceiro_id: parceira.id,
    }).select("id").single();
    casos.push({ ca: ca.id, cl: cl.id });
    return ca.id;
  }
  const casoDocs = await seed("Otavio Bento Sales");
  const casoSem = await seed("Iracema Duarte Pinho");
  console.log("seed ok");
  await new Promise((r) => setTimeout(r, 1500));

  const estudio = await abrirEstudio("analise-desfechos-e-guardas");
  const { still } = estudio;

  async function abrirTarefa(p, busca, alvo) {
    for (let t = 1; ; t++) {
      try {
        await p.goto(BASE + "/tarefas", { waitUntil: "domcontentloaded", timeout: 45000 });
        break;
      } catch (e) { if (t >= 2) throw e; }
    }
    const campo = p.getByPlaceholder(/Buscar t/).first();
    await campo.waitFor({ timeout: 30000 });
    await campo.fill(busca);
    await ler(p, 1400);
    const card = p.getByText(alvo ?? busca, { exact: false }).first();
    if (!(await card.isVisible().catch(() => false))) {
      for (const g of ["Depois", "Esta semana", "Amanhã", "Hoje", "Atrasadas"]) {
        const h = p.getByText(g, { exact: true }).first();
        if (await h.isVisible().catch(() => false)) {
          await clicar(p, h);
          await ler(p, 400);
          if (await card.isVisible().catch(() => false)) break;
        }
      }
    }
    await deslizar(p, card);
    await clicar(p, card);
    await ler(p, 1000);
  }

  try {
    const ato1 = await estudio.novaParte("interno");
    const p1 = ato1.page;

    // ---- Cena 1: aguardar documentação ----
    await narrar(p1, "Desfecho 2 da análise: falta documento pra montar. Um clique — e nada se perde.");
    await abrirTarefa(p1, "Otavio Bento", "Cliente novo - Parceiro");
    await ler(p1, 2000);
    await clicar(p1, p1.getByRole("button", { name: "Aguardar documentação" }).first());
    await ler(p1, 2800);
    await p1.keyboard.press("Escape");
    await narrar(p1, "Nasceu a tarefa de aguardo com prazo — e o parceiro recebeu andamento avisando.");
    await abrirTarefa(p1, "Aguardando documentação - Otavio");
    await ler(p1, 3000);
    await still(p1, "01-aguardando-docs");
    await p1.keyboard.press("Escape");
    await limparNarracao(p1);

    // ---- Cena 2: não há direito ----
    await narrar(p1, "Desfecho 3: analisamos e NÃO há direito agora. O motivo é obrigatório — e vira comunicação.");
    await abrirTarefa(p1, "Iracema Duarte", "Cliente novo - Parceiro");
    await ler(p1, 1500);
    await clicar(p1, p1.getByRole("button", { name: "Não há direito agora" }).first());
    await ler(p1, 800);
    await p1.getByPlaceholder(/carência insuficiente/).fill(
      "Carência insuficiente: faltam 14 contribuições. Reavaliar em março de 2027, quando completa o período.",
    );
    await ler(p1, 2200);
    await still(p1, "02-motivo-sem-direito");
    await clicar(p1, p1.getByRole("button", { name: "Registrar e concluir análise" }));
    await ler(p1, 2800);
    await p1.keyboard.press("Escape");
    await limparNarracao(p1);

    // ---- Cena 3: guarda do kanban ----
    await narrar(p1, "E se alguém tentar CONCLUIR uma tarefa dessas por fora, sem decidir? O sistema segura.");
    await abrirTarefa(p1, "Aguardando documentação - Otavio");
    await ler(p1, 800);
    // (a tarefa de aguardo não tem widget; a guarda mora nas de decisão — usa a análise de outro caso)
    await p1.keyboard.press("Escape");
    const casoGuard = await seed("Nelson Prates Cunha");
    await new Promise((r) => setTimeout(r, 1500));
    await abrirTarefa(p1, "Nelson Prates", "Cliente novo - Parceiro");
    await clicar(p1, p1.getByRole("combobox").filter({ hasText: "A fazer" }).first());
    await ler(p1, 600);
    await clicar(p1, p1.getByRole("option", { name: /Feito|Conclu/i }).first());
    await ler(p1, 600);
    await clicar(p1, p1.getByRole("button", { name: "Salvar" }));
    await ler(p1, 2500);
    await still(p1, "03-guarda-kanban");
    await narrar(p1, "Bloqueado com a orientação: conclua pelo botão de DESFECHO — é ele que dispara o próximo passo.");
    await ler(p1, 3000);
    await p1.keyboard.press("Escape");
    await limparNarracao(p1);

    // ---- Cena 4: Em Análise consertado ----
    await narrar(p1, "E o template 'Em Análise' — que só registra andamento — agora salva direto, sem travar.");
    for (let t = 1; ; t++) {
      try { await p1.goto(BASE + "/tarefas", { waitUntil: "domcontentloaded", timeout: 45000 }); break; }
      catch (e) { if (t >= 2) throw e; }
    }
    await clicar(p1, p1.getByRole("button", { name: "Nova tarefa" }));
    await clicar(p1, p1.getByRole("combobox").filter({ hasText: "Sem caso" }));
    await clicar(p1, p1.getByRole("option", { name: "Otavio Bento Sales" }));
    await clicar(p1, p1.getByRole("combobox").filter({ hasText: "Escolha um template" }));
    await clicar(p1, p1.getByRole("option", { name: /^Em Análise \(/ }));
    await ler(p1, 1500);
    await still(p1, "04-em-analise-form");
    await clicar(p1, p1.getByRole("button", { name: "Salvar" }));
    await p1.getByRole("button", { name: "Nova tarefa" }).waitFor({ timeout: 20000 });
    await narrar(p1, "Salvou: virou SÓ o andamento no caso — nenhuma tarefa fantasma.");
    await ler(p1, 3000);
    await still(p1, "05-em-analise-salvo");
    await limparNarracao(p1);
    await ato1.fechar();

    // ---- Ato 2: parceiro lê o motivo ----
    const ato2 = await estudio.novaParte("parceiro");
    const p2 = ato2.page;
    await p2.goto(BASE + "/casos/" + casoSem);
    await narrar(p2, "Do lado do parceiro: o motivo da Iracema chegou como andamento — transparência sem telefonema.");
    await p2.getByText("Iracema Duarte Pinho").first().waitFor({ timeout: 20000 });
    await clicar(p2, p2.getByRole("tab", { name: "Andamentos" }));
    await ler(p2, 1500);
    await tentar("ver motivo", async () => {
      const alvo = p2.getByText(/não vamos requerer agora/).first();
      await alvo.waitFor({ timeout: 10000 });
      await deslizar(p2, alvo);
    });
    await ler(p2, 4500);
    await still(p2, "06-parceiro-motivo");
    await limparNarracao(p2);
    await ato2.fechar();
  } finally {
    const clipes = await estudio.encerrar();
    console.log("clipes:", clipes);
    try {
      for (const { ca, cl } of casos) {
        for (const t of ["tarefas", "tarefas_excluidas", "andamentos", "agenda_eventos", "processos_admin", "solicitacoes_documento", "notificacoes", "comentarios"]) {
          await admin.from(t).delete().eq("caso_id", ca);
        }
        await admin.from("casos").delete().eq("id", ca);
        await admin.from("clientes").delete().eq("id", cl);
      }
      await admin.from("usuarios").update({ nome: nomeParceiroOriginal }).eq("id", parceira.id);
      if (interna && nomeInternoOriginal) await admin.from("usuarios").update({ nome: nomeInternoOriginal }).eq("id", interna.id);
      console.log("limpeza ok");
    } catch (e) {
      console.log("LIMPEZA FALHOU:", e.message);
    }
  }
})();

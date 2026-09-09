// Filme 1: CICLO ADMINISTRATIVO COMPLETO (lote de 2026-09-01)
//   Cliente novo → análise com desfecho "Fazer o requerimento" → corrente
//   montagem → revisão → protocolo (nº do requerimento) → acompanhamento
//   "aguardando análise do INSS" (benefício SEM perícia) → "Saiu — deferido"
//   → template Concedido (análise + PA + implantação).
//   Ato final: a visão do PARCEIRO (andamentos que chegaram pra ele).
//
// Rodar: PLAYWRIGHT_BASE_URL=https://staging.marasandraconnect.com bunx
//   playwright test site-publico --grep privacidade && node e2e/demo/roteiros/ciclo-requerimento-adm.cjs

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

  const { data: cliente } = await admin
    .from("clientes").insert({ nome: "Tereza Fagundes Lima", cpf: cpfValido() }).select("id").single();
  const { data: caso } = await admin
    .from("casos")
    .insert({
      cliente_id: cliente.id,
      tipo_beneficio: "Aposentadoria por idade",
      fase: "analise",
      parceiro_id: parceira.id,
    })
    .select("id").single();
  const casoId = caso.id;
  console.log("seed ok — caso:", casoId);
  await new Promise((r) => setTimeout(r, 1500)); // trigger da análise

  const estudio = await abrirEstudio("ciclo-requerimento-adm");
  const { still } = estudio;

  async function abrirTarefa(p, busca, alvo) {
    // goto com retry: o staging às vezes segura o "load" (assets/waker).
    for (let tent = 1; ; tent++) {
      try {
        await p.goto(BASE + "/tarefas", { waitUntil: "domcontentloaded", timeout: 45000 });
        break;
      } catch (e) {
        if (tent >= 2) throw e;
      }
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

    // ---- 1. A análise do cliente novo, com desfechos ----
    await narrar(p1, "Cliente novo entrou. A tarefa de ANÁLISE agora termina numa DECISÃO — não num simples concluir.");
    await abrirTarefa(p1, "Tereza Fagundes", "Cliente novo - Parceiro");
    await ler(p1, 2500);
    await still(p1, "01-analise-desfechos");
    await narrar(p1, "Decisão: vamos fazer o requerimento. Escolhe quem monta — e a corrente abre no nome da pessoa.");
    await clicar(p1, p1.getByRole("button", { name: "Fazer o requerimento" }).first());
    await ler(p1, 900);
    await clicar(p1, p1.getByRole("combobox", { name: "Responsável pela montagem" }));
    await ler(p1, 600);
    await clicar(p1, p1.getByRole("option", { name: "Equipe Mara Vian" }));
    await ler(p1, 900);
    await still(p1, "02-escolhe-responsavel");
    await clicar(p1, p1.getByRole("button", { name: "Abrir corrente de montagem" }));
    await ler(p1, 2800);
    await p1.keyboard.press("Escape");
    await ler(p1, 600);

    // ---- 2. A corrente: montagem -> revisão -> protocolo ----
    await narrar(p1, "A corrente do requerimento: montagem, revisão da Mara, protocolo — cada etapa abre a próxima sozinha.");
    await abrirTarefa(p1, "Montagem do requerimento - Tereza");
    await ler(p1, 2000);
    await still(p1, "03-corrente-montagem");
    await clicar(p1, p1.getByRole("button", { name: /Enviar para revisão/i }).first());
    await ler(p1, 2200);
    await p1.keyboard.press("Escape");
    await abrirTarefa(p1, "Revisão do requerimento - Tereza");
    await clicar(p1, p1.getByRole("button", { name: /Enviar para protocolo/i }).first());
    await ler(p1, 2200);
    await p1.keyboard.press("Escape");
    await narrar(p1, "No protocolo, o número do requerimento entra AQUI — e o processo administrativo é cadastrado no caso.");
    await abrirTarefa(p1, "Protocolo do requerimento - Tereza");
    await p1.getByPlaceholder("000000000").fill("704512398");
    await ler(p1, 1500);
    await still(p1, "04-protocolo-numero");
    await clicar(p1, p1.getByRole("button", { name: /Protocolo realizado/i }).first());
    await ler(p1, 2800);
    await p1.keyboard.press("Escape");
    await limparNarracao(p1);

    // ---- 3. Acompanhamento SEM perícia + resultado manual ----
    await narrar(p1, "Aposentadoria por idade NÃO tem perícia — o acompanhamento nasce 'aguardando análise do INSS'.");
    await abrirTarefa(p1, "Acompanhamento — aguardando análise");
    await ler(p1, 3200);
    await still(p1, "05-acompanhamento-sem-pericia");
    await narrar(p1, "O robô de e-mails registra o resultado sozinho — mas dá pra registrar NA MÃO: saiu o deferimento!");
    await deslizar(p1, p1.getByRole("button", { name: "Saiu — deferido" }).first());
    await clicar(p1, p1.getByRole("button", { name: "Saiu — deferido" }).first());
    await ler(p1, 3000);
    await p1.keyboard.press("Escape");
    await ler(p1, 500);

    // ---- 4. O Concedido abriu ----
    await narrar(p1, "O template Concedido entrou sozinho: análise do deferimento, baixar PA e a implantação escalonada.");
    await p1.goto(BASE + "/tarefas");
    const busca = p1.getByPlaceholder(/Buscar t/).first();
    await busca.fill("Tereza");
    await ler(p1, 1600);
    for (const g of ["Depois", "Esta semana", "Amanhã", "Hoje"]) {
      const h = p1.getByText(g, { exact: true }).first();
      if (await h.isVisible().catch(() => false)) await clicar(p1, h).catch(() => {});
    }
    await ler(p1, 3500);
    await still(p1, "06-concedido-aberto");
    await limparNarracao(p1);
    await ato1.fechar();

    // ---- Ato 2: visão do parceiro ----
    const ato2 = await estudio.novaParte("parceiro");
    const p2 = ato2.page;
    await p2.goto(BASE + "/casos/" + casoId);
    await narrar(p2, "E o parceiro? Acompanhou TUDO sem ninguém precisar avisar: cada passo virou andamento.");
    await p2.getByText("Tereza Fagundes Lima").first().waitFor({ timeout: 20000 });
    await ler(p2, 1500);
    await clicar(p2, p2.getByRole("tab", { name: "Andamentos" }));
    await ler(p2, 1500);
    // Andamentos agrupam por processo — expande o card se estiver fechado e
    // mostra o que der: o filme retrata a tela real.
    await tentar("expandir card do processo", async () => {
      const alvo = p2.getByText(/Benefício Concedido|Requerimento protocolado/).first();
      if (!(await alvo.isVisible().catch(() => false))) {
        await clicar(p2, p2.getByText(/704512398|Requerimento/).first());
        await ler(p2, 800);
      }
      await deslizar(p2, alvo);
    });
    await ler(p2, 4500);
    await still(p2, "07-parceiro-andamentos");
    await limparNarracao(p2);
    await ato2.fechar();
  } finally {
    const clipes = await estudio.encerrar();
    console.log("clipes:", clipes);
    try {
      for (const t of ["tarefas", "tarefas_excluidas", "andamentos", "agenda_eventos", "processos_admin", "processos_judiciais", "solicitacoes_documento", "notificacoes", "comentarios"]) {
        await admin.from(t).delete().eq("caso_id", casoId);
      }
      await admin.from("casos").delete().eq("id", casoId);
      await admin.from("clientes").delete().eq("id", cliente.id);
      await admin.from("usuarios").update({ nome: nomeParceiroOriginal }).eq("id", parceira.id);
      if (interna && nomeInternoOriginal) await admin.from("usuarios").update({ nome: nomeInternoOriginal }).eq("id", interna.id);
      console.log("limpeza ok");
    } catch (e) {
      console.log("LIMPEZA FALHOU:", casoId, e.message);
    }
  }
})();

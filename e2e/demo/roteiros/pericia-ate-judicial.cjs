// Filme 3: DO REQUERIMENTO COM PERÍCIA ATÉ A VIA JUDICIAL (lote 2026-09-01)
//   Auxílio-doença: análise → corrente do requerimento (rápida) → protocolo →
//   acompanhamento "aguardando agendamento da PERÍCIA" (benefício por
//   incapacidade!) → perícia agendada (template Perícia INSS + aviso ao
//   parceiro) → Compareceu → resultado "Saiu — indeferido" → template
//   Indeferido → desfecho "Ajuizar" → corrente da MONTAGEM DE INICIAL até o
//   protocolo com o nº do processo. O círculo administrativo→judicial fechado.

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
    .from("clientes").insert({ nome: "Jorge Batista Leal", cpf: cpfValido() }).select("id").single();
  const { data: caso } = await admin
    .from("casos")
    .insert({
      cliente_id: cliente.id,
      tipo_beneficio: "Auxílio-doença",
      fase: "analise",
      parceiro_id: parceira.id,
    })
    .select("id").single();
  const casoId = caso.id;
  console.log("seed ok — caso:", casoId);
  await new Promise((r) => setTimeout(r, 1500));

  const estudio = await abrirEstudio("pericia-ate-judicial");
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

    // ---- 1. análise -> requerimento -> corrente (ritmo rápido) ----
    await narrar(p1, "Jorge, auxílio-doença. Análise decide: fazer o requerimento.");
    await abrirTarefa(p1, "Jorge Batista", "Cliente novo - Parceiro");
    await clicar(p1, p1.getByRole("button", { name: "Fazer o requerimento" }).first());
    await ler(p1, 700);
    await clicar(p1, p1.getByRole("combobox", { name: "Responsável pela montagem" }));
    await clicar(p1, p1.getByRole("option", { name: "Equipe Mara Vian" }));
    await clicar(p1, p1.getByRole("button", { name: "Abrir corrente de montagem" }));
    await ler(p1, 2200);
    await p1.keyboard.press("Escape");
    await abrirTarefa(p1, "Montagem do requerimento - Jorge");
    await clicar(p1, p1.getByRole("button", { name: /Enviar para revisão/i }).first());
    await ler(p1, 1800);
    await p1.keyboard.press("Escape");
    await abrirTarefa(p1, "Revisão do requerimento - Jorge");
    await clicar(p1, p1.getByRole("button", { name: /Enviar para protocolo/i }).first());
    await ler(p1, 1800);
    await p1.keyboard.press("Escape");
    await abrirTarefa(p1, "Protocolo do requerimento - Jorge");
    await p1.getByPlaceholder("000000000").fill("811203457");
    await clicar(p1, p1.getByRole("button", { name: /Protocolo realizado/i }).first());
    await ler(p1, 2500);
    await p1.keyboard.press("Escape");
    await limparNarracao(p1);

    // ---- 2. acompanhamento COM perícia ----
    await narrar(p1, "Auxílio-doença TEM perícia — o acompanhamento já nasce 'aguardando agendamento da perícia'.");
    await abrirTarefa(p1, "aguardando agendamento da perícia");
    await ler(p1, 3500);
    await still(p1, "01-acompanhamento-com-pericia");
    await p1.keyboard.press("Escape");
    await limparNarracao(p1);

    // ---- 3. perícia agendada: template Perícia INSS ----
    await narrar(p1, "O INSS agendou! Template Perícia INSS: agenda, aviso pronto ao parceiro, comparecimento e resultado.");
    for (let t = 1; ; t++) {
      try { await p1.goto(BASE + "/tarefas", { waitUntil: "domcontentloaded", timeout: 45000 }); break; }
      catch (e) { if (t >= 2) throw e; }
    }
    await clicar(p1, p1.getByRole("button", { name: "Nova tarefa" }));
    await clicar(p1, p1.getByRole("combobox").filter({ hasText: "Sem caso" }));
    await clicar(p1, p1.getByRole("option", { name: "Jorge Batista Leal" }));
    await clicar(p1, p1.getByRole("combobox").filter({ hasText: "Escolha um template" }));
    await clicar(p1, p1.getByRole("option", { name: /^Perícia INSS \(/ }));
    await ler(p1, 1500);
    await p1.locator('input[type="datetime-local"]').first().fill("2026-09-10T09:30");
    await ler(p1, 1800);
    await still(p1, "02-pericia-agendando");
    await clicar(p1, p1.getByRole("button", { name: "Salvar" }));
    await p1.getByRole("button", { name: "Nova tarefa" }).waitFor({ timeout: 30000 });
    await ler(p1, 1500);
    await limparNarracao(p1);

    // ---- 4. compareceu ----
    await narrar(p1, "Dia da perícia: Compareceu — e a conferência do resultado abre sozinha.");
    await abrirTarefa(p1, "Confirmar comparecimento na perícia - Jorge");
    await clicar(p1, p1.getByRole("button", { name: /^Compareceu/ }).first());
    await ler(p1, 2500);
    await p1.keyboard.press("Escape");
    await limparNarracao(p1);

    // ---- 5. resultado: indeferido -> template Indeferido ----
    await narrar(p1, "O resultado saiu: INDEFERIDO. Um clique — o template Indeferido entra com a análise e o PA.");
    await abrirTarefa(p1, "Conferir resultado da perícia - Jorge");
    await deslizar(p1, p1.getByRole("button", { name: "Saiu — indeferido" }).first());
    await ler(p1, 1200);
    await still(p1, "03-resultado-indeferido");
    await clicar(p1, p1.getByRole("button", { name: "Saiu — indeferido" }).first());
    await ler(p1, 2800);
    await p1.keyboard.press("Escape");
    await limparNarracao(p1);

    // ---- 6. desfecho: ajuizar -> corrente judicial ----
    await narrar(p1, "E a análise do indeferimento decide: AJUIZAR. A corrente da inicial abre na hora.");
    await abrirTarefa(p1, "Analise de Indeferimento - Jorge");
    await ler(p1, 1500);
    await still(p1, "04-desfecho-ajuizar");
    await clicar(p1, p1.getByRole("button", { name: /Ajuizar/ }).first());
    await ler(p1, 2500);
    await p1.keyboard.press("Escape");
    await abrirTarefa(p1, "Montagem da inicial - Jorge");
    await clicar(p1, p1.getByRole("button", { name: /Enviar para revisão/i }).first());
    await ler(p1, 1800);
    await p1.keyboard.press("Escape");
    await abrirTarefa(p1, "Revisão da inicial - Jorge");
    await clicar(p1, p1.getByRole("button", { name: /Enviar para protocolo/i }).first());
    await ler(p1, 1800);
    await p1.keyboard.press("Escape");
    await narrar(p1, "Protocolo judicial com o número do processo — DataJud e DJEN passam a vigiar sozinhos.");
    await abrirTarefa(p1, "Protocolo da inicial - Jorge");
    await p1.getByPlaceholder("0000000-00.0000.0.00.0000").fill("5009999-11.2026.4.03.6100");
    await ler(p1, 1500);
    await still(p1, "05-protocolo-judicial");
    await clicar(p1, p1.getByRole("button", { name: /Protocolo realizado/i }).first());
    await ler(p1, 2800);
    await p1.keyboard.press("Escape");
    await limparNarracao(p1);

    // ---- 7. o retrato final ----
    await narrar(p1, "Do requerimento ao judicial sem UM passo manual perdido: cada etapa abriu a próxima.");
    await p1.goto(BASE + "/casos/" + casoId, { waitUntil: "domcontentloaded", timeout: 45000 });
    await p1.getByText("Jorge Batista Leal").first().waitFor({ timeout: 20000 });
    await ler(p1, 4000);
    await still(p1, "06-caso-final");
    await limparNarracao(p1);
    await ato1.fechar();
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

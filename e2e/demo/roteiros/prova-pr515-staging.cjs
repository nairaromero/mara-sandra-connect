// Filme do PR #515 (etiquetas com fonte única) no STAGING, escritório Canário.
//
//   Ato 1  O bug do print (09/11): agendar perícia pela tela de Agenda. A
//          etiqueta de espera sai, entra PERICIA_AGENDADA_INSS e as etiquetas
//          que a equipe marcou CONTINUAM.
//   Ato 2  A rotina diária com perícia NOVA marcada: não troca nada (achado 1
//          da revisão).
//   Ato 3  A rotina diária quando a perícia já passou e não há outra: troca
//          para AGUARDANDO_RESULTADO_DE_PERICIA e mantém o resto.
//
// A rotina roda como no pg_cron, mas só a parte das etiquetas
// (`select public.trocar_etiqueta_pos_pericia()`): a rotina inteira também
// manda lembretes, e o staging não deve disparar mensagem.
//
// Rodar da raiz do repo:
//   DEMO_BASE_URL=https://staging.marasandraconnect.com node e2e/demo/roteiros/prova-pr515-staging.cjs
//   node e2e/demo/montar-filme.cjs prova-pr515-staging prova-pr515-staging
//
// Apaga no fim os dois clientes descartáveis (casos, eventos e tarefas juntos).

const { execFileSync } = require("child_process");
const { clicar, deslizar, ler, narrar, tentar, abrirEstudio, cpfValido } = require("../helpers.cjs");
const { BASE, DOM, REPO, admin, sessao, estadoNavegador } = require("../staging.cjs");

const DIA = 24 * 3600 * 1000;
const A = "[PROVA #515] Rafaela Teixeira";
const B = "[PROVA #515] Bruno Siqueira";

function sqlStaging(q) {
  const out = execFileSync("node", ["scripts/msc-sql.mjs", "--staging", q], { cwd: REPO, encoding: "utf8" });
  const txt = out.split("\n").filter((l) => !l.startsWith("[msc-sql]")).join("\n").trim();
  return txt ? JSON.parse(txt) : [];
}

async function etiquetaId(esc, nome) {
  const { data: ja } = await admin.from("etiquetas").select("id").eq("escritorio_id", esc).eq("nome", nome).maybeSingle();
  if (ja) return ja.id;
  const { data, error } = await admin.from("etiquetas").insert({ escritorio_id: esc, nome, cor: "#e3d0e5" }).select("id").single();
  if (error) throw error;
  return data.id;
}

async function clienteComCaso(esc, nome, etiquetas) {
  const { data: cli, error } = await admin.from("clientes").insert({ escritorio_id: esc, nome, cpf: cpfValido() }).select("id").single();
  if (error) throw error;
  const { data: caso, error: e2 } = await admin.from("casos")
    .insert({ escritorio_id: esc, cliente_id: cli.id, tipo_beneficio: "Auxílio por incapacidade", fase: "analise" }).select("id").single();
  if (e2) throw e2;
  for (const n of etiquetas) {
    const { error: e3 } = await admin.from("clientes_etiquetas").insert({ cliente_id: cli.id, etiqueta_id: await etiquetaId(esc, n) });
    if (e3) throw e3;
  }
  return { cliente: cli.id, caso: caso.id };
}

async function pericia(esc, caso, emDias, titulo) {
  const ini = Date.now() + emDias * DIA;
  const { error } = await admin.from("agenda_eventos").insert({
    escritorio_id: esc, caso_id: caso, tipo: "pericia", titulo,
    start_at: new Date(ini).toISOString(), end_at: new Date(ini + 3600 * 1000).toISOString(),
  });
  if (error) throw error;
}

async function etiquetas(cliente) {
  const { data, error } = await admin.from("clientes_etiquetas").select("etiquetas(nome)").eq("cliente_id", cliente);
  if (error) throw error;
  return (data ?? []).map((r) => r.etiquetas.nome).sort();
}

/** Vai para o caso e enquadra a linha de etiquetas. */
async function verEtiquetas(page, caso, esperar) {
  await page.goto(`${BASE}/casos/${caso}`);
  const alvo = page.getByText(esperar).first();
  await alvo.waitFor({ timeout: 60_000 });
  await alvo.evaluate((el) => el.scrollIntoView({ block: "center", behavior: "smooth" }));
  await ler(page, 900);
}

async function verAgenda(page, titulo) {
  await clicar(page, page.getByRole("tab", { name: /Atividades/ }));
  const ev = page.getByText(titulo).first();
  await ev.waitFor({ timeout: 30_000 });
  await ev.evaluate((el) => el.scrollIntoView({ block: "center", behavior: "smooth" }));
  await ler(page, 1200);
}

async function main() {
  const [{ id: esc }] = sqlStaging("select id from escritorios where slug = 'canario'");
  const criados = [];
  const log = {};

  const a = await clienteComCaso(esc, A, ["STATUS:ATIVO", "BENEFICIO:AUXILIO_DOENCA", "AGUARDANDO_AGENDAMENTO_DE_PERICIA"]);
  criados.push(a);
  log.a_antes = await etiquetas(a.cliente);

  const { session } = await sessao(`canario+admin@${DOM}`, esc);
  const estudio = await abrirEstudio("prova-pr515-staging");
  try {
    // ---------- Ato 1: agendar perícia pela tela ----------
    {
      const { page, fechar } = await estudio.novaParte(estadoNavegador(session, esc));
      await verEtiquetas(page, a.caso, "AGUARDANDO_AGENDAMENTO_DE_PERICIA");
      await narrar(page, "Staging · Canário. A Rafaela tem três etiquetas: STATUS:ATIVO e BENEFICIO, marcadas pela equipe, e AGUARDANDO_AGENDAMENTO_DE_PERICIA.", 6200);
      await estudio.still(page, "ato1-01-antes");

      await page.goto(`${BASE}/agenda`);
      await clicar(page, page.getByRole("button", { name: /Novo evento/ }));
      await narrar(page, "Agora a equipe agenda a perícia dela pela Agenda, como no dia a dia.", 3800);
      await clicar(page, page.locator('[data-selecao="cliente"]'));
      const busca = page.getByPlaceholder(/Buscar|Pesquisar/i).last();
      if (await busca.isVisible().catch(() => false)) await busca.pressSequentially("PROVA #515", { delay: 60 });
      await clicar(page, page.getByRole("option", { name: /Rafaela Teixeira/ }).first());
      const titulo = page.locator("#a-titulo");
      await clicar(page, titulo);
      await titulo.fill("");
      await titulo.pressSequentially("Perícia médica INSS - Rafaela", { delay: 40 });
      const ini = new Date(Date.now() + 15 * DIA);
      const p2 = (n) => String(n).padStart(2, "0");
      const local = `${ini.getFullYear()}-${p2(ini.getMonth() + 1)}-${p2(ini.getDate())}T10:00`;
      await page.locator("#a-start").fill(local);
      await page.locator("#a-end").fill(local.replace("T10:00", "T11:00"));
      await ler(page, 800);
      await estudio.still(page, "ato1-02-formulario");
      await clicar(page, page.getByRole("button", { name: /^Salvar$/ }));
      await page.getByRole("button", { name: /^Salvar$/ }).waitFor({ state: "detached", timeout: 30_000 }).catch(() => {});
      await ler(page, 1500);

      await verEtiquetas(page, a.caso, "PERICIA_AGENDADA_INSS");
      log.a_depois_agendar = await etiquetas(a.cliente);
      await narrar(page, "Depois de agendar: saiu AGUARDANDO_AGENDAMENTO, entrou PERICIA_AGENDADA_INSS — e STATUS:ATIVO e BENEFICIO continuam. Antes do conserto, sumiam.", 6800);
      await estudio.still(page, "ato1-03-depois");
      await fechar();
    }

    // ---------- Atos 2 e 3: a rotina diária ----------
    // A Rafaela também teve uma perícia há 10 dias; o Bruno só tem uma que já passou.
    await pericia(esc, a.caso, -10, "Perícia médica INSS - 1ª (já realizada)");
    const b = await clienteComCaso(esc, B, ["STATUS:ATIVO"]);
    criados.push(b);
    await pericia(esc, b.caso, -5, "Perícia médica INSS - Bruno (já realizada)");
    log.b_antes = await etiquetas(b.cliente);
    log.a_antes_rotina = await etiquetas(a.cliente);

    {
      const { page, fechar } = await estudio.novaParte(estadoNavegador(session, esc));
      await verEtiquetas(page, a.caso, "PERICIA_AGENDADA_INSS");
      await narrar(page, "Ato 2. A Rafaela teve uma perícia há 10 dias e tem a nova, que acabamos de marcar.", 4800);
      await verAgenda(page, "Perícia médica INSS - Rafaela");
      await estudio.still(page, "ato2-01-antes");
      await narrar(page, "Roda a rotina diária das etiquetas, a mesma do cron de produção…", 3800);
      [{ n: log.trocados }] = sqlStaging("select public.trocar_etiqueta_pos_pericia() as n");
      log.a_depois_rotina = await etiquetas(a.cliente);
      await verEtiquetas(page, a.caso, "PERICIA_AGENDADA_INSS");
      await narrar(page, "…e a Rafaela continua com PERICIA_AGENDADA_INSS: a última perícia dela ainda não aconteceu. Antes da correção, ela iria para AGUARDANDO_RESULTADO.", 6800);
      await estudio.still(page, "ato2-02-depois");
      await fechar();
    }

    await tentar("ato 3", async () => {
      const { page, fechar } = await estudio.novaParte(estadoNavegador(session, esc));
      await verEtiquetas(page, b.caso, "AGUARDANDO_RESULTADO_DE_PERICIA");
      log.b_depois = await etiquetas(b.cliente);
      await narrar(page, "Ato 3. O Bruno fez a perícia há 5 dias e não tem outra marcada: na mesma rodada, foi para AGUARDANDO_RESULTADO_DE_PERICIA…", 6000);
      await estudio.still(page, "ato3-01-depois");
      await narrar(page, "…e STATUS:ATIVO, marcada pela equipe, continua lá.", 3800);
      await fechar();
    });
  } finally {
    await estudio.encerrar();
    for (const c of criados) {
      await admin.from("tarefas").delete().eq("caso_id", c.caso);
      await admin.from("agenda_eventos").delete().eq("caso_id", c.caso);
      await admin.from("casos").delete().eq("id", c.caso);
      await admin.from("clientes").delete().eq("id", c.cliente);
    }
    console.log("limpeza ok");
    console.log(JSON.stringify(log, null, 1));
  }
}

main().catch((e) => { console.error(e); process.exit(1); });

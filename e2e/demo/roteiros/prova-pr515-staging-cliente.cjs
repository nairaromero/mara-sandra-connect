// Filme do PR #515 no STAGING — o OUTRO caminho de agendar perícia: pela tela
// de Clientes (botão "Perícia" da linha do cliente, que abre a ficha de tarefa
// com o template de perícia e cria o evento na agenda + as tarefas).
//
//   Ato 1  Cliente com STATUS:ATIVO, BENEFICIO e AGUARDANDO_AGENDAMENTO. Agenda
//          a perícia por Clientes → "Perícia". Sai a etiqueta de espera, entra
//          PERICIA_AGENDADA_INSS, as da equipe continuam.
//   Ato 2  Ela também teve uma perícia há 10 dias. A rotina das etiquetas roda
//          (`select public.trocar_etiqueta_pos_pericia()`) e não troca nada: a
//          perícia nova ainda vai acontecer.
//
// Rodar da raiz do repo:
//   DEMO_BASE_URL=https://staging.marasandraconnect.com node e2e/demo/roteiros/prova-pr515-staging-cliente.cjs
//   node e2e/demo/montar-filme.cjs prova-pr515-staging-cliente prova-pr515-staging-cliente
//
// Apaga no fim o cliente descartável (caso, eventos e tarefas juntos).

const { execFileSync } = require("child_process");
const { clicar, ler, narrar, abrirEstudio, cpfValido } = require("../helpers.cjs");
const { BASE, DOM, REPO, admin, sessao, estadoNavegador } = require("../staging.cjs");

const DIA = 24 * 3600 * 1000;
const NOME = "[PROVA #515] Helena Duarte";

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

async function etiquetas(cliente) {
  const { data, error } = await admin.from("clientes_etiquetas").select("etiquetas(nome)").eq("cliente_id", cliente);
  if (error) throw error;
  return (data ?? []).map((r) => r.etiquetas.nome).sort();
}

async function verEtiquetas(page, caso, esperar) {
  await page.goto(`${BASE}/casos/${caso}`);
  const alvo = page.getByText(esperar).first();
  await alvo.waitFor({ timeout: 60_000 });
  await alvo.evaluate((el) => el.scrollIntoView({ block: "center", behavior: "smooth" }));
  await ler(page, 900);
}

async function main() {
  const [{ id: esc }] = sqlStaging("select id from escritorios where slug = 'canario'");
  const log = {};
  let cli = null;
  let caso = null;

  const r1 = await admin.from("clientes").insert({ escritorio_id: esc, nome: NOME, cpf: cpfValido() }).select("id").single();
  if (r1.error) throw r1.error;
  cli = r1.data.id;
  const r2 = await admin.from("casos")
    .insert({ escritorio_id: esc, cliente_id: cli, tipo_beneficio: "Auxílio por incapacidade", fase: "analise" }).select("id").single();
  if (r2.error) throw r2.error;
  caso = r2.data.id;
  for (const n of ["STATUS:ATIVO", "BENEFICIO:AUXILIO_DOENCA", "AGUARDANDO_AGENDAMENTO_DE_PERICIA"]) {
    const { error } = await admin.from("clientes_etiquetas").insert({ cliente_id: cli, etiqueta_id: await etiquetaId(esc, n) });
    if (error) throw error;
  }
  log.antes = await etiquetas(cli);

  const { session } = await sessao(`canario+admin@${DOM}`, esc);
  const estudio = await abrirEstudio("prova-pr515-staging-cliente");
  try {
    // ---------- Ato 1: agendar pela tela de Clientes ----------
    {
      const { page, fechar } = await estudio.novaParte(estadoNavegador(session, esc));
      await verEtiquetas(page, caso, "AGUARDANDO_AGENDAMENTO_DE_PERICIA");
      await narrar(page, "Staging · Canário. A Helena tem STATUS:ATIVO e BENEFICIO (marcadas pela equipe) e AGUARDANDO_AGENDAMENTO_DE_PERICIA.", 6000);
      await estudio.still(page, "ato1-01-antes");

      await page.goto(`${BASE}/clientes`);
      const busca = page.getByPlaceholder(/Ex: João/);
      await busca.waitFor({ timeout: 60_000 });
      await narrar(page, "Agora pelo outro caminho: a tela de Clientes, botão “Perícia” na linha da cliente.", 4200);
      await clicar(page, busca);
      await busca.pressSequentially("Helena Duarte", { delay: 70 });
      const botao = page.getByTitle(`Agendar perícia para ${NOME}`);
      await botao.waitFor({ timeout: 30_000 });
      await ler(page, 800);
      await estudio.still(page, "ato1-02-lista");
      await clicar(page, botao);

      const due = page.locator("#t-due");
      await due.waitFor({ timeout: 30_000 });
      const ini = new Date(Date.now() + 15 * DIA);
      const p2 = (n) => String(n).padStart(2, "0");
      const quando = `${ini.getFullYear()}-${p2(ini.getMonth() + 1)}-${p2(ini.getDate())}T10:00`;
      // O template termina de montar a ficha depois de aberta e zera a data:
      // espera assentar e confere que o valor ficou.
      await page.getByText("Responsáveis das outras tarefas do template").waitFor({ timeout: 30_000 }).catch(() => {});
      await ler(page, 1500);
      for (let i = 0; i < 5 && (await due.inputValue()) !== quando; i++) {
        await due.fill(quando);
        await ler(page, 700);
      }
      if ((await due.inputValue()) !== quando) throw new Error(`data da perícia não ficou no campo: "${await due.inputValue()}"`);
      const titulo = page.locator("#t-titulo");
      if (!(await titulo.inputValue().catch(() => ""))) await titulo.fill("Perícia médica INSS - Helena");
      await narrar(page, "A ficha já vem com o template de perícia: só a data e a hora.", 3600);
      await due.evaluate((el) => el.scrollIntoView({ block: "center", behavior: "smooth" }));
      await ler(page, 900);
      await estudio.still(page, "ato1-03-ficha");
      await clicar(page, page.getByRole("button", { name: /^Salvar$/ }));
      const mesmoAssim = page.getByRole("button", { name: /Agendar mesmo assim/ });
      if (await mesmoAssim.isVisible({ timeout: 3000 }).catch(() => false)) await clicar(page, mesmoAssim);
      await page.locator("#t-due").waitFor({ state: "detached", timeout: 30_000 }).catch(() => {});
      await ler(page, 1500);

      await verEtiquetas(page, caso, "PERICIA_AGENDADA_INSS");
      log.depois_agendar = await etiquetas(cli);
      await narrar(page, "Depois de agendar por Clientes: saiu AGUARDANDO_AGENDAMENTO, entrou PERICIA_AGENDADA_INSS — e STATUS:ATIVO e BENEFICIO continuam.", 6400);
      await estudio.still(page, "ato1-04-depois");
      await fechar();
    }

    // ---------- Ato 2: a rotina com a perícia nova marcada ----------
    const ini = Date.now() - 10 * DIA;
    const { error: eEv } = await admin.from("agenda_eventos").insert({
      escritorio_id: esc, caso_id: caso, tipo: "pericia", titulo: "Perícia médica INSS - 1ª (já realizada)",
      start_at: new Date(ini).toISOString(), end_at: new Date(ini + 3600 * 1000).toISOString(),
    });
    if (eEv) throw eEv;
    {
      const { page, fechar } = await estudio.novaParte(estadoNavegador(session, esc));
      await verEtiquetas(page, caso, "PERICIA_AGENDADA_INSS");
      await narrar(page, "A Helena também teve uma perícia há 10 dias. Roda a rotina diária das etiquetas, a mesma do cron de produção…", 5400);
      [{ n: log.trocados }] = sqlStaging("select public.trocar_etiqueta_pos_pericia() as n");
      log.depois_rotina = await etiquetas(cli);
      await verEtiquetas(page, caso, "PERICIA_AGENDADA_INSS");
      await narrar(page, "…e ela continua com PERICIA_AGENDADA_INSS, porque a perícia agendada por Clientes ainda vai acontecer.", 5600);
      await estudio.still(page, "ato2-01-depois-rotina");
      await fechar();
    }
  } finally {
    await estudio.encerrar();
    if (caso) {
      await admin.from("tarefas").delete().eq("caso_id", caso);
      await admin.from("agenda_eventos").delete().eq("caso_id", caso);
      await admin.from("casos").delete().eq("id", caso);
    }
    if (cli) await admin.from("clientes").delete().eq("id", cli);
    console.log("limpeza ok");
    console.log(JSON.stringify(log, null, 1));
  }
}

main().catch((e) => { console.error(e); process.exit(1); });

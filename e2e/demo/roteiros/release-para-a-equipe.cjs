// Filme de APRESENTAÇÃO DO RELEASE para a equipe: o que muda quando o lote de
// setembro entrar em produção, e o que fazer em cada caso real onde o fluxo
// mudou. Gravado contra o STAGING (banco e edge functions reais).
//
// Texto de referência: planning/COMUNICADO_PRODUCAO.md (mesmos itens, mesma
// ordem). O plano de execução é planning/RELEASE_PRODUCAO.md.
//
//   Ato 0  Abertura + o elenco (o Canário do staging fazendo o escritório real)
//   Ato 1  Quem vira o quê no primeiro login
//   Ato 2  A regra nº 1: se o botão não está lá, não é bug — e o Glossário responde
//   Ato 3  Caso real: cliente duplicado — excluir é só da administração
//   Ato 4  Caso real: documento no caso errado — enviar e apagar são permissões diferentes
//   Ato 5  Caso real: a tarefa que não é minha — o alcance do Assistente
//   Ato 6  A saída: a administradora concede UMA permissão a UMA pessoa
//   Ato 7  Caso real: caso encerrado não volta sozinho por causa de robô
//   Ato 8  Suporte da plataforma: pedido com número, aprovação e prazo
//   Ato 9  Duas etapas (2FA): opcional para a equipe
//   Ato 10 O combinado, e o que avisar nos primeiros dias
//
// Uso:
//   DEMO_BASE_URL=https://staging.marasandraconnect.com \
//   node e2e/demo/roteiros/release-para-a-equipe.cjs
//   (ATOS=0,3,6 para filmar só alguns)
const fs = require("fs");
const path = require("path");
const { ler, deslizar, clicar, tentar, narrar: narrarBase, abrirEstudio } = require("../helpers.cjs");
const { BASE, DOM, admin, sessao, estadoNavegador, esc, esperarRota, fechar } = require("../staging.cjs");

// ---------- legendas (SRT) ----------
const legendas = [];
const inicioClipe = new WeakMap();
let clipesAbertos = 0;
async function narrar(page, texto, ms = 3400) {
  const c = inicioClipe.get(page);
  if (c) legendas.push({ clipe: c.clipe, inicio_ms: Date.now() - c.t0, dur_ms: ms, texto });
  return narrarBase(page, texto, ms);
}

const ATOS = (process.env.ATOS || "0,1,2,3,4,5,6,7,8,9,10").split(",").map((s) => s.trim());
const ato = (n) => ATOS.includes(String(n));

async function cartao(page, titulo, sub, ms = 4600) {
  const c = inicioClipe.get(page);
  if (c) legendas.push({ clipe: c.clipe, inicio_ms: Date.now() - c.t0, dur_ms: ms, texto: `${titulo}. ${sub}` });
  await page.setContent(`<!doctype html><html><body style="margin:0;background:#16110c;color:#fcfaf6;font-family:-apple-system,'Segoe UI',Roboto,sans-serif;height:100vh;display:flex;align-items:center;justify-content:center">
    <div style="max-width:980px;text-align:center;padding:40px"><div style="font-size:13px;letter-spacing:.2em;text-transform:uppercase;color:#af7c00;margin-bottom:18px">O que muda em produção · para a equipe</div>
    <div style="font-family:Georgia,serif;font-size:44px;line-height:1.15;margin-bottom:20px">${esc(titulo)}</div>
    <div style="font-size:19px;line-height:1.55;color:#ded6c9">${esc(sub)}</div></div></body></html>`);
  await page.waitForTimeout(ms);
}

/** Painel de texto: mostra a resposta do SERVIDOR quando não há tela para isso. */
async function painel(page, titulo, corpoHtml, ms = 5600) {
  await page.setContent(`<!doctype html><html><body style="margin:0;background:#f7f4ee;color:#1c1917;font-family:-apple-system,'Segoe UI',Roboto,sans-serif;padding:40px">
    <div style="max-width:1040px;margin:0 auto">
      <div style="font-size:12px;letter-spacing:.18em;text-transform:uppercase;color:#8a6d1f;margin-bottom:10px">Resposta do servidor (staging)</div>
      <h1 style="font-family:Georgia,serif;font-size:30px;margin:0 0 18px">${esc(titulo)}</h1>
      ${corpoHtml}
    </div>
    <style>pre{background:#fff;border:1px solid #e3ddd1;border-radius:10px;padding:16px;font-size:14px;white-space:pre-wrap;margin:0 0 14px}
    .erro{border-color:#d98b8b;background:#fff8f8}.ok{border-color:#9dbf9d;background:#f8fdf8}
    p{font-size:15px;color:#57534e;line-height:1.5}
    table{border-collapse:collapse;width:100%;font-size:15px}td,th{border:1px solid #e3ddd1;padding:9px 12px;text-align:left}
    th{background:#fff;font-weight:600}</style></body></html>`);
  await page.waitForTimeout(ms);
}

(async () => {
  const { data: escritorio } = await admin.from("escritorios").select("id").eq("slug", "canario").single();
  if (!escritorio) throw new Error("escritório Canário ausente no staging — rode node scripts/seed-local-rbac.mjs --staging");
  const ESC = escritorio.id;
  const u = async (email) => (await admin.from("usuarios").select("id, nome").eq("email", `${email}@${DOM}`).single()).data;
  const carla = await u("canario+admin");
  const diego = await u("canario+advogado");
  const elisa = await u("canario+assistente");

  const { data: casos } = await admin.from("casos")
    .select("id, fase, cliente:clientes(id, nome)").eq("escritorio_id", ESC).order("created_at").limit(4);
  const caso = casos[0];                       // cena de cliente/documento
  const casoEncerrar = casos[2] ?? casos[1];   // cena do caso encerrado
  const nomeCliente = caso.cliente?.nome ?? "o cliente";
  const faseOriginal = casoEncerrar.fase;

  // estado a desfazer no fim
  const criados = { documentos: [], tarefas: [], suporte: [] };
  await admin.from("membro_permissoes").delete().eq("escritorio_id", ESC);

  const estudio = await abrirEstudio(process.env.SAIDA || "release-para-a-equipe");
  const { still } = estudio;
  const sessoes = {};
  const parte = async (email, comSessao = true) => {
    let st = { cookies: [], origins: [] };
    if (comSessao) {
      if (!sessoes[email]) sessoes[email] = await sessao(email);
      st = estadoNavegador(sessoes[email].session, ESC);
    }
    const t0 = Date.now();
    const nova = await estudio.novaParte(st);
    inicioClipe.set(nova.page, { clipe: clipesAbertos++, t0 });
    return nova;
  };
  async function abrirPainelPermissoes(page, primeiroNome) {
    await page.goto(`${BASE}/equipe`);
    const botao = page.getByRole("button", { name: new RegExp(`Ações de ${primeiroNome}`) });
    await botao.waitFor({ timeout: 25000 });
    await clicar(page, botao);
    await clicar(page, page.getByRole("menuitem", { name: "Permissões" }));
    await page.locator("[data-permissoes-sheet]").waitFor({ timeout: 20000 });
  }
  /** Abre "Editar cliente" na tela do caso (é lá que vive o excluir cliente). */
  async function abrirEditarCliente(page) {
    await page.goto(`${BASE}/casos/${caso.id}`);
    await page.getByText(nomeCliente).first().waitFor({ timeout: 25000 });
    const editar = page.getByRole("button", { name: "Editar", exact: true }).first();
    await editar.waitFor({ timeout: 20000 });
    await clicar(page, editar);
    await page.getByRole("dialog").waitFor({ timeout: 15000 });
    // O "Excluir cliente" (quando existe) fica no RODAPÉ do diálogo: enquadrar
    // os dois takes ali é o que deixa a diferença visível.
    await page.getByRole("button", { name: "Cancelar" }).last().scrollIntoViewIfNeeded();
    await page.waitForTimeout(400);
  }
  const gravados = [];

  try {
    // ================= ATO 0 — ABERTURA =================
    if (ato(0)) {
      const p = (await parte(null, false)).page;
      await cartao(p, "O lote de setembro vai para produção",
        "Cada pessoa passa a ter um papel, e o sistema só mostra e só aceita o que o papel permite — a mesma regra na tela e no banco.", 6000);
      await cartao(p, "O elenco deste filme",
        "Gravado no staging, no escritório de teste: Carla é a administradora (como Naira e Mara), Diego é advogado (como Mariane, Sebastião e Beatriz), Elisa é assistente e Fábio é do financeiro.", 7000);
      await cartao(p, "O que você vai ver",
        "Quem vira o quê · o botão que não está lá · cliente duplicado · documento no caso errado · a tarefa que não é minha · permissão por pessoa · caso encerrado · suporte com número · 2FA", 7000);
      await fechar(p);
      gravados.push("abertura");
    }

    // ================= ATO 1 — QUEM VIRA O QUÊ =================
    if (ato(1)) {
      const p = (await parte(`canario+admin@${DOM}`)).page;
      await cartao(p, "1 · Quem vira o quê no primeiro login",
        "Ninguém escolhe nada e ninguém cadastra nada: a conta recebe o papel equivalente ao que já era.");
      await p.goto(`${BASE}/equipe`);
      await p.getByRole("heading", { level: 1 }).waitFor({ timeout: 25000 });
      await narrar(p, "Esta é a tela de Equipe: cada pessoa com o papel dela. Advogado é o padrão e não ganha etiqueta.");
      await ler(p, 3500);
      await still(p, "ato1-01-equipe");
      await painel(p, "Na produção, no dia do release",
        `<table><tr><th>Pessoa</th><th>Vira</th><th>Por quê</th></tr>
          <tr><td>Naira, Mara</td><td><b>Administrador</b></td><td>já eram admin</td></tr>
          <tr><td>Mariane, Sebastião, Beatriz</td><td><b>Advogado</b></td><td>eram internos</td></tr>
          <tr><td>Os 23 parceiros ativos</td><td><b>Parceiro</b></td><td>já eram parceiros</td></tr></table>
         <p><b>Ninguém vira Assistente nem Financeiro automaticamente.</b> Esses papéis existem e entram só quando a Naira escolher — e o ato 5 mostra por que a escolha merece atenção.</p>
         <p>Entrar continua igual: mesmo e-mail, mesma senha, mesmo endereço.</p>`, 8000);
      await still(p, "ato1-02-mapeamento");
      await fechar(p);
      gravados.push("ato1");
    }

    // ================= ATO 2 — O BOTÃO QUE NÃO ESTÁ LÁ =================
    if (ato(2)) {
      const p = (await parte(`canario+advogado@${DOM}`)).page;
      await cartao(p, "2 · Se o botão não está lá, não é bug",
        "O sistema esconde o que o servidor recusaria, em vez de deixar clicar e dar erro. Então o que se nota é falta, não erro.");
      await p.goto(`${BASE}/tarefas`);
      await p.getByRole("heading", { level: 1 }).waitFor({ timeout: 25000 });
      await narrar(p, "Este é o menu do Diego, advogado: não existe Equipe nem Auditoria.");
      await ler(p, 3500);
      await still(p, "ato2-01-menu-advogado");

      await narrar(p, "E não é só o menu: digitar o endereço na mão também não entra.");
      await p.goto(`${BASE}/equipe`);
      await esperarRota(p, ["/casos", "/tarefas", "/equipe"], "advogado em /equipe", 20000);
      await ler(p, 2500);
      await still(p, "ato2-02-endereco-na-mao");

      await narrar(p, "A resposta oficial para 'isso é do meu papel?' fica no Glossário.");
      await p.goto(`${BASE}/glossario?q=advogado`);
      await p.locator("article#advogado").waitFor({ timeout: 25000 });
      await deslizar(p, p.locator("article#advogado"));
      await narrar(p, "O verbete de cada papel lista as permissões LIDAS DO BANCO, na hora. Não é texto decorativo.");
      await ler(p, 5000);
      await still(p, "ato2-03-glossario");
      await fechar(p);
      gravados.push("ato2");
    }

    // ================= ATO 3 — CLIENTE DUPLICADO =================
    if (ato(3)) {
      const p = (await parte(`canario+advogado@${DOM}`)).page;
      await cartao(p, "3 · Caso real: cliente cadastrado duas vezes",
        "Antes qualquer interno excluía cliente. Agora é só da administração, porque não tem volta.");
      await abrirEditarCliente(p);
      await narrar(p, "O Diego abre Editar cliente e rola até o fim: dá para corrigir os dados e salvar…");
      await ler(p, 3000);
      await still(p, "ato3-01-advogado-sem-excluir");
      await narrar(p, "…mas não existe Excluir cliente. O que fazer: pedir à administração, com nome e CPF.");
      await ler(p, 3000);
      await p.keyboard.press("Escape");
      await fechar(p);

      const pc = (await parte(`canario+admin@${DOM}`)).page;
      await abrirEditarCliente(pc);
      await narrar(pc, "Na Carla, administradora, o botão existe — no canto, separado do Salvar.");
      const excluir = pc.getByRole("button", { name: "Excluir cliente" });
      await deslizar(pc, excluir);
      await ler(pc, 3000);
      await still(pc, "ato3-02-admin-com-excluir");
      await painel(pc, "O tamanho do que se pede",
        `<p>Excluir cliente leva embora <b>todos os casos dele</b> e, com eles, documentos, andamentos, solicitações, processos, repasses e conversas — inclusive os arquivos guardados.</p>
         <p>Quando o cliente é real e só o cadastro está duplicado, o certo é excluir a <b>duplicata vazia</b>, nunca a que tem o caso. Neste filme ninguém excluiu nada.</p>`, 6500);
      await still(pc, "ato3-03-aviso");
      await fechar(pc);
      gravados.push("ato3");
    }

    // ================= ATO 4 — DOCUMENTO NO CASO ERRADO =================
    if (ato(4)) {
      const { data: doc } = await admin.from("documentos").insert({
        caso_id: caso.id, escritorio_id: ESC, tipo: "outro",
        nome_arquivo: "[Filme] CNIS conferido.pdf",
        storage_path: `filme-release/${caso.id}/cnis.pdf`,
      }).select("id").single();
      if (doc) criados.documentos.push(doc.id);

      const p = (await parte(`canario+assistente@${DOM}`)).page;
      await cartao(p, "4 · Caso real: documento no caso errado",
        "Enviar documento e apagar documento são duas permissões. Um papel pode ter a primeira e não a segunda.");
      await p.goto(`${BASE}/casos/${caso.id}?tab=documentos`);
      await p.getByText(/CNIS conferido/).first().waitFor({ timeout: 25000 });
      await narrar(p, "A Elisa é assistente: ela envia documento e renomeia…");
      await deslizar(p, p.locator('[aria-label="Renomear documento"]').first());
      await ler(p, 3000);
      await still(p, "ato4-01-assistente-renomeia");
      await narrar(p, "…e não tem a lixeira. Subiu no caso errado? Quem apaga é quem tem a permissão.");
      await ler(p, 3200);
      await still(p, "ato4-02-assistente-sem-lixeira");
      await fechar(p);

      const pd = (await parte(`canario+advogado@${DOM}`)).page;
      await pd.goto(`${BASE}/casos/${caso.id}?tab=documentos`);
      await pd.locator('[aria-label="Deletar documento"]').first().waitFor({ timeout: 25000 });
      await deslizar(pd, pd.locator('[aria-label="Deletar documento"]').first());
      await narrar(pd, "No advogado, a lixeira está lá. É a mesma tela, com permissões diferentes.");
      await ler(pd, 3200);
      await still(pd, "ato4-03-advogado-com-lixeira");
      await narrar(pd, "E não improvise pelo Drive: o arquivo e o registro andam juntos.");
      await ler(pd, 2600);
      await fechar(pd);
      gravados.push("ato4");
    }

    // ================= ATO 5 — A TAREFA QUE NÃO É MINHA =================
    if (ato(5)) {
      // uma tarefa de cada, para a prova valer nas duas direções
      const nova = async (titulo, responsavel) => {
        const { data } = await admin.from("tarefas").insert({
          escritorio_id: ESC, caso_id: caso.id, titulo, tipo: "interna",
          responsavel_id: responsavel, created_by: carla.id,
        }).select("id").single();
        if (data) criados.tarefas.push(data.id);
        return data;
      };
      const daElisa = await nova("[Filme] Conferir CNIS do cliente", elisa.id);
      const doDiego = await nova("[Filme] Redigir a petição inicial", diego.id);

      const p = (await parte(`canario+admin@${DOM}`)).page;
      await cartao(p, "5 · Caso real: a tarefa que não é minha",
        "A diferença mais importante entre os papéis, e a que a Naira precisa entender antes de nomear alguém Assistente.");
      await abrirPainelPermissoes(p, "Elisa");
      const linha = p.locator('[data-permissao="tarefas:gerenciar"]');
      await deslizar(p, linha);
      await narrar(p, "A Elisa tem a permissão de tarefas — mas com alcance 'só os atribuídos'.");
      await ler(p, 4000);
      await still(p, "ato5-01-alcance-atribuidos");
      await fechar(p);

      // A prova onde ela mora: o banco. A assistente tenta mexer nas duas.
      const comoElisa = await sessao(`canario+assistente@${DOM}`, ESC);
      // 'feito' é o status válido (tarefas_status_check: a_fazer | feito | cancelado)
      const tentaOutra = await comoElisa.sb.from("tarefas")
        .update({ status: "feito" }).eq("id", doDiego.id).select("id");
      const tentaSua = await comoElisa.sb.from("tarefas")
        .update({ status: "feito" }).eq("id", daElisa.id).select("id");

      const p2 = (await parte(`canario+assistente@${DOM}`)).page;
      await painel(p2, "A Elisa tentando concluir as duas tarefas",
        `<p><b>A tarefa do Diego</b> — “Redigir a petição inicial”:</p>
         <pre class="erro">${esc(tentaOutra.error?.message || `${(tentaOutra.data ?? []).length} linha(s) alterada(s): o banco simplesmente não encontrou a tarefa para ela mexer`)}</pre>
         <p><b>A tarefa dela</b> — “Conferir CNIS do cliente”:</p>
         <pre class="ok">${esc(tentaSua.error ? tentaSua.error.message : `marcada como feita (${(tentaSua.data ?? []).length} linha alterada)`)}</pre>
         <p>Na tela, isso aparece como botão que não existe na tarefa de outra pessoa. O caminho é <b>reatribuir a tarefa</b> a quem vai executá-la — e então o botão aparece.</p>`, 8500);
      await still(p2, "ato5-02-resposta-do-banco");
      await narrar(p2, "Quem recusa é o banco, não a tela. É por isso que reatribuir resolve e insistir não.");
      await ler(p2, 3200);
      await fechar(p2);
      gravados.push("ato5");
    }

    // ================= ATO 6 — PERMISSÃO POR PESSOA =================
    if (ato(6)) {
      const p = (await parte(`canario+admin@${DOM}`)).page;
      await cartao(p, "6 · A saída para “ela precisa só disso”",
        "A administradora soma ou tira UMA permissão de UMA pessoa, por cima do papel. Sem promover ninguém.");
      await abrirPainelPermissoes(p, "Diego");
      const linha = p.locator('[data-permissao="clientes:excluir"]');
      await deslizar(p, linha);
      await narrar(p, "Voltando ao ato 3: a Carla decide que o Diego pode excluir cliente.");
      await ler(p, 2800);
      await still(p, "ato6-01-antes");
      await clicar(p, linha.locator('button[role="checkbox"], input[type="checkbox"]').first());
      await p.getByRole("alertdialog").waitFor({ timeout: 15000 });
      await narrar(p, "É uma das sete permissões sensíveis: a confirmação escreve o que ele passa a poder.");
      await ler(p, 4500);
      await still(p, "ato6-02-confirmacao-sensivel");
      await clicar(p, p.getByRole("button", { name: "Conceder" }));
      await linha.locator("[data-ajustada]").waitFor({ timeout: 15000 });
      await deslizar(p, linha);
      await narrar(p, "Concedido. A etiqueta 'ajustado' marca a diferença, e o papel dele segue advogado.");
      await ler(p, 3200);
      await still(p, "ato6-03-ajustado");
      await fechar(p);

      const pd = (await parte(`canario+advogado@${DOM}`)).page;
      await abrirEditarCliente(pd);
      await deslizar(pd, pd.getByRole("button", { name: "Excluir cliente" }));
      await narrar(pd, "Do lado do Diego, sem sair e entrar: o botão do ato 3 apareceu.");
      await ler(pd, 3200);
      await still(pd, "ato6-04-diego-agora-tem");
      await pd.keyboard.press("Escape");
      await fechar(pd);

      const pc = (await parte(`canario+admin@${DOM}`)).page;
      await abrirPainelPermissoes(pc, "Diego");
      await narrar(pc, "Desfazer é um clique: 'voltar ao papel'. E cada mudança fica na auditoria.");
      await clicar(pc, pc.locator("[data-voltar-ao-papel]").first());
      await ler(pc, 2500);
      await still(pc, "ato6-05-voltou-ao-papel");
      await tentar("a trilha da auditoria", async () => {
        await pc.goto(`${BASE}/auditoria`);
        await pc.getByRole("heading", { level: 1 }).waitFor({ timeout: 25000 });
        // a trilha do escritório fica no FIM da página (em cima ficam os
        // acessos à senha do MEU INSS) — sem rolar, a cena mostra outra coisa
        const trilha = pc.locator("[data-trilha-plataforma]");
        await trilha.waitFor({ timeout: 20000 });
        await deslizar(pc, trilha);
        await narrar(pc, "Na trilha do escritório: quem mexeu, em quem, o que era e o que ficou.");
        await ler(pc, 5000);
        await still(pc, "ato6-06-auditoria");
      });
      await fechar(pc);
      gravados.push("ato6");
    }

    // ================= ATO 7 — CASO ENCERRADO =================
    if (ato(7)) {
      const p = (await parte(`canario+admin@${DOM}`)).page;
      await cartao(p, "7 · Caso real: caso encerrado não volta sozinho",
        "Antes, qualquer coisa que chegasse num caso finalizado podia reabri-lo — inclusive automação. Agora reabre só quando há gente por trás.");

      // o caso vai a 'finalizado' só para a cena, e volta no finally
      await admin.from("casos").update({ fase: "finalizado" }).eq("id", casoEncerrar.id);
      await p.goto(`${BASE}/casos/${casoEncerrar.id}`);
      await p.getByText(casoEncerrar.cliente?.nome ?? "").first().waitFor({ timeout: 30000 });
      await narrar(p, `O caso de ${casoEncerrar.cliente?.nome ?? "um cliente"} está finalizado.`);
      await ler(p, 3200);
      await still(p, "ato7-01-finalizado");

      // robô = quem escreve sem sessão de pessoa (created_by nulo)
      const { data: doRobo } = await admin.from("tarefas").insert({
        escritorio_id: ESC, caso_id: casoEncerrar.id, tipo: "interna",
        titulo: "[Filme] Publicação do DJEN para conferir", origem: "manual",
      }).select("id").single();
      if (doRobo) criados.tarefas.push(doRobo.id);
      const { data: depoisRobo } = await admin.from("casos").select("fase").eq("id", casoEncerrar.id).single();

      // gente = created_by preenchido
      const { data: daPessoa } = await admin.from("tarefas").insert({
        escritorio_id: ESC, caso_id: casoEncerrar.id, tipo: "interna",
        titulo: "[Filme] Cliente ligou pedindo revisão", created_by: carla.id,
      }).select("id").single();
      if (daPessoa) criados.tarefas.push(daPessoa.id);
      const { data: depoisPessoa } = await admin.from("casos").select("fase").eq("id", casoEncerrar.id).single();

      await painel(p, "Duas tarefas chegando no mesmo caso finalizado",
        `<p><b>Tarefa de automação</b> (sem pessoa por trás) — “Publicação do DJEN para conferir”:</p>
         <pre class="${depoisRobo.fase === "finalizado" ? "ok" : "erro"}">fase do caso depois: ${esc(depoisRobo.fase)}</pre>
         <p><b>Tarefa criada por uma pessoa</b> — “Cliente ligou pedindo revisão”:</p>
         <pre class="${depoisPessoa.fase !== "finalizado" ? "ok" : "erro"}">fase do caso depois: ${esc(depoisPessoa.fase)}</pre>
         <table><tr><th>O que chega num caso finalizado</th><th>Reabre?</th></tr>
           <tr><td>Tarefa criada por automação</td><td><b>Não</b></td></tr>
           <tr><td>Publicação trazida pelo DJEN</td><td><b>Não</b> — cria o rascunho e fica ali</td></tr>
           <tr><td>Tarefa criada por uma pessoa</td><td><b>Sim</b></td></tr>
           <tr><td>Solicitação de documento, mesmo aberta pelo robô do INSS</td><td><b>Sim</b> — documento pendente é trabalho real</td></tr>
           <tr><td>Audiência ou perícia nova</td><td><b>Sim</b></td></tr></table>`, 9500);
      await still(p, "ato7-02-prova");
      await narrar(p, "Chegou publicação num caso que você finalizou? Ele fica finalizado. Se exige trabalho, você reabre — a decisão voltou a ser sua.");
      await ler(p, 4000);
      await fechar(p);
      gravados.push("ato7");
    }

    // ================= ATO 8 — SUPORTE COM NÚMERO =================
    if (ato(8)) {
      const p = (await parte(`canario+admin@${DOM}`)).page;
      await cartao(p, "8 · Se alguém da plataforma pedir acesso",
        "Existe um caminho formal, com número, prazo e registro. Pedido que chega por WhatsApp não existe.");
      await tentar("o pedido de suporte", async () => {
        // a coluna é `staff_id` (quem pede é gente do QG, não do escritório)
        const { data: staff } = await admin.from("plataforma_staff").select("usuario_id").limit(1).maybeSingle();
        const { data: pedido, error } = await admin.from("acessos_suporte").insert({
          escritorio_id: ESC, staff_id: staff?.usuario_id ?? carla.id,
          motivo: "Conferir por que o e-mail de aviso ao parceiro não saiu no caso 4821.",
          horas: 24, escopo: "leitura", status: "pendente",
        }).select("id, ticket").single();
        if (error) throw new Error(error.message);
        criados.suporte.push(pedido.id);

        await p.goto(`${BASE}/configuracoes?tab=suporte`);
        await p.getByText(new RegExp(pedido.ticket)).first().waitFor({ timeout: 25000 });
        await narrar(p, `O pedido chega com motivo, prazo e um número automático: ${pedido.ticket}.`);
        await ler(p, 4500);
        await still(p, "ato8-01-pedido-com-numero");
        await narrar(p, "Aprovado, o acesso é somente leitura, expira sozinho no prazo, e cada tela aberta fica na auditoria.");
        await ler(p, 4000);
        await still(p, "ato8-02-aprovar-ou-recusar");
      });
      await painel(p, "A regra prática",
        `<p>Pedido de acesso <b>só existe se está nesta tela</b>, com número. Nada de aprovar por WhatsApp, e-mail ou telefone.</p>
         <p>Quem aprova é a administração; o acesso é <b>somente leitura</b>, com faixa âmbar na tela de quem entrou, prazo de até 72 horas e registro na auditoria do escritório. Pode ser encerrado antes, a qualquer momento.</p>`, 6500);
      await fechar(p);
      gravados.push("ato8");
    }

    // ================= ATO 9 — 2FA =================
    if (ato(9)) {
      const p = (await parte(`canario+advogado@${DOM}`)).page;
      await cartao(p, "9 · Duas etapas: opcional para a equipe",
        "Qualquer pessoa pode ligar. Recomendado para quem administra, porque são as contas que podem tudo.");
      await p.goto(`${BASE}/configuracoes?tab=seguranca`);
      await p.getByRole("heading", { level: 1 }).waitFor({ timeout: 25000 });
      await tentar("rolar até a seção de duas etapas", async () => {
        await deslizar(p, p.getByText(/duas etapas/i).first());
      });
      await narrar(p, "Configurações, aba Segurança: ligar pede um aplicativo autenticador e um código de seis dígitos.");
      await ler(p, 4500);
      await still(p, "ato9-01-seguranca");
      await narrar(p, "Depois disso, o login pede o código depois da senha. Ninguém da equipe é obrigado.");
      await ler(p, 3200);
      await fechar(p);
      gravados.push("ato9");
    }

    // ================= ATO 10 — O COMBINADO =================
    if (ato(10)) {
      const p = (await parte(null, false)).page;
      await painel(p, "Textos que vão aparecer — e o que fazer",
        `<table><tr><th>O que você vê</th><th>O que fazer</th></tr>
          <tr><td>O botão ou o menu simplesmente não está lá</td><td>Não é bug: conferir o papel no Glossário e pedir a permissão se for do seu dia a dia</td></tr>
          <tr><td><b>Área restrita a administradores</b></td><td>Página da administração; pedir o dado a quem tem acesso</td></tr>
          <tr><td><b>Sem permissão: apenas quem gerencia a equipe altera papéis</b></td><td>Pedir à Naira ou à Mara</td></tr>
          <tr><td><b>Legalmail não está configurado neste escritório</b></td><td>Falta credencial cadastrada — Configurações → Integrações</td></tr>
          <tr><td>Erro de <b>permissão</b> ou <b>política</b> DEPOIS de clicar</td><td><b>Avisar.</b> Esse é o único da lista que é bug de verdade</td></tr></table>
         <p style="font-size:17px;color:#1c1917;margin-top:18px"><b>O combinado:</b> botão que some é regra; erro de permissão depois de clicar é bug.</p>`, 10000);
      await cartao(p, "Nos primeiros dias, avise se vir",
        "Publicação em dobro · erro de permissão depois de clicar · hora errada em card de agenda · caso que reabriu sozinho · tela que abre vazia onde antes havia dado.", 7500);
      await cartao(p, "Onde está escrito",
        "planning/COMUNICADO_PRODUCAO.md tem tudo isto por escrito, item por item — e o Glossário, dentro do sistema, responde o que cada papel pode.", 6000);
      await fechar(p);
      gravados.push("fechamento");
    }
  } finally {
    const passo = async (rotulo, fn) => { try { await fn(); } catch (e) { console.log(`  limpeza ${rotulo}: ${e.message}`); } };
    await passo("fase do caso", () => admin.from("casos").update({ fase: faseOriginal }).eq("id", casoEncerrar.id));
    await passo("ajustes de permissão", () => admin.from("membro_permissoes").delete().eq("escritorio_id", ESC));
    for (const id of criados.tarefas) await passo("tarefa", () => admin.from("tarefas").delete().eq("id", id));
    await passo("tarefas excluídas (rastro)", () => admin.from("tarefas_excluidas").delete().like("titulo", "[Filme]%"));
    for (const id of criados.documentos) await passo("documento", () => admin.from("documentos").delete().eq("id", id));
    for (const id of criados.suporte) await passo("pedido de suporte", () => admin.from("acessos_suporte").delete().eq("id", id));

    const clipes = await estudio.encerrar();
    fs.writeFileSync(path.join(estudio.saida, "legendas.json"), JSON.stringify({ legendas }, null, 2));
    console.log(`\natos: ${gravados.join(", ") || "nenhum"}`);
    console.log(`clipes: ${clipes.length} em ${path.join(estudio.saida, "video")}`);
    console.log(`stills: ${path.join(estudio.saida, "stills")}`);
  }
})();

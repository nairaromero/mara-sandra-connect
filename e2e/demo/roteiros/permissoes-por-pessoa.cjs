// Filme de apresentação e teste das PERMISSÕES POR PESSOA (PR #399), gravado
// contra o STAGING (banco e edge functions reais).
//
//   Ato 0  Abertura
//   Ato 1  O ponto de partida: o papel decide, e o financeiro só consulta
//   Ato 2  A admin abre o painel: o que vem do papel, grupo por grupo
//   Ato 3  Conceder: o financeiro passa a editar o caso — na hora, sem relogar
//   Ato 4  Remover: o advogado perde a lixeira do documento
//   Ato 5  Alcance: a tarefa do assistente, todos x só os atribuídos
//   Ato 6  As travas: em si mesma, no parceiro, e quem não gerencia a equipe
//   Ato 7  Sensível: conceder auditoria pede confirmação com o efeito escrito
//   Ato 8  A auditoria: quem mexeu, em quem, o antes e o depois
//   Ato 9  Voltar tudo ao papel
//   Ato 10 Fechamento
//
// Uso (depois do deploy do staging):
//   DEMO_BASE_URL=https://staging.marasandraconnect.com \
//   node e2e/demo/roteiros/permissoes-por-pessoa.cjs
const fs = require("fs");
const path = require("path");
const { ler, deslizar, clicar, tentar, narrar: narrarBase, abrirEstudio } = require("../helpers.cjs");
const { BASE, DOM, admin, sessao, estadoNavegador, esc, esperarRota, fechar } = require("../staging.cjs");

// ---------- legendas (SRT) ----------
const legendas = [];
const inicioClipe = new WeakMap();
let clipesAbertos = 0;
async function narrar(page, texto, ms = 3200) {
  const c = inicioClipe.get(page);
  if (c) legendas.push({ clipe: c.clipe, inicio_ms: Date.now() - c.t0, dur_ms: ms, texto });
  return narrarBase(page, texto, ms);
}

const ATOS = (process.env.ATOS || "0,1,2,3,4,5,6,7,8,9,10").split(",").map((s) => s.trim());
const ato = (n) => ATOS.includes(String(n));

async function cartao(page, titulo, sub, ms = 4200) {
  const c = inicioClipe.get(page);
  if (c) legendas.push({ clipe: c.clipe, inicio_ms: Date.now() - c.t0, dur_ms: ms, texto: `${titulo}. ${sub}` });
  await page.setContent(`<!doctype html><html><body style="margin:0;background:#16110c;color:#fcfaf6;font-family:-apple-system,'Segoe UI',Roboto,sans-serif;height:100vh;display:flex;align-items:center;justify-content:center">
    <div style="max-width:920px;text-align:center;padding:40px"><div style="font-size:13px;letter-spacing:.2em;text-transform:uppercase;color:#af7c00;margin-bottom:18px">Legal Connect · Permissões por pessoa · STAGING</div>
    <div style="font-family:Georgia,serif;font-size:44px;line-height:1.15;margin-bottom:20px">${esc(titulo)}</div>
    <div style="font-size:19px;line-height:1.5;color:#ded6c9">${esc(sub)}</div></div></body></html>`);
  await page.waitForTimeout(ms);
}

/** Painel de texto: mostra a resposta do SERVIDOR quando não há tela para isso. */
async function painel(page, titulo, corpoHtml, ms = 5000) {
  await page.setContent(`<!doctype html><html><body style="margin:0;background:#f7f4ee;color:#1c1917;font-family:-apple-system,'Segoe UI',Roboto,sans-serif;padding:40px">
    <div style="max-width:1000px;margin:0 auto">
      <div style="font-size:12px;letter-spacing:.18em;text-transform:uppercase;color:#8a6d1f;margin-bottom:10px">Resposta do servidor (staging)</div>
      <h1 style="font-family:Georgia,serif;font-size:30px;margin:0 0 18px">${esc(titulo)}</h1>
      ${corpoHtml}
    </div>
    <style>pre{background:#fff;border:1px solid #e3ddd1;border-radius:10px;padding:16px;font-size:14px;white-space:pre-wrap}
    .erro{border-color:#e0a0a0}</style></body></html>`);
  await page.waitForTimeout(ms);
}

(async () => {
  const { data: escritorio } = await admin.from("escritorios").select("id").eq("slug", "canario").single();
  if (!escritorio) throw new Error("escritório Canário ausente no staging");
  const ESC = escritorio.id;
  const u = async (email) => (await admin.from("usuarios").select("id, nome").eq("email", `${email}@${DOM}`).single()).data;
  const fabio = await u("canario+financeiro");
  const diego = await u("canario+advogado");
  const elisa = await u("canario+assistente");
  const gilda = await u("canario+parceiro");
  const { data: caso } = await admin.from("casos").select("id, cliente:clientes(nome)").eq("escritorio_id", ESC).limit(1).single();
  const nomeCliente = caso.cliente?.nome ?? "o cliente";

  // estado a desfazer no fim
  const criados = { documentos: [] };
  await admin.from("membro_permissoes").delete().eq("escritorio_id", ESC);

  const estudio = await abrirEstudio(process.env.SAIDA || "permissoes-por-pessoa");
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
  /** Abre o painel de permissões de alguém, pela tela de Equipe. */
  async function abrirPainel(page, primeiroNome) {
    await page.goto(`${BASE}/equipe`);
    await page.getByRole("button", { name: new RegExp(`Ações de ${primeiroNome}`) }).waitFor({ timeout: 25000 });
    await clicar(page, page.getByRole("button", { name: new RegExp(`Ações de ${primeiroNome}`) }));
    await clicar(page, page.getByRole("menuitem", { name: "Permissões" }));
    await page.locator("[data-permissoes-sheet]").waitFor({ timeout: 20000 });
  }
  const gravados = [];

  try {
    // ================= ABERTURA =================
    if (ato(0)) {
      const p = (await parte(null, false)).page;
      await cartao(p, "Permissões por pessoa", "O papel continua decidindo. O admin ajusta uma pessoa quando precisa — e tudo fica na auditoria.", 5200);
      await cartao(p, "O que este filme mostra", "Conceder · Remover · Alcance · As travas · Permissão sensível · A trilha da auditoria · Voltar ao papel", 5600);
      await fechar(p);
      gravados.push("abertura");
    }

    // ================= ATO 1 — O PONTO DE PARTIDA =================
    if (ato(1)) {
      const p = (await parte(`canario+financeiro@${DOM}`)).page;
      await cartao(p, "1 · O ponto de partida", "Fábio é do financeiro: vê casos e repasses para conferir o que há a pagar e a receber, e não mexe no trabalho jurídico.");
      await p.goto(`${BASE}/casos/${caso.id}`);
      await p.getByText(nomeCliente).first().waitFor({ timeout: 25000 });
      await narrar(p, "O caso abre para ele, mas sem menu de ações e sem editar: é o papel financeiro decidindo.");
      await ler(p, 3000);
      await still(p, "ato1-01-financeiro-so-le");
      await fechar(p);
      gravados.push("ato1");
    }

    // ================= ATO 2 — O PAINEL =================
    if (ato(2)) {
      const p = (await parte(`canario+admin@${DOM}`)).page;
      await cartao(p, "2 · O painel de permissões", "Em Equipe, no menu de cada pessoa. Só quem gerencia a equipe entra — e ninguém ajusta a si mesma.");
      await abrirPainel(p, "Fábio");
      await narrar(p, "A lista vem do banco, agrupada por assunto, com o que o papel dá já marcado.");
      await ler(p, 3500);
      await still(p, "ato2-01-painel");
      await deslizar(p, p.locator('[data-permissao="documentos:enviar"]'));
      await narrar(p, "Cada linha diz a ação em português e a permissão por trás dela.");
      await ler(p, 3000);
      await still(p, "ato2-02-grupos");
      await fechar(p);
      gravados.push("ato2");
    }

    // ================= ATO 3 — CONCEDER =================
    if (ato(3)) {
      const p = (await parte(`canario+admin@${DOM}`)).page;
      await cartao(p, "3 · Conceder a uma pessoa", "A Carla decide que o Fábio vai poder editar casos — só ele, sem mudar o papel financeiro.");
      await abrirPainel(p, "Fábio");
      const linha = p.locator('[data-permissao="casos:editar"]');
      await deslizar(p, linha);
      await narrar(p, "Editar casos: hoje desmarcado, porque o papel não dá.");
      await still(p, "ato3-01-antes");
      await clicar(p, linha.locator('button[role="checkbox"], input[type="checkbox"]').first());
      await linha.locator("[data-ajustada]").waitFor({ timeout: 15000 });
      await narrar(p, "Marcou. A etiqueta 'ajustado' aparece, e o papel dele continua financeiro.");
      await ler(p, 2500);
      await still(p, "ato3-02-ajustado");
      await fechar(p);

      const pf = (await parte(`canario+financeiro@${DOM}`)).page;
      await pf.goto(`${BASE}/casos/${caso.id}`);
      await pf.getByText(nomeCliente).first().waitFor({ timeout: 25000 });
      await narrar(pf, "Do lado do Fábio, sem sair e entrar: o menu de ações do caso aparece.");
      await ler(pf, 3000);
      await still(pf, "ato3-03-financeiro-agora-edita");
      await fechar(pf);
      gravados.push("ato3");
    }

    // ================= ATO 4 — REMOVER =================
    if (ato(4)) {
      const { data: doc } = await admin.from("documentos").insert({
        caso_id: caso.id, escritorio_id: ESC, tipo: "outro",
        nome_arquivo: "[Filme] comprovante de residência.pdf",
        storage_path: `filme-perm/${caso.id}/comprovante.pdf`,
      }).select("id").single();
      if (doc) criados.documentos.push(doc.id);

      const pa = (await parte(`canario+advogado@${DOM}`)).page;
      await cartao(pa, "4 · Tirar de uma pessoa", "O caminho inverso: o papel advogado apaga documento, e a Carla tira isso do Diego.");
      await pa.goto(`${BASE}/casos/${caso.id}?tab=documentos`);
      await pa.locator('[aria-label="Deletar documento"]').first().waitFor({ timeout: 25000 });
      await narrar(pa, "Hoje o Diego tem a lixeira no documento, porque o papel dele dá.");
      await ler(pa, 2500);
      await still(pa, "ato4-01-advogado-com-lixeira");
      await fechar(pa);

      const p = (await parte(`canario+admin@${DOM}`)).page;
      await abrirPainel(p, "Diego");
      const linha = p.locator('[data-permissao="documentos:excluir"]');
      await deslizar(p, linha);
      await narrar(p, "No painel do Diego, a Carla desmarca apagar documento.");
      await clicar(p, linha.locator('button[role="checkbox"], input[type="checkbox"]').first());
      await linha.locator("[data-ajustada]").waitFor({ timeout: 15000 });
      await ler(p, 2000);
      await still(p, "ato4-02-removido");
      await fechar(p);

      const pa2 = (await parte(`canario+advogado@${DOM}`)).page;
      await pa2.goto(`${BASE}/casos/${caso.id}?tab=documentos`);
      await pa2.getByText(/comprovante de resid/).first().waitFor({ timeout: 25000 });
      await narrar(pa2, "A lixeira sumiu para ele. E se tentasse pela API, o banco também recusaria.");
      await ler(pa2, 3000);
      await still(pa2, "ato4-03-advogado-sem-lixeira");
      await fechar(pa2);
      gravados.push("ato4");
    }

    // ================= ATO 5 — ALCANCE =================
    if (ato(5)) {
      const p = (await parte(`canario+admin@${DOM}`)).page;
      await cartao(p, "5 · O alcance da permissão", "Em tarefas e agenda não basta poder: importa se é em tudo do escritório ou só no que está no nome da pessoa.");
      await abrirPainel(p, "Elisa");
      const linha = p.locator('[data-permissao="tarefas:gerenciar"]');
      await deslizar(p, linha);
      await narrar(p, "A Elisa é assistente: o papel dela já vem com 'só os atribuídos'.");
      await ler(p, 2500);
      await still(p, "ato5-01-escopo-do-papel");
      await tentar("trocar o alcance", async () => {
        await linha.locator("[data-escopo]").selectOption("todos");
        await linha.locator("[data-ajustada]").waitFor({ timeout: 15000 });
        await deslizar(p, linha);
        await narrar(p, "A Carla amplia para todos do escritório. Vira um ajuste, e volta ao papel com um clique.");
        await ler(p, 2500);
        await still(p, "ato5-02-escopo-ampliado");
      });
      await fechar(p);
      gravados.push("ato5");
    }

    // ================= ATO 6 — AS TRAVAS =================
    if (ato(6)) {
      const p = (await parte(`canario+admin@${DOM}`)).page;
      await cartao(p, "6 · O que o sistema não deixa", "As travas ficam no banco, não só na tela: valem também para quem chamar a API direto.");
      await p.goto(`${BASE}/equipe`);
      await p.getByRole("button", { name: /Ações de Carla/ }).waitFor({ timeout: 25000 });
      await clicar(p, p.getByRole("button", { name: /Ações de Carla/ }));
      await narrar(p, "No próprio menu, 'Permissões' vem desabilitado: ninguém ajusta a si mesma.");
      await ler(p, 3000);
      await still(p, "ato6-01-nao-em-si");
      await p.keyboard.press("Escape");

      // A parceira não aparece em /equipe (lá é a equipe interna): a trava dela
      // se mostra pela resposta do servidor, que é onde ela mora.
      const comoCarla = await sessao(`canario+admin@${DOM}`, ESC);
      const tentativa = await comoCarla.sb.rpc("definir_permissao_do_membro", {
        p_usuario_id: gilda.id, p_permissao: "equipe:gerenciar", p_estado: "conceder",
      });
      await painel(p, "Conceder uma permissão de interno a uma parceira",
        `<pre class="erro">${esc(tentativa.error?.message ?? "sem erro (inesperado)")}</pre>
         <p style="font-size:15px;color:#57534e">A tela do parceiro é outra e nem oferece isso. A recusa vem do banco, que é o que vale também para quem chamar a API direto.</p>`, 5500);
      await narrar(p, "Na parceira, o sistema só aceita o que o papel de parceiro prevê — quem recusa é o banco.");
      await still(p, "ato6-02-parceira");
      await fechar(p);

      const pd = (await parte(`canario+advogado@${DOM}`)).page;
      await pd.goto(`${BASE}/equipe`);
      await esperarRota(pd, ["/casos", "/tarefas", "/equipe"], "advogado em /equipe", 20000);
      await narrar(pd, "E quem não gerencia a equipe não chega à tela — nem à função que grava.");
      await ler(pd, 2500);
      await still(pd, "ato6-03-advogado-fora");
      await fechar(pd);
      gravados.push("ato6");
    }

    // ================= ATO 7 — SENSÍVEL =================
    if (ato(7)) {
      const p = (await parte(`canario+admin@${DOM}`)).page;
      await cartao(p, "7 · Permissão sensível", "Algumas permissões mudam o alcance da pessoa no escritório inteiro. Essas pedem confirmação.");
      await abrirPainel(p, "Diego");
      const linha = p.locator('[data-permissao="auditoria:ler"]');
      await deslizar(p, linha);
      await narrar(p, "Ver a auditoria é marcada como sensível.");
      await clicar(p, linha.locator('button[role="checkbox"], input[type="checkbox"]').first());
      await p.getByRole("alertdialog").waitFor({ timeout: 15000 });
      await narrar(p, "A confirmação diz o que a pessoa passa a poder, e lembra que fica registrado com o nome de quem concedeu.");
      await ler(p, 4000);
      await still(p, "ato7-01-confirmacao");
      await clicar(p, p.getByRole("button", { name: "Conceder" }));
      await linha.locator("[data-ajustada]").waitFor({ timeout: 15000 });
      await deslizar(p, linha);
      await ler(p, 1500);
      await still(p, "ato7-02-concedida");
      await fechar(p);

      await tentar("o Diego abrindo a auditoria", async () => {
        const pd = (await parte(`canario+advogado@${DOM}`)).page;
        await pd.goto(`${BASE}/auditoria`);
        await pd.getByRole("heading", { level: 1 }).waitFor({ timeout: 25000 });
        await narrar(pd, "Com a permissão concedida, a trilha abre para ele — sem virar admin.");
        await ler(pd, 3000);
        await still(pd, "ato7-03-auditoria-aberta");
        await fechar(pd);
      });
      gravados.push("ato7");
    }

    // ================= ATO 8 — A TRILHA =================
    if (ato(8)) {
      const p = (await parte(`canario+admin@${DOM}`)).page;
      await cartao(p, "8 · Tudo auditável", "Cada ajuste vira linha na auditoria do escritório: quem mexeu, em quem, o que era e o que ficou.");
      await p.goto(`${BASE}/auditoria`);
      await p.getByRole("heading", { level: 1 }).waitFor({ timeout: 25000 });
      await narrar(p, "A trilha do escritório mostra os ajustes de hoje, um por um.");
      await ler(p, 4000);
      await still(p, "ato8-01-auditoria");
      await fechar(p);
      gravados.push("ato8");
    }

    // ================= ATO 9 — VOLTAR AO PAPEL =================
    if (ato(9)) {
      const p = (await parte(`canario+admin@${DOM}`)).page;
      await cartao(p, "9 · Voltar ao papel", "O ajuste é uma diferença em relação ao papel. Desfazer é voltar a ele — item a item, ou tudo de uma vez.");
      await abrirPainel(p, "Diego");
      await narrar(p, "O painel do Diego mostra os ajustes que ele tem.");
      await ler(p, 2500);
      await still(p, "ato9-01-com-ajustes");
      await clicar(p, p.locator("[data-voltar-ao-papel]"));
      await p.getByText(/sem ajustes/).waitFor({ timeout: 20000 });
      await narrar(p, "Voltou tudo ao papel. E isso também fica na auditoria.");
      await ler(p, 2500);
      await still(p, "ato9-02-voltou");
      await fechar(p);
      gravados.push("ato9");
    }

    // ================= FECHAMENTO =================
    if (ato(10)) {
      const p = (await parte(null, false)).page;
      await cartao(p, "Em uma frase", "O papel continua sendo a regra; o ajuste é a exceção explicada, que vale no banco, alcança as integrações e fica registrada.", 6000);
      await fechar(p);
      gravados.push("fechamento");
    }
  } finally {
    const passo = async (rotulo, fn) => { try { await fn(); } catch (e) { console.log(`  limpeza ${rotulo}: ${e.message}`); } };
    await passo("ajustes do filme", () => admin.from("membro_permissoes").delete().eq("escritorio_id", ESC));
    for (const id of criados.documentos) await passo("documento", () => admin.from("documentos").delete().eq("id", id));

    const clipes = await estudio.encerrar();
    fs.writeFileSync(path.join(estudio.saida, "legendas.json"), JSON.stringify({ legendas }, null, 2));
    console.log(`\natos: ${gravados.join(", ") || "nenhum"}`);
    console.log(`clipes: ${clipes.length} em ${path.join(estudio.saida, "video")}`);
    console.log(`stills: ${path.join(estudio.saida, "stills")}`);
  }
})();

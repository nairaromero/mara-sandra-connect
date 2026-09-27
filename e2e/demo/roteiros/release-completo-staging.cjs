// FILME COMPLETO DO RELEASE, gravado contra o STAGING de verdade.
//
// O que este release leva para produção, ato por ato, com PROVA — não é
// demonstração de tela: cada ato afirma uma coisa e falha em voz alta se a
// afirmação não se sustentar. No fim, o placar.
//
//   Ato 0   Abertura e capítulos
//   Ato 1   Dois escritórios, um sistema: cada um vê só o seu
//   Ato 2   O papel decide o que a tela oferece
//   Ato 3   Permissões por pessoa — e a trava da permissão sensível
//   Ato 4   A auditoria segue a permissão, e a trilha guarda o antes e o depois
//   Ato 5   Kanban do parceiro: a coluna vem do processo, não da fase
//   Ato 6   Caso encerrado só reabre quando há gente por trás
//   Ato 7   Marca por escritório e credencial de integração cifrada
//   Ato 8   Segundo fator e o QG da plataforma
//   Ato 9   MCP: token para outra pessoa, e a queda quando o emissor perde a permissão
//   Ato 10  Os túneis: o resumo do dia de um escritório só, e a contagem checada
//   Ato 11  Fechamento com o placar
//
// Rodar da raiz (o front do staging já serve o código do release):
//   node e2e/demo/roteiros/release-completo-staging.cjs
//   ATOS=0,5,11 node e2e/demo/roteiros/release-completo-staging.cjs
//
// Depois, para o MP4 único e a legenda:
//   node e2e/demo/gerar-srt.cjs release-completo-staging <ffmpeg> release-completo
//
// Escreve só no escritório CANÁRIO (o de teste) e devolve tudo no finally.

process.env.DEMO_BASE_URL = process.env.DEMO_BASE_URL || "https://staging.marasandraconnect.com";
process.env.DEMO_QG_URL = process.env.DEMO_QG_URL || "https://qg.staging.marasandraconnect.com";

const fs = require("fs");
const path = require("path");
const { clicar, deslizar, narrar: narrarBase, abrirEstudio } = require("../helpers.cjs");
const {
  BASE, QG, DOM, FN, ANON, admin, sessao, estadoNavegador, fn, esc,
  elevarComTotp, fechar,
} = require("../staging.cjs");

// ---------- legendas (SRT): instante de cada narração, relativo ao clipe ----------
const legendas = [];
const inicioClipe = new WeakMap();
let clipesAbertos = 0;
async function narrar(page, texto, ms = 3200) {
  const c = inicioClipe.get(page);
  if (c) legendas.push({ clipe: c.clipe, inicio_ms: Date.now() - c.t0, dur_ms: ms, texto });
  return narrarBase(page, texto, ms);
}

const ATOS = (process.env.ATOS || "0,1,2,3,4,5,6,7,8,9,10,11").split(",").map((s) => s.trim());
const ato = (n) => ATOS.includes(String(n));
const MARCA = "[Filme release]";
const CNJ = "5008888-88.2026.4.03.6183";

// ---------- placar: cada ato afirma, e o que falha aparece no fim ----------
const provas = [];
async function provar(atoN, afirmacao, f) {
  try {
    const detalhe = await f();
    provas.push({ ato: atoN, afirmacao, ok: true, detalhe: detalhe || "" });
    console.log(`    ✓ ${afirmacao}${detalhe ? " — " + detalhe : ""}`);
  } catch (e) {
    const motivo = String(e?.message ?? e).split("\n")[0].slice(0, 220);
    provas.push({ ato: atoN, afirmacao, ok: false, detalhe: motivo });
    console.log(`    ✘ ${afirmacao} — ${motivo}`);
  }
}
const falha = (m) => { throw new Error(m); };
async function visivel(loc, msg, ms = 20000) {
  try { await loc.first().waitFor({ state: "visible", timeout: ms }); } catch { falha(msg); }
}
async function colunaCom(page, texto) {
  return await page.evaluate((alvo) => {
    for (const g of document.querySelectorAll("div.grid")) {
      const cols = [...g.children];
      if (cols.length < 3) continue;
      for (const c of cols) {
        const t = c.querySelector("p")?.innerText?.split("\n")[0]?.replace(/\s*\d+\s*$/, "").trim();
        if (t && c.innerText.includes(alvo)) return t;
      }
    }
    return null;
  }, texto);
}
let seqMcp = 0;
async function mcp(token, method, params = {}) {
  const r = await fetch(`${FN}/ia-mcp`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: ++seqMcp, method, params }),
  });
  const corpo = await r.json().catch(() => null);
  return { status: r.status, corpo, texto: JSON.stringify(corpo ?? {}) };
}

(async () => {
  const inicio = new Date().toISOString();

  // ---------- quem é quem no staging ----------
  const { data: canario } = await admin.from("escritorios").select("id, nome").eq("slug", "canario").maybeSingle();
  if (!canario) throw new Error("escritório Canário ausente no staging — rode `node scripts/seed-local-rbac.mjs --staging`");
  const ESC2 = canario.id;
  const { data: padrao } = await admin.from("escritorios").select("id, nome").eq("padrao_sistema", true).single();
  const ESC1 = padrao.id;

  const u = async (local) => {
    const { data } = await admin.from("usuarios").select("id, nome, email").eq("email", `${local}@${DOM}`).maybeSingle();
    if (!data) throw new Error(`conta ${local}@${DOM} ausente no staging`);
    return data;
  };
  const carla = await u("canario+admin");
  const diego = await u("canario+advogado");
  const elisa = await u("canario+assistente");
  const fabio = await u("canario+financeiro");
  const gilda = await u("canario+parceiro");

  const clienteDe = async (nome) => {
    const { data } = await admin.from("clientes").select("id, nome").eq("escritorio_id", ESC2).eq("nome", nome).maybeSingle();
    if (!data) throw new Error(`cliente ${nome} ausente no Canário do staging`);
    return data;
  };
  const casoDe = async (c) => (await admin.from("casos").select("id, fase").eq("cliente_id", c.id).order("created_at", { ascending: false }).limit(1).single()).data;
  const helena = await clienteDe("Helena Bastos Ferraz");
  const joana = await clienteDe("Joana Reis Camargo");
  const casoHelena = await casoDe(helena);
  const casoJoana = await casoDe(joana);

  const estudio = await abrirEstudio(process.env.SAIDA || "release-completo-staging");
  const { still } = estudio;
  const sessoes = {};
  const parte = async (email, escritorio) => {
    let st = { cookies: [], origins: [] };
    if (email) {
      if (!sessoes[email]) sessoes[email] = await sessao(email);
      st = estadoNavegador(sessoes[email].session, escritorio);
    }
    const t0 = Date.now();
    const nova = await estudio.novaParte(st);
    inicioClipe.set(nova.page, { clipe: clipesAbertos++, t0 });
    return nova;
  };
  const fortes = {};
  const parteForte = async (email, escritorio) => {
    if (!fortes[email]) {
      const s = await sessao(email);
      desfazer.baixarMfa.push(await elevarComTotp(s.sb));
      const { data } = await s.sb.auth.getSession();
      fortes[email] = data.session;
    }
    const t0 = Date.now();
    const nova = await estudio.novaParte(estadoNavegador(fortes[email], escritorio));
    inicioClipe.set(nova.page, { clipe: clipesAbertos++, t0 });
    return nova;
  };
  const como = (email, escritorio) => sessao(email, escritorio);

  async function cartao(page, titulo, sub, ms = 4600) {
    const c = inicioClipe.get(page);
    if (c) legendas.push({ clipe: c.clipe, inicio_ms: Date.now() - c.t0, dur_ms: ms, texto: `${titulo}. ${sub}` });
    await page.setContent(`<!doctype html><html><body style="margin:0;background:#16110c;color:#fcfaf6;font-family:-apple-system,'Segoe UI',Roboto,sans-serif;height:100vh;display:flex;align-items:center;justify-content:center">
      <div style="max-width:940px;text-align:center;padding:40px"><div style="font-size:13px;letter-spacing:.2em;text-transform:uppercase;color:#af7c00;margin-bottom:18px">Legal Connect · release de setembro · gravado no STAGING</div>
      <div style="font-family:Georgia,serif;font-size:44px;line-height:1.15;margin-bottom:20px">${esc(titulo)}</div>
      <div style="font-size:19px;line-height:1.5;color:#ded6c9">${esc(sub)}</div></div></body></html>`);
    await page.waitForTimeout(ms);
  }
  async function painel(page, titulo, corpoHtml, ms = 5200) {
    await page.setContent(`<!doctype html><html><body style="margin:0;background:#f7f4ee;color:#1c1917;font-family:-apple-system,'Segoe UI',Roboto,sans-serif;padding:36px">
      <div style="max-width:1080px;margin:0 auto">
        <div style="font-size:12px;letter-spacing:.18em;text-transform:uppercase;color:#8a6d1f;margin-bottom:10px">Prova contra o banco e as edge functions do staging</div>
        <h1 style="font-family:Georgia,serif;font-size:30px;margin:0 0 18px">${esc(titulo)}</h1>
        ${corpoHtml}
      </div>
      <style>pre{background:#fff;border:1px solid #e3ddd1;border-radius:10px;padding:14px;font-size:13px;white-space:pre-wrap;word-break:break-word}
      table{border-collapse:collapse;width:100%;background:#fff;border:1px solid #e3ddd1;border-radius:10px;overflow:hidden}
      th,td{padding:9px 12px;text-align:left;border-bottom:1px solid #eee7da;font-size:14px}th{background:#f0ebe0;font-size:12px;text-transform:uppercase;letter-spacing:.08em;color:#6b6a63}
      .ok{color:#15803d;font-weight:600}.nao{color:#b91c1c;font-weight:600}</style></body></html>`);
    await page.waitForTimeout(ms);
  }

  const desfazer = {
    processoJudicial: null, processoAdmin: null, solicitacao: null, faseHelena: null,
    faseJoana: null, tokens: false, ajustes: [], baixarMfa: [], integracao: false,
    andamentosRobo: [], tarefasPessoa: [],
  };
  const gravados = [];

  try {
    // ================= ATO 0 · ABERTURA =================
    if (ato(0)) {
      const { page: p } = await parte(null, null);
      await cartao(p, "O release de setembro, provado no staging",
        "Tudo o que vai para produção, ato por ato. Cada ato afirma uma coisa e falha em voz alta se a afirmação não se sustentar.", 6000);
      await cartao(p, "Capítulos",
        "1 Dois escritórios · 2 O papel decide a tela · 3 Permissões por pessoa · 4 Auditoria e trilha · 5 Kanban por processo · 6 Reabertura de caso · 7 Marca e integrações · 8 Segundo fator e QG · 9 MCP · 10 Os túneis", 7000);
      await fechar(p);
      gravados.push("abertura");
    }

    // ================= ATO 1 · DOIS ESCRITÓRIOS =================
    if (ato(1)) {
      const { page } = await parte(diego.email, ESC2);
      await cartao(page, "Dois escritórios, um sistema",
        "O mesmo banco atende mais de um escritório. Quem entra vê só o seu — e isso é decidido no servidor, não na tela.");
      // /clientes é tela de BUSCA (não lista sozinha) — a lista de trabalho é /tarefas
      await page.goto(`${BASE}/tarefas`);
      await visivel(page.getByText("Helena"), "a lista de trabalho do Canário não carregou");
      await narrar(page, "Diego é advogado do Canário. Tudo o que ele vê aqui é do Canário.", 3400);
      await still(page, "01-lista-canario");

      await provar(1, "o advogado do Canário não alcança dados do outro escritório", async () => {
        const d = await como(diego.email, ESC2);
        const { data, error } = await d.sb.from("clientes").select("nome, escritorio_id");
        if (error) falha(`leitura de clientes: ${error.message}`);
        const fora = (data ?? []).filter((c) => c.escritorio_id !== ESC2);
        if (fora.length) falha(`viu ${fora.length} cliente(s) de outro escritório`);
        if (!(data ?? []).length) falha("não viu nenhum cliente — o escritório ativo não chegou");
        return `${data.length} clientes, todos do Canário`;
      });

      await provar(1, "trocar o escritório no header não abre a porta do vizinho", async () => {
        const d = await como(diego.email, ESC1); // pede o escritório padrão, do qual não é membro
        const { data, error } = await d.sb.from("clientes").select("id");
        if (error) return `o banco recusou: ${error.message.slice(0, 60)}`;
        if ((data ?? []).length > 0) falha(`vazou: leu ${data.length} cliente(s) do escritório padrão`);
        return "pediu o escritório padrão e veio vazio — o vínculo é que manda";
      });

      await painel(page, "O que o servidor respondeu",
        `<table><tr><th>Quem</th><th>Escritório pedido</th><th>Resposta</th></tr>
         <tr><td>Diego (advogado do Canário)</td><td>Canário</td><td class="ok">os clientes do Canário</td></tr>
         <tr><td>Diego (advogado do Canário)</td><td>Escritório padrão</td><td class="nao">nada</td></tr></table>
         <p style="margin-top:14px;font-size:15px;color:#44403c">O escritório ativo vai no cabeçalho de toda chamada e é conferido no banco contra a tabela de vínculos. Cabeçalho inválido não vira "tudo": vira nada.</p>`);
      await fechar(page);
      gravados.push("ato1");
    }

    // ================= ATO 2 · O PAPEL DECIDE A TELA =================
    if (ato(2)) {
      const { page } = await parte(fabio.email, ESC2);
      await cartao(page, "O papel decide o que a tela oferece",
        "Financeiro, advogado, assistente e parceiro entram no mesmo sistema e recebem telas diferentes — e o banco recusa o que a tela não oferece.");
      await page.goto(`${BASE}/tarefas`);
      await visivel(page.getByRole("heading", { name: /Tarefas/i }), "o financeiro não conseguiu abrir a lista de trabalho");
      await narrar(page, "Fábio é do financeiro. Ele consulta o que o escritório está fazendo.", 3200);
      await still(page, "02-financeiro-lista");

      await page.goto(`${BASE}/comercial`);
      await provar(2, "a tela de gestão recusa quem não gerencia", async () => {
        await visivel(page.getByText(/Área restrita a quem gerencia o comercial/i),
          "o financeiro entrou no Comercial — a tela devia recusar");
        return "Comercial responde 'Área restrita a quem gerencia o comercial'";
      });
      await narrar(page, "O Comercial não é dele — e a tela diz por quê, em vez de mostrar um botão que o banco recusaria.", 4200);
      await still(page, "02-financeiro-comercial-restrito");
      await fechar(page);

      const { page: pg } = await parte(gilda.email, ESC2);
      await pg.goto(`${BASE}/tarefas`);
      await visivel(pg.getByText("Helena"), "o quadro da parceira não carregou");
      await narrar(pg, "Gilda é parceira. Ela vê os pedidos dos casos que indicou — e nada além disso.", 4000);
      await still(pg, "02-parceira-quadro");
      await provar(2, "a parceira só alcança os casos que indicou", async () => {
        const g = await como(gilda.email, ESC2);
        const { data, error } = await g.sb.from("casos").select("id, parceiro_id");
        if (error) falha(`casos da parceira: ${error.message}`);
        const alheios = (data ?? []).filter((c) => c.parceiro_id !== gilda.id);
        if (alheios.length) falha(`viu ${alheios.length} caso(s) que não indicou`);
        return `${(data ?? []).length} caso(s), todos indicados por ela`;
      });
      await fechar(pg);
      gravados.push("ato2");
    }

    // ================= ATO 3 · PERMISSÕES POR PESSOA =================
    if (ato(3)) {
      const { page } = await parte(carla.email, ESC2);
      await cartao(page, "Permissões por pessoa",
        "O papel dá o padrão. Quando uma pessoa precisa de um pouco mais (ou de um pouco menos), a admin ajusta — sem promover ninguém a administrador.");

      // estado limpo antes de gravar
      const c = await como(carla.email, ESC2);
      await c.sb.rpc("resetar_permissoes_do_membro", { p_usuario_id: elisa.id });

      await page.goto(`${BASE}/equipe`);
      await visivel(page.getByText("Elisa"), "a lista da equipe não carregou");
      await narrar(page, "Carla é a admin do Canário. Elisa é assistente.", 2800);
      await clicar(page, page.getByRole("button", { name: /Ações de Elisa/i }).first());
      await clicar(page, page.getByRole("menuitem", { name: /^Permissões/i }).first());
      await visivel(page.locator("[data-permissoes-sheet]"), "o painel de permissões não abriu");
      await narrar(page, "Cada permissão do papel aparece aqui, uma a uma.", 3000);
      await still(page, "03-painel-permissoes");

      const linha = page.locator('li[data-permissao="auditoria:ler"]');
      await visivel(linha, "a permissão auditoria:ler não apareceu no painel");
      await deslizar(page, linha);
      await clicar(page, linha.getByRole("checkbox").first());

      await provar(3, "conceder permissão sensível pede confirmação", async () => {
        await visivel(page.getByText(/Conceder uma permissão sensível/i),
          "não apareceu a confirmação da permissão sensível");
        return "o sistema pergunta antes de conceder auditoria:ler";
      });
      await narrar(page, "Auditoria é permissão sensível: o sistema pergunta antes.", 3600);
      await still(page, "03-permissao-sensivel");
      await clicar(page, page.getByRole("button", { name: /^Conceder$/ }).first());
      // esperar a TELA confirmar antes de perguntar ao banco: na primeira
      // gravação a consulta chegou antes da gravação e leu "não tem" — corrida
      // minha, não do produto (a trilha do ato 4 provou que o ajuste ocorreu)
      await visivel(linha.locator("[data-ajustada]"), "a tela não marcou a permissão como ajustada");

      await provar(3, "o ajuste fica marcado como ajuste, não como papel", async () => {
        const { data, error } = await c.sb.rpc("permissoes_do_membro", { p_usuario_id: elisa.id });
        if (error) falha(`permissoes_do_membro: ${error.message}`);
        const l = (data ?? []).find((p) => p.permissao === "auditoria:ler");
        if (!l) falha("auditoria:ler sumiu da lista");
        if (l.tem !== true) falha(`o banco diz que ela não tem: ${JSON.stringify(l)}`);
        if (l.ajustada !== true) falha("não ficou marcada como ajuste individual");
        if (l.do_papel === true) falha("veio do papel — o ajuste perderia o sentido");
        desfazer.ajustes.push(elisa.id);
        return "tem=true · ajustada=true · do_papel=false";
      });
      await narrar(page, "Elisa continua assistente. Ganhou uma permissão, não um cargo.", 4000);
      await still(page, "03-ajustada");
      await fechar(page);
      gravados.push("ato3");
    }

    // ================= ATO 4 · AUDITORIA E TRILHA =================
    if (ato(4)) {
      const { page } = await parte(elisa.email, ESC2);
      await cartao(page, "A auditoria segue a permissão",
        "Antes, ver a auditoria era coisa de administrador. Agora é de quem tem a permissão — e toda mudança de acesso deixa linha, com o antes e o depois.");
      await page.goto(`${BASE}/auditoria`);
      await provar(4, "a assistente com a permissão abre a Auditoria", async () => {
        await visivel(page.getByRole("heading", { name: /Auditoria/i }), "a tela de Auditoria não abriu para ela");
        return "a tela abre sem ela ser admin";
      });
      await narrar(page, "Elisa não é admin. Com a permissão, a Auditoria abre.", 3600);
      await still(page, "04-auditoria-aberta");

      await provar(4, "o ajuste que acabou de acontecer está na trilha", async () => {
        const { data, error } = await admin.from("auditoria")
          .select("acao, detalhes, created_at").eq("escritorio_id", ESC2)
          .eq("acao", "equipe.permissao_ajustada").gte("created_at", inicio)
          .order("created_at", { ascending: false }).limit(1).maybeSingle();
        if (error) falha(`ler a trilha: ${error.message}`);
        if (!data) falha("nenhuma linha 'equipe.permissao_ajustada' desde o início do filme");
        const det = JSON.stringify(data.detalhes ?? {});
        if (!/auditoria:ler/.test(det)) falha(`a linha não diz qual permissão: ${det.slice(0, 120)}`);
        return `linha registrada com a permissão e quem mexeu`;
      });

      await provar(4, "trocar o papel de alguém também deixa linha, com antes e depois", async () => {
        const c = await como(carla.email, ESC2);
        const { data: antes } = await admin.from("membros")
          .select("papel:papeis!inner(chave)").eq("escritorio_id", ESC2).eq("usuario_id", fabio.id).single();
        const chaveAntes = antes?.papel?.chave;
        const r = await c.sb.rpc("definir_papel", { p_usuario_id: fabio.id, p_papel: "assistente" });
        if (r.error) falha(`definir_papel: ${r.error.message}`);
        desfazer.papelFabio = chaveAntes;
        const { data: linha } = await admin.from("auditoria")
          .select("detalhes, created_at").eq("escritorio_id", ESC2).eq("acao", "equipe.papel_alterado")
          .gte("created_at", inicio).order("created_at", { ascending: false }).limit(1).maybeSingle();
        if (!linha) falha("a troca de papel não deixou linha");
        const det = JSON.stringify(linha.detalhes ?? {});
        if (!/assistente/.test(det) || (chaveAntes && !new RegExp(chaveAntes).test(det))) {
          falha(`a linha não guarda antes e depois: ${det.slice(0, 140)}`);
        }
        return `${chaveAntes} → assistente, com os dois lados na linha`;
      });

      await page.reload();
      await narrar(page, "O que acabou de acontecer já está aqui: quem mexeu, em quem, e o que mudou.", 4400);
      await still(page, "04-trilha");
      await fechar(page);
      gravados.push("ato4");
    }

    // ================= ATO 5 · KANBAN POR PROCESSO =================
    if (ato(5)) {
      const { page } = await parte(gilda.email, ESC2);
      await cartao(page, "A coluna vem do processo, não da fase do caso",
        "Um cliente pode correr em duas frentes ao mesmo tempo. A fase do caso é uma só — quem decide a coluna do pedido é o processo a que ele se refere.");

      const { data: sol } = await admin.from("solicitacoes_documento")
        .select("id, processo_admin_id, processo_judicial_id").eq("caso_id", casoHelena.id).eq("status", "pendente").limit(1).maybeSingle();
      if (!sol) falha("nenhuma solicitação pendente no caso da Helena");
      desfazer.solicitacao = { id: sol.id, admin: sol.processo_admin_id, judicial: sol.processo_judicial_id };
      desfazer.faseHelena = casoHelena.fase;

      await page.goto(`${BASE}/tarefas`);
      await visivel(page.getByText("Helena"), "o quadro da parceira não carregou");
      await narrar(page, "O caso da Helena ainda não tem processo. O pedido está em análise.", 3600);
      await still(page, "05-antes");
      await provar(5, "sem processo, o pedido fica na fase do caso", async () => {
        const col = await colunaCom(page, "Helena");
        if (col !== "Em análise") falha(`estava em '${col}'`);
        return "Em análise";
      });

      const { data: pj } = await admin.from("processos_judiciais")
        .insert({ caso_id: casoHelena.id, escritorio_id: ESC2, numero_processo: CNJ }).select("id").single();
      desfazer.processoJudicial = pj.id;
      const { data: pa } = await admin.from("processos_admin")
        .insert({ caso_id: casoHelena.id, escritorio_id: ESC2 }).select("id").single();
      desfazer.processoAdmin = pa.id;
      await admin.from("solicitacoes_documento").update({ processo_admin_id: pa.id, processo_judicial_id: null }).eq("id", sol.id);

      await page.reload();
      await visivel(page.getByText("Helena"), "o card sumiu depois de ligar o processo");
      await provar(5, "o caso entra em fase judicial e o pedido, que é do administrativo, vai para Administrativo", async () => {
        const { data: caso } = await admin.from("casos").select("fase").eq("id", casoHelena.id).single();
        if (caso.fase !== "judicial") falha(`a fase do caso ficou '${caso.fase}'`);
        const col = await colunaCom(page, "Helena");
        if (col !== "Administrativo") falha(`o card foi para '${col}' — se a coluna viesse da fase, estaria em Judiciais`);
        return "caso em 'judicial', card em 'Administrativo'";
      });
      await narrar(page, "O caso está em fase judicial. O pedido é do processo administrativo — e é lá que ele aparece.", 5000);
      await still(page, "05-depois");
      await fechar(page);
      gravados.push("ato5");
    }

    // ================= ATO 6 · REABERTURA DE CASO =================
    if (ato(6)) {
      const { page } = await parte(diego.email, ESC2);
      await cartao(page, "Caso encerrado só reabre quando há gente por trás",
        "Chegava publicação num caso encerrado e ele reabria sozinho. Agora reabrir é resposta a uma pessoa — robô não reabre.");

      desfazer.faseJoana = casoJoana.fase;
      await admin.from("casos").update({ fase: "finalizado" }).eq("id", casoJoana.id);

      await provar(6, "o robô escreve no caso encerrado e ele NÃO reabre", async () => {
        const { data: a, error } = await admin.from("andamentos").insert({
          caso_id: casoJoana.id, escritorio_id: ESC2, origem: "datajud",
          titulo: `${MARCA} movimentação automática`, descricao: "entrada de robô",
          data_evento: new Date().toISOString(),
        }).select("id").single();
        if (error) falha(`inserir andamento de robô: ${error.message}`);
        desfazer.andamentosRobo.push(a.id);
        const { data: caso } = await admin.from("casos").select("fase").eq("id", casoJoana.id).single();
        if (caso.fase !== "finalizado") falha(`o caso reabriu sozinho (fase '${caso.fase}')`);
        return "fase continua 'finalizado'";
      });

      await provar(6, "a pessoa cria uma tarefa e o caso reabre", async () => {
        const d = await como(diego.email, ESC2);
        const { data: t, error } = await d.sb.from("tarefas").insert({
          caso_id: casoJoana.id, tipo: "interna", status: "a_fazer",
          titulo: `${MARCA} retomar o caso`, origem: "manual",
        }).select("id").single();
        if (error) falha(`criar tarefa como advogado: ${error.message}`);
        desfazer.tarefasPessoa.push(t.id);
        const { data: caso } = await admin.from("casos").select("fase").eq("id", casoJoana.id).single();
        if (caso.fase === "finalizado") falha("o caso não reabriu quando uma pessoa agiu");
        return `fase voltou para '${caso.fase}'`;
      });

      const pRobo = provas.filter((p) => p.ato === 6);
      await painel(page, "As duas entradas, no mesmo caso encerrado",
        `<table><tr><th>Quem escreveu</th><th>O quê</th><th>O caso reabriu?</th></tr>
         <tr><td>Robô (DataJud)</td><td>uma movimentação</td><td class="${pRobo[0]?.ok ? "ok" : "nao"}">${pRobo[0]?.ok ? "não — continua encerrado" : "falhou"}</td></tr>
         <tr><td>Diego (advogado)</td><td>uma tarefa</td><td class="${pRobo[1]?.ok ? "ok" : "nao"}">${pRobo[1]?.ok ? "sim" : "falhou"}</td></tr></table>
         <p style="margin-top:14px;font-size:15px;color:#44403c">O que separa os dois não é o tipo da entrada: é ter uma pessoa por trás. Quem escreve pelo sistema não deixa autor, e sem autor o caso fica como estava.</p>`, 6000);
      await still(page, "06-reabertura");
      await fechar(page);
      gravados.push("ato6");
    }

    // ================= ATO 7 · MARCA E INTEGRAÇÕES =================
    if (ato(7)) {
      const { page } = await parte(carla.email, ESC2);
      await cartao(page, "Cada escritório com a sua marca e as suas credenciais",
        "A marca do escritório fica no topo; a do produto, onde não há escritório. E a credencial de integração é de quem a cadastrou — cifrada, e nunca volta para a tela.");
      await page.goto(`${BASE}/tarefas`);
      await visivel(page.getByText("Canário Advocacia").first(), "a marca do escritório não apareceu no topo");
      await narrar(page, "No topo, a marca do escritório. No rodapé, a do produto.", 3400);
      await still(page, "07-marca");

      await provar(7, "a credencial é cifrada e nunca volta", async () => {
        const c = await como(carla.email, ESC2);
        // o contrato é { tipo, config, segredo }: o segredo vai FORA do config,
        // e o que não está na lista de campos do tipo é descartado de propósito
        const salvar = await fn("integracoes-escritorio", c.jwt, ESC2, {
          action: "salvar", tipo: "whatsapp",
          config: { instance: "canario-filme", base_url: "https://exemplo.invalido" },
          segredo: "chave-ficticia-do-filme",
        });
        if (salvar.status !== 200) falha(`salvar: ${salvar.status} ${salvar.texto.slice(0, 120)}`);
        desfazer.integracao = true;
        if (/chave-ficticia-do-filme/.test(salvar.texto)) falha("a resposta devolveu o segredo em claro");
        // erro de consulta NÃO pode passar por "não guardou" — é a lição do túnel
        // de leitura: na primeira gravação a coluna errada virou "não foi guardada".
        const { data: linha, error: eLer } = await admin.from("escritorio_integracoes")
          .select("tipo, config, segredo_cipher, segredo_iv, segredo_definido_em")
          .eq("escritorio_id", ESC2).eq("tipo", "whatsapp").maybeSingle();
        if (eLer) falha(`ler a credencial guardada: ${eLer.message}`);
        if (!linha) falha("a credencial não foi guardada");
        if (!linha.segredo_cipher) falha("não há segredo cifrado na linha");
        if (/chave-ficticia-do-filme/.test(JSON.stringify(linha))) falha("a credencial está em claro no banco");
        // e a tela, ao reabrir a integração, recebe a configuração SEM o segredo
        const status = await fn("integracoes-escritorio", c.jwt, ESC2, { action: "status", tipo: "whatsapp" });
        if (status.status !== 200) falha(`status: ${status.status}`);
        if (/chave-ficticia-do-filme/.test(status.texto)) falha("o status devolveu o segredo para a tela");
        if (!status.json?.segredo_definido_em) falha("o status não diz que há segredo definido");
        return "cifrada no banco; a tela recebe só 'há segredo definido em…'";
      });

      await provar(7, "quem não gerencia integrações não vê a credencial do escritório", async () => {
        const e = await como(elisa.email, ESC2);
        const { data, error } = await e.sb.from("escritorio_integracoes").select("tipo, segredo_cipher");
        // "coluna não existe" não é recusa: só 42501 (e a lista vazia da RLS) contam
        if (error && error.code !== "42501") falha(`erro que não é permissão (${error.code}): ${error.message}`);
        if (error) return `o banco recusou com 42501`;
        if ((data ?? []).length) falha(`a assistente leu ${data.length} credencial(is)`);
        return "a consulta é aceita e volta vazia — a RLS esconde a linha";
      });

      await painel(page, "A credencial que a tela salvou",
        `<table><tr><th>Onde</th><th>O que aparece</th></tr>
         <tr><td>Resposta da função</td><td class="ok">confirmação, sem o segredo</td></tr>
         <tr><td>Banco</td><td class="ok">texto cifrado</td></tr>
         <tr><td>Assistente do escritório</td><td class="nao">nada</td></tr></table>
         <p style="margin-top:14px;font-size:15px;color:#44403c">Cada escritório usa a própria conta de WhatsApp, Legalmail e Tramitação Inteligente. Quem não tem a permissão não vê que existe.</p>`);
      await fechar(page);
      gravados.push("ato7");
    }

    // ================= ATO 8 · SEGUNDO FATOR E O QG =================
    if (ato(8)) {
      await provar(8, "sem o segundo fator, o QG recusa no banco", async () => {
        const s = await como(`qg+dono2@${DOM}`, null);
        const r = await s.sb.rpc("qg_escritorios", { p_limite: 1 });
        if (!r.error) falha("o QG aceitou uma sessão sem segundo fator");
        if (!/duas etapas|AAL2/i.test(r.error.message)) falha(`recusou por outro motivo: ${r.error.message}`);
        return r.error.message.slice(0, 70);
      });

      const { page } = await parteForte(`qg+dono@${DOM}`, null);
      await cartao(page, "O QG da plataforma, atrás do segundo fator",
        "A administração da plataforma mora em outro endereço, com outra porta: exige código, e vê só metadados — nunca o conteúdo de um escritório.");
      await page.goto(`${QG}/qg`);
      await provar(8, "com o segundo fator, o QG abre e lista os escritórios", async () => {
        await visivel(page.getByRole("heading", { name: /Escrit/i }), "o QG não abriu");
        return "a lista de escritórios aparece";
      });
      await narrar(page, "Aqui se vê quantos escritórios existem e o tamanho de cada um. Não se vê um cliente sequer.", 4600);
      await still(page, "08-qg");
      await fechar(page);
      gravados.push("ato8");
    }

    // ================= ATO 9 · MCP =================
    if (ato(9)) {
      const { page } = await parte(carla.email, ESC2);
      await cartao(page, "O acesso da IA é de uma pessoa, e dura o que a permissão dura",
        "O token do MCP roda como a pessoa dona dele, com os limites dela. E vale enquanto quem o emitiu ainda puder conceder.");

      let token = null;
      await provar(9, "a admin emite o token de outra pessoa sem promovê-la", async () => {
        const c = await como(carla.email, ESC2);
        const r = await fn("ia-config", c.jwt, ESC2, {
          action: "token_criar", nome: `${MARCA} 9a`, usuario_id: gilda.id, escopo: "leitura",
        });
        if (r.status !== 200 || !r.json?.token) falha(`emitir: ${r.status} ${r.texto.slice(0, 120)}`);
        desfazer.tokens = true;
        const uso = await mcp(r.json.token, "tools/call", { name: "buscar_casos", arguments: { limite: 1 } });
        if (uso.status !== 200) falha(`o token da parceira não funcionou: ${uso.status}`);
        return "emitido para a parceira, que segue parceira, e o MCP aceitou";
      });

      await provar(9, "tirada a permissão de quem emitiu, o mesmo token para de valer", async () => {
        const c = await como(carla.email, ESC2);
        const g = await c.sb.rpc("definir_permissao_do_membro", { p_usuario_id: diego.id, p_permissao: "ia:mcp_conceder", p_estado: "conceder" });
        if (g.error) falha(`conceder ao advogado: ${g.error.message}`);
        desfazer.ajustes.push(diego.id);
        const d = await como(diego.email, ESC2);
        const r = await fn("ia-config", d.jwt, ESC2, {
          action: "token_criar", nome: `${MARCA} 9b`, usuario_id: elisa.id, escopo: "leitura",
        });
        if (r.status !== 200) falha(`o advogado com a permissão não emitiu: ${r.status}`);
        token = r.json.token;
        const vivo = await mcp(token, "tools/call", { name: "buscar_casos", arguments: { limite: 1 } });
        if (vivo.status !== 200) falha(`token recém-emitido já não vale: ${vivo.status}`);
        const t = await c.sb.rpc("definir_permissao_do_membro", { p_usuario_id: diego.id, p_permissao: "ia:mcp_conceder", p_estado: "papel" });
        if (t.error) falha(`tirar o ajuste: ${t.error.message}`);
        const morto = await mcp(token, "tools/call", { name: "buscar_casos", arguments: { limite: 1 } });
        if (morto.status !== 403) falha(`o token seguiu valendo (${morto.status})`);
        return "valia; tirada a permissão do emissor, virou 403 na hora";
      });

      const p9 = provas.filter((p) => p.ato === 9);
      await painel(page, "O token do MCP, do nascimento à queda",
        `<table><tr><th>Momento</th><th>Resposta do MCP</th></tr>
         <tr><td>Emitido pela admin para a parceira</td><td class="${p9[0]?.ok ? "ok" : "nao"}">${p9[0]?.ok ? "funciona" : "falhou"}</td></tr>
         <tr><td>Emitido por quem tinha a permissão ajustada</td><td class="${p9[1]?.ok ? "ok" : "nao"}">${p9[1]?.ok ? "funciona" : "falhou"}</td></tr>
         <tr><td>Depois de tirar a permissão de quem emitiu</td><td class="${p9[1]?.ok ? "ok" : "nao"}">${p9[1]?.ok ? "403 — não pode mais conceder" : "falhou"}</td></tr></table>
         <p style="margin-top:14px;font-size:15px;color:#44403c">Desligar alguém, rebaixar ou tirar o ajuste derruba os tokens que essa pessoa emitiu. Não é preciso lembrar de revogar um a um.</p>`, 6000);
      await fechar(page);
      gravados.push("ato9");
    }

    // ================= ATO 10 · OS TÚNEIS =================
    if (ato(10)) {
      const { page } = await parte(carla.email, ESC2);
      await cartao(page, "Um lugar só para cada decisão",
        "Boa parte deste release é invisível: onde havia a mesma regra escrita em vários lugares, passou a haver uma só. É o que impede que o próximo conserto esqueça um dos lados.");

      await provar(10, "o resumo diário enxerga um escritório só", async () => {
        const c = await como(carla.email, ESC2);
        const r = await fn("digest-diario", c.jwt, ESC2, { dry_run: true, horas: 720 });
        if (r.status !== 200) falha(`digest-diario: ${r.status} ${r.texto.slice(0, 120)}`);
        const html = String(r.json?.html ?? "");
        if (!html.length) falha("não veio HTML");
        const { data: fora } = await admin.from("clientes").select("nome").eq("escritorio_id", ESC1).limit(40);
        const vazou = (fora ?? []).map((x) => x.nome).filter((n) => n && n.length > 8 && html.includes(n));
        if (vazou.length) falha(`nome de outro escritório no e-mail: ${vazou[0]}`);
        return `${(fora ?? []).length} nomes do outro escritório conferidos, nenhum no e-mail do Canário`;
      });

      await page.goto(`${BASE}/equipe`);
      await visivel(page.getByText("Elisa"), "a lista da equipe não carregou");
      await clicar(page, page.getByRole("button", { name: /Ações de Elisa/i }).first());
      await clicar(page, page.getByRole("menuitem", { name: /Desligar da equipe/i }).first());
      await provar(10, "a contagem que a tela mostra é a do banco, e falha vira erro em vez de zero", async () => {
        await visivel(page.getByText(/tarefa\(s\) aberta\(s\)/i), "o diálogo não mostrou a contagem");
        const texto = await page.locator("body").innerText();
        const m = texto.match(/tem\s+(\d+)\s+tarefa\(s\) aberta\(s\)/i);
        if (!m) falha("não achei o número na tela");
        const { count } = await admin.from("tarefas").select("id", { count: "exact", head: true })
          .eq("responsavel_id", elisa.id).eq("status", "a_fazer");
        if (Number(m[1]) !== Number(count)) falha(`tela ${m[1]} × banco ${count}`);
        return `${m[1]} na tela e ${count} no banco`;
      });
      await narrar(page, "Antes, uma falha na contagem virava zero, e a tela deixava de pedir quem assume. Agora falha aparece como falha.", 5000);
      await still(page, "10-contagem");
      const cancelar = page.getByRole("button", { name: /Cancelar/i }).first();
      if (await cancelar.count()) await clicar(page, cancelar); else await page.keyboard.press("Escape");
      await fechar(page);
      gravados.push("ato10");
    }

    // ================= ATO 11 · FECHAMENTO =================
    if (ato(11)) {
      const { page: p } = await parte(null, null);
      const ok = provas.filter((x) => x.ok).length;
      const ruim = provas.filter((x) => !x.ok).length;
      const linhas = provas.map((x) => `<tr><td>Ato ${x.ato}</td><td>${esc(x.afirmacao)}</td><td class="${x.ok ? "ok" : "nao"}">${x.ok ? "provado" : "FALHOU"}</td><td style="font-size:13px;color:#57534e">${esc(x.detalhe)}</td></tr>`).join("");
      await painel(p, `Placar: ${ok} afirmações provadas, ${ruim} falha(s)`,
        `<table><tr><th>Ato</th><th>Afirmação</th><th>Resultado</th><th>Como se sabe</th></tr>${linhas}</table>`, 12000);
      await cartao(p, ruim === 0 ? "Nada ficou por provar" : `${ruim} afirmação(ões) não se sustentou`,
        ruim === 0
          ? "Tudo o que este filme afirma foi conferido contra o banco e as edge functions do staging, no momento da gravação."
          : "O que falhou está no placar acima, com o motivo — e precisa ser resolvido antes da ida para produção.", 7000);
      await fechar(p);
      gravados.push("fechamento");
    }

  } finally {
    console.log("\ndevolvendo o staging ao estado de antes…");
    const passo = async (rotulo, f) => { try { await f(); console.log(`  ok  ${rotulo}`); } catch (e) { console.log(`  (!) ${rotulo}: ${String(e.message).slice(0, 120)}`); } };
    const c = sessoes[carla.email] ? await sessao(carla.email, ESC2) : null;

    if (desfazer.solicitacao) {
      await passo("pedido volta aos processos de antes", () => admin.from("solicitacoes_documento")
        .update({ processo_admin_id: desfazer.solicitacao.admin, processo_judicial_id: desfazer.solicitacao.judicial })
        .eq("id", desfazer.solicitacao.id));
    }
    if (desfazer.processoJudicial) await passo("processo judicial do filme apagado", () => admin.from("processos_judiciais").delete().eq("id", desfazer.processoJudicial));
    if (desfazer.processoAdmin) await passo("processo administrativo do filme apagado", () => admin.from("processos_admin").delete().eq("id", desfazer.processoAdmin));
    if (desfazer.faseHelena) await passo(`fase do caso da Helena volta a ${desfazer.faseHelena}`, () => admin.from("casos").update({ fase: desfazer.faseHelena }).eq("id", casoHelena.id));
    for (const id of desfazer.tarefasPessoa) await passo("tarefa do filme apagada", () => admin.from("tarefas").delete().eq("id", id));
    for (const id of desfazer.andamentosRobo) await passo("andamento do filme apagado", () => admin.from("andamentos").delete().eq("id", id));
    await passo("rastros de exclusão do filme apagados", async () => {
      await admin.from("tarefas_excluidas").delete().like("titulo", `${MARCA}%`);
      await admin.from("andamentos_excluidos").delete().like("titulo", `${MARCA}%`);
    });
    if (desfazer.faseJoana) await passo(`fase do caso da Joana volta a ${desfazer.faseJoana}`, () => admin.from("casos").update({ fase: desfazer.faseJoana }).eq("id", casoJoana.id));
    if (desfazer.tokens) {
      await passo("tokens do filme apagados", () => admin.from("ia_tokens").delete().like("nome", `${MARCA}%`));
      await passo("ações de MCP do filme apagadas", () => admin.from("ia_acoes").delete().eq("superficie", "mcp").gte("created_at", inicio));
    }
    if (desfazer.integracao) await passo("integração do filme apagada", () => admin.from("escritorio_integracoes").delete().eq("escritorio_id", ESC2).eq("tipo", "whatsapp"));
    if (c) {
      for (const id of [...new Set(desfazer.ajustes)]) {
        await passo(`ajustes de ${id.slice(0, 8)} resetados`, () => c.sb.rpc("resetar_permissoes_do_membro", { p_usuario_id: id }));
      }
      if (desfazer.papelFabio) await passo(`papel do financeiro volta a ${desfazer.papelFabio}`, () => c.sb.rpc("definir_papel", { p_usuario_id: fabio.id, p_papel: desfazer.papelFabio }));
    }
    for (const baixar of desfazer.baixarMfa) await passo("autenticador do filme removido", baixar);
    await passo("processo do filme (por número) apagado", () => admin.from("processos_judiciais").delete().eq("numero_processo", CNJ));

    const clipes = await estudio.encerrar();
    fs.writeFileSync(path.join(estudio.saida, "legendas.json"), JSON.stringify({ legendas }, null, 2));
    fs.writeFileSync(path.join(estudio.saida, "provas.json"), JSON.stringify(provas, null, 2));
    const ok = provas.filter((x) => x.ok).length, ruim = provas.filter((x) => !x.ok).length;
    let md = `# Filme do release — o que ficou provado\n\nGravado contra o STAGING (${BASE}) em ${new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}.\n\n**${ok} afirmações provadas · ${ruim} falha(s).**\n\n| Ato | Afirmação | Resultado | Como se sabe |\n|---|---|---|---|\n`;
    for (const x of provas) md += `| ${x.ato} | ${x.afirmacao} | ${x.ok ? "✅ provado" : "❌ FALHOU"} | ${(x.detalhe || "").replace(/\|/g, "\\|")} |\n`;
    fs.writeFileSync(path.join(estudio.saida, "provas.md"), md);
    console.log(`\natos gravados: ${gravados.join(", ") || "nenhum"}`);
    console.log(`placar: ${ok} provadas · ${ruim} falha(s)`);
    console.log(`clipes: ${clipes.length} | saída: ${estudio.saida}`);
  }
})().catch((e) => { console.error("FALHA:", e); process.exit(1); });

// Filme do lote RBAC multi-tenant gravado contra o STAGING (banco e edge
// functions reais do projeto alhqbpbekmxpoibrrnbi), para a validação da Naira.
//
//   Ato 0  Abertura e capítulos
//   Ato 1  Suporte: a plataforma pede, o admin do escritório aprova, lê e encerra
//   Ato 2  Integrações por escritório: credencial cifrada, teste e o botão que aparece
//   Ato 3  Marca: a do produto onde não há escritório; a do escritório no topo
//   Ato 4  Segundo fator do QG: a trava mora no banco, o cadastro é na tela
//   Ato 5  Token do MCP emitido para outra pessoa (chamada real à function)
//   Ato 6  A tela só oferece o que o papel pode
//   Ato 7  Fechamento
//
// Diferenças em relação ao filme local (lote-rbac-local.cjs): aqui NÃO existem
// provedores simulados. O Legalmail/TI do Canário são cadastrados com chave
// fictícia de propósito — o teste de conexão bate no provedor de verdade e
// volta recusado, que é o caminho inteiro exercitado (tela → function →
// decifra → provedor). O que se valida aqui é o RBAC, não a chave de terceiro.
//
// Enquanto o PR do lote não entra na branch `staging`, o domínio
// staging.marasandraconnect.com serve o build ANTIGO: filma-se com o front novo
// servido na máquina (`bun dev`, que lê VITE_SUPABASE_* do staging). Depois do
// merge: DEMO_BASE_URL=https://staging.marasandraconnect.com e
// DEMO_QG_URL=https://qg.staging.marasandraconnect.com.
//
// Uso:  bun dev  (noutro terminal)  &&  node e2e/demo/roteiros/lote-rbac-staging.cjs
//       ATOS=1,4 node e2e/demo/roteiros/lote-rbac-staging.cjs   # só alguns atos
const fs = require("fs");
const path = require("path");
const { ler, deslizar, clicar, tentar, narrar: narrarBase, abrirEstudio } = require("../helpers.cjs");
const {
  BASE, QG, DOM, FN, ANON, admin, sessao, estadoNavegador, esc,
  codigoNovo, elevarComTotp, esperarRota, fechar, digitar,
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

const MARCA = "[Filme]";
const ATOS = (process.env.ATOS || "0,1,2,3,4,5,6,7").split(",").map((s) => s.trim());
const ato = (n) => ATOS.includes(String(n));

async function cartao(page, titulo, sub, ms = 4200) {
  const c = inicioClipe.get(page);
  if (c) legendas.push({ clipe: c.clipe, inicio_ms: Date.now() - c.t0, dur_ms: ms, texto: `${titulo}. ${sub}` });
  await page.setContent(`<!doctype html><html><body style="margin:0;background:#16110c;color:#fcfaf6;font-family:-apple-system,'Segoe UI',Roboto,sans-serif;height:100vh;display:flex;align-items:center;justify-content:center">
    <div style="max-width:900px;text-align:center;padding:40px"><div style="font-size:13px;letter-spacing:.2em;text-transform:uppercase;color:#af7c00;margin-bottom:18px">Legal Connect · RBAC multi-tenant · STAGING</div>
    <div style="font-family:Georgia,serif;font-size:44px;line-height:1.15;margin-bottom:20px">${esc(titulo)}</div>
    <div style="font-size:19px;line-height:1.5;color:#ded6c9">${esc(sub)}</div></div></body></html>`);
  await page.waitForTimeout(ms);
}

/** Painel de texto (substitui os provedores simulados do filme local). */
async function painel(page, titulo, corpoHtml, ms = 5000) {
  await page.setContent(`<!doctype html><html><body style="margin:0;background:#f7f4ee;color:#1c1917;font-family:-apple-system,'Segoe UI',Roboto,sans-serif;padding:36px">
    <div style="max-width:1080px;margin:0 auto">
      <div style="font-size:12px;letter-spacing:.18em;text-transform:uppercase;color:#8a6d1f;margin-bottom:10px">Chamada real às edge functions do staging</div>
      <h1 style="font-family:Georgia,serif;font-size:30px;margin:0 0 18px">${esc(titulo)}</h1>
      ${corpoHtml}
    </div>
    <style>pre{background:#fff;border:1px solid #e3ddd1;border-radius:10px;padding:14px;font-size:13px;white-space:pre-wrap;word-break:break-word}
    table{border-collapse:collapse;width:100%;background:#fff;border:1px solid #e3ddd1;border-radius:10px;overflow:hidden}
    th,td{padding:9px 12px;text-align:left;border-bottom:1px solid #eee7da;font-size:14px}th{background:#f0ebe0;font-size:12px;text-transform:uppercase;letter-spacing:.08em;color:#6b6a63}
    .ok{border-color:#86c79b}.erro{border-color:#e0a0a0}</style></body></html>`);
  await page.waitForTimeout(ms);
}

(async () => {
  // ---------- quem é quem no staging ----------
  const { data: canario } = await admin.from("escritorios").select("id, nome").eq("slug", "canario").single();
  if (!canario) throw new Error("escritório Canário ausente no staging — rode `node scripts/seed-local-rbac.mjs --staging`");
  const ESC2 = canario.id;
  const { data: esc1 } = await admin.from("escritorios").select("id, nome").eq("padrao_sistema", true).single();
  const ESC1 = esc1.id;

  const u = async (email) => (await admin.from("usuarios").select("id, nome, email").eq("email", `${email}@${DOM}`).single()).data;
  const carla = await u("canario+admin");
  const elisa = await u("canario+assistente");
  if (!carla || !elisa) throw new Error("contas do Canário ausentes — rode o seed com --staging");

  const clienteDe = async (nome) => (await admin.from("clientes").select("id, nome").eq("escritorio_id", ESC2).eq("nome", nome).single()).data;
  const casoDe = async (cli) => (await admin.from("casos").select("id").eq("cliente_id", cli.id).order("created_at", { ascending: false }).limit(1).single()).data;
  const kleber = await clienteDe("Kleber Antunes Siqueira");
  const helena = await clienteDe("Helena Bastos Ferraz");
  if (!kleber || !helena) throw new Error("clientes do seed ausentes no staging");
  const casoKleber = await casoDe(kleber);
  const casoHelena = await casoDe(helena);

  // estado a restaurar no fim
  const { data: cfgAntes } = await admin.from("escritorio_config").select("marca").eq("escritorio_id", ESC2).maybeSingle();
  const marcaAntes = cfgAntes?.marca ?? null;
  const paraLimpar = { documentos: [], tokens: [], integracoes: [], suportes: [], baixarMfa: [] };

  const estudio = await abrirEstudio(process.env.SAIDA || "lote-rbac-staging");
  const { still } = estudio;
  const sessoes = {};
  const parte = async (email, escritorio, comSessao = true) => {
    let st = { cookies: [], origins: [] };
    if (comSessao) {
      if (!sessoes[email]) sessoes[email] = await sessao(email);
      st = estadoNavegador(sessoes[email].session, escritorio);
    }
    const t0 = Date.now();
    const nova = await estudio.novaParte(st);
    inicioClipe.set(nova.page, { clipe: clipesAbertos++, t0 });
    return nova;
  };
  /**
   * Parte com uma sessão já elevada a AAL2 (o QG do staging exige código).
   * A sessão elevada fica guardada por pessoa: elevar de novo a mesma conta
   * derrubaria o autenticador anterior no meio do take.
   */
  const fortes = {};
  const parteForte = async (email, escritorio) => {
    if (!fortes[email]) {
      const s = await sessao(email);
      paraLimpar.baixarMfa.push(await elevarComTotp(s.sb));
      const { data } = await s.sb.auth.getSession();
      fortes[email] = data.session;
    }
    const data = { session: fortes[email] };
    const t0 = Date.now();
    const nova = await estudio.novaParte(estadoNavegador(data.session, escritorio));
    inicioClipe.set(nova.page, { clipe: clipesAbertos++, t0 });
    return nova;
  };
  const gravados = [];

  try {
    // ================= ABERTURA =================
    if (ato(0)) {
      const p = (await parte(null, null, false)).page;
      await cartao(p, "Lote RBAC multi-tenant — os 6 itens", "Gravado no STAGING: banco e edge functions do projeto de staging, com dois escritórios reais no mesmo sistema.", 5200);
      await cartao(p, "Capítulos", "1 Suporte aprovado pelo escritório · 2 Integrações por escritório · 3 Marca · 4 Segundo fator do QG · 5 Token do MCP para outra pessoa · 6 A tela só oferece o que o papel pode", 6000);
      await fechar(p);
      gravados.push("abertura");
    }

    // ================= ATO 1 — SUPORTE =================
    if (ato(1)) {
      const pQ = (await parteForte(`qg+suporte@${DOM}`, null)).page;
      await cartao(pQ, "1 · Suporte com aprovação do escritório", "A plataforma pede; só um administrador do escritório libera. Tudo fica na auditoria dele.");
      await pQ.goto(`${QG}/qg`);
      await pQ.getByRole("link", { name: /Canário/ }).first().waitFor({ timeout: 25000 });
      await narrar(pQ, "QG da plataforma, com a conta de suporte: só operação e contagens, nunca o conteúdo dos escritórios.");
      await still(pQ, "ato1-01-qg");
      await clicar(pQ, pQ.getByRole("link", { name: /Canário/ }).first());
      await pQ.getByRole("button", { name: "Pedir acesso de suporte" }).waitFor({ timeout: 20000 });
      await narrar(pQ, "Para olhar um caso do Canário, o suporte precisa PEDIR acesso, com motivo, ticket e prazo.");
      await clicar(pQ, pQ.getByRole("button", { name: "Pedir acesso de suporte" }));
      await digitar(pQ, pQ.locator("#acao-motivo"), `${MARCA} conferir tarefa que não aparece para a equipe`);
      await digitar(pQ, pQ.locator("#acao-ticket"), "T-2026");
      await still(pQ, "ato1-02-pedido");
      const dlg = pQ.getByRole("dialog");
      await clicar(pQ, dlg.locator("button").filter({ hasText: /\S/ }).filter({ hasNotText: /Cancelar|Close|Fechar/ }).last());
      await ler(pQ, 1500);
      await narrar(pQ, "Pedido feito. Enquanto o escritório não aprova, o suporte não vê nada.");
      await still(pQ, "ato1-03-pendente");
      await fechar(pQ);

      const pA = (await parte(`canario+admin@${DOM}`, ESC2)).page;
      await pA.goto(`${BASE}/tarefas`);
      await pA.locator("[data-aviso-suporte]").waitFor({ timeout: 25000 });
      await narrar(pA, "No Canário, a administradora Carla vê o aviso no topo assim que entra.");
      await still(pA, "ato1-04-aviso");
      await clicar(pA, pA.locator("[data-aviso-suporte]").getByRole("link", { name: "Ver pedido" }));
      await pA.locator('[data-secao="pendentes"] [data-pedido]').first().waitFor({ timeout: 20000 });
      await narrar(pA, "Configurações, aba Suporte: motivo, ticket e duração. Ela aprova.");
      await still(pA, "ato1-05-aba-suporte");
      await clicar(pA, pA.getByRole("button", { name: /Aprovar por/ }).first());
      await pA.locator('[data-secao="andamento"] [data-pedido]').first().waitFor({ timeout: 20000 });
      await narrar(pA, "Aprovado: sessão somente leitura, com prazo. O aviso do topo some.");
      await still(pA, "ato1-06-aprovado");

      await tentar("suporte lendo o canário", async () => {
        const pS = (await parteForte(`qg+suporte@${DOM}`, ESC2)).page;
        await pS.goto(`${BASE}/casos`);
        await pS.getByText(/Kleber|Joana|Helena/).first().waitFor({ timeout: 25000 });
        await narrar(pS, "Agora o suporte abre o sistema do Canário em modo suporte: lê, não altera. Cada tela aberta é registrada.");
        await still(pS, "ato1-07-suporte-lendo");
        await clicar(pS, pS.getByText("Kleber Antunes Siqueira").first());
        await ler(pS, 2500);
        await still(pS, "ato1-08-suporte-caso");
        await fechar(pS);
      });

      await pA.goto(`${BASE}/auditoria`);
      await pA.locator("[data-trilha-plataforma]").waitFor({ timeout: 25000 });
      await narrar(pA, "Auditoria do escritório: o pedido, quem aprovou e cada tela que o suporte abriu, com nome.");
      await deslizar(pA, pA.locator("[data-trilha-plataforma]"));
      await ler(pA, 3500);
      await still(pA, "ato1-09-auditoria");
      await pA.goto(`${BASE}/configuracoes?tab=suporte`);
      await pA.locator('[data-secao="andamento"] [data-pedido]').first().waitFor({ timeout: 20000 });
      await narrar(pA, "Terminou? A administradora encerra na hora, e o acesso do suporte cai imediatamente.");
      await clicar(pA, pA.getByRole("button", { name: "Encerrar agora" }).first());
      await pA.locator('[data-secao="historico"] [data-pedido]').first().waitFor({ timeout: 20000 });
      await ler(pA, 2500);
      await still(pA, "ato1-10-encerrado");
      await fechar(pA);
      gravados.push("ato1");
    }

    // ================= ATO 2 — INTEGRAÇÕES POR ESCRITÓRIO =================
    if (ato(2)) {
      const pAdv = (await parte(`canario+advogado@${DOM}`, ESC2)).page;
      await cartao(pAdv, "2 · Integrações por escritório", "Cada escritório traz a própria conta de Legalmail, Tramitação Inteligente e WhatsApp. A chave fica cifrada no banco e só a function a usa.");
      await pAdv.goto(`${BASE}/casos/${casoHelena.id}?tab=processos`);
      await pAdv.getByText(helena.nome).first().waitFor({ timeout: 25000 });
      await narrar(pAdv, "Antes de cadastrar: no caso do Canário não existe botão de buscar no Legalmail. A tela não oferece o que o escritório não tem.");
      await ler(pAdv, 2500);
      await still(pAdv, "ato2-01-sem-integracao");
      await fechar(pAdv);

      const p = (await parte(`canario+admin@${DOM}`, ESC2)).page;
      await p.goto(`${BASE}/configuracoes?tab=integracoes`);
      const lm = p.locator('[data-card-integracao="legalmail"]');
      await lm.waitFor({ timeout: 25000 });
      await deslizar(p, lm);
      await narrar(p, "Integrações do Canário: Legalmail e Tramitação Inteligente ainda não configurados.");
      await ler(p, 1500);
      await still(p, "ato2-02-cards");
      await narrar(p, "A administradora cadastra a conta do Legalmail. A chave é cifrada no servidor e nunca volta para a tela.");
      await digitar(p, p.locator("#legalmail-usuario"), "canario@exemplo.com.br");
      await digitar(p, p.locator("#legalmail-segredo"), "chave-de-demonstracao-nao-e-real");
      await clicar(p, lm.getByRole("button", { name: "Salvar" }));
      await lm.locator("[data-integracao-estado]").filter({ hasText: /ativo/i }).waitFor({ timeout: 20000 });
      paraLimpar.integracoes.push("legalmail");
      await still(p, "ato2-03-legalmail-salvo");
      await narrar(p, "Testar conexão fala com o Legalmail de verdade. Aqui a chave é de demonstração, então ele recusa: é assim que o escritório descobre chave errada.");
      await clicar(p, lm.getByRole("button", { name: /Testar conexão/ }));
      await lm.locator('[data-teste-integracao="legalmail"]').waitFor({ timeout: 30000 });
      await ler(p, 3000);
      await still(p, "ato2-04-legalmail-teste");
      await p.reload();
      await lm.waitFor({ timeout: 25000 });
      await deslizar(p, lm);
      await narrar(p, "Ao recarregar, o campo da chave volta vazio: o segredo fica no banco, cifrado, fora do alcance do navegador.");
      await ler(p, 2500);
      await still(p, "ato2-05-segredo-nao-volta");

      const wa = p.locator("[data-card-whatsapp]");
      await tentar("cartão do WhatsApp", async () => {
        await deslizar(p, wa);
        await narrar(p, "WhatsApp: a saída de mensagens sai por function, com a chave do escritório da linha, e segue pausada até ser retomada.");
        await ler(p, 2200);
        await still(p, "ato2-06-whatsapp");
      });
      await p.goto(`${BASE}/webhooks`);
      await p.locator('[data-em-breve="webhooks"]').waitFor({ timeout: 25000 });
      await narrar(p, "Webhooks ficou Em breve: a entrega era do n8n, que saiu das rotinas, e volta por function.");
      await ler(p, 2000);
      await still(p, "ato2-07-webhooks");
      await fechar(p);

      const pAdv2 = (await parte(`canario+advogado@${DOM}`, ESC2)).page;
      await pAdv2.goto(`${BASE}/casos/${casoHelena.id}?tab=processos`);
      await pAdv2.locator('[title*="Legalmail"]').first().waitFor({ timeout: 25000 });
      await narrar(pAdv2, "Com a integração cadastrada, o botão aparece no mesmo caso. Quem decide é o escritório, não a pessoa.");
      await deslizar(pAdv2, pAdv2.locator('[title*="Legalmail"]').first());
      await ler(pAdv2, 3000);
      await still(pAdv2, "ato2-08-botao-aparece");
      await fechar(pAdv2);
      gravados.push("ato2");
    }

    // ================= ATO 3 — MARCA =================
    if (ato(3)) {
      const pL = (await parte(null, null, false)).page;
      await cartao(pL, "3 · Marca do produto × marca do escritório", "Legal Connect onde não há escritório: login, favicon, QG e rodapé. A marca do escritório ativo no topo, nos e-mails e nas mensagens.");
      await pL.goto(`${BASE}/login`);
      await pL.getByRole("button", { name: "Entrar", exact: true }).waitFor({ timeout: 25000 });
      await narrar(pL, "Login: marca Legal Connect. Aqui ninguém está em escritório nenhum.");
      await ler(pL, 2000);
      await still(pL, "ato3-01-login");
      await fechar(pL);

      const p = (await parte(`canario+admin@${DOM}`, ESC2)).page;
      await p.goto(`${BASE}/configuracoes?tab=escritorio`);
      const card = p.locator("[data-card-marca]");
      await card.waitFor({ timeout: 25000 });
      await narrar(p, "Configurações, aba Escritório: nome de exibição, cor e logo. A prévia mostra como fica no topo.");
      await ler(p, 2000);
      await still(p, "ato3-02-marca-antes");
      await digitar(p, p.locator("#marca-nome"), "Canário Advocacia & Associados");
      await digitar(p, p.locator("#marca-cor"), "#b45309");
      await ler(p, 1200);
      await clicar(p, card.getByRole("button", { name: "Salvar" }).first());
      await ler(p, 2500);
      await narrar(p, "Salvou. O nome novo já vale no topo, nos e-mails e nas mensagens, para todo mundo do Canário e só do Canário.");
      await still(p, "ato3-03-marca-depois");
      await fechar(p);

      const pM = (await parte(`e2e+admin@${DOM}`, ESC1)).page;
      await pM.goto(`${BASE}/tarefas`);
      await pM.locator('[data-marca-escritorio]').first().waitFor({ timeout: 25000 }).catch(() => {});
      await narrar(pM, "No outro escritório do mesmo sistema, o topo é o dele. Nada do Canário aparece aqui.");
      await ler(pM, 3000);
      await still(pM, "ato3-04-outro-escritorio");
      await fechar(pM);
      gravados.push("ato3");
    }

    // ================= ATO 4 — SEGUNDO FATOR DO QG =================
    if (ato(4)) {
      const dono = await sessao(`qg+dono@${DOM}`);
      const t0 = Date.now();
      const pq = (await estudio.novaParte(estadoNavegador(dono.session, null))).page;
      inicioClipe.set(pq, { clipe: clipesAbertos++, t0 });
      await cartao(pq, "4 · O QG exige verificação em duas etapas", "A exigência mora no banco (app_config.qg_exigir_aal2), conferida por cada função do QG. A tela só mostra o que o banco já decidiu.");
      await pq.goto(`${QG}/qg`);
      await pq.getByText(/exige verificação em duas etapas/).waitFor({ timeout: 25000 });
      await narrar(pq, "Sessão de senha não basta: o QG para aqui e oferece o cadastro do autenticador.");
      await ler(pq, 2500);
      await still(pq, "ato4-01-qg-exige");
      await pq.locator("[data-mfa-secret]").waitFor({ timeout: 25000 });
      const segredo = (await pq.locator("[data-mfa-secret]").innerText()).trim();
      await narrar(pq, "QR e chave para o aplicativo autenticador. O código de seis dígitos confirma o cadastro.");
      await still(pq, "ato4-02-qr");
      const codigo = await codigoNovo(segredo);
      await digitar(pq, pq.locator('[data-duas-etapas] input[inputmode="numeric"]'), codigo);
      await clicar(pq, pq.getByRole("button", { name: /Ativar e entrar/ }));
      await pq.getByRole("link", { name: /Canário/ }).first().waitFor({ timeout: 30000 });
      paraLimpar.baixarMfa.push(async () => {
        const { data } = await dono.sb.auth.mfa.listFactors();
        for (const f of data?.all ?? []) await dono.sb.auth.mfa.unenroll({ factorId: f.id }).catch(() => {});
      });
      await narrar(pq, "QG aberto em sessão forte. Os dois escritórios do staging aparecem com suas contagens, nunca com o conteúdo.");
      await ler(pq, 3500);
      await still(pq, "ato4-03-qg-aberto");
      await fechar(pq);
      gravados.push("ato4");
    }

    // ================= ATO 5 — TOKEN DO MCP PARA OUTRA PESSOA =================
    if (ato(5)) {
      const p = (await parte(`canario+admin@${DOM}`, ESC2)).page;
      await cartao(p, "5 · Token do MCP para outra pessoa", "O admin emite; o Claude da pessoa roda COMO ela e vê só o que ela vê. Dono e emissor veem e revogam.");
      await p.goto(`${BASE}/configuracoes?tab=integracoes`);
      const sel = p.getByRole("combobox", { name: "Para quem emitir o token" });
      await sel.waitFor({ timeout: 25000 });
      await deslizar(p, sel);
      await narrar(p, "Conectar Claude: o campo Para quem lista as pessoas do Canário. Antes, o token só servia para quem o gerava.");
      await still(p, "ato5-01-card");
      await clicar(p, sel);
      await clicar(p, p.getByRole("option", { name: /Elisa/ }));
      await ler(p, 1000);
      await clicar(p, p.getByRole("button", { name: "Gerar token" }).first());
      await p.locator("[data-token-para]").waitFor({ timeout: 25000 });
      await narrar(p, "Token da Elisa, mostrado uma única vez, para ela colar no Claude dela.");
      await still(p, "ato5-02-token");
      const token = (await p.locator("[data-token-para]").locator("xpath=following::code[1]").innerText()).trim();

      await tentar("chamada real ao ia-mcp do staging", async () => {
        let seq = 0;
        const mcp = async (method, params, comToken = token) => {
          const r = await fetch(`${FN}/ia-mcp`, {
            method: "POST",
            headers: { Authorization: `Bearer ${comToken}`, apikey: ANON, "content-type": "application/json" },
            body: JSON.stringify({ jsonrpc: "2.0", id: ++seq, method, params }),
          });
          let json = null; const texto = await r.text();
          try { json = JSON.parse(texto); } catch { /* texto */ }
          return { status: r.status, json, texto };
        };
        const r = await mcp("tools/call", { name: "buscar_casos", arguments: { limite: 10 } });
        const bruto = r.json?.result?.content?.[0]?.text ?? r.texto;
        let lista = null;
        try { const j = JSON.parse(bruto); lista = Array.isArray(j) ? j : (j.casos ?? j.itens ?? j.resultados ?? null); } catch { /* texto livre */ }
        const tabela = Array.isArray(lista)
          ? `<table><tr><th>Cliente</th><th>Benefício</th><th>Fase</th></tr>${lista.map((c) => `<tr><td>${esc((c.cliente && typeof c.cliente === "object" ? c.cliente.nome : c.cliente) ?? c.cliente_nome ?? c.nome ?? "")}</td><td>${esc(c.tipo_beneficio ?? "")}</td><td>${esc(c.fase ?? c.status ?? "")}</td></tr>`).join("")}</table>`
          : `<pre>${esc(String(bruto).slice(0, 900))}</pre>`;
        await painel(p, "O token da Elisa chamando a function ia-mcp do staging",
          `<p style="font-size:15px;color:#57534e;margin:0 0 14px">Ferramenta <code>buscar_casos</code> · resposta HTTP ${r.status} · o servidor roda como a Elisa, no escritório do token.</p>${tabela}`, 6000);
        await narrar(p, "Chamada real à function do staging com o token da Elisa: voltam os casos do Canário que ela enxerga.");
        await still(p, "ato5-03-mcp-chamada");

        await p.goto(`${BASE}/configuracoes?tab=integracoes`);
        await p.locator("[data-token-dono]").first().waitFor({ timeout: 25000 });
        await deslizar(p, p.locator("[data-token-dono]").first());
        await narrar(p, "Na lista fica de quem é o token e quem emitiu. A dona e a emissora veem e revogam; outro admin, não.");
        await ler(p, 2500);
        await still(p, "ato5-04-lista");
        await clicar(p, p.getByRole("button", { name: "Revogar token" }).first());
        await tentar("confirmar revogação", async () => {
          const d = p.getByRole("dialog");
          await d.waitFor({ timeout: 3000 });
          await clicar(p, d.getByRole("button", { name: /Revogar|Confirmar/ }).last());
        });
        await ler(p, 2000);
        await still(p, "ato5-05-revogado");
        const depois = await mcp("tools/call", { name: "buscar_casos", arguments: { limite: 5 } });
        await painel(p, "A mesma chamada, depois de revogar",
          `<pre class="${depois.status === 401 ? "ok" : "erro"}">HTTP ${depois.status}\n${esc(depois.texto.slice(0, 300))}</pre>
           <p style="font-size:15px;color:#57534e">Revogado significa revogado: a próxima chamada é recusada pelo servidor, não pela tela.</p>`, 5500);
        await narrar(p, "Revogado, a mesma chamada volta recusada. Quem decide é o servidor.");
        await still(p, "ato5-06-revogado-401");
      });
      await fechar(p);
      gravados.push("ato5");
    }

    // ================= ATO 6 — TELAS POR PAPEL =================
    if (ato(6)) {
      const { data: doc } = await admin.from("documentos").insert({
        caso_id: casoKleber.id, escritorio_id: ESC2, tipo: "outro",
        nome_arquivo: `${MARCA} comprovante de residência.pdf`,
        storage_path: `filme/${casoKleber.id}/comprovante.pdf`,
      }).select("id").single();
      if (doc) paraLimpar.documentos.push(doc.id);

      const pF = (await parte(`canario+financeiro@${DOM}`, ESC2)).page;
      await cartao(pF, "6 · A tela só oferece o que o papel pode", "O banco já barrava; agora a tela não oferece o botão que ia falhar. Financeiro, assistente e advogado no mesmo caso.");
      await pF.goto(`${BASE}/casos/${casoKleber.id}`);
      await pF.getByText(kleber.nome).first().waitFor({ timeout: 25000 });
      await narrar(pF, "Fábio, do financeiro: sem menu de ações, sem telefone ou e-mail do cliente, sem a senha do INSS, e sem editar o cliente ou mexer nas etiquetas.");
      await ler(pF, 3000);
      await still(pF, "ato6-01-financeiro-caso");
      await pF.goto(`${BASE}/casos/${casoKleber.id}?tab=documentos`);
      await ler(pF, 2500);
      await narrar(pF, "Documentos: nem enviar, nem renomear, nem apagar.");
      await ler(pF, 2000);
      await still(pF, "ato6-02-financeiro-docs");
      await pF.goto(`${BASE}/comercial`);
      await pF.getByText("Área restrita a quem gerencia o comercial.").waitFor({ timeout: 20000 });
      await narrar(pF, "Comercial e Etiquetas fecham com aviso; Processos, Novo caso e Publicações devolvem para a lista de casos.");
      await ler(pF, 2000);
      await still(pF, "ato6-03-financeiro-comercial");
      await pF.goto(`${BASE}/processos`);
      await esperarRota(pF, ["/casos", "/tarefas"], "financeiro-processos");
      await ler(pF, 1500);
      await still(pF, "ato6-04-financeiro-processos");
      await fechar(pF);

      const pAs = (await parte(`canario+assistente@${DOM}`, ESC2)).page;
      await pAs.goto(`${BASE}/casos/${casoKleber.id}?tab=documentos`);
      await pAs.locator('[aria-label="Renomear documento"]').first().waitFor({ timeout: 25000 });
      await narrar(pAs, "Elisa, assistente: edita o caso, envia e renomeia documentos, mas a lixeira não aparece.");
      await deslizar(pAs, pAs.locator('[aria-label="Renomear documento"]').first());
      await ler(pAs, 3000);
      await still(pAs, "ato6-05-assistente-docs");
      await fechar(pAs);

      const pAd = (await parte(`canario+advogado@${DOM}`, ESC2)).page;
      await pAd.goto(`${BASE}/casos/${casoKleber.id}?tab=documentos`);
      await pAd.locator('[aria-label="Deletar documento"]').first().waitFor({ timeout: 25000 });
      await narrar(pAd, "Diego, advogado, no mesmo caso e no mesmo documento: a lixeira está lá. A diferença é a permissão do vínculo.");
      await deslizar(pAd, pAd.locator('[aria-label="Deletar documento"]').first());
      await ler(pAd, 3000);
      await still(pAd, "ato6-06-advogado-docs");
      await pAd.goto(`${BASE}/etiquetas`);
      await esperarRota(pAd, ["/etiquetas"], "advogado-etiquetas");
      await narrar(pAd, "Etiquetas e Comercial abrem para quem gerencia. Excluir cliente e parceiro, desde este lote, é só de admin.");
      await ler(pAd, 2500);
      await still(pAd, "ato6-07-advogado-etiquetas");
      await fechar(pAd);
      gravados.push("ato6");
    }

    // ================= FECHAMENTO =================
    if (ato(7)) {
      const p = (await parte(null, null, false)).page;
      await cartao(p, "Os 6 itens, no staging", "Suporte aprovado pelo escritório · Integrações por escritório · Marca · Segundo fator do QG · Token do MCP para outra pessoa · A tela só oferece o que o papel pode", 6500);
      await cartao(p, "O que ainda falta", "Merge do PR para a branch staging (leva o front novo ao domínio) e, depois da validação, a ida para produção.", 5500);
      await fechar(p);
      gravados.push("fechamento");
    }
  } finally {
    // ---------- limpeza: o staging volta como estava ----------
    const passo = async (rotulo, fn) => { try { await fn(); } catch (e) { console.log(`  limpeza ${rotulo}: ${e.message}`); } };
    for (const id of paraLimpar.documentos) await passo("documento", () => admin.from("documentos").delete().eq("id", id));
    await passo("tokens do filme", async () => {
      const { data } = await admin.from("ia_tokens").select("id").eq("usuario_id", elisa.id);
      for (const t of data ?? []) await admin.from("ia_tokens").delete().eq("id", t.id);
    });
    for (const tipo of paraLimpar.integracoes) {
      await passo(`integração ${tipo}`, () => admin.from("escritorio_integracoes").delete().eq("escritorio_id", ESC2).eq("tipo", tipo));
    }
    await passo("acessos de suporte do filme", async () => {
      const { data } = await admin.from("acessos_suporte").select("id, status").eq("escritorio_id", ESC2).in("status", ["pendente", "aprovado"]);
      for (const a of data ?? []) await admin.from("acessos_suporte").update({ status: "encerrado", fim: new Date().toISOString() }).eq("id", a.id);
    });
    if (marcaAntes) await passo("marca do Canário", () => admin.from("escritorio_config").update({ marca: marcaAntes, updated_at: new Date().toISOString() }).eq("escritorio_id", ESC2));
    for (const baixar of paraLimpar.baixarMfa) await passo("autenticador do filme", baixar);

    const clipes = await estudio.encerrar();
    fs.writeFileSync(path.join(estudio.saida, "legendas.json"), JSON.stringify({ legendas }, null, 2));
    console.log(`\natos gravados: ${gravados.join(", ") || "nenhum"}`);
    console.log(`clipes: ${clipes.length} em ${path.join(estudio.saida, "video")}`);
    console.log(`stills: ${path.join(estudio.saida, "stills")}`);
    console.log("legendas.json escrito (use e2e/demo/gerar-srt.cjs para o .srt)");
  }
})();

// Filme do lote RBAC (23/09) — os 6 itens, gravados no AMBIENTE LOCAL com os
// provedores externos simulados (e2e/demo/mocks/provedores.cjs):
//   Ato 1  Suporte: o QG pede, o admin do Canário aprova, o suporte lê, a
//          Auditoria registra, o admin encerra.
//   Ato 2  Integrações por escritório: WhatsApp (Evolution simulado: testar,
//          token, webhook), Gmail do INSS (consentimento simulado, e-mail vira
//          exigência no caso), DJEN (publicações do Comunica simulado).
//   Ato 3  Marca: Legal Connect no login; a marca do Canário no topo e no e-mail
//          ao parceiro (Resend simulado, caixa de entrada visível).
//   Ato 4  MFA: ativar no Canário, código no login; o QG exige duas etapas.
//   Ato 5  MCP: token emitido para a Gilda; o "Claude simulado" vê só os casos dela.
//   Ato 6  A tela só oferece o que o papel pode: financeiro, assistente, advogado.
//
// Pré-requisitos: `bun run local:rbac` feito; app em http://localhost:8080
// (`bun run dev:local`); mocks em http://localhost:8787
// (`node e2e/demo/mocks/provedores.cjs`); supabase/functions/.env com as
// variáveis *_BASE_URL apontando para host.docker.internal:8787 (pilha
// reiniciada depois). Rodar da raiz: `node e2e/demo/roteiros/lote-rbac-local.cjs`
// (ATOS=1,3 grava só esses atos; a limpeza roda sempre).
// Sessões via API, nunca digita senha. Limpa tudo no finally e roda o seed.

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");
const { ler, deslizar, clicar, tentar, narrar: narrarBase, abrirEstudio } = require("../helpers.cjs");
const { REPO, BASE, QG, MOCK, MOCK_DOCKER, DOM, FN, admin, sessao, estadoNavegador, fn, mock, esc, codigoNovo, esperarRota, fechar, digitar, cronSimulado, segredoSistemaLocal } = require("../local.cjs");
const { createHmac } = require("crypto");

// ---------- legendas (SRT): instante de cada narração, relativo ao clipe ----------
// Cada context Playwright = um clipe; o vídeo começa quando o context nasce.
const legendas = [];            // { clipe, inicio_ms, dur_ms, texto }
const inicioClipe = new WeakMap(); // page -> { clipe, t0 }
let clipesAbertos = 0;
async function narrar(page, texto, ms = 3200) {
  const c = inicioClipe.get(page);
  if (c) legendas.push({ clipe: c.clipe, inicio_ms: Date.now() - c.t0, dur_ms: ms, texto });
  return narrarBase(page, texto, ms);
}

const MARCA = "[Filme]";
const ATOS = (process.env.ATOS || "0,1,2,3,4,5,6,7").split(",")  // 8 = complemento n8n (ATOS=8 SAIDA=lote-rbac-n8n); 9 = complemento Legalmail/TI (ATOS=9 SAIDA=lote-rbac-legalmail-ti).map((s) => s.trim());
const ato = (n) => ATOS.includes(String(n));

// ---------- cartões de título (uma página em branco com o texto) ----------
async function cartao(page, titulo, sub, ms = 3800) {
  const c = inicioClipe.get(page);
  if (c) legendas.push({ clipe: c.clipe, inicio_ms: Date.now() - c.t0, dur_ms: ms, texto: `${titulo}. ${sub}` });
  await page.setContent(`<!doctype html><html><body style="margin:0;background:#16110c;color:#fcfaf6;font-family:-apple-system,'Segoe UI',Roboto,sans-serif;height:100vh;display:flex;align-items:center;justify-content:center">
    <div style="max-width:900px;text-align:center;padding:40px"><div style="font-size:13px;letter-spacing:.2em;text-transform:uppercase;color:#af7c00;margin-bottom:18px">Legal Connect · RBAC multi-tenant · ambiente local</div>
    <div style="font-family:Georgia,serif;font-size:44px;line-height:1.15;margin-bottom:20px">${esc(titulo)}</div>
    <div style="font-size:19px;line-height:1.5;color:#ded6c9">${esc(sub)}</div></div></body></html>`);
  await page.waitForTimeout(ms);
}
(async () => {
  const inicio = new Date().toISOString();
  // ----- quem é quem no Canário -----
  const { data: canario } = await admin.from("escritorios").select("id, nome").eq("slug", "canario").single();
  if (!canario) throw new Error("escritório canário ausente — rode `bun run local:rbac`");
  const ESC2 = canario.id;
  const { data: esc1 } = await admin.from("escritorios").select("id").eq("padrao_sistema", true).single();
  const ESC1 = esc1.id;
  const u = async (email) => (await admin.from("usuarios").select("id, nome, email, telefone").eq("email", `${email}@${DOM}`).single()).data;
  const carla = await u("canario+admin"), gilda = await u("canario+parceiro");
  const clienteDe = async (nome) => (await admin.from("clientes").select("id, nome, cpf").eq("escritorio_id", ESC2).eq("nome", nome).single()).data;
  const casoDe = async (cliente) => (await admin.from("casos").select("id").eq("cliente_id", cliente.id).order("created_at", { ascending: false }).limit(1).single()).data;
  const kleber = await clienteDe("Kleber Antunes Siqueira"), joana = await clienteDe("Joana Reis Camargo"), helena = await clienteDe("Helena Bastos Ferraz");
  if (!kleber || !joana || !helena) throw new Error("clientes do seed ausentes — rode `bun run local:rbac`");
  const casoKleber = await casoDe(kleber), casoJoana = await casoDe(joana), casoHelena = await casoDe(helena);
  const cpfFmt = (c) => (c || "").replace(/\D/g, "").replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, "$1.$2.$3-$4");
  const TEL_GILDA = "5511999990000";
  const CNJ = "5001234-56.2026.4.03.6183";

  const { data: cfgAntes } = await admin.from("escritorio_config").select("marca").eq("escritorio_id", ESC2).maybeSingle();
  const marcaAntes = cfgAntes?.marca ?? null;
  await mock("/_reset");
  await mock("/_config", { cliente_nome: joana.nome.toUpperCase(), cliente_cpf: cpfFmt(joana.cpf), oab_numero: "123456", oab_uf: "SP", processo_cnj: CNJ, gmail_email: "inss@canario-advocacia.com.br", msg_id: `mock-msg-${Date.now()}` });
  await admin.from("usuarios").update({ telefone: TEL_GILDA }).eq("id", gilda.id);

  const estudio = await abrirEstudio(process.env.SAIDA || "lote-rbac-local");
  const { still } = estudio;
  const sessoes = {};
  const parte = async (email, escritorio, comSessao = true) => {
    let st = { cookies: [], origins: [] };
    if (comSessao) {
      if (!sessoes[email]) sessoes[email] = await sessao(email);
      st = estadoNavegador(sessoes[email].session, escritorio);
    }
    const t0 = Date.now();
    const parteNova = await estudio.novaParte(st);
    inicioClipe.set(parteNova.page, { clipe: clipesAbertos++, t0 });
    return parteNova;
  };
  const cAdmin = await sessao(`canario+admin@${DOM}`, ESC2);
  const gravados = [];

  try {
    // ================= ABERTURA =================
    if (ato(0)) {
      const p = (await parte(null, null, false)).page;
      await cartao(p, "Lote RBAC multi-tenant — os 6 itens", "Gravado no ambiente local. Provedores externos (Evolution, Google, DJEN, Resend) simulados: se o provedor real responder no mesmo formato, o resultado é o mesmo.", 5000);
      await cartao(p, "Capítulos", "1 Suporte aprovado pelo escritório · 2 Integrações por escritório · 3 Marca · 4 Verificação em duas etapas · 5 Token do MCP para outra pessoa · 6 A tela só oferece o que o papel pode", 5500);
      await fechar(p);
      gravados.push("abertura");
    }

    // ================= ATO 1 — SUPORTE =================
    if (ato(1)) {
      const pQ = (await parte(`qg+suporte@${DOM}`, null)).page;
      await cartao(pQ, "1 · Suporte com aprovação do escritório", "A plataforma pede; só um administrador do escritório libera. Tudo fica na auditoria dele.");
      await pQ.goto(`${QG}/qg`);
      await pQ.getByRole("link", { name: /Canário/ }).first().waitFor({ timeout: 20000 });
      await narrar(pQ, "QG da plataforma, como a equipe de suporte: só operação e contagens, nunca o conteúdo dos escritórios.");
      await still(pQ, "ato1-01-qg");
      await clicar(pQ, pQ.getByRole("link", { name: /Canário/ }).first());
      await pQ.getByRole("button", { name: "Pedir acesso de suporte" }).waitFor({ timeout: 15000 });
      await narrar(pQ, "Para olhar um caso do Canário, o suporte precisa PEDIR acesso — com motivo, ticket e prazo.");
      await clicar(pQ, pQ.getByRole("button", { name: "Pedir acesso de suporte" }));
      await digitar(pQ, pQ.locator("#acao-motivo"), `${MARCA} conferir tarefa que não aparece para a equipe`);
      await digitar(pQ, pQ.locator("#acao-ticket"), "T-1042");
      await still(pQ, "ato1-02-pedido");
      const dlg = pQ.getByRole("dialog");
      // o X de fechar do Radix é o último botão do diálogo (texto "Close"): fica de fora
      await clicar(pQ, dlg.locator("button").filter({ hasText: /\S/ }).filter({ hasNotText: /Cancelar|Close|Fechar/ }).last());
      await ler(pQ, 1500);
      await narrar(pQ, "Pedido feito. Enquanto o escritório não aprova, o suporte não vê nada.");
      await still(pQ, "ato1-03-pendente");
      await fechar(pQ);

      const pA = (await parte(`canario+admin@${DOM}`, ESC2)).page;
      await pA.goto(`${BASE}/tarefas`);
      await pA.locator("[data-aviso-suporte]").waitFor({ timeout: 20000 });
      await narrar(pA, "No Canário, a administradora Carla vê o aviso no topo assim que entra.");
      await still(pA, "ato1-04-aviso");
      await clicar(pA, pA.locator("[data-aviso-suporte]").getByRole("link", { name: "Ver pedido" }));
      await pA.locator('[data-secao="pendentes"] [data-pedido]').first().waitFor({ timeout: 15000 });
      await narrar(pA, "Configurações → Suporte: motivo, ticket e duração. Ela aprova por 1 hora.");
      await still(pA, "ato1-05-aba-suporte");
      await clicar(pA, pA.getByRole("button", { name: /Aprovar por/ }).first());
      await pA.locator('[data-secao="andamento"] [data-pedido]').first().waitFor({ timeout: 15000 });
      await narrar(pA, "Aprovado: sessão somente leitura, com prazo. O aviso do topo some.");
      await still(pA, "ato1-06-aprovado");

      await tentar("suporte lendo o canário", async () => {
        const pS = (await parte(`qg+suporte@${DOM}`, ESC2)).page;
        await pS.goto(`${BASE}/casos`);
        await pS.getByText(/Kleber|Joana|Helena/).first().waitFor({ timeout: 20000 });
        await narrar(pS, "Agora o suporte abre o sistema do Canário, em modo suporte: lê, não altera. Cada tela aberta é registrada.");
        await still(pS, "ato1-07-suporte-lendo");
        await clicar(pS, pS.getByText("Kleber Antunes Siqueira").first());
        await ler(pS, 2500);
        await still(pS, "ato1-08-suporte-caso");
        const sup = await sessao(`qg+suporte@${DOM}`, ESC2);
        await sup.sb.rpc("suporte_registrar", { p_recurso: "/casos", p_recurso_id: casoKleber.id });
        await fechar(pS);
      });

      await pA.goto(`${BASE}/auditoria`);
      await pA.locator("[data-trilha-plataforma]").waitFor({ timeout: 20000 });
      await narrar(pA, "Auditoria do escritório: o pedido, quem aprovou e cada tela que o suporte abriu — com nome.");
      await deslizar(pA, pA.locator("[data-trilha-plataforma]"));
      await ler(pA, 3500);
      await still(pA, "ato1-09-auditoria");
      await pA.goto(`${BASE}/configuracoes?tab=suporte`);
      await pA.locator('[data-secao="andamento"] [data-pedido]').first().waitFor({ timeout: 15000 });
      await narrar(pA, "Terminou? A administradora encerra na hora — o acesso do suporte cai imediatamente.");
      await clicar(pA, pA.getByRole("button", { name: "Encerrar agora" }).first());
      await pA.locator('[data-secao="historico"] [data-pedido]').first().waitFor({ timeout: 15000 });
      await ler(pA, 2500);
      await still(pA, "ato1-10-encerrado");
      await fechar(pA);
      gravados.push("ato1");
    }

    // ================= ATO 2 — INTEGRAÇÕES =================
    if (ato(2)) {
      const p = (await parte(`canario+admin@${DOM}`, ESC2)).page;
      await cartao(p, "2 · Integrações por escritório", "WhatsApp, caixa do INSS e DJEN: cada escritório configura o seu. Chaves cifradas no banco; provedores simulados nesta gravação.");
      await p.goto(`${BASE}/configuracoes?tab=integracoes`);
      const wa = p.locator("[data-card-whatsapp]");
      await wa.waitFor({ timeout: 20000 });
      await narrar(p, "WhatsApp do Canário: a URL do Evolution, a instância e a chave da API — a chave é cifrada e nunca volta para a tela.");
      await deslizar(p, wa);
      await digitar(p, p.locator("#wa-url"), `${MOCK_DOCKER}/evolution`);
      await digitar(p, p.locator("#wa-inst"), "canario");
      await digitar(p, p.locator("#wa-num"), "55 11 98888-0001");
      await digitar(p, p.locator("#wa-key"), "chave-evolution-canario");
      await still(p, "ato2-01-whatsapp-form");
      await clicar(p, wa.getByRole("button", { name: "Salvar" }).first());
      await ler(p, 1800);
      await narrar(p, "Testar: a function chama o Evolution com a chave decifrada e devolve o estado da instância.");
      await clicar(p, wa.getByRole("button", { name: /Testar/ }).first());
      await wa.locator("[data-teste-whatsapp]").waitFor({ timeout: 20000 });
      await ler(p, 2500);
      await still(p, "ato2-02-whatsapp-testado");
      await narrar(p, "O token de entrada protege o webhook: só chamadas com este token e desta instância entram.");
      await clicar(p, wa.getByRole("button", { name: /Gerar token/ }).first());
      await wa.locator("[data-webhook-url]").waitFor({ timeout: 15000 });
      await ler(p, 2500);
      await still(p, "ato2-03-webhook");
      const webhook = (await wa.locator("[data-webhook-url]").innerText()).trim();

      // webhook: mensagem da Gilda entra no Canário; instância errada é recusada
      await tentar("webhook do whatsapp", async () => {
        const corpo = { event: "messages.upsert", instance: "canario", data: { key: { remoteJid: `${TEL_GILDA}@s.whatsapp.net`, fromMe: false, id: `FILME${Date.now()}` }, message: { conversation: "Oi! A Helena me perguntou do prazo da perícia." }, messageType: "conversation" } };
        const r1 = await fetch(webhook, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(corpo) });
        const t1 = await r1.text();
        const r2 = await fetch(webhook, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...corpo, instance: "outra-instancia" }) });
        const t2 = await r2.text();
        const { data: msgs } = await admin.from("whatsapp_mensagens").select("telefone, direcao, conteudo, escritorio_id").eq("telefone", TEL_GILDA).order("created_at", { ascending: false }).limit(3);
        const linhas = (msgs ?? []).map((m) => `<tr><td>${esc(m.direcao)}</td><td>${esc(m.conteudo).slice(0, 80)}</td><td>${m.escritorio_id === ESC2 ? "Canário" : "outro"}</td></tr>`).join("");
        await mock("/painel/registrar", { titulo: `POST ${webhook.replace(/token=.*/, "token=•••")}  (instância canario, número da Gilda)`, html: `<pre class="${r1.ok ? "ok" : "erro"}">HTTP ${r1.status}\n${esc(t1.slice(0, 300))}</pre>` });
        await mock("/painel/registrar", { titulo: "Mesma chamada com instância \"outra-instancia\"", html: `<pre class="${r2.status === 401 ? "ok" : "erro"}">HTTP ${r2.status} — recusada\n${esc(t2.slice(0, 200))}</pre>` });
        await mock("/painel/registrar", { titulo: "Banco: whatsapp_mensagens (telefone da Gilda)", html: `<table><tr><th>direção</th><th>conteúdo</th><th>escritório</th></tr>${linhas || "<tr><td colspan=3>nenhuma</td></tr>"}</table>` });
        await p.goto(`${MOCK}/painel`);
        await narrar(p, "Uma mensagem da Gilda (parceira do Canário) chega pelo webhook: entra no escritório certo. Com outra instância, 401.");
        await ler(p, 4500);
        await still(p, "ato2-04-webhook-painel");
      });

      // Gmail do INSS
      await p.goto(`${BASE}/configuracoes?tab=integracoes`);
      const gm = p.locator("[data-card-gmail]");
      await gm.waitFor({ timeout: 20000 });
      await deslizar(p, gm);
      await narrar(p, "Caixa do INSS: cada escritório conecta o próprio Gmail. O consentimento do Google está simulado aqui.");
      await still(p, "ato2-05-gmail-antes");
      await clicar(p, gm.getByRole("button", { name: /Conectar Gmail/ }).first());
      await p.locator("#permitir").waitFor({ timeout: 20000 });
      await ler(p, 2500);
      await still(p, "ato2-06-consentimento");
      await clicar(p, p.locator("#permitir"));
      await p.waitForURL(/configuracoes/, { timeout: 20000 });
      console.log("  pós-callback:", p.url());
      await still(p, "ato2-06b-pos-callback");
      {
        const { data: caixas, error } = await admin.from("usuario_gmail_oauth").select("email_conectado, escritorio_id, connected_at").eq("escritorio_id", ESC2);
        console.log("  usuario_gmail_oauth:", JSON.stringify(caixas), error?.message ?? "");
      }
      await gm.getByText(/Conectado como/).waitFor({ timeout: 20000 });
      await deslizar(p, gm);
      await narrar(p, "Conectado: o refresh token fica cifrado, ligado ao Canário. Agora o robô lê a caixa e cria a exigência no caso.");
      await still(p, "ato2-07-gmail-conectado");
      await tentar("processar e-mail do INSS", async () => {
        const r = await fn("inss-email-processor", cAdmin.jwt, ESC2, { dias: 7, limite: 5 });
        console.log("  inss-email-processor:", r.status, (r.texto || "").slice(0, 700));
        await mock("/painel/registrar", { titulo: "inss-email-processor (caixa do Canário, Gmail simulado)", html: `<pre class="${r.status === 200 ? "ok" : "erro"}">HTTP ${r.status}\n${esc(JSON.stringify(r.json ?? r.texto, null, 2).slice(0, 900))}</pre>` });
        await p.goto(`${BASE}/casos/${casoJoana.id}?tab=atividades`);
        await p.getByText(joana.nome).first().waitFor({ timeout: 20000 });
        await narrar(p, "O e-mail \"alterado para EXIGÊNCIA\" da Joana virou andamento e tarefa no caso dela — no Canário.");
        await p.getByText(/EXIG[ÊE]NCIA|exig[êe]ncia/i).first().waitFor({ timeout: 15000 }).catch(() => {});
        await ler(p, 4000);
        await still(p, "ato2-08-inss-exigencia");
      });

      // DJEN
      await tentar("djen", async () => {
        await admin.from("oabs_monitoradas").insert({ numero: "123456", uf: "SP", tipo: "escritorio", ativo: true, observacao: MARCA, escritorio_id: ESC2 });
        await admin.from("processos_judiciais").insert({ caso_id: casoHelena.id, numero_processo: CNJ, vara: "3ª Vara Federal Previdenciária", comarca: "São Paulo", uf: "SP", escritorio_id: ESC2 });
        const r = await fn("sync-djen-publicacoes", cAdmin.jwt, ESC2, { dias: 3 });
        console.log("  sync-djen:", r.status, (r.texto || "").slice(0, 300));
        await mock("/painel/registrar", { titulo: "sync-djen-publicacoes (OAB 123456/SP do Canário, Comunica simulado)", html: `<pre class="${r.status === 200 ? "ok" : "erro"}">HTTP ${r.status}\n${esc(JSON.stringify(r.json ?? r.texto, null, 2).slice(0, 900))}</pre>` });
        await p.goto(`${BASE}/publicacoes`);
        await p.getByText(/Vinculada|Sem processo/).first().waitFor({ timeout: 20000 });
        await narrar(p, "Publicações do DJEN da OAB do Canário: uma casou com o processo da Helena; a outra ficou órfã, para vincular.");
        await ler(p, 4000);
        await still(p, "ato2-09-publicacoes");
      });

      await tentar("isolamento no escritório 1", async () => {
        const p1 = (await parte(`e2e+admin@${DOM}`, ESC1)).page;
        await p1.goto(`${BASE}/configuracoes?tab=integracoes`);
        await p1.locator("[data-card-whatsapp]").waitFor({ timeout: 20000 });
        await narrar(p1, "No escritório 1 nada disso existe: integrações são por escritório.");
        await deslizar(p1, p1.locator("[data-card-whatsapp]"));
        await ler(p1, 2500);
        await still(p1, "ato2-10-isolamento");
        await fechar(p1);
      });
      await fechar(p);
      gravados.push("ato2");
    }

    // ================= ATO 3 — MARCA =================
    if (ato(3)) {
      const pL = (await parte(null, null, false)).page;
      await cartao(pL, "3 · Marca do produto × marca do escritório", "Legal Connect onde não há escritório (login, QG, rodapé). A marca do escritório ativo no topo, nos e-mails e nas mensagens.");
      await pL.goto(`${BASE}/login`);
      await pL.getByRole("button", { name: "Entrar", exact: true }).waitFor({ timeout: 20000 });
      await narrar(pL, "Login: marca Legal Connect — aqui ninguém está em escritório nenhum.");
      await still(pL, "ato3-01-login");
      await fechar(pL);

      const p = (await parte(`canario+admin@${DOM}`, ESC2)).page;
      await p.goto(`${BASE}/configuracoes?tab=escritorio`);
      const card = p.locator("[data-card-marca]");
      await card.waitFor({ timeout: 20000 });
      await narrar(p, "Configurações → Escritório: nome de exibição, cor e logo. A prévia mostra como fica no topo.");
      await still(p, "ato3-02-marca-antes");
      await digitar(p, p.locator("#marca-nome"), "Canário Advocacia & Associados");
      await digitar(p, p.locator("#marca-cor"), "#b45309");
      await ler(p, 1200);
      await clicar(p, card.getByRole("button", { name: "Salvar" }).first());
      await ler(p, 2500);
      await narrar(p, "Salvou. Com logo cadastrado, o topo mostra o logo; o nome novo já vale nos e-mails e nas mensagens.");
      await still(p, "ato3-03-marca-depois");
      await clicar(p, card.getByRole("button", { name: "Remover logo" }).first());
      await p.locator('[data-marca-escritorio="nome"]').filter({ hasText: /Associados/ }).first().waitFor({ timeout: 15000 }).catch(async () => { await p.reload(); await card.waitFor({ timeout: 20000 }); });
      await ler(p, 1500);
      await narrar(p, "Sem logo, o topo passa a mostrar o nome em texto, na cor escolhida — para todo mundo do Canário, e só do Canário.");
      await still(p, "ato3-03b-marca-sem-logo");

      await tentar("e-mail com a marca", async () => {
        const { data: and } = await admin.from("andamentos").insert({ caso_id: casoHelena.id, origem: "interno", titulo: `${MARCA} Perícia médica agendada`, descricao: "Perícia marcada para 14/10 às 9h, na agência Santo Amaro. Levar documento com foto e os laudos.", visivel_parceiro: true, data_evento: new Date().toISOString().slice(0, 10) }).select("id").single();
        if (!and) throw new Error("andamento não criado");
        const r = await fn("notify-novo-andamento", cAdmin.jwt, ESC2, { andamento_id: and.id });
        await mock("/painel/registrar", { titulo: "notify-novo-andamento → Resend simulado", html: `<pre class="${r.status === 200 ? "ok" : "erro"}">HTTP ${r.status}\n${esc(r.texto.slice(0, 400))}</pre>` });
        await p.goto(`${MOCK}/inbox`);
        await p.getByText(/Perícia médica agendada/).first().waitFor({ timeout: 20000 });
        await narrar(p, "O e-mail para a parceira Gilda sai com a marca do Canário — remetente, cabeçalho e cor. Caixa de entrada simulada.");
        await ler(p, 5000);
        await still(p, "ato3-04-email");
      });
      await fechar(p);
      gravados.push("ato3");
    }

    // ================= ATO 4 — MFA =================
    if (ato(4)) {
      const p = (await parte(`canario+admin@${DOM}`, ESC2)).page;
      await cartao(p, "4 · Verificação em duas etapas", "Quem ativa passa a digitar o código do autenticador no login. O QG pode exigir para todo mundo.");
      await p.goto(`${BASE}/configuracoes?tab=seguranca`);
      const card = p.locator("[data-card-duas-etapas]");
      await card.waitFor({ timeout: 20000 });
      await deslizar(p, card);
      await narrar(p, "Configurações → Segurança: ativar a verificação em duas etapas.");
      await still(p, "ato4-01-seguranca");
      await clicar(p, card.getByRole("button", { name: /Ativar/ }).first());
      await p.locator("[data-mfa-secret]").waitFor({ timeout: 20000 });
      const segredo = (await p.locator("[data-mfa-secret]").innerText()).trim();
      await narrar(p, "QR e chave para o aplicativo autenticador. O código de 6 dígitos confirma o cadastro.");
      await still(p, "ato4-02-qr");
      const codigo = await codigoNovo(segredo);
      await digitar(p, p.locator('[data-duas-etapas] input[inputmode="numeric"]'), codigo);
      await clicar(p, p.getByRole("button", { name: /Ativar verificação/ }));
      await p.locator('[data-mfa-status="ativa"]').waitFor({ timeout: 20000 });
      await narrar(p, "Ativa. A partir de agora o login pede o código.");
      await still(p, "ato4-03-ativa");
      await fechar(p);

      await tentar("login com código", async () => {
        const nova = await sessao(`canario+admin@${DOM}`);
        const t0l = Date.now();
        const pl = (await estudio.novaParte(estadoNavegador(nova.session, ESC2))).page;
        inicioClipe.set(pl, { clipe: clipesAbertos++, t0: t0l });
        await pl.goto(`${BASE}/login`);
        await pl.locator("[data-login-mfa]").waitFor({ timeout: 20000 });
        await narrar(pl, "Depois da senha, a sessão fica \"meio aberta\" até o código certo.");
        await still(pl, "ato4-04-login-codigo");
        const c2 = await codigoNovo(segredo);
        await digitar(pl, pl.locator('[data-login-mfa] input[inputmode="numeric"]'), c2);
        await clicar(pl, pl.locator("[data-login-mfa]").getByRole("button", { name: "Entrar", exact: true }));
        await pl.waitForURL(/\/(casos|tarefas)/, { timeout: 20000 }).catch(async (e) => { await still(pl, "ato4-04b-falha-codigo"); console.log("  login-mfa url:", pl.url(), "| toasts:", await pl.locator("[data-sonner-toast]").allInnerTexts().catch(() => [])); throw e; });
        await narrar(pl, "Entrou. Sem o código, nada abre.");
        await still(pl, "ato4-05-entrou");
        await fechar(pl);
      });

      await tentar("QG exige AAL2", async () => {
        await admin.from("app_config").upsert({ chave: "qg_exigir_aal2", valor: "true" }, { onConflict: "chave" });
        const dono = await sessao(`qg+dono@${DOM}`);
        const t0q = Date.now();
        const pq = (await estudio.novaParte(estadoNavegador(dono.session, null))).page;
        inicioClipe.set(pq, { clipe: clipesAbertos++, t0: t0q });
        await pq.goto(`${QG}/qg`);
        await pq.getByText(/exige verificação em duas etapas/).waitFor({ timeout: 20000 });
        await narrar(pq, "Com qg_exigir_aal2 ligado, o QG só abre com o código — quem não tem autenticador cadastra ali mesmo.");
        await still(pq, "ato4-06-qg-exige");
        await pq.locator("[data-mfa-secret]").waitFor({ timeout: 20000 });
        const s2 = (await pq.locator("[data-mfa-secret]").innerText()).trim();
        const c3 = await codigoNovo(s2);
        await digitar(pq, pq.locator('[data-duas-etapas] input[inputmode="numeric"]'), c3);
        await clicar(pq, pq.getByRole("button", { name: /Ativar e entrar/ }));
        await pq.getByRole("link", { name: /Canário/ }).first().waitFor({ timeout: 25000 });
        await narrar(pq, "QG aberto em sessão forte (AAL2). O banco confere o nível da sessão, não só a tela.");
        await still(pq, "ato4-07-qg-aal2");
        await fechar(pq);
      });
      gravados.push("ato4");
    }

    // ================= ATO 5 — MCP =================
    if (ato(5)) {
      const p = (await parte(`canario+admin@${DOM}`, ESC2)).page;
      await cartao(p, "5 · Token do MCP para outra pessoa", "O admin emite o token; o Claude da pessoa roda COMO ela e vê só o que ela vê. Dono e emissor veem e revogam.");
      await p.goto(`${BASE}/configuracoes?tab=integracoes`);
      const sel = p.getByRole("combobox", { name: "Para quem emitir o token" });
      await sel.waitFor({ timeout: 20000 });
      await deslizar(p, sel);
      await narrar(p, "Conectar Claude: o campo \"Para quem\" lista as pessoas do Canário.");
      await still(p, "ato5-01-card");
      await clicar(p, sel);
      await clicar(p, p.getByRole("option", { name: /Gilda/ }));
      await ler(p, 1000);
      await clicar(p, p.getByRole("button", { name: "Gerar token" }).first());
      await p.locator("[data-token-para]").waitFor({ timeout: 20000 });
      await narrar(p, "Token da Gilda, mostrado uma única vez: a Carla envia para ela colar no Claude.");
      await still(p, "ato5-02-token");
      const token = (await p.locator("[data-token-para]").locator("xpath=following::code[1]").innerText()).trim();

      await tentar("claude simulado", async () => {
        let seq = 0;
        const mcp = async (method, params) => (await fetch(`${FN}/ia-mcp`, { method: "POST", headers: { Authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: ++seq, method, params }) })).json();
        const r = await mcp("tools/call", { name: "buscar_casos", arguments: { limite: 10 } });
        const texto = r?.result?.content?.[0]?.text ?? JSON.stringify(r);
        let lista = null;
        try { const j = JSON.parse(texto); lista = Array.isArray(j) ? j : (j.casos ?? j.itens ?? j.resultados ?? null); } catch { /* texto livre */ }
        const tabela = Array.isArray(lista)
          ? `<table><tr><th>Cliente</th><th>Benefício</th><th>Fase</th></tr>${lista.map((c) => `<tr><td>${esc((c.cliente && typeof c.cliente === "object" ? c.cliente.nome : c.cliente) ?? c.cliente_nome ?? c.nome ?? "")}</td><td>${esc(c.tipo_beneficio ?? "")}</td><td>${esc(c.fase ?? c.status ?? "")}</td></tr>`).join("")}</table>`
          : `<pre>${esc(texto.slice(0, 1200))}</pre>`;
        await mock("/claude/registrar", { papel: "eu", texto: "Quais casos meus estão em andamento no Canário?" });
        await mock("/claude/registrar", { papel: "claude", html: `Consultei o conector <code>Legal Connect</code> (buscar_casos) com o seu token:${tabela}<p style="margin:10px 0 0;color:#6b6a63;font-size:13px">Só os casos que você indicou aparecem — o token roda como você, e o servidor registra que foi emitido pela Carla.</p>` });
        await p.goto(`${MOCK}/claude`);
        await p.getByText(/Consultei o conector/).waitFor({ timeout: 15000 });
        await narrar(p, "O Claude da Gilda (simulado) usa o token: só Helena e Ivo, os casos dela. Nunca Joana ou Kleber.");
        await ler(p, 5500);
        await still(p, "ato5-03-claude");
      });

      await p.goto(`${BASE}/configuracoes?tab=integracoes`);
      await p.locator("[data-token-dono]").first().waitFor({ timeout: 20000 });
      await deslizar(p, p.locator("[data-token-dono]").first());
      await narrar(p, "Na lista: \"de Gilda Moura\". A Carla (emissora) e a Gilda (dona) veem e revogam; outro admin, não.");
      await still(p, "ato5-04-lista");
      await clicar(p, p.getByRole("button", { name: "Revogar token" }).first());
      await tentar("confirmar revogação", async () => { const d = p.getByRole("dialog"); await d.waitFor({ timeout: 3000 }); await clicar(p, d.getByRole("button", { name: /Revogar|Confirmar/ }).last()); });
      await ler(p, 2000);
      await narrar(p, "Revogado: a próxima chamada do Claude recebe 401.");
      await still(p, "ato5-05-revogado");
      await fechar(p);
      gravados.push("ato5");
    }

    // ================= ATO 6 — TELAS POR PAPEL =================
    if (ato(6)) {
      await admin.from("documentos").insert({ caso_id: casoKleber.id, escritorio_id: ESC2, tipo: "outro", nome_arquivo: `${MARCA} comprovante de residência.pdf`, storage_path: `filme/${casoKleber.id}/comprovante.pdf` });
      const pF = (await parte(`canario+financeiro@${DOM}`, ESC2)).page;
      await cartao(pF, "6 · A tela só oferece o que o papel pode", "O banco já barrava; agora a tela não oferece o botão que ia falhar. Financeiro, assistente e advogado no mesmo caso.");
      await pF.goto(`${BASE}/casos/${casoKleber.id}`);
      await pF.getByText(kleber.nome).first().waitFor({ timeout: 20000 });
      await narrar(pF, "Fábio, financeiro (só lê casos e repasses): sem menu de ações, sem telefone ou e-mail, sem a senha do INSS.");
      await ler(pF, 2500);
      await still(pF, "ato6-01-financeiro-caso");
      await pF.goto(`${BASE}/casos/${casoKleber.id}?tab=documentos`);
      await pF.getByText(/comprovante de resid/).first().waitFor({ timeout: 15000 }).catch(() => {});
      await narrar(pF, "Documentos: nem enviar, nem renomear, nem apagar.");
      await ler(pF, 2000);
      await still(pF, "ato6-02-financeiro-docs");
      await pF.goto(`${BASE}/comercial`);
      await pF.getByText("Área restrita a quem gerencia o comercial.").waitFor({ timeout: 15000 });
      await narrar(pF, "Comercial e Etiquetas fecham; Processos, Novo caso, Publicações e Parceiros devolvem para a lista de casos.");
      await still(pF, "ato6-03-financeiro-comercial");
      await pF.goto(`${BASE}/processos`);
      await esperarRota(pF, ["/casos", "/tarefas"], "financeiro-processos", 15000, path.join(estudio.saida, "stills"));
      await ler(pF, 1500);
      await pF.goto(`${BASE}/agenda`);
      await pF.getByRole("heading", { level: 1 }).waitFor({ timeout: 15000 });
      await narrar(pF, "Agenda abre para consulta — sem o botão \"Novo evento\".");
      await ler(pF, 2000);
      await still(pF, "ato6-04-financeiro-agenda");
      await fechar(pF);

      const pAs = (await parte(`canario+assistente@${DOM}`, ESC2)).page;
      await pAs.goto(`${BASE}/casos/${casoKleber.id}?tab=documentos`);
      await pAs.locator('[aria-label="Renomear documento"]').first().waitFor({ timeout: 20000 });
      await narrar(pAs, "Elisa, assistente: edita o caso, envia e renomeia documentos — mas a lixeira não aparece (apagar é de advogado e admin).");
      await deslizar(pAs, pAs.locator('[aria-label="Renomear documento"]').first());
      await ler(pAs, 3000);
      await still(pAs, "ato6-05-assistente-docs");
      await fechar(pAs);

      const pAd = (await parte(`canario+advogado@${DOM}`, ESC2)).page;
      await pAd.goto(`${BASE}/casos/${casoKleber.id}?tab=documentos`);
      await pAd.locator('[aria-label="Deletar documento"]').first().waitFor({ timeout: 20000 });
      await narrar(pAd, "Diego, advogado, no mesmo caso: a lixeira está lá. O gate vem da permissão do vínculo, não da tela.");
      await deslizar(pAd, pAd.locator('[aria-label="Deletar documento"]').first());
      await ler(pAd, 3000);
      await still(pAd, "ato6-06-advogado-docs");
      await pAd.goto(`${BASE}/etiquetas`);
      await esperarRota(pAd, ["/etiquetas"], "advogado-etiquetas", 15000, path.join(estudio.saida, "stills"));
      await narrar(pAd, "Etiquetas e Comercial abrem para quem gerencia.");
      await ler(pAd, 2000);
      await still(pAd, "ato6-07-advogado-etiquetas");
      await fechar(pAd);
      gravados.push("ato6");
    }

    // ================= ATO 8 — COMPLEMENTO: n8n FORA DAS ROTINAS =================
    if (ato(8)) {
      const p = (await parte(`canario+admin@${DOM}`, ESC2)).page;
      await cartao(p, "Complemento · n8n fora das rotinas", "Decisão de 23/09: nenhuma rotina do sistema passa pelo n8n. O DJEN vai para o pg_cron; Webhooks e envio de WhatsApp ficam \"Em breve\" até voltarem por function. O n8n continua instalado, sem rotina.", 6000);
      await p.goto(`${BASE}/webhooks`);
      await p.locator('[data-em-breve="webhooks"]').waitFor({ timeout: 20000 });
      await narrar(p, "Webhooks: o endereço antigo ainda abre a aba, mas o módulo não é oferecido — \"Em breve\". A entrega era do n8n; volta por function.");
      await ler(p, 1500);
      await still(p, "ato8-01-webhooks");
      await p.goto(`${BASE}/configuracoes?tab=integracoes`);
      const wa = p.locator("[data-card-whatsapp]");
      await wa.waitFor({ timeout: 20000 });
      await deslizar(p, wa);
      await narrar(p, "WhatsApp: o envio de mensagens pelo sistema também fica \"Em breve\". A entrada pelo webhook e o teste da conexão continuam.");
      await ler(p, 1500);
      await still(p, "ato8-02-whatsapp");
      await tentar("cron simulado do DJEN", async () => {
        await mock("/painel/limpar");
        const segredo = segredoSistemaLocal();
        const ts = Math.floor(Date.now() / 1000).toString();
        const hmac = createHmac("sha256", segredo).update(`n8n:djen-sync.${ts}`).digest("hex");
        const velho = await fetch(`${FN}/sync-djen-publicacoes`, { method: "POST", headers: { "content-type": "application/json", "x-msc-assinatura": `${ts}.${hmac}` }, body: JSON.stringify({ dias: 1, dry_run: true }) });
        await mock("/painel/registrar", { titulo: "Identidade antiga (n8n:djen-sync) chamando a function", html: `<pre class="${velho.status === 401 ? "ok" : "erro"}">HTTP ${velho.status} — ${esc((await velho.text()).slice(0, 120))}</pre>` });
        await admin.from("oabs_monitoradas").insert({ numero: "123456", uf: "SP", tipo: "escritorio", ativo: true, observacao: MARCA, escritorio_id: ESC2 });
        await admin.from("processos_judiciais").insert({ caso_id: casoHelena.id, numero_processo: CNJ, vara: "3ª Vara Federal Previdenciária", comarca: "São Paulo", uf: "SP", escritorio_id: ESC2 });
        const r = await cronSimulado("cron:djen-sync", "sync-djen-publicacoes", { dias: 2 });
        const doCanario = (r.json?.escritorios ?? []).find((e) => e.escritorio_id === ESC2) ?? {};
        await mock("/painel/registrar", { titulo: "Cron simulado — o comando que o pg_cron executa em produção (aqui, function local + Comunica simulado)", html: `<pre>${esc(r.comando)}</pre>` });
        await mock("/painel/registrar", { titulo: `O que o pg_net recebeu de volta (net._http_response #${r.id})`, html: `<pre class="${r.status === 200 ? "ok" : "erro"}">HTTP ${r.status}\n${esc(JSON.stringify({ escritorio: "Canário", ...doCanario }, null, 2).slice(0, 900))}</pre>` });
        await p.goto(`${MOCK}/painel`);
        await narrar(p, "A identidade antiga do n8n recebe 401. O cron simulado roda o mesmo SQL do pg_cron: pg_net chama a function com a assinatura de sistema, e a function busca o DJEN.");
        await ler(p, 5000);
        await still(p, "ato8-03-cron-painel");
        await p.goto(`${BASE}/publicacoes`);
        await p.getByText(/Vinculada|Sem processo/).first().waitFor({ timeout: 20000 });
        await narrar(p, "As publicações chegaram pelo caminho do cron — sem n8n no meio. Em produção: aplicar a migration e desligar o workflow antigo.");
        await ler(p, 4000);
        await still(p, "ato8-04-publicacoes");
      });
      await cartao(p, "No release", "Aplicar migration_cron_djen em produção (job msc-djen-sync, 07:00 de Brasília) e desligar o workflow djen-sync no n8n. Webhooks e envio de WhatsApp voltam por function, quando forem retomados.", 5500);
      await fechar(p);
      gravados.push("ato8");
    }

    // ================= ATO 9 — COMPLEMENTO: LEGALMAIL E TI POR ESCRITÓRIO =================
    // Um context por vez (cada um fechado antes do próximo): os clipes saem na
    // ordem da história e sem tela parada.
    if (ato(9)) {
      await admin.from("escritorio_integracoes").delete().eq("escritorio_id", ESC2).in("tipo", ["legalmail", "ti"]);
      // 1) advogado, antes da credencial
      let pa = (await parte(`canario+advogado@${DOM}`, ESC2)).page;
      await cartao(pa, "Complemento · Legalmail e TI por escritório", "Antes, qualquer escritório buscava na conta da Mara. Agora cada escritório cadastra a própria credencial; sem ela, a tela nem oferece o botão e a function recusa.", 6000);
      await pa.goto(`${BASE}/casos/${casoHelena.id}?tab=processos`);
      await pa.getByRole("tab", { name: /Processos/ }).waitFor({ timeout: 20000 });
      await narrar(pa, "Para o advogado, o caso da Helena não oferece \"Buscar no Legalmail\": ainda não há credencial neste escritório.");
      await ler(pa, 2000);
      await still(pa, "ato9-01-sem-botao");
      await fechar(pa);
      // 2) admin cadastra
      const p = (await parte(`canario+admin@${DOM}`, ESC2)).page;
      await p.goto(`${BASE}/configuracoes?tab=integracoes`);
      const lm = p.locator('[data-card-integracao="legalmail"]');
      await lm.waitFor({ timeout: 20000 });
      await deslizar(p, lm);
      await narrar(p, "Integrações do Canário: Legalmail e Tramitação Inteligente ainda não configurados.");
      await ler(p, 1500);
      await still(p, "ato9-02-cards");
      await narrar(p, "A administradora cadastra a conta do Legalmail. A chave é cifrada no servidor e testada contra o provedor (aqui, simulado).");
      await digitar(p, p.locator("#legalmail-usuario"), "canario@exemplo.com.br");
      await digitar(p, p.locator("#legalmail-segredo"), "chave-legalmail-canario");
      await clicar(p, lm.getByRole("button", { name: "Salvar" }));
      await lm.locator("[data-integracao-estado]").filter({ hasText: /ativo/ }).waitFor({ timeout: 15000 });
      await clicar(p, lm.getByRole("button", { name: /Testar conexão/ }));
      await lm.locator('[data-teste-integracao="legalmail"]').waitFor({ timeout: 20000 });
      await ler(p, 2000);
      await still(p, "ato9-03-legalmail-salvo");
      const ti = p.locator('[data-card-integracao="ti"]');
      await deslizar(p, ti);
      await narrar(p, "O mesmo para o Tramitação Inteligente: conta, token, Salvar, Testar.");
      await digitar(p, p.locator("#ti-usuario"), "canario@exemplo.com.br");
      await digitar(p, p.locator("#ti-segredo"), "token-ti-canario");
      await clicar(p, ti.getByRole("button", { name: "Salvar" }));
      await ti.locator("[data-integracao-estado]").filter({ hasText: /ativo/ }).waitFor({ timeout: 15000 });
      await clicar(p, ti.getByRole("button", { name: /Testar conexão/ }));
      await ti.locator('[data-teste-integracao="ti"]').waitFor({ timeout: 20000 });
      await ler(p, 1500);
      await still(p, "ato9-04-ti-salvo");
      await fechar(p);
      // 3) advogado, com a credencial
      pa = (await parte(`canario+advogado@${DOM}`, ESC2)).page;
      await pa.goto(`${BASE}/casos/${casoHelena.id}?tab=processos`);
      await pa.locator('[title*="Legalmail"]').first().waitFor({ timeout: 20000 });
      await narrar(pa, "Com a credencial, o botão aparece. A busca roda na conta do Canário e traz o processo da Helena.");
      await clicar(pa, pa.locator('[title*="Legalmail"]').first());
      await pa.getByText("5001234-56.2026.4.03.6183").first().waitFor({ timeout: 20000 });
      await ler(pa, 3500);
      await still(pa, "ato9-05-busca-legalmail");
      await pa.keyboard.press("Escape");
      await pa.goto(`${BASE}/casos/novo`);
      await pa.getByRole("button", { name: /Buscar no TI/ }).waitFor({ timeout: 20000 });
      await narrar(pa, "Novo caso: \"Buscar no TI\" lista os clientes da conta do Canário; escolher um preenche o formulário.");
      await clicar(pa, pa.getByRole("button", { name: /Buscar no TI/ }));
      await pa.getByText("Otávio Lins Barreto").first().waitFor({ timeout: 20000 });
      await ler(pa, 1500);
      await clicar(pa, pa.getByText("Otávio Lins Barreto").first());
      await pa.locator('input[value="Otávio Lins Barreto"]').first().waitFor({ timeout: 15000 });
      await ler(pa, 2500);
      await still(pa, "ato9-06-ti-preenchido");
      await fechar(pa);
      // 4) escritório 1
      await tentar("isolamento do escritório 1", async () => {
        const p1 = (await parte(`e2e+admin@${DOM}`, ESC1)).page;
        await p1.goto(`${BASE}/configuracoes?tab=integracoes`);
        const c1 = p1.locator('[data-card-integracao="legalmail"]');
        await c1.waitFor({ timeout: 20000 });
        await deslizar(p1, c1);
        await narrar(p1, "No escritório 1 nada mudou: ele segue na credencial do sistema até cadastrar a sua — e nunca usa a do Canário.");
        await ler(p1, 3000);
        await still(p1, "ato9-07-escritorio1");
        await fechar(p1);
      });
      // 5) fecho
      const pf = (await parte(null, null, false)).page;
      await cartao(pf, "Resultado", "Credencial por escritório, cifrada; sem ela, 412 e nenhum botão. O escritório padrão continua no legado até cadastrar a sua. Spec integracoes-legalmail-ti: 4 testes.", 5000);
      await fechar(pf);
      gravados.push("ato9");
    }

    // ================= ENCERRAMENTO =================
    if (ato(7)) {
      const p = (await parte(null, null, false)).page;
      await cartao(p, "Fim", "Seis itens implementados no ambiente local. 119 testes automáticos (118 passam, 1 pulado sem o hook de e-mail). Tudo o que este filme criou foi apagado no final.", 5000);
      await fechar(p);
      gravados.push("fim");
    }
  } finally {
    console.log("limpando…");
    const passo = async (rotulo, f) => { try { await f(); } catch (e) { console.log(`  (limpeza ${rotulo}: ${e.message?.slice(0, 100)})`); } };
    await passo("documentos", () => admin.from("documentos").delete().like("nome_arquivo", `${MARCA}%`));
    await passo("acessos_suporte", () => admin.from("acessos_suporte").delete().like("motivo", `${MARCA}%`));
    await passo("whatsapp_mensagens", () => admin.from("whatsapp_mensagens").delete().eq("telefone", TEL_GILDA));
    await passo("whatsapp_sessoes", () => admin.from("whatsapp_sessoes").delete().eq("telefone", TEL_GILDA));
    await passo("whatsapp_outbox", () => admin.from("whatsapp_outbox").delete().eq("telefone", TEL_GILDA));
    await passo("escritorio_integracoes", () => admin.from("escritorio_integracoes").delete().eq("escritorio_id", ESC2));
    await passo("usuario_gmail_oauth", () => admin.from("usuario_gmail_oauth").delete().eq("escritorio_id", ESC2));
    await passo("publicacoes_dje", () => admin.from("publicacoes_dje").delete().like("djen_id", "mock-djen-%"));
    await passo("publicacoes_dje (ids)", () => admin.from("publicacoes_dje").delete().in("djen_id", ["990001", "990002"]));
    await passo("processos_judiciais", () => admin.from("processos_judiciais").delete().eq("numero_processo", CNJ));
    await passo("oabs_monitoradas", () => admin.from("oabs_monitoradas").delete().eq("observacao", MARCA));
    for (const t of ["tarefas", "andamentos", "notificacoes", "processos_admin"]) {
      await passo(`${t} (joana/helena desde o início)`, () => admin.from(t).delete().in("caso_id", [casoJoana.id, casoHelena.id]).gte("created_at", inicio));
    }
    await passo("inss_email_log", () => admin.from("inss_email_log").delete().like("gmail_message_id", "mock-msg-%"));
    await passo("tarefas_excluidas", () => admin.from("tarefas_excluidas").delete().in("caso_id", [casoJoana.id, casoHelena.id]).gte("created_at", inicio));
    await passo("ia_tokens", () => admin.from("ia_tokens").delete().eq("usuario_id", gilda.id).gte("criado_em", inicio));
    await passo("ia_acoes", () => admin.from("ia_acoes").delete().eq("usuario_id", gilda.id).gte("created_at", inicio));
    await passo("telefone da gilda", () => admin.from("usuarios").update({ telefone: gilda.telefone ?? null }).eq("id", gilda.id));
    await passo("mfa", async () => {
      for (const email of [`canario+admin@${DOM}`, `qg+dono@${DOM}`]) {
        const { data: usr } = await admin.from("usuarios").select("id").eq("email", email).single();
        if (!usr) continue;
        const { data } = await admin.auth.admin.mfa.listFactors({ userId: usr.id });
        for (const f of data?.factors ?? []) await admin.auth.admin.mfa.deleteFactor({ id: f.id, userId: usr.id });
      }
    });
    await passo("qg_exigir_aal2", () => admin.from("app_config").upsert({ chave: "qg_exigir_aal2", valor: "false" }, { onConflict: "chave" }));
    await passo("marca do canário (snapshot)", async () => { if (marcaAntes) await admin.from("escritorio_config").update({ marca: marcaAntes }).eq("escritorio_id", ESC2); });
    await passo("seed (marca, contas)", () => {
      try { execSync("node scripts/seed-local-rbac.mjs", { cwd: REPO, stdio: "pipe", encoding: "utf8" }); }
      catch (e) { throw new Error(`seed falhou: ${(e.stderr || e.stdout || e.message || "").toString().slice(-400)}`); }
    });
    await passo("mock reset", () => mock("/_reset"));
    const clipes = await estudio.encerrar();
    fs.writeFileSync(path.join(estudio.saida, "legendas.json"), JSON.stringify({ clipes: clipes.length, legendas }, null, 2));
    console.log("clipes:", clipes.length, "| gravados:", gravados.join(", "));
    console.log("saida:", estudio.saida);
  }
})().catch((e) => { console.error("FALHA:", e); process.exit(1); });

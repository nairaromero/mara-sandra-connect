// Conferência AUTOMÁTICA das seções L, M, N, O, P e Q do guia (planning/RBAC_TESTE_LOCAL.md),
// no ambiente local, com vídeo e um still por item — o que a Naira faria à mão,
// feito pelo Playwright e devolvido como relatório (relatorio.md + resultados.json).
// Cada item do guia vira um `item(...)`: passa (OK), falha (com o motivo) ou é
// "não conferível no local" (nota). Provedores externos: mocks de e2e/demo/mocks.
//
// Pré: `bun run local:rbac`, app em :8080 (`bun run dev:local`), mocks em :8787,
// supabase/functions/.env com os *_BASE_URL (seção R do guia).
// Rodar da raiz: node e2e/demo/roteiros/conferencia-lote-rbac.cjs  (SECOES=L,Q filtra)
// Limpa tudo no finally e roda o seed.

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");
const { ler, deslizar, clicar, narrar, abrirEstudio } = require("../helpers.cjs");
const { REPO, BASE, QG, MOCK, MOCK_DOCKER, DOM, PILHA, FN, admin, sessao, estadoNavegador, fn, mock, esc, codigoNovo, fechar, digitar, cronSimulado, segredoSistemaLocal } = require("../local.cjs");
const { createHmac } = require("crypto");

const SECOES = (process.env.SECOES || "L,M,N,O,P,Q,S").split(",").map((s) => s.trim().toUpperCase());
const MARCA = "[Conferência]";
const TEL_GILDA = "5511999990000";
const CNJ = "5001234-56.2026.4.03.6183";
const MAILPIT = "http://127.0.0.1:55324";
const PNG_1x1 = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");

const resultados = [];
let estudio, still, secaoAtual = "";
async function item(codigo, titulo, f) {
  const t0 = Date.now();
  try {
    const obs = await f();
    resultados.push({ secao: secaoAtual, codigo, titulo, ok: true, obs: obs || "", ms: Date.now() - t0 });
    console.log(`  ✓ ${codigo} ${titulo}${obs ? " — " + obs : ""}`);
  } catch (e) {
    const motivo = String(e?.message ?? e).split("\n")[0].slice(0, 260);
    resultados.push({ secao: secaoAtual, codigo, titulo, ok: false, obs: motivo, ms: Date.now() - t0 });
    console.log(`  ✘ ${codigo} ${titulo} — ${motivo}`);
  }
}
function nota(codigo, titulo, obs) { resultados.push({ secao: secaoAtual, codigo, titulo, ok: null, obs }); console.log(`  – ${codigo} ${titulo} — ${obs}`); }
const falha = (m) => { throw new Error(m); };
async function visivel(loc, msg, ms = 15000) { try { await loc.waitFor({ state: "visible", timeout: ms }); } catch { falha(msg); } }
async function ausente(loc, msg, ms = 4000) { await new Promise((r) => setTimeout(r, Math.min(ms, 2500))); if ((await loc.count()) > 0) falha(msg); }
async function textoContem(loc, re, msg, ms = 15000) { const fim = Date.now() + ms; while (Date.now() < fim) { const t = (await loc.allInnerTexts().catch(() => [])).join("\n"); if (re.test(t)) return t; await new Promise((r) => setTimeout(r, 300)); } falha(msg); }
async function rota(page, rotas, msg, ms = 15000) { const fim = Date.now() + ms; while (Date.now() < fim) { const p = new URL(page.url()).pathname; if (rotas.includes(p)) return p; await new Promise((r) => setTimeout(r, 250)); } falha(`${msg} (ficou em ${new URL(page.url()).pathname})`); }
async function legenda(page, codigo, texto) { await narrar(page, `${codigo} · ${texto}`, 1200); }
const sql = (q) => JSON.parse(execSync(`node scripts/msc-sql.mjs --local ${JSON.stringify(q)}`, { cwd: REPO, encoding: "utf8" }).split("\n").filter((l) => !l.startsWith("[msc-sql]")).join("\n") || "[]");

(async () => {
  const inicio = new Date().toISOString();
  const { data: canario } = await admin.from("escritorios").select("id, nome").eq("slug", "canario").single();
  if (!canario) throw new Error("escritório canário ausente — rode `bun run local:rbac`");
  const ESC2 = canario.id;
  const { data: esc1 } = await admin.from("escritorios").select("id, nome").eq("padrao_sistema", true).single();
  const ESC1 = esc1.id;
  const u = async (email) => (await admin.from("usuarios").select("id, nome, email, telefone").eq("email", `${email}@${DOM}`).single()).data;
  const carla = await u("canario+admin"), diego = await u("canario+advogado"), elisa = await u("canario+assistente"), gilda = await u("canario+parceiro"), sup = await u("qg+suporte");
  const clienteDe = async (nome) => (await admin.from("clientes").select("id, nome, cpf, telefone").eq("escritorio_id", ESC2).eq("nome", nome).single()).data;
  const casoDe = async (c) => (await admin.from("casos").select("id").eq("cliente_id", c.id).order("created_at", { ascending: false }).limit(1).single()).data;
  const kleber = await clienteDe("Kleber Antunes Siqueira"), joana = await clienteDe("Joana Reis Camargo"), helena = await clienteDe("Helena Bastos Ferraz");
  const casoKleber = await casoDe(kleber), casoJoana = await casoDe(joana), casoHelena = await casoDe(helena);
  const cpfFmt = (c) => (c || "").replace(/\D/g, "").replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, "$1.$2.$3-$4");
  const { data: cfgAntes } = await admin.from("escritorio_config").select("marca").eq("escritorio_id", ESC2).maybeSingle();
  const marcaAntes = cfgAntes?.marca ?? null;

  await mock("/_reset");
  await mock("/_config", { cliente_nome: joana.nome.toUpperCase(), cliente_cpf: cpfFmt(joana.cpf), oab_numero: "123456", oab_uf: "SP", processo_cnj: CNJ, msg_id: `conf-msg-${Date.now()}` });
  await admin.from("usuarios").update({ telefone: TEL_GILDA }).eq("id", gilda.id);
  await admin.from("documentos").insert({ caso_id: casoKleber.id, escritorio_id: ESC2, tipo: "outro", nome_arquivo: `${MARCA} comprovante.pdf`, storage_path: `conferencia/${casoKleber.id}/comprovante.pdf` });

  estudio = await abrirEstudio(process.env.SAIDA || "conferencia-lote-rbac");
  still = estudio.still;
  const sessoes = {};
  const parte = async (email, escritorio, comSessao = true) => {
    let st = { cookies: [], origins: [] };
    if (comSessao) { if (!sessoes[email]) sessoes[email] = await sessao(email); st = estadoNavegador(sessoes[email].session, escritorio); }
    return (await estudio.novaParte(st)).page;
  };
  const cAdmin = await sessao(`canario+admin@${DOM}`, ESC2);
  const abertas = [];
  const abrir = async (email, esc, com) => { const p = await parte(email, esc, com); abertas.push(p); return p; };
  const fecharTodas = async () => { for (const p of abertas.splice(0)) await fechar(p); };

  try {
    // ======================= L. Integrações por escritório =======================
    if (SECOES.includes("L")) {
      secaoAtual = "L";
      console.log("L. Integrações por escritório");
      const p = await abrir(`canario+admin@${DOM}`, ESC2);
      let webhook = "";
      await item("L1", "Admin vê os cards Gmail e WhatsApp; advogado não vê a aba", async () => {
        await p.goto(`${BASE}/configuracoes?tab=integracoes`);
        await legenda(p, "L1", "cards Gmail (INSS) e WhatsApp (Evolution) para o admin");
        await visivel(p.locator("[data-card-gmail]"), "card do Gmail não apareceu");
        await textoContem(p.locator("[data-card-gmail]"), /Nenhuma caixa conectada neste escritório/i, "card do Gmail sem 'Nenhuma caixa conectada neste escritório'");
        await textoContem(p.locator("[data-card-whatsapp]"), /não configurado/i, "card do WhatsApp sem 'não configurado'");
        await still(p, "L1-admin-cards");
        const pa = await abrir(`canario+advogado@${DOM}`, ESC2);
        await pa.goto(`${BASE}/configuracoes?tab=integracoes`);
        await visivel(pa.getByRole("tab", { name: /Perfil/ }), "abas de Configurações não carregaram (advogado)");
        await ausente(pa.getByRole("tab", { name: /Integrações/ }), "advogado vê a aba Integrações");
        await legenda(pa, "L1", "advogado: a aba Integrações não existe (caiu em Perfil)");
        await still(pa, "L1-advogado-sem-aba");
        await fechar(pa);
      });
      await item("L2", "WhatsApp: salvar (chave cifrada, some do campo), gerar token, copiar", async () => {
        await p.goto(`${BASE}/configuracoes?tab=integracoes`);
        const wa = p.locator("[data-card-whatsapp]");
        await visivel(wa, "card do WhatsApp");
        await deslizar(p, wa);
        await legenda(p, "L2", "preencher URL, instância e chave; Salvar; Gerar token");
        await digitar(p, p.locator("#wa-url"), "https://evo.exemplo.com");
        await digitar(p, p.locator("#wa-inst"), "canario");
        await digitar(p, p.locator("#wa-key"), "chave-de-teste-123");
        await clicar(p, wa.getByRole("button", { name: "Salvar" }).first());
        await textoContem(wa, /definida em/i, "depois de salvar não apareceu 'definida em …'");
        if ((await p.locator("#wa-key").inputValue()) !== "") falha("a chave continuou no campo depois de salvar");
        await textoContem(wa, /\bativo\b/i, "badge 'ativo' não apareceu");
        await clicar(p, wa.getByRole("button", { name: /Gerar token/ }).first());
        await visivel(wa.locator("[data-webhook-url]"), "URL do webhook não apareceu");
        webhook = (await wa.locator("[data-webhook-url]").innerText()).trim();
        if (!/token=/.test(webhook)) falha("URL do webhook sem token");
        await visivel(wa.getByRole("button", { name: "Copiar URL do webhook" }), "botão Copiar ausente");
        await still(p, "L2-whatsapp-salvo-token");
        return "chave some do campo; 'definida em'; webhook com token";
      });
      await item("L3", "Testar conexão com URL inexistente → 'Falhou: não alcancei o Evolution'", async () => {
        const wa = p.locator("[data-card-whatsapp]");
        await legenda(p, "L3", "Testar contra https://evo.exemplo.com (não existe)");
        await clicar(p, wa.getByRole("button", { name: /Testar/ }).first());
        const t = await textoContem(wa.locator("[data-teste-whatsapp]"), /Falhou/i, "resultado do teste não apareceu", 30000);
        if (!/não alcancei/i.test(t)) falha(`texto do teste: ${t.slice(0, 120)}`);
        await still(p, "L3-testar-falhou");
      });
      await item("L4", "Escritório 1 (e2e+admin): WhatsApp 'não configurado' — a do Canário não vaza", async () => {
        const p1 = await abrir(`e2e+admin@${DOM}`, ESC1);
        await p1.goto(`${BASE}/configuracoes?tab=integracoes`);
        await legenda(p1, "L4", "escritório 1 não vê a integração do Canário");
        await textoContem(p1.locator("[data-card-whatsapp]"), /não configurado/i, "escritório 1 não mostra 'não configurado'");
        await still(p1, "L4-escritorio1-isolado");
        await fechar(p1);
      });
      await item("L5", "Webhook: token certo → ok e mensagem no Canário; token errado/instância desconhecida → 401", async () => {
        if (!webhook) falha("sem webhook (L2 falhou)");
        const id = `conf-${Date.now()}`;
        const corpo = { event: "messages.upsert", instance: "canario", data: { key: { remoteJid: `${TEL_GILDA}@s.whatsapp.net`, fromMe: false, id }, message: { conversation: "oi" }, messageType: "conversation" } };
        const post = (url, b) => fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(b) });
        const r1 = await post(webhook, corpo); const t1 = await r1.text();
        if (r1.status !== 200 || !/"ok":\s*true/.test(t1)) falha(`token certo: HTTP ${r1.status} ${t1.slice(0, 80)}`);
        const r2 = await post(webhook.replace(/token=[^&]+/, "token=errado"), corpo);
        if (r2.status !== 401) falha(`token errado: HTTP ${r2.status} (esperava 401)`);
        const r3 = await post(webhook, { ...corpo, instance: "instancia-inexistente" });
        if (r3.status !== 401) falha(`instância desconhecida: HTTP ${r3.status} (esperava 401)`);
        const { data: m } = await admin.from("whatsapp_mensagens").select("escritorio_id").eq("evolution_message_id", id).maybeSingle();
        if (!m) falha("mensagem não gravada em whatsapp_mensagens");
        if (m.escritorio_id !== ESC2) falha("mensagem gravada em outro escritório");
        await mock("/painel/registrar", { titulo: `POST webhook (instância canario): HTTP ${r1.status}`, html: `<pre class="ok">${esc(t1)}</pre>` });
        await mock("/painel/registrar", { titulo: "token errado / instância desconhecida", html: `<pre class="ok">HTTP ${r2.status} / HTTP ${r3.status}</pre>` });
        await mock("/painel/registrar", { titulo: "banco: whatsapp_mensagens.escritorio_id", html: `<pre class="ok">${m.escritorio_id} = Canário</pre>` });
        await p.goto(`${MOCK}/painel`);
        await legenda(p, "L5", "webhook com token certo, errado e instância desconhecida");
        await ler(p, 1500);
        await still(p, "L5-webhook");
        return "200 / 401 / 401; mensagem no Canário";
      });
      await item("L6", "Gmail: botão 'Conectar Gmail' e card fala do escritório (+ extra: OAuth e processador com o Google simulado)", async () => {
        await p.goto(`${BASE}/configuracoes?tab=integracoes`);
        const gm = p.locator("[data-card-gmail]");
        await visivel(gm.getByRole("button", { name: /Conectar Gmail/ }), "botão Conectar Gmail ausente");
        await textoContem(gm, /escritório/i, "card do Gmail não fala do escritório");
        await deslizar(p, gm);
        await legenda(p, "L6", "Conectar Gmail (Google simulado) e processar a caixa");
        await clicar(p, gm.getByRole("button", { name: /Conectar Gmail/ }).first());
        await visivel(p.locator("#permitir"), "consentimento simulado não abriu", 20000);
        await clicar(p, p.locator("#permitir"));
        await p.waitForURL(/configuracoes/, { timeout: 20000 });
        await textoContem(p.locator("[data-card-gmail]"), /Conectado como/i, "não voltou 'Conectado como'");
        await still(p, "L6-gmail-conectado");
        const r = await fn("inss-email-processor", cAdmin.jwt, ESC2, { dias: 7, limite: 5 });
        const res = r.json?.resultados?.[0];
        if (r.status !== 200 || !res || res.caso_id !== casoJoana.id || !res.andamento_id) falha(`processador: HTTP ${r.status} ${JSON.stringify(res ?? r.texto).slice(0, 200)}`);
        return `extra: e-mail simulado virou andamento no caso da Joana (${res.classificacao}, via ${res.match_via})`;
      });
      await item("L7", "DJEN: oabs_monitoradas tem escritorio_id; rotina por escritório (+ extra: sync com o Comunica simulado)", async () => {
        const cols = sql("select column_name from information_schema.columns where table_schema='public' and table_name='oabs_monitoradas' and column_name='escritorio_id'");
        if (cols.length !== 1) falha("oabs_monitoradas sem escritorio_id");
        await admin.from("oabs_monitoradas").insert({ numero: "123456", uf: "SP", tipo: "escritorio", ativo: true, observacao: MARCA, escritorio_id: ESC2 });
        await admin.from("processos_judiciais").insert({ caso_id: casoHelena.id, numero_processo: CNJ, vara: "3ª Vara Federal", comarca: "São Paulo", uf: "SP", escritorio_id: ESC2 });
        const r = await fn("sync-djen-publicacoes", cAdmin.jwt, ESC2, { dias: 3 });
        if (r.status !== 200 || r.json?.escritorio_id !== ESC2) falha(`sync: HTTP ${r.status} ${r.texto.slice(0, 160)}`);
        await p.goto(`${BASE}/publicacoes`);
        await legenda(p, "L7", "publicações da OAB do Canário: uma vinculada, uma órfã");
        await textoContem(p.locator("main"), /Vinculada/, "publicação vinculada não apareceu");
        await textoContem(p.locator("main"), /Sem processo/, "publicação órfã não apareceu");
        await still(p, "L7-publicacoes");
        const porEsc = sql("select e.slug, count(*) n from oabs_monitoradas o join escritorios e on e.id=o.escritorio_id where o.ativo group by 1 order by 1");
        return `extra: ${r.json.vinculadas_novas} vinculada, ${r.json.orfas_novas} órfã; OABs ativas por escritório: ${porEsc.map((x) => `${x.slug}=${x.n}`).join(", ")}`;
      });
      await fecharTodas();
    }

    // ======================= M. Marca Legal Connect =======================
    if (SECOES.includes("M")) {
      secaoAtual = "M";
      console.log("M. Marca Legal Connect");
      const pL = await abrir(null, null, false);
      await item("M1", "Login, redefinir e definir senha: marca Legal Connect, sem 'Mara Sandra Vian'", async () => {
        for (const r of ["/login", "/redefinir-senha", "/definir-senha"]) {
          await pL.goto(`${BASE}${r}`);
          await visivel(pL.locator('img[alt="Legal Connect"]').first(), `${r}: logo Legal Connect ausente`);
          if ((await pL.getByText(/Mara Sandra Vian/i).count()) > 0) falha(`${r}: ainda cita Mara Sandra Vian`);
        }
        await pL.goto(`${BASE}/login`);
        await visivel(pL.getByText("Gestão de casos previdenciários para escritórios e parceiros"), "frase do login ausente");
        await legenda(pL, "M1", "login com a marca do produto");
        await still(pL, "M1-login");
      });
      await item("M2", "Título da aba 'Legal Connect' e favicon com os anéis", async () => {
        const titulo = await pL.title();
        if (!/Legal Connect/.test(titulo)) falha(`título: ${titulo}`);
        const fav = await pL.locator('link[rel~="icon"]').first().getAttribute("href");
        if (!fav || !/favicon/.test(fav)) falha(`favicon: ${fav}`);
        return `título "${titulo}", favicon ${fav}`;
      });
      await item("M6", "Manifesto do app instalável: nome e ícones Legal Connect", async () => {
        const m = await (await fetch(`${BASE}/manifest.webmanifest`)).json();
        if (m.name !== "Legal Connect" || !Array.isArray(m.icons) || m.icons.length === 0) falha(`manifest: ${JSON.stringify(m).slice(0, 120)}`);
        return `name="${m.name}", ${m.icons.length} ícone(s) (a instalação em si é manual no Chrome)`;
      });
      await fechar(pL);
      const p = await abrir(`canario+admin@${DOM}`, ESC2);
      await item("M3", "Logado: topo com a marca do escritório; rodapé da sidebar 'por Legal Connect'", async () => {
        await p.goto(`${BASE}/tarefas`);
        await visivel(p.locator("[data-marca-escritorio]").first(), "marca do escritório ausente no topo");
        await visivel(p.getByText("por", { exact: true }), "rodapé 'por' ausente");
        await visivel(p.locator('img[alt="Legal Connect"]').last(), "marca Legal Connect no rodapé ausente");
        await legenda(p, "M3", "topo = escritório; rodapé = por Legal Connect");
        await still(p, "M3-rodape");
      });
      await item("M4", "QG: logo Legal Connect em fundo escuro + selo QG", async () => {
        const pq = await abrir(`qg+dono@${DOM}`, null);
        await pq.goto(`${QG}/qg`);
        await visivel(pq.locator('header img[alt="Legal Connect"]'), "logo no cabeçalho do QG ausente", 20000);
        await visivel(pq.locator("header").getByText("QG", { exact: true }), "selo QG ausente");
        await legenda(pq, "M4", "cabeçalho do QG");
        await still(pq, "M4-qg");
        await fechar(pq);
      });
      await item("M5", "Convite pelo Canário: e-mail chega no Mailpit; metadados levam o nome do escritório", async () => {
        const email = `conferencia+convite@${DOM}`;
        const r = await fn("convidar-usuario", cAdmin.jwt, ESC2, { nome: `${MARCA} Convidado`, email, tipo: "interno", papel: "assistente" });
        if (r.status !== 200) falha(`convidar-usuario: HTTP ${r.status} ${r.texto.slice(0, 120)}`);
        let msg = null;
        for (let i = 0; i < 20 && !msg; i++) { const lista = await (await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent("to:" + email)}`)).json().catch(() => null); msg = lista?.messages?.[0] ?? null; if (!msg) await new Promise((r) => setTimeout(r, 1000)); }
        if (!msg) falha("e-mail do convite não chegou no Mailpit");
        const { data: lista } = await admin.auth.admin.listUsers({ perPage: 1000 });
        const usr = lista?.users?.find((x) => x.email === email);
        const nomeEsc = usr?.user_metadata?.escritorio_nome;
        if (!nomeEsc || !/Can[áa]rio/.test(nomeEsc)) falha(`escritorio_nome nos metadados: ${nomeEsc}`);
        return `assunto "${msg.Subject}" (template padrão do Supabase no local); escritorio_nome="${nomeEsc}"`;
      });
      await fecharTodas();
    }

    // ======================= N. Marca por escritório =======================
    if (SECOES.includes("N")) {
      secaoAtual = "N";
      console.log("N. Marca por escritório");
      const p = await abrir(`canario+admin@${DOM}`, ESC2);
      await item("N1", "Canário: logo verde no topo; sidebar recolhida mostra 'CA' na cor", async () => {
        await p.goto(`${BASE}/tarefas`);
        const logo = p.locator('[data-marca-escritorio="logo"]').first();
        await visivel(logo, "logo do escritório ausente");
        if (!/Can[áa]rio/.test((await logo.getAttribute("alt")) || "")) falha("alt do logo não é o Canário");
        await legenda(p, "N1", "logo do Canário; recolher a sidebar → iniciais");
        await clicar(p, p.locator('button[data-sidebar="trigger"]').first());
        const comp = p.locator('[data-marca-escritorio="compacta"]').first();
        await visivel(comp, "marca compacta não apareceu ao recolher");
        const txt = (await comp.innerText()).trim();
        const bg = await comp.evaluate((el) => getComputedStyle(el).backgroundColor);
        await still(p, "N1-compacta");
        await clicar(p, p.locator('button[data-sidebar="trigger"]').first());
        if (txt !== "CA") falha(`iniciais: "${txt}"`);
        return `iniciais ${txt}, fundo ${bg}`;
      });
      await item("N2", "Configurações → Escritório: trocar nome e cor; o topo muda sem recarregar", async () => {
        await p.goto(`${BASE}/configuracoes?tab=escritorio`);
        const card = p.locator("[data-card-marca]");
        await visivel(card, "card da marca ausente");
        await visivel(card.locator("[data-previa-marca]"), "prévia ausente");
        await legenda(p, "N2", "nome 'Canário & Associados' e cor nova → Salvar");
        await digitar(p, p.locator("#marca-nome"), "Canário & Associados");
        await digitar(p, p.locator("#marca-cor"), "#b45309");
        await clicar(p, card.getByRole("button", { name: "Salvar" }).first());
        const fim = Date.now() + 10000; let ok = false;
        while (Date.now() < fim && !ok) { const alt = await p.locator("[data-marca-escritorio]").first().getAttribute("alt").catch(() => null) ?? await p.locator("[data-marca-escritorio]").first().getAttribute("aria-label").catch(() => null); ok = /Associados/.test(alt || ""); if (!ok) await new Promise((r) => setTimeout(r, 300)); }
        if (!ok) falha("o topo não passou a usar o nome novo sem recarregar");
        await still(p, "N2-nome-cor");
      });
      await item("N3", "Trocar logo (PNG) → URL pública; Remover logo → nome em texto na cor", async () => {
        const card = p.locator("[data-card-marca]");
        await legenda(p, "N3", "enviar um PNG e depois remover");
        await card.locator("[data-input-logo]").setInputFiles({ name: "logo.png", mimeType: "image/png", buffer: PNG_1x1 });
        const fim = Date.now() + 15000; let src = "";
        while (Date.now() < fim && !/\/storage\/v1\/object\/public\/marcas\//.test(src)) { src = (await p.locator('[data-marca-escritorio="logo"]').first().getAttribute("src").catch(() => "")) || ""; if (!/marcas\//.test(src)) await new Promise((r) => setTimeout(r, 400)); }
        if (!new RegExp(`/storage/v1/object/public/marcas/${ESC2}/logo\\.png`).test(src)) falha(`src do logo: ${src}`);
        await still(p, "N3-logo-novo");
        await clicar(p, card.getByRole("button", { name: "Remover logo" }).first());
        const nome = p.locator('[data-marca-escritorio="nome"]').first();
        await visivel(nome, "nome em texto não apareceu no topo após remover o logo");
        const t = (await nome.innerText()).trim(); const cor = await nome.evaluate((el) => getComputedStyle(el).color);
        await still(p, "N3-sem-logo");
        if (!/Associados/.test(t)) falha(`texto do topo: ${t}`);
        return `logo público em ${src.replace(PILHA.url, "")}; depois: "${t}" na cor ${cor}`;
      });
      await item("N4", "Escritório 1 mantém a marca dele e vê a própria aba; advogado do Canário não tem a aba", async () => {
        const p1 = await abrir(`e2e+admin@${DOM}`, ESC1);
        await p1.goto(`${BASE}/configuracoes?tab=escritorio`);
        const m = p1.locator("[data-marca-escritorio]").first();
        await visivel(m, "marca do escritório 1 ausente");
        const alt = (await m.getAttribute("alt")) || (await m.getAttribute("aria-label")) || "";
        if (/Can[áa]rio/.test(alt)) falha("escritório 1 mostra a marca do Canário");
        await visivel(p1.locator("[data-card-marca]"), "aba Escritório do escritório 1 não abriu");
        await legenda(p1, "N4", "escritório 1: marca própria, aba própria");
        await still(p1, "N4-escritorio1");
        await fechar(p1);
        const pa = await abrir(`canario+advogado@${DOM}`, ESC2);
        await pa.goto(`${BASE}/configuracoes?tab=escritorio`);
        await visivel(pa.getByRole("tab", { name: /Perfil/ }), "abas não carregaram (advogado)");
        await ausente(pa.getByRole("tab", { name: /Escritório/ }), "advogado vê a aba Escritório");
        const rpc = await (await sessao(`canario+advogado@${DOM}`, ESC2)).sb.rpc("escritorio_definir_marca", { p_nome_exibicao: "hack" });
        if (rpc.error?.code !== "42501") falha(`RPC como advogado: ${rpc.error?.code ?? "passou"}`);
        await fechar(pa);
        return `marca do 1: "${alt}"; advogado sem aba e RPC 42501`;
      });
      await item("N5", "Convite pelo Canário leva o nome do escritório nos metadados", async () => {
        const email = `conferencia+convite2@${DOM}`;
        const r = await fn("convidar-usuario", cAdmin.jwt, ESC2, { nome: `${MARCA} Convidado 2`, email, tipo: "interno", papel: "assistente" });
        if (r.status !== 200) falha(`convidar-usuario: HTTP ${r.status} ${r.texto.slice(0, 120)}`);
        const { data: lista } = await admin.auth.admin.listUsers({ perPage: 1000 });
        const usr = lista?.users?.find((x) => x.email === email);
        const nomeEsc = usr?.user_metadata?.escritorio_nome;
        if (!nomeEsc || !/Can[áa]rio/.test(nomeEsc)) falha(`escritorio_nome: ${nomeEsc}`);
        return `escritorio_nome="${nomeEsc}" (assunto com o nome só onde o send-email-hook está ligado)`;
      });
      await item("N6", "Suporte em sessão no Canário vê a marca do Canário (faixa âmbar continua)", async () => {
        const s = await sessao(`qg+suporte@${DOM}`, ESC2);
        const ped = await s.sb.rpc("qg_suporte_solicitar", { p_escritorio_id: ESC2, p_motivo: `${MARCA} conferir a marca em sessão de suporte`, p_horas: 1 });
        if (ped.error) falha(`pedido: ${ped.error.message}`);
        const ap = await cAdmin.sb.rpc("suporte_responder", { p_id: ped.data, p_aprovar: true });
        if (ap.error) falha(`aprovar: ${ap.error.message}`);
        const ps = await abrir(`qg+suporte@${DOM}`, ESC2);
        await ps.goto(`${BASE}/tarefas`);
        await visivel(ps.getByText(/Sessão de suporte em/), "faixa de suporte ausente", 20000);
        const m = ps.locator("[data-marca-escritorio]").first();
        await visivel(m, "marca ausente na sessão de suporte");
        const alt = (await m.getAttribute("alt")) || (await m.getAttribute("aria-label")) || (await m.innerText());
        await legenda(ps, "N6", "sessão de suporte: marca do Canário no topo");
        await still(ps, "N6-suporte-marca");
        await fechar(ps);
        await cAdmin.sb.rpc("suporte_encerrar", { p_id: ped.data });
        if (!/Can[áa]rio|Associados/.test(alt)) falha(`marca vista pelo suporte: ${alt}`);
      });
      await fecharTodas();
    }

    // ======================= O. MFA e o QG =======================
    if (SECOES.includes("O")) {
      secaoAtual = "O";
      console.log("O. Verificação em duas etapas");
      let segredo = "";
      const p = await abrir(`canario+advogado@${DOM}`, ESC2);
      await item("O1", "Advogado ativa em Segurança: QR + chave, código → 'ativa desde'", async () => {
        await p.goto(`${BASE}/configuracoes?tab=seguranca`);
        const card = p.locator("[data-card-duas-etapas]");
        await visivel(card, "card duas etapas ausente");
        await visivel(card.locator('[data-mfa-status="inativa"]'), "status inicial não é 'inativa'");
        await deslizar(p, card);
        await legenda(p, "O1", "Ativar → QR e chave → código");
        await clicar(p, card.getByRole("button", { name: /Ativar/ }).first());
        await visivel(p.locator("[data-mfa-secret]"), "chave/QR não apareceu");
        segredo = (await p.locator("[data-mfa-secret]").innerText()).trim();
        await still(p, "O1-qr");
        await digitar(p, p.locator('[data-duas-etapas] input[inputmode="numeric"]'), await codigoNovo(segredo));
        await clicar(p, p.getByRole("button", { name: /Ativar verificação/ }));
        await visivel(card.locator('[data-mfa-status="ativa"]'), "não ficou 'ativa'", 20000);
        await textoContem(card, /Ativa desde/i, "sem 'Ativa desde …'");
        await still(p, "O1-ativa");
      });
      await item("O2", "Login: pede o código; errado → 'inválido ou expirado'; certo → entra", async () => {
        const nova = await sessao(`canario+advogado@${DOM}`);
        const pl = await abrir(null, null, false); await fechar(pl);
        const ctx = await estudio.novaParte(estadoNavegador(nova.session, ESC2)); const pg = ctx.page; abertas.push(pg);
        await pg.goto(`${BASE}/login`);
        await visivel(pg.locator("[data-login-mfa]"), "etapa do código não apareceu no login", 20000);
        await legenda(pg, "O2", "código errado, depois o certo");
        await digitar(pg, pg.locator('[data-login-mfa] input[inputmode="numeric"]'), "000000");
        await clicar(pg, pg.locator("[data-login-mfa]").getByRole("button", { name: "Entrar", exact: true }));
        await visivel(pg.getByText(/inválido|expirado/i).first(), "código errado não avisou 'inválido ou expirado'", 10000);
        await still(pg, "O2-codigo-errado");
        await digitar(pg, pg.locator('[data-login-mfa] input[inputmode="numeric"]'), await codigoNovo(segredo));
        await clicar(pg, pg.locator("[data-login-mfa]").getByRole("button", { name: "Entrar", exact: true }));
        await rota(pg, ["/tarefas", "/casos"], "não entrou depois do código certo", 20000);
        await still(pg, "O2-entrou");
        await fechar(pg);
      });
      await item("O5", "QG: a lista de pessoas do Canário marca '2 etapas' (escudo) para quem tem o fator", async () => {
        const pq = await abrir(`qg+dono@${DOM}`, null);
        await pq.goto(`${QG}/qg/escritorios/${ESC2}`);
        await visivel(pq.getByText(/Quem usa o sistema/), "tela do escritório no QG não abriu", 20000);
        const linha = pq.locator("tr", { hasText: "Diego Prado" }).first();
        await visivel(linha, "linha do Diego ausente");
        await deslizar(pq, linha);
        const t = await linha.innerText();
        await legenda(pq, "O5", "coluna '2 etapas' do Diego");
        await still(pq, "O5-qg-2etapas");
        // a coluna "2 etapas" mostra um ícone (escudo) quando há fator e o texto "não" quando não há
        const icone = await linha.locator("td").nth(3).locator("svg").count();
        await fechar(pq);
        if (icone === 0 || /\bnão\b/.test(t)) falha(`linha do Diego sem o escudo de 2 etapas: ${t.replace(/\s+/g, " ").slice(0, 120)}`);
        return "escudo verde na coluna '2 etapas' do Diego";
      });
      await item("O3", "Desativar em Segurança → 'não ativa'; entrar de novo sem etapa do código", async () => {
        await p.goto(`${BASE}/configuracoes?tab=seguranca`);
        const card = p.locator("[data-card-duas-etapas]");
        await deslizar(p, card);
        await legenda(p, "O3", "Desativar");
        await clicar(p, card.getByRole("button", { name: /Desativar/ }).first());
        const cod = p.locator('[data-duas-etapas] input[inputmode="numeric"]');
        if (await cod.count().then((n) => n > 0)) { await digitar(p, cod, await codigoNovo(segredo)); await clicar(p, p.getByRole("button", { name: /Confirmar|Desativar/ }).last()); }
        await visivel(card.locator('[data-mfa-status="inativa"]'), "não voltou a 'inativa'", 20000);
        await still(p, "O3-desativada");
        const nova = await sessao(`canario+advogado@${DOM}`);
        const pg = (await estudio.novaParte(estadoNavegador(nova.session, ESC2))).page; abertas.push(pg);
        await pg.goto(`${BASE}/login`);
        await rota(pg, ["/tarefas", "/casos"], "com o fator removido o login ainda não entrou direto", 20000);
        await fechar(pg);
      });
      await item("O4", "QG exige AAL2: qg+suporte cadastra o fator e entra; sessão só com senha é recusada no banco", async () => {
        await admin.from("app_config").upsert({ chave: "qg_exigir_aal2", valor: "true" }, { onConflict: "chave" });
        const pq = await abrir(`qg+suporte@${DOM}`, null);
        await pq.goto(`${QG}/qg`);
        await visivel(pq.getByText(/exige verificação em duas etapas/), "tela 'O QG exige…' não apareceu", 20000);
        await legenda(pq, "O4", "cadastrar o fator e entrar no QG");
        await visivel(pq.locator("[data-mfa-secret]"), "QR do cadastro não apareceu", 20000);
        const s2 = (await pq.locator("[data-mfa-secret]").innerText()).trim();
        await still(pq, "O4-qg-exige");
        await digitar(pq, pq.locator('[data-duas-etapas] input[inputmode="numeric"]'), await codigoNovo(s2));
        await clicar(pq, pq.getByRole("button", { name: /Ativar e entrar/ }));
        await visivel(pq.getByRole("link", { name: /Canário/ }).first(), "lista de escritórios não abriu após o código", 25000);
        await still(pq, "O4-qg-aberto");
        await fechar(pq);
        // sair e entrar: sessão só com senha (AAL1) → tela pede o código; e o banco recusa as funções do QG
        const aal1 = await sessao(`qg+suporte@${DOM}`);
        const rpc = await aal1.sb.rpc("qg_escritorios_nomes");
        const pg = (await estudio.novaParte(estadoNavegador(aal1.session, null))).page; abertas.push(pg);
        await pg.goto(`${QG}/qg`);
        await visivel(pg.getByText(/exige verificação em duas etapas/), "ao entrar de novo o QG não pediu o código", 20000);
        await visivel(pg.getByRole("button", { name: /Entrar no QG/ }), "não ofereceu 'Entrar no QG' (modo confirmar)", 20000);
        await legenda(pg, "O4", "entrando de novo: pede o código antes do QG");
        await still(pg, "O4-qg-pede-codigo");
        await fechar(pg);
        if (!rpc.error) falha("qg_escritorios_nomes respondeu com sessão só de senha (deveria recusar no banco)");
        return `banco recusou: ${rpc.error.message.slice(0, 80)}`;
      });
      await item("O6", "Desligar a exigência e remover o fator do qg+suporte", async () => {
        await admin.from("app_config").upsert({ chave: "qg_exigir_aal2", valor: "false" }, { onConflict: "chave" });
        const { data } = await admin.auth.admin.mfa.listFactors({ userId: sup.id });
        for (const f of data?.factors ?? []) await admin.auth.admin.mfa.deleteFactor({ id: f.id, userId: sup.id });
        return "qg_exigir_aal2=false; fator removido (pela API de admin)";
      });
      await fecharTodas();
    }

    // ======================= P. Token do MCP para outra pessoa =======================
    if (SECOES.includes("P")) {
      secaoAtual = "P";
      console.log("P. Token do MCP para outra pessoa");
      const p = await abrir(`canario+admin@${DOM}`, ESC2);
      let token = "";
      let seq = 0;
      const mcp = async (tok, method, params) => { const r = await fetch(`${FN}/ia-mcp`, { method: "POST", headers: { Authorization: `Bearer ${tok}`, "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: ++seq, method, params }) }); return { status: r.status, corpo: await r.json().catch(() => null) }; };
      await item("P1", "'Para quem' lista as pessoas do Canário (Para mim, Gilda · Parceiro, Elisa · Assistente…)", async () => {
        await p.goto(`${BASE}/configuracoes?tab=integracoes`);
        const sel = p.getByRole("combobox", { name: "Para quem emitir o token" });
        await visivel(sel, "campo 'Para quem' ausente");
        await deslizar(p, sel);
        await legenda(p, "P1", "opções do 'Para quem'");
        await clicar(p, sel);
        for (const re of [/Para mim/, /Gilda.*Parceiro/, /Elisa.*Assistente/]) await visivel(p.getByRole("option", { name: re }), `opção ${re} ausente`);
        await still(p, "P1-para-quem");
        await p.keyboard.press("Escape");
      });
      await item("P2", "Gerar token para a Gilda: aviso 'envie a essa pessoa'; lista 'Claude de Gilda… · de Gilda Moura'", async () => {
        const sel = p.getByRole("combobox", { name: "Para quem emitir o token" });
        await clicar(p, sel);
        await clicar(p, p.getByRole("option", { name: /Gilda/ }));
        await legenda(p, "P2", "Somente leitura → Gerar token");
        await clicar(p, p.getByRole("button", { name: "Gerar token" }).first());
        await visivel(p.locator("[data-token-para]"), "aviso do token não apareceu");
        const aviso = await p.locator("[data-token-para]").innerText();
        if (!/Gilda/.test(aviso) || !/envie/i.test(aviso)) falha(`aviso: ${aviso.slice(0, 100)}`);
        token = (await p.locator("[data-token-para]").locator("xpath=following::code[1]").innerText()).trim();
        await textoContem(p.locator("[data-token-dono]").first(), /de Gilda Moura/, "lista sem 'de Gilda Moura'");
        await still(p, "P2-token-gerado");
      });
      await item("P3", "Token no MCP: só os casos da Gilda (Helena e Ivo); ia_acoes com dono=Gilda, emitido_por=admin", async () => {
        const r = await mcp(token, "tools/call", { name: "buscar_casos", arguments: { limite: 10 } });
        const texto = r.corpo?.result?.content?.[0]?.text ?? "";
        if (r.status !== 200 || !texto) falha(`MCP: HTTP ${r.status}`);
        if (!/Helena/.test(texto) || !/Ivo/.test(texto)) falha("resposta sem Helena/Ivo");
        if (/Joana|Kleber/.test(texto)) falha("resposta vazou Joana/Kleber");
        const { data: acao } = await admin.from("ia_acoes").select("usuario_id, emitido_por").eq("superficie", "mcp").gte("created_at", inicio).order("created_at", { ascending: false }).limit(1).maybeSingle();
        if (!acao || acao.usuario_id !== gilda.id || acao.emitido_por !== carla.id) falha(`ia_acoes: ${JSON.stringify(acao)}`);
        await mock("/claude/registrar", { papel: "eu", texto: "Quais casos meus estão em andamento?" });
        await mock("/claude/registrar", { papel: "claude", html: `<pre>${esc(texto.slice(0, 900))}</pre>` });
        await p.goto(`${MOCK}/claude`);
        await legenda(p, "P3", "o Claude da Gilda (simulado) só vê os casos dela");
        await ler(p, 1200);
        await still(p, "P3-mcp");
      });
      await item("P4", "Advogado: sem aba Integrações; token_criar pela API → 403", async () => {
        const adv = await sessao(`canario+advogado@${DOM}`, ESC2);
        const r = await fn("ia-config", adv.jwt, ESC2, { action: "token_criar", nome: `${MARCA} adv` });
        if (r.status !== 403) falha(`token_criar como advogado: HTTP ${r.status}`);
        const pa = await abrir(`canario+advogado@${DOM}`, ESC2);
        await pa.goto(`${BASE}/configuracoes?tab=integracoes`);
        await visivel(pa.getByRole("tab", { name: /Perfil/ }), "abas não carregaram");
        await ausente(pa.getByRole("tab", { name: /Integrações/ }), "advogado vê Integrações");
        await legenda(pa, "P4", "advogado: sem a aba; API 403");
        await still(pa, "P4-advogado");
        await fechar(pa);
      });
      await item("P5", "Diego promovido a admin não vê o token da Gilda (emitido por outro admin); rebaixado de volta", async () => {
        const up = await cAdmin.sb.rpc("definir_papel", { p_usuario_id: diego.id, p_papel: "admin" });
        if (up.error) falha(`promover: ${up.error.message}`);
        try {
          const adv = await sessao(`canario+advogado@${DOM}`, ESC2);
          const lista = await fn("ia-config", adv.jwt, ESC2, { action: "token_listar" });
          const nomes = (lista.json?.tokens ?? []).map((t) => t.nome);
          if (nomes.some((n) => /Gilda/.test(n))) falha(`outro admin viu: ${nomes.join(", ")}`);
          const pa = await abrir(`canario+advogado@${DOM}`, ESC2);
          await pa.goto(`${BASE}/configuracoes?tab=integracoes`);
          await visivel(pa.getByRole("combobox", { name: "Para quem emitir o token" }), "Diego admin não vê o card");
          await legenda(pa, "P5", "Diego como admin: card sem o token da Gilda");
          await ausente(pa.getByText(/Claude de Gilda/), "Diego (admin) vê o token da Gilda na tela");
          await still(pa, "P5-outro-admin");
          await fechar(pa);
        } finally {
          await cAdmin.sb.rpc("definir_papel", { p_usuario_id: diego.id, p_papel: "advogado" });
        }
      });
      await item("P6", "Revogar → MCP 401; emissor rebaixado → 403", async () => {
        await p.goto(`${BASE}/configuracoes?tab=integracoes`);
        await visivel(p.getByRole("button", { name: "Revogar token" }).first(), "botão Revogar ausente");
        await legenda(p, "P6", "Revogar o token da Gilda");
        await clicar(p, p.getByRole("button", { name: "Revogar token" }).first());
        try { const d = p.getByRole("dialog"); await d.waitFor({ timeout: 2500 }); await clicar(p, d.getByRole("button", { name: /Revogar|Confirmar/ }).last()); } catch { /* sem diálogo */ }
        await ler(p, 1500);
        const r1 = await mcp(token, "tools/call", { name: "buscar_casos", arguments: { limite: 1 } });
        if (r1.status !== 401) falha(`depois de revogar: HTTP ${r1.status}`);
        await still(p, "P6-revogado");
        // emissor rebaixado: Diego (admin temporário) emite para a Elisa; rebaixado → 403
        await cAdmin.sb.rpc("definir_papel", { p_usuario_id: diego.id, p_papel: "admin" });
        try {
          const adv = await sessao(`canario+advogado@${DOM}`, ESC2);
          const cr = await fn("ia-config", adv.jwt, ESC2, { action: "token_criar", nome: `${MARCA} do Diego`, usuario_id: elisa.id, escopo: "leitura" });
          if (cr.status !== 200 || !cr.json?.token) falha(`Diego admin não emitiu: HTTP ${cr.status}`);
          await cAdmin.sb.rpc("definir_papel", { p_usuario_id: diego.id, p_papel: "advogado" });
          const r2 = await mcp(cr.json.token, "tools/call", { name: "buscar_casos", arguments: { limite: 1 } });
          if (r2.status !== 403) falha(`emissor rebaixado: HTTP ${r2.status} (esperava 403)`);
        } finally {
          await cAdmin.sb.rpc("definir_papel", { p_usuario_id: diego.id, p_papel: "advogado" });
        }
        return "401 após revogar; 403 com o emissor rebaixado";
      });
      await fecharTodas();
    }

    // ======================= Q. A tela só oferece o que o papel pode =======================
    if (SECOES.includes("Q")) {
      secaoAtual = "Q";
      console.log("Q. Telas por papel");
      const pF = await abrir(`canario+financeiro@${DOM}`, ESC2);
      await item("Q1", "Financeiro no caso do Kleber: sem ações, contato, senha, excluir, documentos e processos; advogado tem tudo", async () => {
        await pF.goto(`${BASE}/casos/${casoKleber.id}`);
        await visivel(pF.getByText(kleber.nome).first(), "caso não abriu (financeiro)", 20000);
        await legenda(pF, "Q1", "financeiro: só leitura");
        await ausente(pF.locator('[aria-label="Ações do caso"]'), "financeiro vê 'Ações do caso'");
        await ausente(pF.getByText(/^\s*Telefone:\s*$/), "financeiro vê Telefone");
        await ausente(pF.getByText(/^\s*E-mail:\s*$/), "financeiro vê E-mail");
        await ausente(pF.getByText(/Senha MEU INSS/), "financeiro vê a senha do INSS");
        await ausente(pF.getByRole("button", { name: /Excluir cliente/ }), "financeiro vê Excluir cliente");
        await still(pF, "Q1-financeiro-caso");
        await pF.goto(`${BASE}/casos/${casoKleber.id}?tab=documentos`);
        await visivel(pF.getByRole("tab", { name: /Documentos/ }), "aba Documentos");
        await ausente(pF.locator('[aria-label="Renomear documento"]'), "financeiro vê Renomear");
        await ausente(pF.locator('[aria-label="Deletar documento"]'), "financeiro vê Deletar");
        await still(pF, "Q1-financeiro-docs");
        await pF.goto(`${BASE}/casos/${casoKleber.id}?tab=processos`);
        await visivel(pF.getByRole("tab", { name: /Processos/ }), "aba Processos");
        await ausente(pF.getByRole("button", { name: /^Novo$/ }), "financeiro vê 'Novo' em Processos");
        await ausente(pF.locator('[title*="Legalmail"]'), "financeiro vê a busca no Legalmail");
        await still(pF, "Q1-financeiro-processos");
        const pAd = await abrir(`canario+advogado@${DOM}`, ESC2);
        await pAd.goto(`${BASE}/casos/${casoKleber.id}`);
        await visivel(pAd.locator('[aria-label="Ações do caso"]'), "advogado sem 'Ações do caso'", 20000);
        await visivel(pAd.getByText(/^\s*Telefone:\s*$/).first(), "advogado sem Telefone");
        await visivel(pAd.getByText(/Senha MEU INSS/).first(), "advogado sem a senha do INSS");
        await legenda(pAd, "Q1", "advogado: tudo volta");
        await still(pAd, "Q1-advogado-caso");
        await pAd.goto(`${BASE}/casos/${casoKleber.id}?tab=processos`);
        await visivel(pAd.getByRole("button", { name: /^Novo$/ }).first(), "advogado sem 'Novo' em Processos");
        await visivel(pAd.locator('[title*="Legalmail"]').first(), "advogado sem Legalmail");
        await still(pAd, "Q1-advogado-processos");
        await fechar(pAd);
      });
      await item("Q2", "Financeiro: Comercial/Etiquetas fecham; Processos, Novo caso, Publicações, Parceiros voltam; Agenda sem 'Novo evento'; Clientes sem 'Perícia'", async () => {
        await pF.goto(`${BASE}/comercial`);
        await visivel(pF.getByText("Área restrita a quem gerencia o comercial."), "/comercial não fechou");
        await legenda(pF, "Q2", "páginas de gestão fecham para o financeiro");
        await still(pF, "Q2-comercial");
        await pF.goto(`${BASE}/etiquetas`);
        await visivel(pF.getByText("Área restrita a quem gerencia etiquetas."), "/etiquetas não fechou");
        for (const r of ["/processos", "/casos/novo", "/publicacoes", "/parceiros"]) { await pF.goto(`${BASE}${r}`); await rota(pF, ["/casos", "/tarefas"], `${r} não devolveu para /casos`); }
        await pF.goto(`${BASE}/agenda`);
        await visivel(pF.getByRole("heading", { level: 1 }), "agenda não abriu");
        await ausente(pF.getByRole("button", { name: "Novo evento" }), "financeiro vê 'Novo evento'");
        await still(pF, "Q2-agenda");
        await pF.goto(`${BASE}/clientes`);
        await visivel(pF.getByRole("heading", { level: 1 }), "clientes não abriu");
        await ausente(pF.getByRole("button", { name: /Perícia/ }), "financeiro vê 'Perícia' em Clientes");
        await still(pF, "Q2-clientes");
      });
      await item("Q3", "Assistente: ações, telefone, enviar/renomear documento, sem lixeira; Comercial/Etiquetas fecham; Processos abre", async () => {
        const pAs = await abrir(`canario+assistente@${DOM}`, ESC2);
        await pAs.goto(`${BASE}/casos/${casoKleber.id}`);
        await visivel(pAs.locator('[aria-label="Ações do caso"]'), "assistente sem 'Ações do caso'", 20000);
        await visivel(pAs.getByText(/^\s*Telefone:\s*$/).first(), "assistente sem Telefone");
        await pAs.goto(`${BASE}/casos/${casoKleber.id}?tab=documentos`);
        await visivel(pAs.locator('[aria-label="Renomear documento"]').first(), "assistente sem Renomear");
        await ausente(pAs.locator('[aria-label="Deletar documento"]'), "assistente vê a lixeira");
        await legenda(pAs, "Q3", "assistente: renomeia, não apaga");
        await still(pAs, "Q3-assistente-docs");
        await pAs.goto(`${BASE}/comercial`);
        await visivel(pAs.getByText("Área restrita a quem gerencia o comercial."), "/comercial não fechou (assistente)");
        await pAs.goto(`${BASE}/etiquetas`);
        await visivel(pAs.getByText("Área restrita a quem gerencia etiquetas."), "/etiquetas não fechou (assistente)");
        await pAs.goto(`${BASE}/processos`);
        await rota(pAs, ["/processos"], "assistente não ficou em /processos");
        await still(pAs, "Q3-assistente-processos");
        await fechar(pAs);
      });
      await item("Q4", "Advogado: Publicações com 'Vincular', Etiquetas e Comercial abrem; parceiro sem botões internos", async () => {
        const pAd = await abrir(`canario+advogado@${DOM}`, ESC2);
        await pAd.goto(`${BASE}/publicacoes`);
        await visivel(pAd.getByRole("button", { name: /Vincular/ }).first(), "advogado sem 'Vincular' (precisa de publicação órfã da seção L7)", 20000);
        await legenda(pAd, "Q4", "advogado: Vincular; Etiquetas e Comercial abrem");
        await still(pAd, "Q4-advogado-publicacoes");
        await pAd.goto(`${BASE}/etiquetas`); await rota(pAd, ["/etiquetas"], "advogado não ficou em /etiquetas"); await ausente(pAd.getByText(/Área restrita/), "advogado bloqueado em /etiquetas");
        await pAd.goto(`${BASE}/comercial`); await rota(pAd, ["/comercial"], "advogado não ficou em /comercial"); await ausente(pAd.getByText(/Área restrita/), "advogado bloqueado em /comercial");
        await fechar(pAd);
        const pP = await abrir(`canario+parceiro@${DOM}`, ESC2);
        await pP.goto(`${BASE}/casos/${casoHelena.id}`);
        await visivel(pP.getByText(helena.nome).first(), "parceiro não abriu o caso da Helena", 20000);
        await ausente(pP.locator('[aria-label="Ações do caso"]'), "parceiro vê 'Ações do caso'");
        await ausente(pP.locator('[title*="Legalmail"]'), "parceiro vê a busca no Legalmail");
        await ausente(pP.locator('[aria-label="Deletar documento"]'), "parceiro vê a lixeira");
        await legenda(pP, "Q4", "parceiro: nada de botão interno");
        await still(pP, "Q4-parceiro");
        await fechar(pP);
      });
      await fecharTodas();
    }

    // ======================= S. n8n fora das rotinas =======================
    if (SECOES.includes("S")) {
      secaoAtual = "S";
      console.log("S. n8n fora das rotinas");
      const p = await abrir(`canario+admin@${DOM}`, ESC2);
      await item("S1", "Webhooks: a aba mostra 'Em breve', sem 'Novo webhook'; /webhooks redireciona para a aba", async () => {
        await p.goto(`${BASE}/webhooks`);
        await p.waitForURL(/configuracoes\?tab=webhooks/, { timeout: 15000 });
        await visivel(p.locator('[data-em-breve="webhooks"]'), "card 'Em breve' de Webhooks ausente");
        await visivel(p.locator('[data-em-breve="webhooks"]').getByText("Em breve", { exact: true }), "selo 'Em breve' ausente");
        await ausente(p.getByRole("button", { name: "Novo webhook" }), "botão 'Novo webhook' ainda aparece");
        await legenda(p, "S1", "aba Webhooks: Em breve");
        await still(p, "S1-webhooks-em-breve");
      });
      let webhook = "";
      await item("S2", "WhatsApp: 'Envio de mensagens · Em breve'; salvar, Testar e o webhook de entrada seguem funcionando", async () => {
        await p.goto(`${BASE}/configuracoes?tab=integracoes`);
        const wa = p.locator("[data-card-whatsapp]");
        await visivel(wa, "card do WhatsApp");
        await deslizar(p, wa);
        await visivel(wa.locator('[data-whatsapp-envio="em-breve"]'), "linha 'Envio · Em breve' ausente");
        await legenda(p, "S2", "envio 'Em breve'; entrada e teste continuam");
        await digitar(p, p.locator("#wa-url"), `${MOCK_DOCKER}/evolution`);
        await digitar(p, p.locator("#wa-inst"), "canario");
        await digitar(p, p.locator("#wa-key"), "chave-evolution-canario");
        await clicar(p, wa.getByRole("button", { name: "Salvar" }).first());
        await textoContem(wa, /definida em/i, "não salvou");
        await clicar(p, wa.getByRole("button", { name: /Testar/ }).first());
        await textoContem(wa.locator("[data-teste-whatsapp]"), /Conectado/i, "Testar não deu 'Conectado' com o Evolution simulado", 30000);
        await clicar(p, wa.getByRole("button", { name: /Gerar token/ }).first());
        await visivel(wa.locator("[data-webhook-url]"), "URL do webhook");
        webhook = (await wa.locator("[data-webhook-url]").innerText()).trim();
        const r = await fetch(webhook, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ event: "messages.upsert", instance: "canario", data: { key: { remoteJid: `${TEL_GILDA}@s.whatsapp.net`, fromMe: false, id: `conf-s-${Date.now()}` }, message: { conversation: "oi" }, messageType: "conversation" } }) });
        if (r.status !== 200) falha(`webhook de entrada: HTTP ${r.status}`);
        await still(p, "S2-whatsapp-em-breve");
        return "entrada: webhook 200; teste: conectado";
      });
      await item("S3", "Assinatura de sistema: cron:djen-sync é aceita; a identidade antiga n8n:djen-sync recebe 401", async () => {
        const segredo = segredoSistemaLocal();
        if (!segredo) falha("MSC_SYSTEM_SECRET ausente em supabase/functions/.env");
        const chamar = async (job) => {
          const ts = Math.floor(Date.now() / 1000).toString();
          const hmac = createHmac("sha256", segredo).update(`${job}.${ts}`).digest("hex");
          const r = await fetch(`${FN}/sync-djen-publicacoes`, { method: "POST", headers: { "content-type": "application/json", "x-region": "sa-east-1", "x-msc-assinatura": `${ts}.${hmac}` }, body: JSON.stringify({ dias: 1, dry_run: true }) });
          return { status: r.status, texto: await r.text() };
        };
        const cron = await chamar("cron:djen-sync"); const n8n = await chamar("n8n:djen-sync");
        await mock("/painel/registrar", { titulo: "sync-djen-publicacoes assinado como cron:djen-sync (dry_run)", html: `<pre class="${cron.status !== 401 ? "ok" : "erro"}">HTTP ${cron.status}\n${esc(cron.texto.slice(0, 300))}</pre>` });
        await mock("/painel/registrar", { titulo: "mesma chamada assinada como n8n:djen-sync (identidade antiga)", html: `<pre class="${n8n.status === 401 ? "ok" : "erro"}">HTTP ${n8n.status}\n${esc(n8n.texto.slice(0, 200))}</pre>` });
        if (cron.status === 401 || /assinatura/.test(cron.texto)) falha(`cron: HTTP ${cron.status} ${cron.texto.slice(0, 120)}`);
        if (n8n.status !== 401) falha(`n8n: HTTP ${n8n.status} (esperava 401)`);
        return `cron HTTP ${cron.status} (${cron.texto.replace(/\s+/g, " ").slice(0, 140)}); n8n HTTP 401`;
      });
      await item("S4", "Cron simulado: o comando SQL do pg_cron (net.http_post + ops.headers_sistema) sincroniza o DJEN sem n8n", async () => {
        await admin.from("oabs_monitoradas").insert({ numero: "123456", uf: "SP", tipo: "escritorio", ativo: true, observacao: MARCA, escritorio_id: ESC2 });
        await admin.from("processos_judiciais").insert({ caso_id: casoHelena.id, numero_processo: CNJ, vara: "3ª Vara Federal", comarca: "São Paulo", uf: "SP", escritorio_id: ESC2 });
        const r = await cronSimulado("cron:djen-sync", "sync-djen-publicacoes", { dias: 2 });
        const escs = r.json?.escritorios ?? [];
        const doCanario = escs.find((e) => e.escritorio_id === ESC2);
        await mock("/painel/registrar", { titulo: "Cron simulado: comando que o pg_cron roda em produção (aqui, apontando para a function local)", html: `<pre>${esc(r.comando)}</pre>` });
        await mock("/painel/registrar", { titulo: `Resposta recebida pelo pg_net (net._http_response #${r.id})`, html: `<pre class="${r.status === 200 ? "ok" : "erro"}">HTTP ${r.status ?? "—"} ${esc(r.erro ?? "")}\n${esc(JSON.stringify(r.json ?? r.corpo, null, 2).slice(0, 1200))}</pre>` });
        if (r.status !== 200) falha(`pg_net: HTTP ${r.status} ${r.erro ?? ""} ${(r.corpo || "").slice(0, 120)}`);
        if (!doCanario || doCanario.error) falha(`escritório Canário no resultado: ${JSON.stringify(doCanario ?? escs).slice(0, 200)}`);
        await p.goto(`${MOCK}/painel`);
        await legenda(p, "S4", "cron simulado: SQL → pg_net → function → Comunica simulado");
        await ler(p, 1500);
        await still(p, "S4-cron-painel");
        await p.goto(`${BASE}/publicacoes`);
        await textoContem(p.locator("main"), /Vinculada/, "publicação vinculada não apareceu");
        await textoContem(p.locator("main"), /Sem processo/, "publicação órfã não apareceu");
        await legenda(p, "S4", "publicações chegaram pelo caminho do cron, sem n8n");
        await still(p, "S4-publicacoes");
        return `pg_net HTTP 200; Canário: ${doCanario.publicacoes_recebidas} recebidas, ${doCanario.vinculadas_novas} vinculada, ${doCanario.orfas_novas} órfã; ${escs.length} escritório(s) percorrido(s)`;
      });
      await fecharTodas();
    }
  } finally {
    console.log("limpando…");
    const passo = async (rotulo, f) => { try { await f(); } catch (e) { console.log(`  (limpeza ${rotulo}: ${e.message?.slice(0, 120)})`); } };
    await passo("documentos", () => admin.from("documentos").delete().like("nome_arquivo", `${MARCA}%`));
    await passo("acessos_suporte", () => admin.from("acessos_suporte").delete().like("motivo", `${MARCA}%`));
    await passo("whatsapp_mensagens", () => admin.from("whatsapp_mensagens").delete().eq("telefone", TEL_GILDA));
    await passo("whatsapp_sessoes", () => admin.from("whatsapp_sessoes").delete().eq("telefone", TEL_GILDA));
    await passo("whatsapp_outbox", () => admin.from("whatsapp_outbox").delete().eq("telefone", TEL_GILDA));
    await passo("escritorio_integracoes", () => admin.from("escritorio_integracoes").delete().eq("escritorio_id", ESC2));
    await passo("usuario_gmail_oauth", () => admin.from("usuario_gmail_oauth").delete().eq("escritorio_id", ESC2));
    await passo("inss_email_log", () => admin.from("inss_email_log").delete().like("gmail_message_id", "conf-msg-%"));
    await passo("publicacoes_dje", () => admin.from("publicacoes_dje").delete().in("djen_id", ["990001", "990002"]));
    await passo("processos_judiciais", () => admin.from("processos_judiciais").delete().eq("numero_processo", CNJ));
    await passo("oabs_monitoradas", () => admin.from("oabs_monitoradas").delete().eq("observacao", MARCA));
    for (const t of ["tarefas", "andamentos", "notificacoes", "processos_admin"]) await passo(`${t} (joana/helena)`, () => admin.from(t).delete().in("caso_id", [casoJoana.id, casoHelena.id]).gte("created_at", inicio));
    await passo("tarefas_excluidas", () => admin.from("tarefas_excluidas").delete().in("caso_id", [casoJoana.id, casoHelena.id]).gte("created_at", inicio));
    await passo("ia_tokens", () => admin.from("ia_tokens").delete().gte("criado_em", inicio).eq("escritorio_id", ESC2));
    await passo("ia_acoes", () => admin.from("ia_acoes").delete().eq("superficie", "mcp").gte("created_at", inicio).eq("usuario_id", gilda.id));
    await passo("convidados", async () => { const { data: lista } = await admin.auth.admin.listUsers({ perPage: 1000 }); for (const x of lista?.users ?? []) if (/^conferencia\+/.test(x.email || "")) { await admin.from("membros").delete().eq("usuario_id", x.id); await admin.from("usuarios").delete().eq("id", x.id); await admin.auth.admin.deleteUser(x.id); } });
    await passo("telefone da gilda", () => admin.from("usuarios").update({ telefone: gilda.telefone ?? null }).eq("id", gilda.id));
    await passo("mfa", async () => { for (const id of [diego.id, sup.id, carla.id]) { const { data } = await admin.auth.admin.mfa.listFactors({ userId: id }); for (const f of data?.factors ?? []) await admin.auth.admin.mfa.deleteFactor({ id: f.id, userId: id }); } });
    await passo("papel do diego", () => cAdmin.sb.rpc("definir_papel", { p_usuario_id: diego.id, p_papel: "advogado" }));
    await passo("qg_exigir_aal2", () => admin.from("app_config").upsert({ chave: "qg_exigir_aal2", valor: "false" }, { onConflict: "chave" }));
    await passo("marca (snapshot)", async () => { if (marcaAntes) await admin.from("escritorio_config").update({ marca: marcaAntes }).eq("escritorio_id", ESC2); });
    await passo("seed", () => { try { execSync("node scripts/seed-local-rbac.mjs", { cwd: REPO, stdio: "pipe", encoding: "utf8" }); } catch (e) { throw new Error(`seed: ${(e.stderr || e.stdout || "").toString().slice(-300)}`); } });
    await passo("mock reset", () => mock("/_reset"));
    if (estudio) {
      const clipes = await estudio.encerrar();
      const ok = resultados.filter((r) => r.ok === true).length, ruim = resultados.filter((r) => r.ok === false).length, notas = resultados.filter((r) => r.ok === null).length;
      const titulos = { L: "Integrações por escritório", M: "Marca Legal Connect (produto)", N: "Marca por escritório", O: "Verificação em duas etapas e o QG", P: "Token do MCP para outra pessoa", Q: "A tela só oferece o que o papel pode", S: "n8n fora das rotinas: DJEN no pg_cron, Webhooks e envio de WhatsApp \"Em breve\"" };
      let md = `# Conferência do lote RBAC — seções L a Q\n\nAmbiente local, ${new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}. Executada pelo Playwright a partir do guia (planning/RBAC_TESTE_LOCAL.md), com provedores simulados.\n\n**Resumo: ${ok} OK · ${ruim} falhou · ${notas} nota(s).** Vídeo: \`video/ato*.webm\` (um clipe por sessão) e stills por item em \`stills/\`.\n\n`;
      for (const s of ["L", "M", "N", "O", "P", "Q", "S"]) {
        const its = resultados.filter((r) => r.secao === s);
        if (!its.length) continue;
        md += `## ${s}. ${titulos[s]}\n\n| Item | Resultado | Observação |\n|---|---|---|\n`;
        for (const r of its) md += `| ${r.codigo} · ${r.titulo} | ${r.ok === true ? "✅ OK" : r.ok === false ? "❌ FALHOU" : "ℹ️ nota"} | ${(r.obs || "").replace(/\|/g, "\\|")} |\n`;
        md += "\n";
      }
      fs.writeFileSync(path.join(estudio.saida, "relatorio.md"), md);
      fs.writeFileSync(path.join(estudio.saida, "resultados.json"), JSON.stringify(resultados, null, 2));
      console.log(`clipes: ${clipes.length} | OK ${ok} · falhou ${ruim} · notas ${notas}`);
      console.log("saida:", estudio.saida);
    }
  }
})().catch((e) => { console.error("FALHA:", e); process.exit(1); });

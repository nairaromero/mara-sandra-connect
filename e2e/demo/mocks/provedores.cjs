// Mocks LOCAIS dos provedores externos, pro filme e pra testar de ponta a ponta
// sem chave de ninguém: Evolution (WhatsApp), Comunica/DJEN, Google OAuth +
// Gmail, Resend (com caixa de entrada visível) e um "Claude simulado" que
// mostra o que o MCP devolveu. Só roda na máquina; as edge functions LOCAIS
// apontam pra cá pelas variáveis *_BASE_URL do supabase/functions/.env
// (host.docker.internal:8787 = esta máquina vista de dentro do Docker).
//
// Rodar: node e2e/demo/mocks/provedores.cjs   (porta 8787; PORT= pra mudar)
// Estado dinâmico (cliente do e-mail, OAB, etc.): POST /_config {..json..}
// Contrato: se o provedor de verdade responder no mesmo formato, a function
// se comporta igual — é isso que o mock prova.

const http = require("http");
const { URL } = require("url");

const PORT = Number(process.env.PORT || 8787);
const EVO_KEY = process.env.MOCK_EVO_KEY || "chave-evolution-canario";

const estado = {
  config: {
    gmail_email: "inss@canario-advocacia.com.br",
    cliente_nome: "JOANA REIS CAMARGO",
    cliente_cpf: "000.000.000-00",
    oab_numero: "123456",
    oab_uf: "SP",
    processo_cnj: "5001234-56.2026.4.03.6183",
    msg_id: "mock-msg-1",
  },
  emails: [],          // Resend: o que as functions mandaram
  claude: [],          // "conversa" do Claude simulado
  painel: [],          // blocos {titulo, html} do painel
  chamadas: [],        // log curto pra depurar
};

const b64url = (s) => Buffer.from(s, "utf8").toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const esc = (t) => String(t ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const json = (res, corpo, status = 200) => { res.writeHead(status, { "content-type": "application/json" }); res.end(JSON.stringify(corpo)); };
const html = (res, corpo, status = 200) => { res.writeHead(status, { "content-type": "text/html; charset=utf-8" }); res.end(corpo); };
const lerCorpo = (req) => new Promise((ok) => { let t = ""; req.on("data", (c) => (t += c)); req.on("end", () => ok(t)); });

function emailInss() {
  const c = estado.config;
  const corpo = [
    `Prezado(a) Sr(a) ${c.cliente_nome},`,
    ``,
    `Informamos que o status do seu requerimento foi alterado.`,
    `Protocolo: 1234567890`,
    `CPF: ${c.cliente_cpf}`,
    `Serviço: Aposentadoria por Idade Urbana`,
    `Status atual: EXIGÊNCIA`,
    `Despacho: Apresentar CTPS (páginas de identificação e contratos) e comprovante de residência atualizado no prazo de 30 dias, sob pena de indeferimento.`,
    ``,
    `É possível acompanhar o andamento pelo Meu INSS.`,
    `Instituto Nacional do Seguro Social`,
  ].join("\n");
  return {
    id: c.msg_id,
    threadId: `thread-${c.msg_id}`,
    labelIds: ["INBOX"],
    payload: {
      mimeType: "multipart/alternative",
      headers: [
        { name: "Subject", value: "Status do requerimento 1234567890 alterado para EXIGÊNCIA" },
        { name: "From", value: "INSS <naoresponda@inss.gov.br>" },
        { name: "Date", value: new Date().toUTCString() },
      ],
      parts: [{ mimeType: "text/plain", body: { data: b64url(corpo) } }],
    },
  };
}

function publicacoesDjen(q) {
  const c = estado.config;
  if (q.get("numeroOab") !== c.oab_numero || q.get("ufOab") !== c.oab_uf) return { items: [] };
  if (q.get("pagina") && q.get("pagina") !== "1") return { items: [] };
  const hoje = new Date().toISOString().slice(0, 10);
  return {
    items: [
      {
        id: 990001,
        hash: "mock-djen-990001",
        numero_processo: c.processo_cnj.replace(/\D/g, ""),
        numeroprocessocommascara: c.processo_cnj,
        siglaTribunal: "TRF3",
        nomeOrgao: "3ª Vara Federal Previdenciária de São Paulo",
        tipoComunicacao: "Intimação",
        tipoDocumento: "Despacho",
        texto: `INTIMAÇÃO — Processo nº ${c.processo_cnj}. Intime-se a parte autora para, no prazo de 15 (quinze) dias, juntar CNIS atualizado e cópia integral da CTPS. Publicado no DJEN em ${hoje}.`,
        data_disponibilizacao: hoje,
        link: "https://comunica.pje.jus.br/consulta?mock=990001",
      },
      {
        id: 990002,
        hash: "mock-djen-990002",
        numero_processo: "50098765420264036183",
        numeroprocessocommascara: "5009876-54.2026.4.03.6183",
        siglaTribunal: "TRF3",
        nomeOrgao: "1ª Vara Federal de Guarulhos",
        tipoComunicacao: "Intimação",
        tipoDocumento: "Sentença",
        texto: `SENTENÇA — Processo nº 5009876-54.2026.4.03.6183. Julgo PROCEDENTE o pedido para condenar o INSS a conceder o benefício. Publicado no DJEN em ${hoje}.`,
        data_disponibilizacao: hoje,
        link: "https://comunica.pje.jus.br/consulta?mock=990002",
      },
    ],
  };
}

function paginaInbox() {
  const lista = estado.emails.map((e, i) =>
    `<li class="${i === estado.emails.length - 1 ? "ativo" : ""}"><a href="/inbox?i=${i}"><b>${esc(e.subject)}</b><br><small>${esc(e.from)} → ${esc(Array.isArray(e.to) ? e.to.join(", ") : e.to)}</small></a></li>`).join("");
  return (i) => {
    const e = estado.emails[i];
    return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Caixa de entrada (simulada)</title>
<style>body{margin:0;font:15px -apple-system,Segoe UI,Roboto,sans-serif;background:#f3f4f6;color:#111}
header{background:#111827;color:#fff;padding:12px 20px;font-weight:600;display:flex;justify-content:space-between}
header span{font-weight:400;opacity:.8}main{display:grid;grid-template-columns:340px 1fr;height:calc(100vh - 46px)}
ul{list-style:none;margin:0;padding:0;border-right:1px solid #e5e7eb;background:#fff;overflow:auto}
li a{display:block;padding:14px 16px;border-bottom:1px solid #eee;color:inherit;text-decoration:none}li.ativo a{background:#eef2ff}
.leitura{padding:20px;overflow:auto}.meta{background:#fff;border:1px solid #e5e7eb;border-radius:8px;padding:12px 16px;margin-bottom:12px}
iframe{width:100%;height:calc(100vh - 190px);border:1px solid #e5e7eb;border-radius:8px;background:#fff}.vazio{color:#6b7280;padding:40px;text-align:center}</style></head>
<body><header>Caixa de entrada (simulada) — parceiro<span>Resend mock · ${estado.emails.length} e-mail(s)</span></header>
<main><ul>${lista || '<li class="vazio">nenhum e-mail ainda</li>'}</ul><section class="leitura">${
      e ? `<div class="meta"><div><b>De:</b> ${esc(e.from)}</div><div><b>Para:</b> ${esc(Array.isArray(e.to) ? e.to.join(", ") : e.to)}</div><div><b>Assunto:</b> ${esc(e.subject)}</div></div><iframe srcdoc="${esc(e.html || e.text || "")}"></iframe>`
        : '<div class="vazio">Selecione um e-mail</div>'}</section></main></body></html>`;
  };
}

function paginaPainel() {
  const blocos = estado.painel.map((b) => `<section><h2>${esc(b.titulo)}</h2><div class="corpo">${b.html ?? `<pre>${esc(b.texto ?? "")}</pre>`}</div></section>`).join("");
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Painel — respostas das integrações</title>
<style>body{margin:0;font:15px -apple-system,Segoe UI,Roboto,sans-serif;background:#0f172a;color:#e2e8f0}
header{padding:14px 24px;border-bottom:1px solid #1e293b;font-weight:600;display:flex;gap:10px;align-items:center}.tag{font-size:12px;font-weight:500;background:#fde68a;color:#78350f;border-radius:6px;padding:2px 8px}
main{max-width:980px;margin:0 auto;padding:20px 24px}section{margin:0 0 18px;background:#111c33;border:1px solid #1e293b;border-radius:10px;overflow:hidden}
h2{margin:0;padding:10px 14px;font-size:14px;font-weight:600;background:#1e293b}.corpo{padding:12px 14px}pre{margin:0;white-space:pre-wrap;font:13px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace;color:#bae6fd}
.ok{color:#86efac}.erro{color:#fca5a5}table{border-collapse:collapse;width:100%;font-size:14px}td,th{border-bottom:1px solid #1e293b;padding:6px 8px;text-align:left}.vazio{color:#94a3b8;text-align:center;padding:60px}</style></head>
<body><header>Painel de integrações <span class="tag">simulação local — o que cada provedor recebeu e respondeu</span></header>
<main>${blocos || '<div class="vazio">nada registrado ainda</div>'}</main></body></html>`;
}

function paginaClaude() {
  const bolhas = estado.claude.map((m) =>
    `<div class="msg ${m.papel}"><div class="quem">${m.papel === "eu" ? "Gilda (parceira)" : "Claude"}</div><div class="balao">${m.html ?? esc(m.texto).replace(/\n/g, "<br>")}</div></div>`).join("");
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Claude (simulado) — MCP</title>
<style>body{margin:0;font:15px -apple-system,Segoe UI,Roboto,sans-serif;background:#faf9f5;color:#1f1e1a}
header{padding:14px 24px;border-bottom:1px solid #e8e6df;display:flex;gap:10px;align-items:center;font-weight:600}
header .tag{font-size:12px;font-weight:500;background:#fde68a;border-radius:6px;padding:2px 8px}
main{max-width:820px;margin:0 auto;padding:24px}.msg{margin:18px 0}.quem{font-size:12px;color:#6b6a63;margin-bottom:4px}
.balao{background:#fff;border:1px solid #e8e6df;border-radius:12px;padding:14px 16px;line-height:1.5}.eu .balao{background:#f0efe9}
table{border-collapse:collapse;width:100%;margin-top:8px;font-size:14px}td,th{border-bottom:1px solid #e8e6df;padding:6px 8px;text-align:left}
code{background:#f0efe9;padding:1px 5px;border-radius:4px;font-size:13px}.vazio{color:#6b6a63;text-align:center;padding:60px}</style></head>
<body><header>Claude <span class="tag">simulação local · conector MCP "Legal Connect"</span></header>
<main>${bolhas || '<div class="vazio">Aguardando a conversa…</div>'}</main></body></html>`;
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const p = url.pathname;
  estado.chamadas.push(`${req.method} ${p}`);
  if (estado.chamadas.length > 200) estado.chamadas.shift();
  try {
    // ---- utilitários
    if (p === "/_health") return json(res, { ok: true, config: estado.config, emails: estado.emails.length, chamadas: estado.chamadas.slice(-10) });
    if (p === "/_config" && req.method === "POST") { Object.assign(estado.config, JSON.parse(await lerCorpo(req) || "{}")); return json(res, { ok: true, config: estado.config }); }
    if (p === "/_reset" && req.method === "POST") { estado.emails = []; estado.claude = []; estado.painel = []; return json(res, { ok: true }); }

    // ---- Evolution API (WhatsApp)
    if (p.startsWith("/evolution/")) {
      if (req.headers.apikey !== EVO_KEY) return json(res, { status: 401, error: "Unauthorized", response: { message: ["apikey inválida"] } }, 401);
      let m;
      if ((m = p.match(/^\/evolution\/instance\/connectionState\/([^/]+)$/))) return json(res, { instance: { instanceName: decodeURIComponent(m[1]), state: "open" } });
      if ((m = p.match(/^\/evolution\/message\/sendText\/([^/]+)$/))) { const c = JSON.parse(await lerCorpo(req) || "{}"); estado.chamadas.push(`sendText→${c.number}: ${String(c.text ?? c.textMessage?.text ?? "").slice(0, 60)}`); return json(res, { key: { id: "MOCK" + Date.now() }, status: "PENDING" }, 201); }
      if (p.includes("/chat/getBase64FromMediaMessage/")) return json(res, { error: "sem mídia no mock" }, 404);
      return json(res, { error: "rota não simulada", p }, 404);
    }

    // ---- Comunica / DJEN
    if (p === "/api/v1/comunicacao") return json(res, publicacoesDjen(url.searchParams));

    // ---- Google OAuth (tela de consentimento simulada) + token + Gmail
    if (p === "/o/oauth2/v2/auth") {
      const redirect = url.searchParams.get("redirect_uri") || "";
      const state = url.searchParams.get("state") || "";
      const destino = `${redirect}?code=mock-code-${Date.now()}&state=${encodeURIComponent(state)}`;
      return html(res, `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Conta Google (simulação)</title>
<style>body{margin:0;font:15px Roboto,-apple-system,sans-serif;background:#f8f9fa;display:flex;align-items:center;justify-content:center;height:100vh}
.card{background:#fff;border:1px solid #dadce0;border-radius:12px;padding:40px 44px;width:420px;text-align:center}
h1{font-size:22px;font-weight:400;margin:12px 0 4px}.g{font-weight:700;font-size:26px;letter-spacing:-1px}.g b{color:#4285f4}.g i{color:#ea4335;font-style:normal}.g u{color:#fbbc05;text-decoration:none}.g s{color:#34a853;text-decoration:none}
p{color:#5f6368;line-height:1.5}.email{display:inline-block;border:1px solid #dadce0;border-radius:20px;padding:6px 14px;margin:10px 0 18px}
.perm{text-align:left;background:#f8f9fa;border-radius:8px;padding:12px 16px;margin:0 0 22px;font-size:14px}
button{background:#1a73e8;color:#fff;border:0;border-radius:6px;padding:10px 26px;font-size:15px;cursor:pointer}.tag{font-size:11px;color:#b45309;background:#fef3c7;border-radius:6px;padding:2px 8px;display:inline-block;margin-bottom:8px}</style></head>
<body><div class="card"><span class="tag">simulação local — nenhum dado vai ao Google</span><div class="g"><b>G</b><i>o</i><u>o</u><b>g</b><s>l</s><i>e</i></div>
<h1>Legal Connect quer acessar sua Conta do Google</h1><div class="email">${esc(estado.config.gmail_email)}</div>
<div class="perm">✉️ Ler os e-mails da caixa do INSS (somente leitura)</div>
<form method="get" action="${esc(redirect)}"><input type="hidden" name="code" value="mock-code-${Date.now()}"><input type="hidden" name="state" value="${esc(state)}"><button type="submit" id="permitir">Permitir</button></form>
<p style="font-size:12px;margin-top:18px">redireciona para <code>${esc(destino.slice(0, 60))}…</code></p></div></body></html>`);
    }
    if (p === "/token" && req.method === "POST") {
      const corpo = await lerCorpo(req);
      const ps = new URLSearchParams(corpo);
      return json(res, { access_token: "mock-access-" + Date.now(), refresh_token: ps.get("grant_type") === "refresh_token" ? undefined : "mock-refresh-token", scope: "https://www.googleapis.com/auth/gmail.readonly", token_type: "Bearer", expires_in: 3599 });
    }
    if (p.startsWith("/gmail/v1/users/")) {
      if (!String(req.headers.authorization || "").startsWith("Bearer mock-access-")) return json(res, { error: { code: 401, message: "Invalid Credentials" } }, 401);
      if (p.endsWith("/profile")) return json(res, { emailAddress: estado.config.gmail_email, messagesTotal: 1 });
      if (p.endsWith("/messages")) return json(res, { messages: [{ id: estado.config.msg_id, threadId: `thread-${estado.config.msg_id}` }], resultSizeEstimate: 1 });
      if (p.includes(`/messages/${estado.config.msg_id}`)) return json(res, emailInss());
      return json(res, { error: { code: 404, message: "Not Found" } }, 404);
    }

    // ---- Resend
    if (p === "/resend/emails" && req.method === "POST") {
      if (!String(req.headers.authorization || "").startsWith("Bearer ")) return json(res, { message: "missing api key" }, 401);
      const e = JSON.parse(await lerCorpo(req) || "{}");
      estado.emails.push({ ...e, recebido_em: new Date().toISOString() });
      return json(res, { id: "mock-email-" + estado.emails.length });
    }
    if (p === "/inbox") { const i = url.searchParams.has("i") ? Number(url.searchParams.get("i")) : estado.emails.length - 1; return html(res, paginaInbox()(i)); }

    // ---- Painel genérico (o que a API respondeu, pra aparecer no filme)
    if (p === "/painel/registrar" && req.method === "POST") { estado.painel.push(JSON.parse(await lerCorpo(req) || "{}")); return json(res, { ok: true }); }
    if (p === "/painel/limpar" && req.method === "POST") { estado.painel = []; return json(res, { ok: true }); }
    if (p === "/painel") return html(res, paginaPainel());

    // ---- Claude simulado
    if (p === "/claude/registrar" && req.method === "POST") { estado.claude.push(JSON.parse(await lerCorpo(req) || "{}")); return json(res, { ok: true, n: estado.claude.length }); }
    if (p === "/claude") return html(res, paginaClaude());

    return json(res, { error: "rota não simulada", p }, 404);
  } catch (e) {
    return json(res, { error: String(e?.message ?? e) }, 500);
  }
});

server.listen(PORT, "0.0.0.0", () => console.log(`mocks dos provedores em http://localhost:${PORT} (Docker: host.docker.internal:${PORT})`));

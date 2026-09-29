// Conferência do lote que está em "Validar no staging" no board, feita CONTRA O
// STAGING de verdade: banco `alhqbpbekmxpoibrrnbi`, edge functions do staging e
// o front servido em staging.marasandraconnect.com.
//
// É o que a Naira faria à mão, card por card, feito pelo Playwright e devolvido
// como relatório (relatorio.md + resultados.json), com um still por item e
// vídeo. Cada card vira um `item(...)`: passa (OK), falha (com o motivo) ou é
// "nada a conferir no staging" (nota — card de documento ou de script local).
//
// O que ela ainda decide depois: se o COMPORTAMENTO conferido é o que ela
// quer. A conferência responde "funciona como está escrito", não "é o certo".
//
// Rodar da raiz:
//   node e2e/demo/roteiros/conferencia-lote-staging.cjs
//   CARDS=357,402 node e2e/demo/roteiros/conferencia-lote-staging.cjs   # filtra
//   DEMO_BASE_URL=http://localhost:8080 node …                          # front local, banco de staging
//
// Escreve no escritório CANÁRIO do staging (o de teste, seed de 23/09) e
// devolve tudo no finally: permissões ajustadas, papel do financeiro, processo
// plantado, tokens do MCP. Nada toca o escritório padrão.

process.env.DEMO_BASE_URL = process.env.DEMO_BASE_URL || "https://staging.marasandraconnect.com";

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");
const { narrar, abrirEstudio } = require("../helpers.cjs");
const { REPO, BASE, DOM, admin, sessao, estadoNavegador, fn } = require("../staging.cjs");

const FILTRO = (process.env.CARDS || "").split(",").map((s) => s.trim().replace(/^#/, "")).filter(Boolean);
const MARCA = "[Conferência staging]";
const CNJ = "5009999-99.2026.4.03.6183";

const resultados = [];
let estudio, still;

async function item(codigo, titulo, f) {
  if (FILTRO.length && !FILTRO.includes(String(codigo).replace(/^#/, ""))) return;
  const t0 = Date.now();
  try {
    const obs = await f();
    resultados.push({ codigo, titulo, ok: true, obs: obs || "", ms: Date.now() - t0 });
    console.log(`  ✓ ${codigo} ${titulo}${obs ? " — " + obs : ""}`);
  } catch (e) {
    const motivo = String(e?.message ?? e).split("\n")[0].slice(0, 300);
    resultados.push({ codigo, titulo, ok: false, obs: motivo, ms: Date.now() - t0 });
    console.log(`  ✘ ${codigo} ${titulo} — ${motivo}`);
  }
}
function nota(codigo, titulo, obs) {
  if (FILTRO.length && !FILTRO.includes(String(codigo).replace(/^#/, ""))) return;
  resultados.push({ codigo, titulo, ok: null, obs });
  console.log(`  – ${codigo} ${titulo} — ${obs}`);
}
const falha = (m) => { throw new Error(m); };
async function visivel(loc, msg, ms = 20000) {
  try { await loc.first().waitFor({ state: "visible", timeout: ms }); } catch { falha(msg); }
}
/** O título da coluna do kanban que contém este texto (ou null). */
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
/** Títulos das colunas visíveis do kanban. */
async function colunasDoKanban(page) {
  return await page.evaluate(() => {
    for (const g of document.querySelectorAll("div.grid")) {
      const cols = [...g.children];
      if (cols.length < 3) continue;
      const t = cols.map((c) => c.querySelector("p")?.innerText?.split("\n")[0]?.replace(/\s*\d+\s*$/, "").trim()).filter(Boolean);
      if (t.length >= 3) return t;
    }
    return [];
  });
}
/** Uma chamada MCP com o token (JSON-RPC), como o Claude faria. */
let seqMcp = 0;
async function mcp(token, method, params = {}) {
  const { FN } = require("../staging.cjs");
  const r = await fetch(`${FN}/ia-mcp`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: ++seqMcp, method, params }),
  });
  const corpo = await r.json().catch(() => null);
  return { status: r.status, corpo, erroTool: corpo?.result?.isError === true, texto: JSON.stringify(corpo ?? {}) };
}
// Datas de calendário de Brasília (mesmas regras de e2e/datas.ts, que é TS).
// Um .cjs não importa o túnel TS (`src/lib/fuso.ts`); esta é a única cópia no roteiro.
const TZ = "America/Sao_Paulo";
const hojeBR = () => new Date().toLocaleDateString("en-CA", { timeZone: TZ });
const diaBR = (n) => {
  const [y, m, d] = hojeBR().split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
};
/** Sábado/domingo recuam para a sexta (regra do banco). */
const recua = (dia) => {
  const [y, m, d] = dia.split("-").map(Number);
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return new Date(Date.UTC(y, m - 1, d - (dow === 6 ? 1 : dow === 0 ? 2 : 0))).toISOString().slice(0, 10);
};
/** n dias úteis depois (mesma conta de `public.somar_dias_uteis`). */
const somarDiasUteis = (dia, n) => {
  const d = new Date(`${dia}T12:00:00Z`);
  for (let i = 0; i < n; ) { d.setUTCDate(d.getUTCDate() + 1); if (d.getUTCDay() % 6 !== 0) i++; }
  return d.toISOString().slice(0, 10);
};
const diaDoInstanteBR = (iso) => new Date(iso).toLocaleDateString("en-CA", { timeZone: TZ });
const dataBR = (dia) => dia.split("-").reverse().join("/");
function cpfValido() {
  const n = Array.from({ length: 9 }, () => Math.floor(Math.random() * 10));
  for (const p of [10, 11]) {
    const s = n.reduce((acc, v, i) => acc + v * (p - i), 0);
    n.push((s * 10) % 11 % 10);
  }
  return n.join("");
}

const sql = (q) => {
  const saida = execSync(`node scripts/msc-sql.mjs --staging ${JSON.stringify(q)}`, { cwd: REPO, encoding: "utf8" });
  return JSON.parse(saida.split("\n").filter((l) => !l.startsWith("[msc-sql]")).join("\n") || "[]");
};

(async () => {
  const inicio = new Date().toISOString();
  console.log(`conferência do lote — alvo: ${BASE}\n`);

  // ---------- contexto do staging ----------
  const { data: canario } = await admin.from("escritorios").select("id, nome").eq("slug", "canario").maybeSingle();
  if (!canario) throw new Error("escritório canário ausente no staging — rode `node scripts/seed-local-rbac.mjs --staging`");
  const ESC2 = canario.id;
  const { data: padrao } = await admin.from("escritorios").select("id, nome").eq("padrao_sistema", true).single();
  const ESC1 = padrao.id;

  const u = async (local) => {
    const { data } = await admin.from("usuarios").select("id, nome, email").eq("email", `${local}@${DOM}`).maybeSingle();
    if (!data) throw new Error(`conta ${local}@${DOM} ausente no staging`);
    return data;
  };
  const carla = await u("canario+admin");      // admin do Canário
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
  const casoHelena = await casoDe(helena);

  estudio = await abrirEstudio(process.env.SAIDA || "conferencia-lote-staging");
  still = estudio.still;
  const sessoes = {};
  const parte = async (email, escritorio) => {
    if (!sessoes[email]) sessoes[email] = await sessao(email);
    return await estudio.novaParte(estadoNavegador(sessoes[email].session, escritorio));
  };
  const como = async (email, escritorio) => {
    if (!sessoes[email]) sessoes[email] = await sessao(email);
    // client novo com o header do escritório (a sessão é reaproveitada)
    return await sessao(email, escritorio);
  };

  const desfazer = { processoJudicial: null, processoAdmin: null, solicitacao: null, tokens: [], ajustes: [], papelFabio: null, faseHelena: null, casos: [] };

  /** Caso descartável no Canário (cliente com a MARCA); apagado no finally. */
  const casoNovo = async (rotulo) => {
    const { data: cli, error: eCli } = await admin.from("clientes")
      .insert({ escritorio_id: ESC2, nome: `${MARCA} ${rotulo} ${Date.now()}`, cpf: cpfValido() })
      .select("id, nome").single();
    if (eCli) falha(`semear cliente: ${eCli.message}`);
    const { data: cs, error: eCs } = await admin.from("casos")
      .insert({ escritorio_id: ESC2, cliente_id: cli.id, tipo_beneficio: "Salário-maternidade", fase: "analise" })
      .select("id").single();
    if (eCs) falha(`semear caso: ${eCs.message}`);
    desfazer.casos.push({ caso: cs.id, cliente: cli.id });
    return { casoId: cs.id, nomeCliente: cli.nome };
  };
  const abrirAtividades = async (page, casoId) => {
    await page.goto(`${BASE}/casos/${casoId}`);
    await page.getByText("Atividades", { exact: true }).first().click();
  };

  try {
    // =====================================================================
    // #357 · a coluna do card vem do PROCESSO, não da fase do caso
    // =====================================================================
    // =====================================================================
    // #357 · a coluna do card vem do PROCESSO do item, não da fase do caso
    //
    // A primeira versão desta conferência plantou um processo JUDICIAL e exigiu
    // que a fase do caso seguisse 'analise'. Errado: existe gatilho que leva a
    // fase do caso para 'judicial' quando nasce processo judicial. O card foi
    // para "Judiciais", mas aí não dava para saber se foi pelo processo ou pela
    // fase — prova ambígua não é prova.
    //
    // Aqui o caso fica em 'judicial' (pelo gatilho) e o PEDIDO é ligado ao
    // processo ADMINISTRATIVO. Se a coluna viesse da fase, o card estaria em
    // "Judiciais". Estar em "Administrativo" só é possível se quem manda é o
    // processo do item.
    // =====================================================================
    await item("#357", "kanban do parceiro: a coluna vem do processo do item", async () => {
      const { data: sol } = await admin.from("solicitacoes_documento")
        .select("id, status, processo_admin_id, processo_judicial_id").eq("caso_id", casoHelena.id).eq("status", "pendente").limit(1).maybeSingle();
      if (!sol) falha("nenhuma solicitação pendente no caso da Helena — seed do Canário incompleto");
      if (casoHelena.fase !== "analise") falha(`o caso da Helena está em '${casoHelena.fase}', a conferência espera 'analise'`);

      const { page } = await parte(gilda.email, ESC2);
      await page.goto(`${BASE}/tarefas`);
      await visivel(page.getByText("Helena"), "o card da Helena não apareceu no quadro da parceira");
      const antes = await colunaCom(page, "Helena");
      await narrar(page, "#357 · o pedido da Helena está em análise — o caso não tem processo", 1600);
      await still(page, "357-antes-em-analise");
      if (antes !== "Em análise") falha(`antes de plantar processo, o card estava em '${antes}' (esperado 'Em análise')`);

      desfazer.faseHelena = casoHelena.fase;
      desfazer.solicitacao = { id: sol.id, admin: sol.processo_admin_id, judicial: sol.processo_judicial_id };

      // (1) processo judicial: o gatilho leva a FASE DO CASO para 'judicial'
      const { data: pj, error: ePj } = await admin.from("processos_judiciais")
        .insert({ caso_id: casoHelena.id, escritorio_id: ESC2, numero_processo: CNJ }).select("id").single();
      if (ePj) falha(`plantar processo judicial: ${ePj.message}`);
      desfazer.processoJudicial = pj.id;

      const { data: casoJud } = await admin.from("casos").select("fase").eq("id", casoHelena.id).single();
      if (casoJud.fase !== "judicial") falha(`esperava a fase do caso em 'judicial' depois do processo, veio '${casoJud.fase}'`);

      // (2) processo administrativo no MESMO caso, e o pedido passa a ser DELE
      const { data: pa, error: ePa } = await admin.from("processos_admin")
        .insert({ caso_id: casoHelena.id, escritorio_id: ESC2 }).select("id").single();
      if (ePa) falha(`plantar processo administrativo: ${ePa.message}`);
      desfazer.processoAdmin = pa.id;
      const { error: eLig } = await admin.from("solicitacoes_documento")
        .update({ processo_admin_id: pa.id, processo_judicial_id: null }).eq("id", sol.id);
      if (eLig) falha(`ligar o pedido ao processo administrativo: ${eLig.message}`);

      await page.reload();
      await visivel(page.getByText("Helena"), "o card da Helena desapareceu depois de ligar o processo");
      const depois = await colunaCom(page, "Helena");
      await narrar(page, "#357 · caso em fase JUDICIAL, pedido do processo ADMINISTRATIVO — o card segue o processo", 2000);
      await still(page, "357-depois-administrativo");
      if (depois !== "Administrativo") {
        falha(`com o caso em fase 'judicial' e o pedido no processo administrativo, o card ficou em '${depois}' (esperado 'Administrativo')`);
      }
      const { data: casoFim } = await admin.from("casos").select("fase").eq("id", casoHelena.id).single();
      return `caso em fase '${casoFim.fase}' e card em 'Administrativo' — a coluna veio do processo, não da fase`;
    });

    // =====================================================================
    // #364 · as colunas do quadro consolidado
    // =====================================================================
    await item("#364", "kanban por processo: as três colunas fixas no ar", async () => {
      const { page } = await parte(gilda.email, ESC2);
      await page.goto(`${BASE}/tarefas`);
      await visivel(page.getByText("Helena"), "quadro da parceira não carregou");
      const cols = await colunasDoKanban(page);
      await still(page, "364-colunas");
      for (const t of ["Em análise", "Administrativo", "Judiciais"]) {
        if (!cols.includes(t)) falha(`coluna '${t}' ausente (vi: ${cols.join(" · ")})`);
      }
      return `colunas no ar: ${cols.join(" · ")}`;
    });

    // =====================================================================
    // #385 · admin emite token do MCP para outra pessoa (que não é admin)
    // =====================================================================
    await item("#385", "MCP: admin emite o token de outra pessoa, sem promovê-la", async () => {
      const { data: papelGilda } = await admin.from("membros")
        .select("papel:papeis!inner(chave)").eq("escritorio_id", ESC2).eq("usuario_id", gilda.id).single();
      const chave = papelGilda?.papel?.chave;
      if (chave === "admin") falha("a Gilda está admin no staging — a conferência precisa dela como parceira");

      const c = await como(carla.email, ESC2);
      const r = await fn("ia-config", c.jwt, ESC2, { action: "token_criar", nome: `${MARCA} 385`, usuario_id: gilda.id, escopo: "leitura" });
      if (r.status !== 200 || !r.json?.token) falha(`emitir token: ${r.status} ${r.texto.slice(0, 140)}`);
      desfazer.tokens.push(r.json.prefixo);

      const uso = await mcp(r.json.token, "tools/call", { name: "buscar_casos", arguments: { limite: 1 } });
      if (uso.status !== 200) falha(`o token da parceira não funcionou: ${uso.status} ${uso.texto.slice(0, 140)}`);
      if (uso.erroTool) falha(`o MCP respondeu erro de ferramenta: ${uso.texto.slice(0, 140)}`);
      return `token emitido para a Gilda (papel '${chave}') e aceito pelo MCP na chamada real`;
    });

    // =====================================================================
    // #389 · documento
    // =====================================================================
    nota("#389", "docs(planning): QG da plataforma no plano de RBAC",
      "card de documento (planning/MULTI_TENANT_RBAC.md §QG) — nada a conferir na tela do staging");

    // =====================================================================
    // #394 · caso encerrado só reabre quando há gente por trás
    // =====================================================================
    await item("#394", "caso encerrado só reabre quando há gente por trás", async () => {
      const def = sql("select pg_get_functiondef(p.oid) as d from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='_reabre_caso_finalizado'");
      if (!def.length) falha("função public._reabre_caso_finalizado ausente no staging");
      const d = def[0].d;
      if (!/created_by is null/.test(d)) falha("a função no staging não confere `created_by` — está na versão antiga");
      if (/origem\s*=\s*'manual'/.test(d)) falha("a função no staging ainda filtra por origem = 'manual' (versão antiga)");
      const reg = sql("select nome from ops.migrations_aplicadas where nome='migration_reabre_caso_so_com_autor.sql'");
      if (!reg.length) falha("migration_reabre_caso_so_com_autor.sql não está no registro do staging");
      return "função no staging confere `created_by` (robô não reabre) e a migration está registrada; comportamento coberto pela spec frente-unica-e-dono-do-pedido na suíte de staging";
    });

    // =====================================================================
    // #395 · RBAC multi-tenant: isolamento, papel e a trava do QG
    // =====================================================================
    await item("#395", "RBAC: cada escritório vê só o seu; a trava do QG está ligada", async () => {
      const d = await como(diego.email, ESC2);
      const { data: vistos, error } = await d.sb.from("clientes").select("nome, escritorio_id");
      if (error) falha(`advogado do Canário lendo clientes: ${error.message}`);
      const deFora = (vistos ?? []).filter((c) => c.escritorio_id !== ESC2);
      if (deFora.length) falha(`o advogado do Canário viu ${deFora.length} cliente(s) de outro escritório`);
      if (!(vistos ?? []).length) falha("o advogado do Canário não viu nenhum cliente — header de escritório não chegou?");

      const aal2 = sql("select valor from app_config where chave='qg_exigir_aal2'");
      if (aal2[0]?.valor !== "true") falha(`qg_exigir_aal2 está '${aal2[0]?.valor}' no staging (esperado 'true')`);
      const sup = await como(`qg+suporte@${DOM}`, null);
      const recusa = await sup.sb.rpc("qg_escritorios", { p_limite: 1 });
      if (!recusa.error) falha("o QG aceitou uma sessão sem segundo fator — a trava não está pegando");
      if (!/duas etapas|AAL2/i.test(recusa.error.message)) falha(`o QG recusou por outro motivo: ${recusa.error.message}`);

      const { page } = await parte(diego.email, ESC2);
      await page.goto(`${BASE}/casos`);
      await visivel(page.getByText("Helena"), "a lista de casos do Canário não carregou");
      await narrar(page, "#395 · o advogado do Canário só vê o Canário", 1600);
      await still(page, "395-casos-do-canario");
      return `${vistos.length} cliente(s), todos do Canário; QG recusa sessão AAL1 ("${recusa.error.message.slice(0, 60)}…")`;
    });

    // =====================================================================
    // #405 · a auditoria segue a PERMISSÃO, não o papel admin
    // =====================================================================
    await item("#405", "auditoria: quem tem a permissão lê, mesmo sem ser admin", async () => {
      const c = await como(carla.email, ESC2);
      // estado limpo: sem ajuste individual para a assistente
      await c.sb.rpc("resetar_permissoes_do_membro", { p_usuario_id: elisa.id });
      // `auditoria_plataforma` é FUNÇÃO (a tela chama por rpc, equipe.tsx/auditoria.tsx),
      // não tabela — a primeira versão daqui usou .from() e levou "table not found".
      const e1 = await como(elisa.email, ESC2);
      const antes = await e1.sb.rpc("auditoria_plataforma", { p_limite: 5, p_offset: 0 });
      if (!antes.error && (antes.data ?? []).length > 0) {
        falha("a assistente leu a auditoria SEM a permissão — a trava não está pegando");
      }
      const motivoAntes = antes.error ? antes.error.message.slice(0, 60) : "0 linhas";

      const g = await c.sb.rpc("definir_permissao_do_membro", { p_usuario_id: elisa.id, p_permissao: "auditoria:ler", p_estado: "conceder" });
      if (g.error) falha(`conceder auditoria:ler para a assistente: ${g.error.message}`);
      desfazer.ajustes.push(elisa.id);

      const e2 = await como(elisa.email, ESC2);
      const depois = await e2.sb.rpc("auditoria_plataforma", { p_limite: 5, p_offset: 0 });
      if (depois.error) falha(`com a permissão, a leitura ainda falhou: ${depois.error.message}`);

      const { page } = await parte(elisa.email, ESC2);
      await page.goto(`${BASE}/auditoria`);
      await visivel(page.getByRole("heading", { name: /Auditoria/i }), "a tela de Auditoria não abriu para a assistente com a permissão");
      await narrar(page, "#405 · assistente com auditoria:ler — a tela abre sem ser admin", 1800);
      await still(page, "405-auditoria-por-permissao");
      return `sem a permissão: ${motivoAntes}; com a permissão: ${(depois.data ?? []).length} linha(s) e a tela de Auditoria abre`;
    });

    // =====================================================================
    // #399 · o admin ajusta na tela o que o papel dá
    // =====================================================================
    await item("#399", "permissões por pessoa: o ajuste aparece em /equipe", async () => {
      const c = await como(carla.email, ESC2);
      const { data: perms, error } = await c.sb.rpc("permissoes_do_membro", { p_usuario_id: elisa.id });
      if (error) falha(`permissoes_do_membro: ${error.message}`);
      // a RPC devolve (permissao, grupo, descricao, sensivel, do_papel, tem,
      // escopo, ajustada, definida_por_nome, definida_em)
      const linha = (perms ?? []).find((p) => p.permissao === "auditoria:ler");
      if (!linha) falha("auditoria:ler não apareceu na lista de permissões da assistente");
      if (linha.tem !== true) falha(`a RPC diz que a assistente NÃO tem auditoria:ler: ${JSON.stringify(linha)}`);
      if (linha.ajustada !== true) falha("a RPC não marcou a permissão como ajuste individual (ajustada=false)");
      if (linha.do_papel === true) falha("auditoria:ler veio do papel, não do ajuste — a conferência perderia o sentido");

      const { page } = await parte(carla.email, ESC2);
      await page.goto(`${BASE}/equipe`);
      await visivel(page.getByText("Elisa"), "a lista da equipe do Canário não carregou");
      await narrar(page, "#399 · a admin ajusta por pessoa o que o papel dá", 1700);
      await still(page, "399-equipe");
      return `ajuste individual de auditoria:ler na assistente: tem=${linha.tem}, ajustada=${linha.ajustada}, do_papel=${linha.do_papel}`;
    });

    // =====================================================================
    // #402 · o token do MCP vale enquanto quem emitiu ainda pode conceder
    // =====================================================================
    await item("#402", "MCP: o token cai quando o emissor perde a permissão", async () => {
      const c = await como(carla.email, ESC2);
      const g = await c.sb.rpc("definir_permissao_do_membro", { p_usuario_id: diego.id, p_permissao: "ia:mcp_conceder", p_estado: "conceder" });
      if (g.error) falha(`conceder ia:mcp_conceder ao advogado: ${g.error.message}`);
      desfazer.ajustes.push(diego.id);

      const d = await como(diego.email, ESC2);
      const r = await fn("ia-config", d.jwt, ESC2, { action: "token_criar", nome: `${MARCA} 402`, usuario_id: elisa.id, escopo: "leitura" });
      if (r.status !== 200 || !r.json?.token) falha(`o advogado com a permissão não conseguiu emitir: ${r.status} ${r.texto.slice(0, 140)}`);
      desfazer.tokens.push(r.json.prefixo);
      const token = r.json.token;

      const vivo = await mcp(token, "tools/call", { name: "buscar_casos", arguments: { limite: 1 } });
      if (vivo.status !== 200) falha(`token recém-emitido já não funciona: ${vivo.status} ${vivo.texto.slice(0, 140)}`);

      const t = await c.sb.rpc("definir_permissao_do_membro", { p_usuario_id: diego.id, p_permissao: "ia:mcp_conceder", p_estado: "papel" });
      if (t.error) falha(`tirar o ajuste do advogado: ${t.error.message}`);

      const morto = await mcp(token, "tools/call", { name: "buscar_casos", arguments: { limite: 1 } });
      if (morto.status !== 403) falha(`depois de tirar a permissão do emissor, o token respondeu ${morto.status} (esperado 403)`);
      if (!/nao pode mais conceder|não pode mais conceder/.test(morto.texto)) {
        falha(`403 por outro motivo: ${morto.texto.slice(0, 160)}`);
      }
      return "emissor não-admin com a permissão emite e o token funciona; tirado o ajuste, o MESMO token vira 403";
    });

    // =====================================================================
    // #401 · o glossário na tela do staging
    // =====================================================================
    await item("#401", "glossário: os termos novos estão na tela", async () => {
      const { page } = await parte(diego.email, ESC2);
      await page.goto(`${BASE}/glossario`);
      await visivel(page.getByRole("heading", { name: /Gloss/i }), "a tela do glossário não abriu");
      const faltando = [];
      for (const termo of ["Ajuste de permissão", "Permissão sensível", "Gate de permissão", "Documento ou andamento apagado"]) {
        const achou = await page.getByText(termo, { exact: false }).count();
        if (!achou) faltando.push(termo);
      }
      await narrar(page, "#401 · o glossário acompanha as permissões por pessoa", 1700);
      await still(page, "401-glossario");
      if (faltando.length) falha(`termo(s) ausente(s) na tela: ${faltando.join(" · ")}`);
      return "os 4 termos novos aparecem no glossário servido pelo staging";
    });

    // =====================================================================
    // #404 · documento
    // =====================================================================
    nota("#404", "docs: comunicado à equipe e plano do release",
      "card de documento (planning/COMUNICADO_PRODUCAO.md e planning/RELEASE_PRODUCAO.md) — nada a conferir na tela");

    // =====================================================================
    // #406 · script do ambiente local
    // =====================================================================
    nota("#406", "fix(local): a cópia do staging leva o schema private",
      "card de script local (`bun run local:copiar`) — não existe superfície no staging; provado rodando a cópia nesta máquina");

    // =====================================================================
    // #407 · toda mudança de acesso deixa linha na trilha
    // =====================================================================
    await item("#407", "trilha: mudança de acesso deixa linha com antes e depois", async () => {
      const c = await como(carla.email, ESC2);
      const { data: papelAntes } = await admin.from("membros")
        .select("papel:papeis!inner(chave)").eq("escritorio_id", ESC2).eq("usuario_id", fabio.id).single();
      const antesChave = papelAntes?.papel?.chave;
      desfazer.papelFabio = antesChave;

      const mudou = await c.sb.rpc("definir_papel", { p_usuario_id: fabio.id, p_papel: "assistente" });
      if (mudou.error) falha(`trocar o papel do financeiro: ${mudou.error.message}`);

      const { data: linha, error } = await admin.from("auditoria")
        .select("acao, recurso, recurso_id, detalhes, created_at")
        .eq("escritorio_id", ESC2).eq("acao", "equipe.papel_alterado")
        .order("created_at", { ascending: false }).limit(1).maybeSingle();
      if (error) falha(`ler a trilha: ${error.message}`);
      if (!linha) falha("nenhuma linha 'equipe.papel_alterado' na trilha do Canário");
      if (new Date(linha.created_at) < new Date(inicio)) falha("a linha da trilha é anterior a esta conferência — a troca não foi auditada");
      const det = JSON.stringify(linha.detalhes ?? {});
      if (!/assistente/.test(det)) falha(`a linha não guarda o depois: ${det.slice(0, 160)}`);
      if (antesChave && !new RegExp(antesChave).test(det)) falha(`a linha não guarda o antes ('${antesChave}'): ${det.slice(0, 160)}`);

      // e a permissão ajustada também deixou linha (do item #405/#399)
      const { data: perm } = await admin.from("auditoria")
        .select("acao, detalhes, created_at").eq("escritorio_id", ESC2).eq("acao", "equipe.permissao_ajustada")
        .gte("created_at", inicio).order("created_at", { ascending: false }).limit(1).maybeSingle();
      const extra = perm ? " · ajuste de permissão também auditado" : "";
      return `papel ${antesChave} → assistente registrado com antes e depois${extra}`;
    });

    // =====================================================================
    // #408 · os túneis: escopo do resumo, contagem checada e fuso
    // =====================================================================
    await item("#408", "túneis: o resumo do dia é de um escritório só", async () => {
      const c = await como(carla.email, ESC2);
      const r = await fn("digest-diario", c.jwt, ESC2, { dry_run: true, horas: 720 });
      if (r.status !== 200) falha(`digest-diario: ${r.status} ${r.texto.slice(0, 160)}`);
      const html = String(r.json?.html ?? "");
      if (!html.length) falha("o dry_run não devolveu HTML");
      const { data: deFora } = await admin.from("clientes").select("nome").eq("escritorio_id", ESC1).limit(40);
      const vazou = (deFora ?? []).map((x) => x.nome).filter((n) => n && n.length > 8 && html.includes(n));
      if (vazou.length) falha(`nome de cliente de outro escritório no resumo do Canário: ${vazou.slice(0, 2).join(", ")}`);
      return `HTML de ${html.length} bytes, nenhum dos ${(deFora ?? []).length} nomes do escritório padrão aparece`;
    });

    // A primeira versão procurou data dd/mm/aaaa na tela da equipe: lá o
    // `dataBR` só aparece em quem foi DESLIGADO, e no Canário não há ninguém
    // desligado. O fuso na tela é provado pela spec `datas-fuso-brasilia`
    // (contexto do navegador em Europe/Madrid) — aqui fica a contagem checada.
    await item("#408b", "túneis: a contagem do desligamento vem checada do banco", async () => {
      const { page } = await parte(carla.email, ESC2);
      await page.goto(`${BASE}/equipe`);
      await visivel(page.getByText("Elisa"), "a lista da equipe não carregou");
      const acoes = page.getByRole("button", { name: /Ações de Elisa/i }).first();
      await visivel(acoes, "o menu de ações da assistente não apareceu para a admin");
      await acoes.click();
      const desligar = page.getByRole("menuitem", { name: /Desligar da equipe/i }).first();
      await visivel(desligar, "o item 'Desligar da equipe' não apareceu no menu");
      await desligar.click();
      await visivel(page.getByText(/tarefa\(s\) aberta\(s\)/i),
        "o diálogo de desligar não mostrou a contagem de tarefas abertas");
      const texto = await page.locator("body").innerText();
      const m = texto.match(/tem\s+(\d+)\s+tarefa\(s\) aberta\(s\)/i);
      await narrar(page, "#408b · a contagem vem por lerContagem: falha vira erro, não vira zero", 1900);
      await still(page, "408-contagem-checada");
      const cancelar = page.getByRole("button", { name: /Cancelar/i }).first();
      if (await cancelar.count()) await cancelar.click(); else await page.keyboard.press("Escape");
      if (!m) falha("não achei o número de tarefas abertas no diálogo");
      const { count: real } = await admin.from("tarefas").select("id", { count: "exact", head: true })
        .eq("responsavel_id", elisa.id).eq("status", "a_fazer");
      if (Number(m[1]) !== Number(real)) falha(`a tela mostrou ${m[1]} e o banco tem ${real}`);
      return `a tela mostrou ${m[1]} tarefa(s) aberta(s), igual ao banco — pelo túnel lerContagem`;
    });

    // =====================================================================
    // #432 · um só componente de seleção, com a busca ligando sozinha
    //
    // A régua do componente tem DOIS lados: lista longa TEM que oferecer busca,
    // lista curta NÃO pode (senão o campo vira ruído onde rolar é mais rápido).
    // Provar só um lado provaria pouco — "tem busca" se consegue ligando busca
    // em tudo, que é justamente o oposto do pedido.
    //
    // O staging dá o experimento pronto: o MESMO campo (cliente, na gaveta de
    // agendamento — a tela da reclamação) tem 453 clientes no escritório padrão
    // e 4 no Canário. Mesmo componente, mesma tela, dois tamanhos de lista.
    //
    // Único item que entra no escritório PADRÃO (só leitura: abre a gaveta e
    // some com Escape, nada é salvo). Usa `e2e+admin`, que é a conta da suíte
    // E2E — não rodar esta conferência ao mesmo tempo que `bun run e2e:staging`,
    // senão as duas sessões se derrubam pela rotação de refresh token.
    // =====================================================================
    await item("#432", "dropdown: a busca liga sozinha pelo tamanho da lista", async () => {
      const LIMITE = 8;
      const abrirCliente = async (page) => {
        await page.goto(`${BASE}/agenda`);
        await visivel(page.getByRole("heading", { name: /Agenda/i }), "a tela da agenda não abriu");
        await page.getByRole("button", { name: /Novo evento/i }).first().click();
        const campo = page.locator('button[role="combobox"]').filter({ hasText: /Sem cliente/i }).first();
        await visivel(campo, "o campo de cliente não apareceu na gaveta de agendamento");
        await campo.click();
        await page.waitForTimeout(500);
        return {
          opcoes: await page.getByRole("option").count(),
          busca: await page.locator("[data-selecao-busca]").count(),
        };
      };

      // lado longo — escritório padrão (453 clientes)
      const a = await parte(`e2e+admin@${DOM}`, ESC1);
      const longo = await abrirCliente(a.page);
      await narrar(a.page, "#432 · lista longa: a busca aparece sozinha", 1900);
      await still(a.page, "432-lista-longa-com-busca");
      if (longo.opcoes < LIMITE) falha(`esperava lista longa no escritório padrão e vieram ${longo.opcoes} opções`);
      if (!longo.busca) falha(`${longo.opcoes} clientes e nenhum campo de busca — é a reclamação original, de volta`);
      // A busca tem que ACHAR, não só esvaziar. Filtrar para zero passaria com
      // uma lista quebrada — é o mesmo número. Então procura um cliente que
      // existe de verdade no escritório e cobra que ele fique na tela.
      const { data: alvo } = await admin.from("clientes").select("nome")
        .eq("escritorio_id", ESC1).not("nome", "is", null).order("nome").limit(1).maybeSingle();
      if (!alvo?.nome) falha("não achei nome de cliente no escritório padrão para procurar");
      // O nome INTEIRO, não o primeiro pedaço: o espelho do staging anonimiza
      // para "Cliente A70492", e aí procurar "Cliente" casa com os 453 — a
      // busca pareceria quebrada estando certa. Foi o que aconteceu na 1ª volta.
      const pedaco = alvo.nome;
      const escapado = pedaco.replace(/[.*+?^${}()|[\]\\]/g, (c) => "\\" + c);
      await a.page.locator("[data-selecao-busca]").first().fill(pedaco);
      await a.page.waitForTimeout(600);
      const depois = await a.page.getByRole("option").count();
      if (depois === 0) falha(`procurei "${pedaco}", que é de um cliente real, e a lista ficou vazia`);
      if (depois >= longo.opcoes) falha(`a busca não filtrou: ${longo.opcoes} antes, ${depois} depois`);
      const achou = await a.page.getByRole("option", { name: new RegExp(escapado, "i") }).count();
      if (!achou) falha(`sobraram ${depois} opções mas nenhuma casa com "${pedaco}"`);
      await a.page.keyboard.press("Escape");

      // lado curto — Canário (4 clientes)
      const { page } = await parte(carla.email, ESC2);
      const curto = await abrirCliente(page);
      await narrar(page, "#432 · lista curta: sem campo de busca, rolar é mais rápido", 1900);
      await still(page, "432-lista-curta-sem-busca");
      if (curto.opcoes >= LIMITE) falha(`esperava lista curta no Canário e vieram ${curto.opcoes} opções`);
      if (curto.busca) falha(`só ${curto.opcoes} opções e ainda assim ofereceu busca`);
      await page.keyboard.press("Escape");

      return `mesmo campo, dois escritórios: ${longo.opcoes} opções → com busca ("${pedaco}" deixa ${depois}, todas casando); ${curto.opcoes} opções → sem busca`;
    });


    // =====================================================================
    // #315 · andamento com a data do fato
    //
    // O sintoma: um deferimento de julho lançado hoje ia para o TOPO da lista.
    // Aqui: um andamento de hoje já no caso, e o advogado lança pela tela um de
    // 21/07. Prova dupla: a data gravada é a informada, e na tela o de hoje fica
    // ACIMA do retroativo (a lista ordena pela data do fato, não pela gravação).
    // A parte do robô do e-mail só roda com e-mail de verdade: aqui confere-se
    // que a function publicada é posterior ao merge.
    // =====================================================================
    await item("#315", "andamento com a data do fato: retroativo entra na ordem", async () => {
      const { casoId } = await casoNovo("315");
      const tituloHoje = `${MARCA} andamento de hoje`;
      const tituloAntigo = `${MARCA} deferimento de julho`;
      const { error: eHoje } = await admin.from("andamentos").insert({
        caso_id: casoId, escritorio_id: ESC2, origem: "interno", titulo: tituloHoje,
        data_evento: new Date().toISOString(), visivel_parceiro: false,
      });
      if (eHoje) falha(`semear andamento de hoje: ${eHoje.message}`);

      const { page } = await parte(diego.email, ESC2);
      await abrirAtividades(page, casoId);
      await page.getByRole("button", { name: "Novo", exact: true }).first().click();
      await visivel(page.getByRole("heading", { name: /Novo andamento/ }), "o formulário de novo andamento não abriu");
      await page.getByPlaceholder("Ex.: Documentos recebidos").fill(tituloAntigo);
      await page.getByLabel("Data da publicação").fill("2026-07-21T09:00");
      await narrar(page, "#315 · lançado hoje, com a data em que aconteceu: 21/07/2026", 1600);
      await still(page, "315-form-data-da-publicacao");
      await page.getByRole("button", { name: "Adicionar" }).click();
      const confere = page.getByRole("button", { name: "Salvar assim mesmo" });
      if (await confere.isVisible().catch(() => false)) await confere.click();
      await visivel(page.getByText("Andamento adicionado"), "o andamento não foi adicionado");

      const { data: gravado } = await admin.from("andamentos").select("data_evento")
        .eq("caso_id", casoId).eq("titulo", tituloAntigo).single();
      if (!gravado) falha("o andamento não está no banco");
      const esperado = new Date("2026-07-21T12:00:00Z").getTime();
      if (new Date(gravado.data_evento).getTime() !== esperado) {
        falha(`data gravada ${gravado.data_evento}, esperada 2026-07-21 09:00 de Brasília`);
      }
      await visivel(page.getByText(tituloAntigo), "o retroativo não apareceu na lista do caso");
      // O bloco "Andamentos Gerais" fica abaixo da dobra: sem rolar, o still
      // não mostra os dois — e a prova da ordem tem que estar na imagem.
      await page.getByText(tituloHoje).first().scrollIntoViewIfNeeded();
      await page.mouse.wheel(0, 120);
      const yHoje = (await page.getByText(tituloHoje).first().boundingBox())?.y;
      const yAntigo = (await page.getByText(tituloAntigo).first().boundingBox())?.y;
      await narrar(page, "#315 · o de hoje fica em cima; o de julho, na ordem do calendário", 1800);
      await still(page, "315-ordem-cronologica");
      if (yHoje == null || yAntigo == null) falha("não achei os dois andamentos na tela para comparar a ordem");
      if (!(yHoje < yAntigo)) falha("o andamento de julho ficou ACIMA do de hoje — é o sintoma original");

      const lista = JSON.parse(execSync("bunx supabase functions list --project-ref alhqbpbekmxpoibrrnbi -o json",
        { cwd: REPO, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }));
      const robo = (Array.isArray(lista) ? lista : lista.functions).find((f) => f.slug === "inss-email-processor");
      const deploy = new Date(robo.updated_at);
      const merge = new Date("2026-09-29T14:59:38Z"); // merge do PR #393
      if (deploy < merge) falha(`inss-email-processor publicado em ${deploy.toISOString()}, antes do merge do #393`);
      return `gravado 21/07/2026 09:00 e listado abaixo do de hoje; robô do e-mail publicado ${deploy.toISOString().slice(0, 16)}Z, depois do merge (a data do e-mail em si pede e-mail real)`;
    });

    // =====================================================================
    // #397 · relógio de prazos: datas fixas e trava no banco
    //
    // Indeferido há 12 dias (a análise chega como o robô do e-mail grava). O
    // relógio abre com as datas fixas a partir da origem; o advogado decide
    // "Ajuizar" pela tela e a montagem nasce no D+20 — não em hoje + prazo. Aí a
    // mesma sessão tenta empurrar o prazo pela API, sem tela: o gatilho recusa.
    // =====================================================================
    await item("#397", "relógio do caso: datas fixas, montagem no D+20 e trava no banco", async () => {
      const D = -12;
      const { casoId, nomeCliente } = await casoNovo("397");
      const { data: proc, error: eProc } = await admin.from("processos_admin")
        .insert({ caso_id: casoId, escritorio_id: ESC2, numero_requerimento: "3970000397", data_protocolo: diaBR(-60) })
        .select("id").single();
      if (eProc) falha(`semear processo: ${eProc.message}`);
      const tituloAnalise = `Analise de Indeferimento - ${nomeCliente}`;
      const { error: eAn } = await admin.from("tarefas").insert({
        caso_id: casoId, escritorio_id: ESC2, processo_admin_id: proc.id, responsavel_id: diego.id,
        tipo: "interna", prioridade: 1, titulo: tituloAnalise, due_at: new Date().toISOString(),
        origem: "sync_inss_email",
        metadata: { template: "indeferido", analise_indeferimento: true, prazo_fatal: true, data_indeferimento: diaBR(D) },
      });
      if (eAn) falha(`semear análise: ${eAn.message}`);

      const { data: rel } = await admin.from("relogios_prazo")
        .select("id, origem_em, planejado_em, limite_em, status").eq("caso_id", casoId).maybeSingle();
      if (!rel) falha("a análise do indeferimento não abriu relógio");
      const quer = { origem_em: diaBR(D), planejado_em: recua(diaBR(D + 30)), limite_em: recua(diaBR(D + 40)), status: "aberto" };
      for (const [k, v] of Object.entries(quer)) if (rel[k] !== v) falha(`relógio: ${k} = ${rel[k]}, esperado ${v}`);

      const { page } = await parte(diego.email, ESC2);
      await abrirAtividades(page, casoId);
      await visivel(page.getByText(tituloAnalise), "a análise não apareceu nas atividades do caso");
      await page.locator("div.group").filter({ hasText: tituloAnalise }).first().getByText(tituloAnalise).click();
      await visivel(page.getByRole("heading", { name: "Editar tarefa" }), "a análise não abriu");
      await narrar(page, "#397 · indeferido há 12 dias: a análise decide ajuizar", 1600);
      await page.getByRole("button", { name: "Ajuizar (montagem de inicial)" }).click();

      let montagem = null;
      for (let i = 0; i < 30 && !montagem; i++) {
        const { data } = await admin.from("tarefas").select("id, titulo, due_at, metadata")
          .eq("caso_id", casoId).eq("metadata->>relogio_etapa", "montagem").maybeSingle();
        montagem = data;
        if (!montagem) await page.waitForTimeout(500);
      }
      if (!montagem) falha("a montagem da inicial não nasceu depois do Ajuizar");
      const noD20 = recua(diaBR(D + 20));
      if (diaDoInstanteBR(montagem.due_at) !== noD20) {
        falha(`montagem vence ${diaDoInstanteBR(montagem.due_at)}, esperado ${noD20} (D+20 fixo, não hoje + prazo)`);
      }

      await abrirAtividades(page, casoId);
      await visivel(page.getByText(montagem.titulo), "a montagem não apareceu nas atividades");
      await page.locator("div.group").filter({ hasText: montagem.titulo }).first().getByText(montagem.titulo).click();
      const linha = page.getByTestId("relogio-linha");
      await visivel(linha, "a linha do relógio não aparece na tarefa de montagem");
      const textoLinha = await linha.innerText();
      await narrar(page, "#397 · a montagem nasce no D+20 e a linha mostra onde o caso está no relógio", 1900);
      await still(page, "397-montagem-no-d20");
      if (!textoLinha.includes(`Montagem da inicial até ${dataBR(noD20)}`)) falha(`linha do relógio: "${textoLinha}"`);

      const c = await como(diego.email, ESC2);
      const longe = new Date(Date.now() + 40 * 86_400_000).toISOString();
      const { error: eTrava } = await c.sb.from("tarefas").update({ due_at: longe }).eq("id", montagem.id);
      if (eTrava?.code !== "MSC01") falha(`adiar pela API passou do gatilho (erro: ${eTrava?.code ?? "nenhum"})`);
      const { data: depois } = await admin.from("tarefas").select("due_at").eq("id", montagem.id).single();
      if (diaDoInstanteBR(depois.due_at) !== noD20) falha("o prazo mudou mesmo com o gatilho recusando");

      return `relógio ${dataBR(rel.origem_em)} → protocolo ${dataBR(rel.planejado_em)}, limite ${dataBR(rel.limite_em)}; montagem no D+20 (${dataBR(noD20)}); adiar pela API sem tela → MSC01, prazo intacto`;
    });

    // =====================================================================
    // #440 · template Concedido pela tela
    //
    // O erro: "permission denied for function implementacao_cadencia" no meio
    // do template, com cópia parcial a cada tentativa. Aqui o advogado aplica o
    // Concedido pela tela e cobra-se o conjunto INTEIRO: 3 tarefas, o
    // acompanhamento vencendo em 5 dias úteis (conta do gatilho) e 1 andamento.
    // E a régua estrutural: o túnel não acusa função fechada no caminho.
    // =====================================================================
    await item("#440", "template Concedido pela tela: conjunto inteiro, sem permission denied", async () => {
      const { casoId, nomeCliente } = await casoNovo("440");
      const { page } = await parte(diego.email, ESC2);
      await abrirAtividades(page, casoId);
      await page.getByRole("button", { name: "Nova tarefa" }).click();
      await visivel(page.getByRole("heading", { name: "Nova tarefa" }), "o formulário de nova tarefa não abriu");
      await visivel(page.getByRole("combobox").filter({ hasText: nomeCliente }), "o cliente não veio preenchido");
      await page.getByRole("combobox").filter({ hasText: "Escolha um template" }).click();
      await page.getByRole("option", { name: /Concedido/ }).click();
      await visivel(page.getByText("Responsáveis das outras tarefas do template"), "o template não preencheu os itens");
      await narrar(page, "#440 · o Concedido: análise, baixar PA e o acompanhamento de implementação", 1700);
      await still(page, "440-template-concedido");
      await page.getByRole("button", { name: "Salvar" }).click();

      let tarefas = [];
      for (let i = 0; i < 30 && tarefas.length < 3; i++) {
        const { data } = await admin.from("tarefas").select("titulo, due_at, metadata").eq("caso_id", casoId);
        tarefas = data ?? [];
        if (tarefas.length < 3) await page.waitForTimeout(500);
      }
      const negado = await page.getByText(/permission denied/i).count();
      await still(page, "440-depois-de-salvar");
      if (negado) falha(`a tela mostrou "permission denied" (${tarefas.length} tarefa(s) gravada(s))`);
      if (tarefas.length !== 3) falha(`gravou ${tarefas.length} tarefa(s), esperado 3: ${tarefas.map((t) => t.titulo).join(" | ")}`);
      const acomp = tarefas.find((t) => t.metadata?.acompanhamento_implementacao === true);
      if (!acomp) falha("sem a tarefa de acompanhamento de implementação");
      const cinco = somarDiasUteis(hojeBR(), 5);
      if (diaDoInstanteBR(acomp.due_at) !== cinco) falha(`acompanhamento vence ${diaDoInstanteBR(acomp.due_at)}, esperado ${cinco} (5 dias úteis)`);
      const { count: ands } = await admin.from("andamentos").select("id", { count: "exact", head: true })
        .eq("caso_id", casoId).eq("metadata->>template_aplicado", "concedido");
      if (ands !== 1) falha(`${ands} andamento(s) do template, esperado 1`);
      const [{ n }] = sql("select count(*) as n from private.funcoes_fechadas_no_caminho()");
      if (Number(n) !== 0) falha(`o túnel acusa ${n} função(ões) fechada(s) no caminho de gatilho/policy`);
      return `3 tarefas + 1 andamento; acompanhamento em 5 dias úteis (${dataBR(cinco)}); túnel: 0 fechadas no caminho`;
    });

    // =====================================================================
    // #400 · o filme
    // =====================================================================
    nota("#400", "filme de apresentação das permissões por pessoa",
      "entregue como vídeo (e2e/demo/roteiros/permissoes-por-pessoa.cjs) — card de artefato, não de tela");

  } finally {
    console.log("\ndevolvendo o staging ao estado de antes…");
    const passo = async (rotulo, f) => { try { await f(); console.log(`  ok  ${rotulo}`); } catch (e) { console.log(`  (!) ${rotulo}: ${String(e.message).slice(0, 140)}`); } };
    const c = sessoes[carla.email] ? await sessao(carla.email, ESC2) : null;

    if (desfazer.solicitacao) {
      await passo("pedido volta aos processos de antes", () => admin.from("solicitacoes_documento")
        .update({ processo_admin_id: desfazer.solicitacao.admin, processo_judicial_id: desfazer.solicitacao.judicial })
        .eq("id", desfazer.solicitacao.id));
    }
    if (desfazer.processoJudicial) {
      await passo("processo judicial plantado apagado", () => admin.from("processos_judiciais").delete().eq("id", desfazer.processoJudicial));
    }
    if (desfazer.processoAdmin) {
      await passo("processo administrativo plantado apagado", () => admin.from("processos_admin").delete().eq("id", desfazer.processoAdmin));
    }
    if (desfazer.faseHelena) {
      await passo(`fase do caso da Helena volta a ${desfazer.faseHelena}`, () => admin.from("casos")
        .update({ fase: desfazer.faseHelena }).eq("id", casoHelena.id));
    }
    if (desfazer.tokens.length) {
      await passo("tokens do MCP apagados", () => admin.from("ia_tokens").delete().like("nome", `${MARCA}%`));
      await passo("ações do MCP da conferência apagadas", () => admin.from("ia_acoes").delete().eq("superficie", "mcp").gte("created_at", inicio));
    }
    if (c) {
      for (const id of [...new Set(desfazer.ajustes)]) {
        await passo(`ajustes individuais de ${id.slice(0, 8)} resetados`, () => c.sb.rpc("resetar_permissoes_do_membro", { p_usuario_id: id }));
      }
      if (desfazer.papelFabio) {
        await passo(`papel do financeiro volta a ${desfazer.papelFabio}`, () => c.sb.rpc("definir_papel", { p_usuario_id: fabio.id, p_papel: desfazer.papelFabio }));
      }
    }
    await passo("processo da conferência (por número) apagado", () => admin.from("processos_judiciais").delete().eq("numero_processo", CNJ));
    for (const { caso, cliente } of desfazer.casos) {
      const apaga = async (tabela, col, valor) => {
        const { error } = await admin.from(tabela).delete().eq(col, valor);
        if (error) throw new Error(`${tabela}: ${error.message}`);
      };
      await passo(`caso descartável ${caso.slice(0, 8)} apagado`, async () => {
        const { data: ts } = await admin.from("tarefas").select("id").eq("caso_id", caso);
        for (const t of ts ?? []) await apaga("pedidos_prorrogacao", "tarefa_id", t.id);
        await apaga("tarefas", "caso_id", caso);
        await apaga("relogios_prazo", "caso_id", caso);
        await apaga("andamentos", "caso_id", caso);
        await apaga("processos_admin", "caso_id", caso);
        await apaga("processos_judiciais", "caso_id", caso);
        await apaga("casos", "id", caso);
        await apaga("clientes", "id", cliente);
      });
    }

    if (estudio) {
      const clipes = await estudio.encerrar();
      const ok = resultados.filter((r) => r.ok === true).length;
      const ruim = resultados.filter((r) => r.ok === false).length;
      const notas = resultados.filter((r) => r.ok === null).length;
      let md = `# Conferência do lote em "Validar no staging"\n\n`;
      md += `Feita contra o STAGING (${BASE}, banco \`alhqbpbekmxpoibrrnbi\`) em `;
      md += `${new Date().toLocaleString("pt-BR", { timeZone: TZ })}, pelo Playwright.\n\n`;
      md += `**${ok} OK · ${ruim} falhou · ${notas} nota(s).** Stills em \`stills/\`, vídeo em \`video/\`.\n\n`;
      md += `O que isto responde: "o que está no staging funciona como está escrito". O que fica para você: se o comportamento é o que você quer.\n\n`;
      md += `| Card | Resultado | O que foi conferido |\n|---|---|---|\n`;
      for (const r of resultados) {
        const sinal = r.ok === true ? "✅ OK" : r.ok === false ? "❌ FALHOU" : "ℹ️ nota";
        md += `| ${r.codigo} · ${r.titulo} | ${sinal} | ${(r.obs || "").replace(/\|/g, "\\|")} |\n`;
      }
      fs.writeFileSync(path.join(estudio.saida, "relatorio.md"), md);
      fs.writeFileSync(path.join(estudio.saida, "resultados.json"), JSON.stringify(resultados, null, 2));
      console.log(`\nclipes: ${clipes.length} | OK ${ok} · falhou ${ruim} · notas ${notas}`);
      console.log("saída:", estudio.saida);
    }
  }
})().catch((e) => { console.error("FALHA:", e); process.exit(1); });

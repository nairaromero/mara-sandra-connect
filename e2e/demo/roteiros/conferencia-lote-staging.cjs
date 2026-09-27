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

  const desfazer = { processoJudicial: null, processoAdmin: null, solicitacao: null, tokens: [], ajustes: [], papelFabio: null, faseHelena: null };

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

    if (estudio) {
      const clipes = await estudio.encerrar();
      const ok = resultados.filter((r) => r.ok === true).length;
      const ruim = resultados.filter((r) => r.ok === false).length;
      const notas = resultados.filter((r) => r.ok === null).length;
      let md = `# Conferência do lote em "Validar no staging"\n\n`;
      md += `Feita contra o STAGING (${BASE}, banco \`alhqbpbekmxpoibrrnbi\`) em `;
      md += `${new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}, pelo Playwright.\n\n`;
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

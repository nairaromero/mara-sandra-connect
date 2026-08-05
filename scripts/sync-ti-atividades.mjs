#!/usr/bin/env node
// sync-ti-atividades.mjs — sincroniza as ATIVIDADES do Tramitacao Inteligente
// (tarefas, prazos e pericias) com a tabela `tarefas`.
//
// Substitui o importar-ti-tarefas.mjs, que dependia de um JSON extraido a mao
// pelo Chrome logado. O endpoint /api/v1/atividades responde pelo TI_TOKEN,
// entao da pra sincronizar direto pela API — e, ao contrario do importador
// antigo, este script tambem ATUALIZA o que mudou no TI, nao so insere.
//
// Mapeamento de tipo:
//   Task -> interna | Deadline -> prazo | MedicalExam -> pericia
//   Income e Event sao IGNORADOS de proposito: Income e lancamento financeiro
//   (348 deles no TI hoje) e viraria lixo na lista de tarefas.
//
// Chave de dedup: metadata->>'ti_uuid' (uuid da atividade no TI). NAO usar o
// 'ti_iid' da migracao antiga — aquele numero vinha da tela do TI e nao bate
// com o `id` da API.
//
// Regras de atualizacao (TI e a fonte da verdade, com uma excecao):
//   - titulo, descricao, due_at, tipo: sempre alinhados com o TI.
//   - concluida no TI  -> marca 'feito' no app.
//   - concluida no APP mas nao no TI -> NAO desmarca. Assimetria proposital:
//     desfazer trabalho de alguem e pior do que deixar uma tarefa a mais.
//   - responsavel: so preenche quando esta vazio no app, pra nao desfazer
//     redistribuicao feita aqui dentro.
//
// Uso:
//   node scripts/sync-ti-atividades.mjs --dry-run
//   node scripts/sync-ti-atividades.mjs

import fs from "node:fs";
import path from "node:path";

const PROJECT_REF = process.env.SUPABASE_PROJECT_REF || "llugytkdsfsrciavhrfw";
const TI_BASE = "https://planilha.tramitacaointeligente.com.br/api/v1";
const DRY_RUN = process.argv.includes("--dry-run");
const CHUNK = 40;
const TIPO = { Task: "interna", Deadline: "prazo", MedicalExam: "pericia" };

function lerEnv(nome) {
  try {
    const txt = fs.readFileSync(path.join(process.cwd(), ".env.local"), "utf8");
    const m = txt.match(new RegExp("^" + nome + "=(.*)$", "m"));
    return m ? m[1].trim().replace(/^"|"$/g, "") : null;
  } catch {
    return null;
  }
}
const SB_TOKEN = lerEnv("SUPABASE_ACCESS_TOKEN");
const TI_TOKEN = lerEnv("TI_TOKEN");
if (!SB_TOKEN || !TI_TOKEN) {
  console.error("ERRO: SUPABASE_ACCESS_TOKEN e/ou TI_TOKEN ausentes no .env.local");
  process.exit(1);
}

async function runSql(sql) {
  const resp = await fetch(
    `https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${SB_TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify({ query: sql }),
    },
  );
  const text = await resp.text();
  if (!resp.ok) throw new Error(`SQL HTTP ${resp.status}: ${text.slice(0, 400)}`);
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function sqlStr(v) {
  if (v === null || v === undefined || v === "") return "NULL";
  return `'${String(v).replace(/\u0000/g, "").replace(/'/g, "''")}'`;
}
function sqlJson(o) {
  return o === null || o === undefined ? "NULL" : sqlStr(JSON.stringify(o)) + "::jsonb";
}
// Timestamp sem offset (atividade all-day do TI) e horario de Brasilia. Sem
// isso o Postgres assume UTC e tudo desloca 3h.
function sqlTs(v) {
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}/.test(v)) return "NULL";
  if (!/[+-]\d{2}:?\d{2}$|Z$/.test(v)) {
    return `(${sqlStr(v)}::timestamp at time zone 'America/Sao_Paulo')`;
  }
  return sqlStr(v);
}

async function buscarAtividadesTI() {
  const todas = new Map();
  let page = 1;
  let paginas = 1;
  do {
    const resp = await fetch(`${TI_BASE}/atividades?page=${page}&per_page=100`, {
      headers: { Authorization: `Bearer ${TI_TOKEN}` },
    });
    if (!resp.ok) throw new Error(`TI HTTP ${resp.status} na pagina ${page}`);
    const d = await resp.json();
    // Dedup por id: a paginacao do TI repete registros entre paginas quando
    // algo e criado durante a varredura.
    for (const a of d.activities || []) todas.set(a.id, a);
    paginas = d.pagination?.pages ?? 1;
    page++;
  } while (page <= paginas);
  return [...todas.values()];
}

const iso = (v) => (v ? new Date(v).toISOString() : null);

async function main() {
  console.log(`== sync-ti-atividades ${DRY_RUN ? "(DRY-RUN)" : "(EXECUCAO REAL)"} ==\n`);

  const atividades = await buscarAtividadesTI();
  const porTipoTI = {};
  for (const a of atividades) porTipoTI[a.type] = (porTipoTI[a.type] || 0) + 1;
  console.log(`TI devolveu ${atividades.length} atividades: ${JSON.stringify(porTipoTI)}`);

  const relevantes = atividades.filter((a) => TIPO[a.type]);
  console.log(`Relevantes (Task/Deadline/MedicalExam): ${relevantes.length}`);
  console.log(`Ignoradas (Income/Event): ${atividades.length - relevantes.length}\n`);

  // ---- Estado local ----
  const casos = await runSql(
    `select c.ti_customer_id,
       (select k.id from casos k where k.cliente_id = c.id order by k.created_at desc limit 1) as caso_id
     from clientes c where c.ti_customer_id is not null`,
  );
  const casoPorTiId = new Map();
  for (const r of casos) if (r.caso_id) casoPorTiId.set(Number(r.ti_customer_id), r.caso_id);

  const usuarios = await runSql("select id, nome from usuarios where tipo = 'interno'");
  const usuarioPorPrimeiroNome = new Map();
  for (const u of usuarios) {
    const p = String(u.nome || "").trim().split(/\s+/)[0].toLowerCase();
    if (p) usuarioPorPrimeiroNome.set(p, u.id);
  }

  const existentes = await runSql(
    `select id, metadata->>'ti_uuid' as ti_uuid, titulo, descricao, due_at, status, tipo,
            responsavel_id, caso_id
     from tarefas where origem = 'migracao_ti' and metadata->>'ti_uuid' is not null`,
  );
  const porUuid = new Map(existentes.map((r) => [r.ti_uuid, r]));

  // Responsavel = SO executor (decisao Naira 2026-07-20): revisor e interessado
  // ficam em metadata mas nao viram responsavel.
  function resolverResponsavel(a) {
    return (
      (a.users || [])
        .filter((u) => u.role === "executor")
        .map((u) => usuarioPorPrimeiroNome.get(String(u.name || "").trim().split(/\s+/)[0].toLowerCase()))
        .find(Boolean) || null
    );
  }
  function metadataDe(a) {
    return {
      ti_id: a.id,
      ti_uuid: a.uuid,
      ti_type: a.type,
      ti_assignments: a.users || [],
      ti_executores: (a.users || []).filter((u) => u.role === "executor").map((u) => u.name),
      ti_customer_iid: a.customer?.id ?? null,
      ti_customer_nome: a.customer?.name ?? null,
      ti_all_day: a.all_day ?? null,
      ti_lawsuit: a.lawsuit || null,
      ti_archived_at: a.archived_at || null,
      migracao_ti: true,
      ti_sincronizado_em: new Date().toISOString(),
    };
  }

  const inserir = [];
  const atualizar = [];
  let semMudanca = 0;
  const semCaso = new Map();

  for (const a of relevantes) {
    const tipo = TIPO[a.type];
    const casoId = casoPorTiId.get(Number(a.customer?.id)) || null;
    const resp = resolverResponsavel(a);
    const titulo = (a.title || "").trim() || "(sem titulo)";
    const descricao = (a.description || "").trim() || null;
    const atual = porUuid.get(a.uuid);

    if (!atual) {
      if (!casoId) semCaso.set(a.customer?.id ?? "?", a.customer?.name ?? "(sem cliente)");
      inserir.push({ a, tipo, casoId, resp, titulo, descricao });
      continue;
    }

    const campos = {};
    if ((atual.titulo || "") !== titulo) campos.titulo = titulo;
    if ((atual.descricao || null) !== descricao) campos.descricao = descricao;
    if (iso(atual.due_at) !== iso(a.start)) campos.due_at = a.start;
    if (atual.tipo !== tipo) campos.tipo = tipo;
    // So propaga conclusao TI -> app. Nunca desmarca o que foi feito aqui.
    if (a.completed && atual.status !== "feito") campos.status = "feito";
    // So preenche responsavel vazio — nao sobrescreve redistribuicao local.
    if (!atual.responsavel_id && resp) campos.responsavel_id = resp;
    if (!atual.caso_id && casoId) campos.caso_id = casoId;

    if (Object.keys(campos).length === 0) semMudanca++;
    else atualizar.push({ a, id: atual.id, campos });
  }

  const orfas = existentes.filter((r) => !relevantes.some((a) => a.uuid === r.ti_uuid));

  console.log("---- PLANO ----");
  console.log(`Inserir:        ${inserir.length}`);
  console.log(`Atualizar:      ${atualizar.length}`);
  console.log(`Sem mudanca:    ${semMudanca}`);
  console.log(`Sem caso local: ${semCaso.size} cliente(s) — tarefa entra sem caso`);
  console.log(
    `\nNo app mas AUSENTES no TI: ${orfas.length}` +
      ` (${orfas.filter((o) => o.status !== "feito").length} ainda como 'a_fazer')`,
  );
  console.log("  -> este script NAO mexe nelas. Decisao separada.");

  if (atualizar.length) {
    const cont = {};
    for (const u of atualizar) for (const k of Object.keys(u.campos)) cont[k] = (cont[k] || 0) + 1;
    console.log(`\nCampos que mudam: ${JSON.stringify(cont)}`);
  }

  if (DRY_RUN) {
    console.log("\nDRY-RUN. Rode sem --dry-run pra aplicar.");
    return;
  }

  // ---- Inserts ----
  for (let i = 0; i < inserir.length; i += CHUNK) {
    const lote = inserir.slice(i, i + CHUNK);
    const values = lote
      .map(({ a, tipo, casoId, resp, titulo, descricao }) =>
        `(${casoId ? sqlStr(casoId) + "::uuid" : "NULL"}, ` +
        `${resp ? sqlStr(resp) + "::uuid" : "NULL"}, ` +
        `${sqlStr(tipo)}, ${sqlStr(a.completed ? "feito" : "a_fazer")}, 2, ` +
        `${sqlStr(titulo)}, ${sqlStr(descricao)}, ${sqlTs(a.start)}, ` +
        `'migracao_ti', ${sqlStr(`ti:${a.id}`)}, ${sqlJson(metadataDe(a))}, ` +
        `${a.completed ? "now()" : "NULL"})`,
      )
      .join(",\n");
    await runSql(
      `insert into tarefas (caso_id, responsavel_id, tipo, status, prioridade, titulo, descricao, due_at, origem, origem_ref, metadata, completed_at)\n` +
        `values ${values} on conflict do nothing`,
    );
    console.log(`  inseridas ${Math.min(i + CHUNK, inserir.length)}/${inserir.length}`);
  }

  // ---- Updates ----
  for (let i = 0; i < atualizar.length; i += CHUNK) {
    const lote = atualizar.slice(i, i + CHUNK);
    for (const { a, id, campos } of lote) {
      const sets = [];
      if ("titulo" in campos) sets.push(`titulo = ${sqlStr(campos.titulo)}`);
      if ("descricao" in campos) sets.push(`descricao = ${sqlStr(campos.descricao)}`);
      if ("due_at" in campos) sets.push(`due_at = ${sqlTs(campos.due_at)}`);
      if ("tipo" in campos) sets.push(`tipo = ${sqlStr(campos.tipo)}`);
      if ("status" in campos) sets.push(`status = 'feito', completed_at = coalesce(completed_at, now())`);
      if ("responsavel_id" in campos) sets.push(`responsavel_id = ${sqlStr(campos.responsavel_id)}::uuid`);
      if ("caso_id" in campos) sets.push(`caso_id = ${sqlStr(campos.caso_id)}::uuid`);
      sets.push(`metadata = ${sqlJson(metadataDe(a))}`);
      await runSql(`update tarefas set ${sets.join(", ")} where id = ${sqlStr(id)}::uuid`);
    }
    console.log(`  atualizadas ${Math.min(i + CHUNK, atualizar.length)}/${atualizar.length}`);
  }

  const check = await runSql(
    `select count(*) as total,
       count(*) filter (where tipo='pericia') as pericias,
       count(*) filter (where tipo='prazo') as prazos,
       count(*) filter (where status='feito') as feitas,
       count(*) filter (where caso_id is not null) as com_caso,
       count(*) filter (where responsavel_id is not null) as com_responsavel
     from tarefas where origem='migracao_ti'`,
  );
  console.log("\n---- RESULTADO ----");
  console.log(JSON.stringify(check[0], null, 2));
}

main().catch((e) => {
  console.error("ERRO:", e?.message ?? e);
  process.exit(1);
});

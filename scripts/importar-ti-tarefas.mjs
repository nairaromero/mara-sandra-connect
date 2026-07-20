#!/usr/bin/env node
// importar-ti-tarefas.mjs — fase 2 da migração TI: tarefas + perícias + prazos.
//
// Consome o JSON extraído da API interna do TI (via Chrome logado, tela
// /atividades) e importa pra tabela `tarefas`:
//   MedicalExam → tipo 'pericia' | Deadline → tipo 'prazo' | Task → tipo 'interna'
//
// - caso_id: resolvido por customer_iid (= clientes.ti_customer_id) → caso mais
//   recente do cliente. Cliente não migrado → tarefa fica sem caso (metadata
//   guarda nome/iid) e é listada no relatório.
// - responsavel_id: primeiro assignment que casar com usuário interno pelo
//   primeiro nome (ex.: "Mara Oliveira" ↔ "Mara Sandra"). Lista completa fica
//   em metadata.ti_assignments.
// - Dedup por origem_ref = 'ti:<iid>' (origem 'migracao_ti'). Idempotente.
//
// Uso:
//   node scripts/importar-ti-tarefas.mjs --file <ti-atividades.json> --dry-run
//   node scripts/importar-ti-tarefas.mjs --file <ti-atividades.json>

import fs from "node:fs";
import path from "node:path";

const PROJECT_REF = process.env.SUPABASE_PROJECT_REF || "llugytkdsfsrciavhrfw";
const DRY_RUN = process.argv.includes("--dry-run");
const CHUNK = 50;

const fileIdx = process.argv.indexOf("--file");
const FILE = fileIdx !== -1 ? process.argv[fileIdx + 1] : null;
if (!FILE || !fs.existsSync(FILE)) {
  console.error("ERRO: use --file <caminho do ti-atividades.json>");
  process.exit(1);
}

function readEnvLocal(key) {
  try {
    const txt = fs.readFileSync(path.join(process.cwd(), ".env.local"), "utf8");
    const m = txt.match(new RegExp("^" + key + "=(.*)$", "m"));
    return m ? m[1].trim() : null;
  } catch {
    return null;
  }
}
const SB_TOKEN = readEnvLocal("SUPABASE_ACCESS_TOKEN");
if (!SB_TOKEN) {
  console.error("ERRO: SUPABASE_ACCESS_TOKEN não encontrado no .env.local");
  process.exit(1);
}

async function runSql(sql) {
  const resp = await fetch(
    `https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${SB_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query: sql }),
    },
  );
  const text = await resp.text();
  if (!resp.ok) throw new Error(`SQL HTTP ${resp.status}: ${text.slice(0, 500)}`);
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function sqlStr(v) {
  if (v === null || v === undefined || v === "") return "NULL";
  const s = String(v).replace(/\u0000/g, "").replace(/'/g, "''");
  return `'${s}'`;
}
function sqlJson(obj) {
  if (obj === null || obj === undefined) return "NULL";
  return sqlStr(JSON.stringify(obj)) + "::jsonb";
}
function sqlTs(v) {
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}/.test(v)) return "NULL";
  return sqlStr(v);
}

const TIPO = { MedicalExam: "pericia", Deadline: "prazo", Task: "interna" };

async function main() {
  console.log(`== importar-ti-tarefas ${DRY_RUN ? "(DRY-RUN)" : "(EXECUÇÃO REAL)"} ==\n`);

  const dados = JSON.parse(fs.readFileSync(FILE, "utf8"));
  const atividades = [].concat(dados.atuais || [], dados.futuras || []);
  console.log(`${atividades.length} atividades no arquivo (extraído em ${dados.extraido_em})`);

  // Estado local
  const casos = await runSql(
    `select c.ti_customer_id,
       (select k.id from casos k where k.cliente_id = c.id order by k.created_at desc limit 1) as caso_id
     from clientes c where c.ti_customer_id is not null`,
  );
  const casoPorTiId = new Map();
  for (const r of casos) {
    if (r.caso_id) casoPorTiId.set(Number(r.ti_customer_id), r.caso_id);
  }

  const usuarios = await runSql(
    "select id, nome from usuarios where tipo = 'interno'",
  );
  const usuarioPorPrimeiroNome = new Map();
  for (const u of usuarios) {
    const primeiro = String(u.nome || "").trim().split(/\s+/)[0].toLowerCase();
    if (primeiro) usuarioPorPrimeiroNome.set(primeiro, u.id);
  }

  const jaImportadas = await runSql(
    "select origem_ref from tarefas where origem = 'migracao_ti'",
  );
  const refsExistentes = new Set(jaImportadas.map((r) => r.origem_ref));

  // Classificação
  const aImportar = [];
  const semCaso = [];
  let puladasDedup = 0;
  const porTipo = {};
  const semResponsavel = [];
  for (const a of atividades) {
    const ref = `ti:${a.iid}`;
    if (refsExistentes.has(ref)) {
      puladasDedup++;
      continue;
    }
    const casoId = casoPorTiId.get(Number(a.customer_iid)) || null;
    // Responsável = SÓ executor (decisão Naira 2026-07-20). O TI tem papéis
    // executor/reviewer/interested; revisor e interessado NÃO viram responsável
    // (ficam em metadata). Aceita assignments como [{name, role}] (extração com
    // role, preferida) ou ["Nome"] (legado — trata todos como executor).
    const assigns = (a.assignments || []).map((s) =>
      typeof s === "string" ? { name: s, role: "executor" } : s,
    );
    const primeiroMatch = assigns
      .filter((s) => s.role === "executor")
      .map((s) => usuarioPorPrimeiroNome.get(String(s.name || "").trim().split(/\s+/)[0].toLowerCase()))
      .find(Boolean) || null;
    const tipo = TIPO[a.type] || "interna";
    porTipo[tipo] = (porTipo[tipo] || 0) + 1;
    if (!casoId) semCaso.push(a);
    if (!primeiroMatch) semResponsavel.push(a);
    aImportar.push({ a, ref, casoId, responsavelId: primeiroMatch, tipo });
  }

  console.log("\n---- PLANO ----");
  console.log(`A importar:        ${aImportar.length}`);
  console.log(`  por tipo:        ${JSON.stringify(porTipo)}`);
  console.log(`  já importadas:   ${puladasDedup} (dedup)`);
  console.log(`  sem caso:        ${semCaso.length} (cliente não migrado — tarefa fica sem caso)`);
  console.log(`  sem responsável: ${semResponsavel.length}`);
  if (semCaso.length) {
    console.log("\nClientes das tarefas sem caso:");
    const nomes = new Map();
    for (const a of semCaso) {
      nomes.set(a.customer_iid, a.customer_nome);
    }
    for (const [iid, nome] of nomes) console.log(`  - TI #${iid} ${nome}`);
  }

  if (DRY_RUN) {
    console.log("\nDRY-RUN concluído. Rode sem --dry-run para executar.");
    return;
  }

  console.log("\nGravando tarefas...");
  for (let i = 0; i < aImportar.length; i += CHUNK) {
    const lote = aImportar.slice(i, i + CHUNK);
    const values = lote
      .map(({ a, ref, casoId, responsavelId, tipo }) => {
        const titulo = (a.title || "").trim() || "(sem título)";
        const status = a.completed ? "feito" : "a_fazer";
        const meta = {
          ti_iid: a.iid,
          ti_uuid: a.uuid,
          ti_type: a.type,
          ti_assignments: a.assignments || [],
          ti_executores: (a.assignments || [])
            .map((s) => (typeof s === "string" ? { name: s, role: "executor" } : s))
            .filter((s) => s.role === "executor")
            .map((s) => s.name),
          ti_customer_iid: a.customer_iid,
          ti_customer_nome: a.customer_nome,
          ti_all_day: a.allDay ?? null,
          ti_lawsuit: a.lawsuit || null,
          migracao_ti: true,
        };
        return `(${casoId ? sqlStr(casoId) + "::uuid" : "NULL"}, ` +
          `${responsavelId ? sqlStr(responsavelId) + "::uuid" : "NULL"}, ` +
          `${sqlStr(tipo)}, ${sqlStr(status)}, 2, ${sqlStr(titulo)}, ` +
          `${sqlStr((a.description || "").trim() || null)}, ${sqlTs(a.start)}, ` +
          `'migracao_ti', ${sqlStr(ref)}, ${sqlJson(meta)}, ` +
          `${a.completed ? "now()" : "NULL"})`;
      })
      .join(",\n");
    await runSql(
      `insert into tarefas (caso_id, responsavel_id, tipo, status, prioridade, titulo, descricao, due_at, origem, origem_ref, metadata, completed_at)\n` +
        `values ${values}\n` +
        `on conflict do nothing`,
    );
    console.log(`  ${Math.min(i + CHUNK, aImportar.length)}/${aImportar.length}`);
  }

  const check = await runSql(
    `select count(*) as total,
       count(*) filter (where tipo = 'pericia') as pericias,
       count(*) filter (where tipo = 'prazo') as prazos,
       count(*) filter (where caso_id is not null) as com_caso,
       count(*) filter (where responsavel_id is not null) as com_responsavel
     from tarefas where origem = 'migracao_ti'`,
  );
  console.log("\n---- RESULTADO ----");
  console.log(JSON.stringify(check[0], null, 2));
  console.log("\nImportação de tarefas concluída (idempotente — pode rodar de novo).");
}

main().catch((e) => {
  console.error("ERRO:", e?.message ?? e);
  process.exit(1);
});

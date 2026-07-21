#!/usr/bin/env node
// migrar-ti.mjs — migração total do Tramitação Inteligente (TI) → Mara Sandra Connect.
//
// Fase 1 da migração: clientes + casos + notas (via API oficial do TI).
//   1. Busca TODOS os clientes do TI (GET /clientes, paginado).
//   2. Busca TODAS as notas do TI (GET /notas, paginado).
//   3. ESCOPO (decisão Naira 2026-07-20): migra apenas clientes COM tag no TI.
//      Os sem tag aguardam limpeza da base e entram depois (--todos inclui todos).
//   4. Cria clientes que não existem (match por CPF); nos existentes atualiza
//      tags/ti_customer_id/ti_dados e preenche contatos vazios (nunca
//      sobrescreve dado que o escritório já preencheu).
//   5. Cria 1 caso por cliente migrado que não tenha caso (tipo 'a_definir').
//   6. Aloca parceiro_id nos casos conforme MAPA_PARCEIROS (tag PARCERIA_* →
//      email do usuário parceiro). Só preenche casos com parceiro_id NULL.
//   7. Converte notas em andamentos (origem 'tramitacao', dedup por ti_nota_id
//      — índice único andamentos_ti_nota_id_uniq garante no banco).
//
// Idempotente: rodar 2x não duplica nada.
//
// Uso:
//   node scripts/migrar-ti.mjs --dry-run   # só relatório, não escreve nada
//   node scripts/migrar-ti.mjs             # executa a migração (só clientes com tag)
//   node scripts/migrar-ti.mjs --todos     # inclui também clientes sem tag
//
// Credenciais no .env.local (gitignored):
//   TI_TOKEN               — token do Tramitação Inteligente
//   SUPABASE_ACCESS_TOKEN  — já usado pelo msc-sql.mjs

import fs from "node:fs";
import path from "node:path";

const PROJECT_REF = process.env.SUPABASE_PROJECT_REF || "llugytkdsfsrciavhrfw";
const TI_BASE_URL = "https://planilha.tramitacaointeligente.com.br/api/v1";
const DRY_RUN = process.argv.includes("--dry-run");
const INCLUIR_SEM_TAG = process.argv.includes("--todos");
const CHUNK = 50;

// Tag do TI → email do usuário parceiro no sistema (usuarios.tipo='parceiro').
// Casos de clientes com a tag nascem/ficam alocados nesse parceiro.
const MAPA_PARCEIROS = {
  "PARCERIA_ISABELA/MT": "nairaromerovian+isabella@gmail.com",
};

function readEnvLocal(key) {
  try {
    const txt = fs.readFileSync(path.join(process.cwd(), ".env.local"), "utf8");
    const m = txt.match(new RegExp("^" + key + "=(.*)$", "m"));
    return m ? m[1].trim() : null;
  } catch {
    return null;
  }
}

const TI_TOKEN = readEnvLocal("TI_TOKEN");
const SB_TOKEN = readEnvLocal("SUPABASE_ACCESS_TOKEN");

if (!TI_TOKEN) {
  console.error("ERRO: TI_TOKEN não encontrado no .env.local");
  console.error("Adicione a linha: TI_TOKEN=<token do Tramitação Inteligente>");
  process.exit(1);
}
if (!SB_TOKEN) {
  console.error("ERRO: SUPABASE_ACCESS_TOKEN não encontrado no .env.local");
  process.exit(1);
}

// ---------------------------------------------------------------- SQL helpers

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
  if (!resp.ok) {
    throw new Error(`SQL HTTP ${resp.status}: ${text.slice(0, 500)}`);
  }
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

function sqlDate(v) {
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}/.test(v)) return "NULL";
  return sqlStr(v.slice(0, 10));
}

function sqlTs(v) {
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}/.test(v)) return "now()";
  // Sem offset explícito = horário de Brasília (senão o Postgres assume UTC).
  if (!/[+-]\d{2}:?\d{2}$|Z$/.test(v)) {
    return `(${sqlStr(v)}::timestamp at time zone 'America/Sao_Paulo')`;
  }
  return sqlStr(v);
}

// ------------------------------------------------------------------ TI client

const headersTI = {
  Authorization: `Bearer ${TI_TOKEN}`,
  "Content-Type": "application/json",
};

async function fetchTIPaginado(pathname, keys, maxPages = 60) {
  const all = [];
  let page = 1;
  while (true) {
    const sep = pathname.includes("?") ? "&" : "?";
    const url = `${TI_BASE_URL}${pathname}${sep}page=${page}&per_page=100`;
    const resp = await fetch(url, { headers: headersTI });
    if (!resp.ok) {
      throw new Error(`TI ${pathname} ${resp.status}: ${await resp.text()}`);
    }
    const data = await resp.json();
    const batch = keys.map((k) => data[k]).find(Array.isArray) || [];
    all.push(...batch);
    const totalPages = data.pagination?.pages || 1;
    if (page >= totalPages || batch.length < 100) break;
    page++;
    if (page > maxPages) throw new Error(`paginação de ${pathname} excedeu limite`);
  }
  return all;
}

function normalizeCPF(cpf) {
  return String(cpf || "").replace(/\D/g, "");
}

function temTag(c) {
  return Array.isArray(c.tags) && c.tags.some((t) => t?.name);
}

// Monta endereço legível a partir dos campos que o TI expõe.
// Tudo continua íntegro em ti_dados.
function montarEndereco(c) {
  const pick = (...ks) => {
    for (const k of ks) {
      const v = c[k];
      if (v !== null && v !== undefined && String(v).trim() !== "") {
        return String(v).trim();
      }
    }
    return null;
  };
  const rua = pick("street", "address", "endereco", "logradouro");
  const numero = pick("street_number", "address_number", "numero");
  const bairro = pick("neighborhood", "bairro");
  const cidade = pick("city", "cidade");
  const uf = pick("state", "uf");
  const cep = pick("zipcode", "zip_code", "cep");
  const partes = [];
  if (rua) partes.push(numero ? `${rua}, ${numero}` : rua);
  if (bairro) partes.push(bairro);
  if (cidade) partes.push(uf ? `${cidade}/${uf}` : cidade);
  else if (uf) partes.push(uf);
  if (cep) partes.push(`CEP ${cep}`);
  return partes.length ? partes.join(" - ") : null;
}

// ----------------------------------------------------------------------- main

async function main() {
  console.log(
    `== migrar-ti ${DRY_RUN ? "(DRY-RUN — nada será escrito)" : "(EXECUÇÃO REAL)"}` +
      `${INCLUIR_SEM_TAG ? " [--todos: inclui clientes sem tag]" : " [escopo: só clientes com tag]"} ==\n`,
  );

  // 1. TI: clientes + notas
  console.log("Buscando clientes no TI...");
  const tiClientes = await fetchTIPaginado("/clientes", ["customers", "clientes"]);
  console.log(`  ${tiClientes.length} clientes no TI`);

  console.log("Buscando notas no TI...");
  const tiNotas = await fetchTIPaginado("/notas", ["notes", "notas"]);
  console.log(`  ${tiNotas.length} notas no TI\n`);

  // 2. Estado local
  const clientesLocais = await runSql(
    "select id, cpf, ti_customer_id from clientes",
  );
  const notasImportadas = await runSql(
    "select metadata->>'ti_nota_id' as ti_nota_id from andamentos " +
      "where origem='tramitacao' and metadata->>'ti_nota_id' is not null",
  );
  const cpfsLocais = new Set(clientesLocais.map((c) => normalizeCPF(c.cpf)));
  const notasJaImportadas = new Set(notasImportadas.map((n) => n.ti_nota_id));

  // 3. Classificação dos clientes TI
  const validos = [];
  const invalidos = [];
  const cpfsVistos = new Set();
  const duplicados = [];
  for (const c of tiClientes) {
    const cpf = normalizeCPF(c.cpf_cnpj);
    if (cpf.length !== 11) {
      invalidos.push(c);
      continue;
    }
    if (cpfsVistos.has(cpf)) {
      duplicados.push(c);
      continue;
    }
    cpfsVistos.add(cpf);
    validos.push({ ...c, _cpf: cpf });
  }

  // Escopo: com tag, OU já existente no sistema (atualização é sempre segura),
  // OU tudo se --todos.
  const escopo = validos.filter(
    (c) => INCLUIR_SEM_TAG || temTag(c) || cpfsLocais.has(c._cpf),
  );
  const foraEscopo = validos.length - escopo.length;
  const novos = escopo.filter((c) => !cpfsLocais.has(c._cpf));
  const existentes = escopo.filter((c) => cpfsLocais.has(c._cpf));

  // 4. Classificação das notas
  const tiIdsEscopo = new Set(escopo.map((c) => c.id));
  const tiIdsValidos = new Set(validos.map((c) => c.id));
  const notasPendentes = [];
  let notasJaOk = 0;
  let notasForaEscopo = 0;
  let notasOrfas = 0;
  for (const n of tiNotas) {
    const custId = n.customer?.id ?? n.customer_id ?? null;
    if (notasJaImportadas.has(String(n.id))) {
      notasJaOk++;
      continue;
    }
    if (custId && tiIdsEscopo.has(custId)) {
      notasPendentes.push({ ...n, _custId: custId });
    } else if (custId && tiIdsValidos.has(custId)) {
      notasForaEscopo++; // cliente válido mas sem tag — entra quando o cliente entrar
    } else {
      notasOrfas++; // cliente sem CPF válido ou nota sem cliente
    }
  }

  // 5a. Distribuição por tag (do escopo) — base pra alocação de parceiros.
  const porTag = new Map();
  for (const c of escopo) {
    const nomes = (Array.isArray(c.tags) ? c.tags : [])
      .map((t) => t?.name)
      .filter(Boolean);
    if (!nomes.length) {
      porTag.set("(sem tag)", (porTag.get("(sem tag)") || 0) + 1);
      continue;
    }
    for (const nome of nomes) {
      porTag.set(nome, (porTag.get(nome) || 0) + 1);
    }
  }

  // 5b. Parceiros mapeados
  const clientesPorParceria = new Map();
  for (const tag of Object.keys(MAPA_PARCEIROS)) {
    clientesPorParceria.set(
      tag,
      escopo.filter((c) =>
        (c.tags || []).some((t) => t?.name === tag)
      ).length,
    );
  }

  // 5. Relatório
  console.log("---- PLANO ----");
  console.log(`Clientes TI:            ${tiClientes.length}`);
  console.log(`  CPF válido:           ${validos.length}`);
  console.log(`  CPF inválido/vazio:   ${invalidos.length} (pulados — relatório à parte)`);
  console.log(`  CPF duplicado no TI:  ${duplicados.length} (mantido o primeiro)`);
  if (!INCLUIR_SEM_TAG) {
    console.log(`  sem tag (fora desta leva): ${foraEscopo}`);
  }
  console.log(`ESCOPO desta execução:  ${escopo.length}`);
  console.log(`  a CRIAR:              ${novos.length}`);
  console.log(`  a ATUALIZAR:          ${existentes.length} (tags/ti_dados; contatos só se vazios)`);
  console.log(`Notas TI:               ${tiNotas.length}`);
  console.log(`  já importadas:        ${notasJaOk}`);
  console.log(`  a importar:           ${notasPendentes.length}`);
  console.log(`  de clientes sem tag:  ${notasForaEscopo} (entram com os clientes, depois)`);
  console.log(`  órfãs (cliente sem CPF/da nota): ${notasOrfas}`);
  console.log("Casos: 1 por cliente do escopo sem caso (tipo 'a_definir').");
  for (const [tag, qtd] of clientesPorParceria) {
    console.log(`Parceiro: ${qtd} clientes com ${tag} → ${MAPA_PARCEIROS[tag]}`);
  }
  console.log("");

  console.log("---- Distribuição por tag (escopo) ----");
  const tagsOrdenadas = [...porTag.entries()].sort((a, b) => b[1] - a[1]);
  for (const [nome, qtd] of tagsOrdenadas) {
    console.log(`  ${String(qtd).padStart(4)}  ${nome}`);
  }
  console.log("");

  if (DRY_RUN) {
    console.log("DRY-RUN concluído. Rode sem --dry-run para executar.");
    return;
  }

  // 6. Upsert de clientes (em lotes)
  console.log("Gravando clientes...");
  for (let i = 0; i < escopo.length; i += CHUNK) {
    const lote = escopo.slice(i, i + CHUNK);
    const values = lote
      .map((c) => {
        const nome = (c.name || "").trim() || `Cliente TI #${c.id}`;
        return `(${sqlStr(nome)}, ${sqlStr(c._cpf)}, ${sqlDate(c.birthdate)}, ` +
          `${sqlStr(c.phone_mobile || c.phone_1 || c.phone_2)}, ${sqlStr(c.email)}, ` +
          `${sqlStr(montarEndereco(c))}, ${sqlJson(c.tags || [])}, ${c.id}, ${sqlJson(c)})`;
      })
      .join(",\n");
    await runSql(
      `insert into clientes (nome, cpf, data_nascimento, telefone, email, endereco, tags, ti_customer_id, ti_dados)\n` +
        `values ${values}\n` +
        `on conflict (cpf) do update set\n` +
        `  ti_customer_id = excluded.ti_customer_id,\n` +
        `  ti_dados = excluded.ti_dados,\n` +
        `  tags = excluded.tags,\n` +
        `  email = coalesce(clientes.email, excluded.email),\n` +
        `  telefone = coalesce(clientes.telefone, excluded.telefone),\n` +
        `  data_nascimento = coalesce(clientes.data_nascimento, excluded.data_nascimento),\n` +
        `  endereco = coalesce(clientes.endereco, excluded.endereco)`,
    );
    console.log(`  ${Math.min(i + CHUNK, escopo.length)}/${escopo.length}`);
  }

  // 7. Casos automáticos (1 statement idempotente)
  console.log("Criando casos para clientes sem caso...");
  const casosCriados = await runSql(
    `with novos as (\n` +
      `  insert into casos (cliente_id, tipo_beneficio, observacoes)\n` +
      `  select c.id, 'a_definir', 'Caso criado automaticamente na migração do Tramitação Inteligente.'\n` +
      `  from clientes c\n` +
      `  where c.ti_customer_id is not null\n` +
      `    and not exists (select 1 from casos k where k.cliente_id = c.id)\n` +
      `  returning id\n` +
      `) select count(*) as criados from novos`,
  );
  console.log(`  ${casosCriados[0]?.criados ?? 0} casos criados`);

  // 8. Alocação de parceiros (só casos ainda sem parceiro)
  for (const [tag, emailParceiro] of Object.entries(MAPA_PARCEIROS)) {
    const r = await runSql(
      `with alvo as (\n` +
        `  update casos ca set parceiro_id = u.id\n` +
        `  from clientes c, usuarios u\n` +
        `  where ca.cliente_id = c.id\n` +
        `    and ca.parceiro_id is null\n` +
        `    and u.email = ${sqlStr(emailParceiro)} and u.tipo = 'parceiro'\n` +
        `    and c.tags @> ${sqlJson([{ name: tag }])}\n` +
        `  returning ca.id\n` +
        `) select count(*) as alocados from alvo`,
    );
    console.log(`Parceiro ${tag}: ${r[0]?.alocados ?? 0} casos alocados`);
  }

  // 9. Mapa ti_customer_id → caso mais recente
  const mapa = await runSql(
    `select c.ti_customer_id,\n` +
      `  (select k.id from casos k where k.cliente_id = c.id order by k.created_at desc limit 1) as caso_id\n` +
      `from clientes c where c.ti_customer_id is not null`,
  );
  const casoPorTiId = new Map();
  for (const r of mapa) {
    if (r.caso_id) casoPorTiId.set(Number(r.ti_customer_id), r.caso_id);
  }

  // 10. Notas → andamentos (em lotes; dedup pelo índice único)
  console.log("Importando notas como andamentos...");
  const notasComCaso = notasPendentes.filter((n) => casoPorTiId.has(n._custId));
  const notasSemCaso = notasPendentes.length - notasComCaso.length;
  for (let i = 0; i < notasComCaso.length; i += CHUNK) {
    const lote = notasComCaso.slice(i, i + CHUNK);
    const values = lote
      .map((n) => {
        const content = (n.content || "").trim();
        const titulo = content ? content.slice(0, 100) : "(nota sem texto)";
        const meta = {
          ti_nota_id: String(n.id),
          ti_nota_uuid: n.uuid || null,
          ti_user_email: n.user?.email || null,
          ti_user_name: n.user?.name || null,
          migracao_ti: true,
        };
        return `(${sqlStr(casoPorTiId.get(n._custId))}::uuid, 'tramitacao', ${sqlStr(titulo)}, ` +
          `${sqlStr(content || null)}, ${sqlTs(n.created_at)}, false, ${sqlJson(meta)})`;
      })
      .join(",\n");
    await runSql(
      `insert into andamentos (caso_id, origem, titulo, descricao, data_evento, visivel_parceiro, metadata)\n` +
        `values ${values}\n` +
        `on conflict do nothing`,
    );
    console.log(`  ${Math.min(i + CHUNK, notasComCaso.length)}/${notasComCaso.length}`);
  }
  if (notasSemCaso > 0) {
    console.log(`  AVISO: ${notasSemCaso} notas ficaram sem caso (cliente sem caso?) — investigar.`);
  }

  // 11. Verificação final
  const check = await runSql(
    `select (select count(*) from clientes) as clientes,\n` +
      `  (select count(*) from clientes where ti_dados is not null) as clientes_ti,\n` +
      `  (select count(*) from casos) as casos,\n` +
      `  (select count(*) from casos where parceiro_id is not null) as casos_com_parceiro,\n` +
      `  (select count(*) from andamentos where origem='tramitacao') as andamentos_ti`,
  );
  console.log("\n---- RESULTADO ----");
  console.log(JSON.stringify(check[0], null, 2));
  console.log("\nMigração fase 1 concluída. Rode de novo a qualquer momento — é idempotente.");
}

main().catch((e) => {
  console.error("ERRO:", e?.message ?? e);
  process.exit(1);
});

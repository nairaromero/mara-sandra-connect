#!/usr/bin/env node
// board-sync.mjs — mantém o board "Legal Connect" (GitHub Projects) em dia com
// o que o git e o banco de produção dizem. Roda pelo .github/workflows/board.yml.
//
//   node scripts/board-sync.mjs em-revisao <pr>
//       PR aberto para a staging -> "Em revisão".
//
//   node scripts/board-sync.mjs release [--dry-run] [--alvo <ref>] [--registro-staging]
//       Cada card em "Validar no staging" vai para "Produção" só quando TODOS
//       os PRs dele já estão na main E todas as migrations desses PRs estão no
//       registro de produção (ops.migrations_aplicadas). O resto fica, com o
//       motivo impresso. O PR de release em si, se tiver entrado no board, é
//       arquivado — ele é o veículo do lote, não trabalho.
//         --dry-run            mostra o que faria, sem mexer no board
//         --alvo <ref>         ref que conta como "em produção" (padrão origin/main)
//         --registro-staging   lê o registro do STAGING em vez do de produção
//                              (só para teste local)
//
// O que NÃO é daqui: "PR mergeado na staging -> Validar no staging" é do
// workflow nativo "Pull request merged" do board, que acerta esse caso porque
// o PR de release entra com o label `release` e fica fora do board.
//
// Credenciais:
//   GH_TOKEN  PAT com escopo `project` (no Actions: BOARD_PROJECT_TOKEN).
//             Fora do Actions, cai no `gh auth token`.
//   Registro de migrations, na ordem:
//     REGISTRO_PG_CONN + PGPASSWORD      psql só-leitura (Actions: espelho_leitura)
//     SUPABASE_ACCESS_TOKEN no .env.local   Management API (uso local)
//
// O repositório é público, então o log do Actions também é — e o board é
// privado. Este script imprime só números de PR/issue, nomes de migration e
// motivos; nunca títulos nem conteúdo do board.
//
// Saída: 0 ok (card segurado é resultado normal, não erro) ·
//        1 erro de configuração ou algo que não deu para conferir.

import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const OWNER = "nairaromero";
const PROJECT_NUMBER = 1;
const REPO = process.env.GITHUB_REPOSITORY || "nairaromero/mara-sandra-connect";
const [REPO_OWNER, REPO_NAME] = REPO.split("/");

const COLUNA = {
  revisao: "Em revisão",
  validar: "Validar no staging",
  producao: "Produção",
};

// O mesmo padrão do msc-sql.mjs e do check de ops.migrations_aplicadas.
// Arquivo fora dele na pasta (diagnóstico, correção avulsa) não é migration.
const PASTA_MIGRATIONS = "planning/sql-migrations/";
const PADRAO_MIGRATION = /^migration_[a-z0-9_]+\.sql$/;

const REF_PRODUCAO = "llugytkdsfsrciavhrfw";
const REF_STAGING = "alhqbpbekmxpoibrrnbi";
const TIMEOUT_MS = 30_000;

// ---------------------------------------------------------------------------
// GitHub
// ---------------------------------------------------------------------------

function tokenGitHub() {
  if (process.env.GH_TOKEN) return process.env.GH_TOKEN;
  if (process.env.GITHUB_ACTIONS === "true") {
    throw new Error("segredo BOARD_PROJECT_TOKEN ausente ou vazio no repositório");
  }
  try {
    return execFileSync("gh", ["auth", "token"], { encoding: "utf8" }).trim();
  } catch {
    throw new Error("sem GH_TOKEN e o `gh auth token` falhou — faça `gh auth login`");
  }
}

let TOKEN;

async function gql(query, variables = {}) {
  const resp = await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query, variables }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const json = await resp.json();
  if (!resp.ok || json.errors) {
    throw new Error(`GitHub GraphQL: ${JSON.stringify(json.errors ?? json).slice(0, 400)}`);
  }
  return json.data;
}

async function carregarBoard() {
  const d = await gql(
    `query($o: String!, $n: Int!) {
      user(login: $o) {
        projectV2(number: $n) {
          id
          field(name: "Status") {
            ... on ProjectV2SingleSelectField { id options { id name } }
          }
        }
      }
    }`,
    { o: OWNER, n: PROJECT_NUMBER },
  );
  const p = d.user?.projectV2;
  if (!p) throw new Error(`board ${OWNER}/${PROJECT_NUMBER} não encontrado — o token enxerga o board?`);
  if (!p.field) throw new Error('o board não tem o campo "Status"');
  const opcoes = Object.fromEntries(p.field.options.map((o) => [o.name, o.id]));
  for (const nome of Object.values(COLUNA)) {
    if (!opcoes[nome]) throw new Error(`a coluna "${nome}" não existe no campo Status`);
  }
  return { id: p.id, campo: p.field.id, opcoes };
}

async function gravarStatus(board, itemId, coluna) {
  await gql(
    `mutation($p: ID!, $i: ID!, $f: ID!, $o: String!) {
      updateProjectV2ItemFieldValue(input: {
        projectId: $p, itemId: $i, fieldId: $f, value: { singleSelectOptionId: $o }
      }) { projectV2Item { id } }
    }`,
    { p: board.id, i: itemId, f: board.campo, o: board.opcoes[coluna] },
  );
}

async function lerStatus(itemId) {
  const d = await gql(
    `query($i: ID!) {
      node(id: $i) {
        ... on ProjectV2Item {
          fieldValueByName(name: "Status") {
            ... on ProjectV2ItemFieldSingleSelectValue { name }
          }
        }
      }
    }`,
    { i: itemId },
  );
  return d.node?.fieldValueByName?.name ?? null;
}

// Idempotente: se o conteúdo já está no board, devolve o item existente.
async function adicionar(board, contentId) {
  const d = await gql(
    `mutation($p: ID!, $c: ID!) {
      addProjectV2ItemById(input: { projectId: $p, contentId: $c }) { item { id } }
    }`,
    { p: board.id, c: contentId },
  );
  return d.addProjectV2ItemById.item.id;
}

async function arquivar(board, itemId) {
  await gql(
    `mutation($p: ID!, $i: ID!) {
      archiveProjectV2Item(input: { projectId: $p, itemId: $i }) { item { id } }
    }`,
    { p: board.id, i: itemId },
  );
}

// Só o necessário para achar os cards da coluna; o detalhe vem depois, card a
// card — buscar arquivos de PR para o board inteiro seria desperdício.
async function cardsNaColuna(board, coluna) {
  const cards = [];
  let cursor = null;
  do {
    const d = await gql(
      `query($id: ID!, $c: String) {
        node(id: $id) {
          ... on ProjectV2 {
            items(first: 100, after: $c) {
              pageInfo { hasNextPage endCursor }
              nodes {
                id
                isArchived
                fieldValueByName(name: "Status") {
                  ... on ProjectV2ItemFieldSingleSelectValue { name }
                }
                content {
                  __typename
                  ... on PullRequest { number }
                  ... on Issue { number }
                }
              }
            }
          }
        }
      }`,
      { id: board.id, c: cursor },
    );
    const pagina = d.node.items;
    for (const n of pagina.nodes) {
      if (n.isArchived || n.fieldValueByName?.name !== coluna || !n.content?.number) continue;
      cards.push({ itemId: n.id, tipo: n.content.__typename, numero: n.content.number });
    }
    cursor = pagina.pageInfo.hasNextPage ? pagina.pageInfo.endCursor : null;
  } while (cursor);
  return cards;
}

const CAMPOS_PR = `
  number merged state baseRefName
  mergeCommit { oid }
  files(first: 100) { totalCount nodes { path changeType } }
`;

// Os PRs que decidem um card: o próprio PR, ou os PRs vinculados à issue.
async function prsDoCard(card) {
  if (card.tipo === "PullRequest") {
    const d = await gql(
      `query($o: String!, $r: String!, $n: Int!) {
        repository(owner: $o, name: $r) { pullRequest(number: $n) { ${CAMPOS_PR} } }
      }`,
      { o: REPO_OWNER, r: REPO_NAME, n: card.numero },
    );
    return [d.repository.pullRequest];
  }
  const d = await gql(
    `query($o: String!, $r: String!, $n: Int!) {
      repository(owner: $o, name: $r) {
        issue(number: $n) {
          closedByPullRequestsReferences(first: 10, includeClosedPrs: true) {
            nodes { ${CAMPOS_PR} }
          }
        }
      }
    }`,
    { o: REPO_OWNER, r: REPO_NAME, n: card.numero },
  );
  return d.repository.issue.closedByPullRequestsReferences.nodes;
}

function migrationsDoPr(pr) {
  return pr.files.nodes
    .filter((f) => f.path.startsWith(PASTA_MIGRATIONS) && f.changeType !== "DELETED")
    .map((f) => path.basename(f.path))
    .filter((nome) => PADRAO_MIGRATION.test(nome));
}

// ---------------------------------------------------------------------------
// git
// ---------------------------------------------------------------------------

// "Não está no alvo" e "não consegui conferir" são respostas diferentes: o
// primeiro segura o card em silêncio (é normal entre releases), o segundo é
// erro e tem que aparecer.
function estaNoAlvo(oid, alvo) {
  try {
    execFileSync("git", ["merge-base", "--is-ancestor", oid, alvo], { stdio: "ignore" });
    return true;
  } catch (e) {
    if (e.status === 1) return false;
    throw new Error(
      `git não conseguiu avaliar ${oid.slice(0, 7)} contra ${alvo} (status ${e.status}) — clone raso ou commit ausente?`,
    );
  }
}

function sha256NoAlvo(alvo, nome) {
  const conteudo = execFileSync("git", ["show", `${alvo}:${PASTA_MIGRATIONS}${nome}`]);
  return crypto.createHash("sha256").update(conteudo).digest("hex");
}

// ---------------------------------------------------------------------------
// Registro de migrations (ops.migrations_aplicadas)
// ---------------------------------------------------------------------------

function lerEnvLocal(chave) {
  try {
    const txt = fs.readFileSync(path.join(process.cwd(), ".env.local"), "utf8");
    return txt.match(new RegExp(`^${chave}=(.*)$`, "m"))?.[1].trim() ?? null;
  } catch {
    return null;
  }
}

// Devolve Map(nome -> sha256) com as migrations que ESTÃO no registro.
// Os nomes chegam validados por PADRAO_MIGRATION, então não carregam aspas.
async function lerRegistro(nomes, { staging }) {
  if (!nomes.length) return new Map();
  const sql =
    "select nome, sha256 from ops.migrations_aplicadas where nome in (" +
    nomes.map((n) => `'${n}'`).join(", ") +
    ")";

  if (process.env.REGISTRO_PG_CONN && !staging) {
    const saida = execFileSync(
      "psql",
      [process.env.REGISTRO_PG_CONN, "-v", "ON_ERROR_STOP=1", "-tAX", "-F", "\t", "-c", sql],
      { encoding: "utf8", timeout: TIMEOUT_MS, stdio: ["ignore", "pipe", "pipe"] },
    );
    return new Map(
      saida
        .split("\n")
        .filter(Boolean)
        .map((linha) => linha.split("\t")),
    );
  }

  const token = lerEnvLocal("SUPABASE_ACCESS_TOKEN");
  if (!token) {
    throw new Error("sem acesso ao registro: defina REGISTRO_PG_CONN + PGPASSWORD, ou SUPABASE_ACCESS_TOKEN no .env.local");
  }
  const ref = staging ? REF_STAGING : REF_PRODUCAO;
  const resp = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query: sql }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const texto = await resp.text();
  if (!resp.ok) throw new Error(`registro (${ref}): HTTP ${resp.status} ${texto.slice(0, 300)}`);
  return new Map(JSON.parse(texto).map((r) => [r.nome, r.sha256]));
}

// ---------------------------------------------------------------------------
// Modos
// ---------------------------------------------------------------------------

const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

async function emRevisao(numero) {
  const board = await carregarBoard();
  const d = await gql(
    `query($o: String!, $r: String!, $n: Int!) {
      repository(owner: $o, name: $r) { pullRequest(number: $n) { id isDraft baseRefName state } }
    }`,
    { o: REPO_OWNER, r: REPO_NAME, n: numero },
  );
  const pr = d.repository.pullRequest;
  if (pr.baseRefName !== "staging" || pr.isDraft || pr.state !== "OPEN") {
    console.log(`#${numero}: nada a fazer (base ${pr.baseRefName}, draft=${pr.isDraft}, ${pr.state})`);
    return;
  }
  const itemId = await adicionar(board, pr.id);
  await gravarStatus(board, itemId, COLUNA.revisao);
  console.log(`#${numero} -> ${COLUNA.revisao}`);

  // O "Item added to project" nativo carimba Backlog quando o Auto-add puxa o
  // PR, e não há ordem garantida entre ele e este job. Confere depois de um
  // tempo; se ele passou por cima, grava de novo.
  await dormir(20_000);
  const agora = await lerStatus(itemId);
  if (agora !== COLUNA.revisao) {
    await gravarStatus(board, itemId, COLUNA.revisao);
    console.log(`#${numero}: estava em "${agora}" (workflow nativo passou por cima) — regravado`);
  }
}

async function release({ dryRun, alvo, registroStaging }) {
  const board = await carregarBoard();
  const cards = await cardsNaColuna(board, COLUNA.validar);
  const erros = [];

  // 1. Por card: os PRs que o decidem e se cada um já está no alvo.
  for (const card of cards) {
    card.motivos = [];
    card.migrations = [];
    let prs;
    try {
      prs = await prsDoCard(card);
    } catch (e) {
      card.motivos.push("não consegui ler o card no GitHub");
      erros.push(`#${card.numero}: ${e.message}`);
      continue;
    }
    // O PR de release é o veículo do lote. Se entrou no board (label
    // esquecido), arquiva em vez de mover.
    if (card.tipo === "PullRequest" && prs[0].baseRefName === "main") {
      card.release = prs[0].merged;
      if (!prs[0].merged) card.motivos.push("PR de release ainda aberto");
      continue;
    }
    const mergeados = prs.filter((p) => p.merged);
    if (!mergeados.length) {
      card.motivos.push(card.tipo === "Issue" ? "nenhum PR mergeado vinculado à issue" : "PR não mergeado");
      continue;
    }
    // Issue resolvida por mais de um PR: um ainda aberto quer dizer que o
    // trabalho não terminou. (PR fechado sem merge é tentativa abandonada e
    // não segura nada.)
    for (const aberto of prs.filter((p) => p.state === "OPEN")) {
      card.motivos.push(`PR vinculado #${aberto.number} ainda aberto`);
    }
    for (const pr of mergeados) {
      if (pr.files.totalCount > pr.files.nodes.length) {
        card.motivos.push(`#${pr.number} tem ${pr.files.totalCount} arquivos: migrations não conferidas`);
        continue;
      }
      try {
        if (!estaNoAlvo(pr.mergeCommit.oid, alvo)) card.motivos.push(`#${pr.number} ainda não está em ${alvo}`);
      } catch (e) {
        card.motivos.push(`#${pr.number}: não deu para conferir no git`);
        erros.push(e.message);
      }
      card.migrations.push(...migrationsDoPr(pr));
    }
    card.migrations = [...new Set(card.migrations)];
  }

  // 2. Registro: uma consulta só, e só para quem já passou no git — entre
  // releases nada está na main e o banco nem é consultado.
  const precisam = cards.filter((c) => !c.motivos.length && !c.release && c.migrations.length);
  const nomes = [...new Set(precisam.flatMap((c) => c.migrations))];
  let registro = new Map();
  try {
    registro = await lerRegistro(nomes, { staging: registroStaging });
  } catch (e) {
    const msg = String(e.stderr || e.message).trim().split("\n")[0];
    erros.push(`registro de migrations indisponível: ${msg}`);
    for (const c of precisam) c.motivos.push("registro de migrations indisponível");
  }
  const origemRegistro = registroStaging ? "staging" : "produção";
  const avisos = [];
  for (const c of precisam) {
    for (const nome of c.migrations) {
      if (!registro.has(nome)) {
        if (!c.motivos.includes("registro de migrations indisponível")) {
          c.motivos.push(`${nome} não está no registro de ${origemRegistro}`);
        }
        continue;
      }
      // Registrada, mas o arquivo mudou depois de aplicado: não segura o card
      // (pode ser só um comentário), mas tem que aparecer.
      let sha;
      try {
        sha = sha256NoAlvo(alvo, nome);
      } catch {
        avisos.push(`${nome}: não consegui ler o arquivo em ${alvo} para comparar com o registro`);
        continue;
      }
      if (sha !== registro.get(nome)) {
        avisos.push(`${nome}: o arquivo em ${alvo} difere do que foi aplicado`);
      }
    }
  }

  // 3. Decisão.
  const linhas = [];
  for (const c of cards) {
    if (c.release) {
      if (!dryRun) await arquivar(board, c.itemId);
      linhas.push([c.numero, "arquivado", "PR de release — é o veículo do lote"]);
    } else if (!c.motivos.length) {
      if (!dryRun) await gravarStatus(board, c.itemId, COLUNA.producao);
      linhas.push([c.numero, `-> ${COLUNA.producao}`, c.migrations.length ? `migrations: ${c.migrations.join(", ")}` : ""]);
    } else {
      linhas.push([c.numero, "segurado", c.motivos.join("; ")]);
    }
  }

  // 4. Relatório — só números, nomes de migration e motivos (log público).
  const titulo = `board: release${dryRun ? " (dry-run — nada foi alterado)" : ""} · alvo ${alvo} · registro de ${origemRegistro}`;
  const movidos = linhas.filter((l) => l[1] !== "segurado").length;
  console.log(`\n${titulo}`);
  console.log(`${cards.length} card(s) em "${COLUNA.validar}": ${movidos} movido(s), ${cards.length - movidos} segurado(s)\n`);
  for (const [n, decisao, motivo] of linhas.sort((a, b) => a[0] - b[0])) {
    console.log(`  #${String(n).padEnd(4)} ${decisao.padEnd(12)} ${motivo}`);
  }
  for (const a of avisos) console.log(`  AVISO: ${a}`);
  for (const e of erros) console.log(`  ERRO: ${e}`);

  if (process.env.GITHUB_STEP_SUMMARY) {
    const md = [
      `### ${titulo}`,
      "",
      `${cards.length} card(s) em *${COLUNA.validar}*: **${movidos} movido(s)**, ${cards.length - movidos} segurado(s).`,
      "",
      "| Card | Decisão | Motivo |",
      "|---|---|---|",
      ...linhas.map(([n, d, m]) => `| #${n} | ${d} | ${m} |`),
      ...avisos.map((a) => `\n> ⚠️ ${a}`),
      ...erros.map((e) => `\n> ❌ ${e}`),
      "",
    ].join("\n");
    fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, md);
  }

  if (erros.length) process.exitCode = 1;
}

// ---------------------------------------------------------------------------

async function main() {
  const [modo, ...resto] = process.argv.slice(2);
  TOKEN = tokenGitHub();

  if (modo === "em-revisao") {
    const numero = Number(resto[0]);
    if (!Number.isInteger(numero) || numero <= 0) throw new Error("uso: em-revisao <número do PR>");
    return emRevisao(numero);
  }
  if (modo === "release") {
    const i = resto.indexOf("--alvo");
    return release({
      dryRun: resto.includes("--dry-run"),
      alvo: i !== -1 ? resto[i + 1] : "origin/main",
      registroStaging: resto.includes("--registro-staging"),
    });
  }
  throw new Error("uso: board-sync.mjs em-revisao <pr> | release [--dry-run] [--alvo <ref>] [--registro-staging]");
}

main().catch((e) => {
  console.error(`ERRO: ${e.message}`);
  process.exit(1);
});

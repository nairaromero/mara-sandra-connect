// Confere o espelho do front (`src/lib/rbac/exigencias.ts`) contra o que o BANCO
// realmente exige. É a resposta automática para "ainda falta alguma?" — a
// pergunta que a auditoria de 24/09 teve de responder à mão
// (planning/RBAC_AUDITORIA_TELAS.md).
//
// Compara três listas:
//   1. policies `perm_*` de escrita  → tabela, operação, permissão e ESCOPO cobrado;
//   2. RPCs do schema `public` que chamam `private.tem_permissao`;
//   3. edge functions com `permissao:` no `exigirUsuario` (lidas do código).
//
// Sai 0 quando bate, 1 quando diverge (e diz exatamente o que sobra ou falta).
//
//   node scripts/rbac-conferir-exigencias.mjs --local
//   node scripts/rbac-conferir-exigencias.mjs --staging
//   node scripts/rbac-conferir-exigencias.mjs               # produção
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const flag = process.argv.find((a) => a === "--local" || a === "--staging");
const alvo = flag ?? "(produção)";

function sql(q) {
  const args = ["scripts/msc-sql.mjs", ...(flag ? [flag] : []), q];
  const out = execFileSync("node", args, { encoding: "utf8" });
  const txt = out.split("\n").filter((l) => !l.startsWith("[msc-sql]")).join("\n").trim();
  return txt ? JSON.parse(txt) : [];
}

// ---------- o que o banco exige ----------
const policies = sql(`
  select tablename as tabela, lower(cmd) as cmd,
         coalesce(qual, with_check) as regra
    from pg_policies
   where schemaname = 'public' and policyname like 'perm\\_%'
     and cmd in ('INSERT','UPDATE','DELETE')
   order by 1, 2`);

// Lê a regra INTEIRA. Ela tem duas formas:
//   tem_permissao('x:y', NULL)                                  -> qualquer escopo
//   tem_permissao('x:y','todos') OR (tem_permissao('x:y','atribuidos') AND col = auth.uid())
// Ler só o primeiro `tem_permissao(...)` (como este script fazia) faz a segunda
// parecer "exige escopo todos" — foi assim que o espelho nasceu errado em 24/09.
function lerRegra(regra) {
  const perms = [...regra.matchAll(/tem_permissao\('([a-z_:]+)'::text, *(?:'([a-z]+)'::text|NULL)/g)]
    .map((m) => ({ permissao: m[1], escopo: m[2] ?? null }));
  if (perms.length === 0) return null;
  const permissao = perms[0].permissao;
  const restrito = perms.find((p) => p.escopo && p.escopo !== "todos");
  if (!restrito) return { permissao, proprio: null };
  const col = regra.match(/\(([a-z_]+) = \( SELECT auth\.uid\(\)/);
  return { permissao, proprio: { escopo: restrito.escopo, coluna: col ? col[1] : "?" } };
}

// `substring` e não `regexp_matches(..., 'g')`: a função de conjunto quebra o
// caminho do msc-sql local (que agrega o resultado).
const rpcs = sql(`
  select p.proname as nome,
         substring(pg_get_functiondef(p.oid) from 'tem_permissao\\(''([a-z_:]+)''') as permissao
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     -- prokind = 'f': pg_get_functiondef recusa agregados (o banco local
     -- tem um array_agg no public e a consulta morria só lá).
     and p.prokind = 'f'
     and pg_get_functiondef(p.oid) like '%tem_permissao%'
   order by 1`);

// ---------- o que o front declara ----------
const arq = fs.readFileSync(path.resolve("src/lib/rbac/exigencias.ts"), "utf8");
const bloco = (nome) => {
  const i = arq.indexOf(`export const ${nome}`);
  if (i < 0) return "";
  const fim = arq.indexOf("\n};", i);
  return arq.slice(i, fim);
};
const OP = { insert: "inserir", update: "atualizar", delete: "excluir" };

/** Corpo `{ … }` de uma chave do bloco, contando chaves (a entrada pode ter várias linhas). */
function corpoDaChave(txt, chave) {
  const i = txt.indexOf(`\n  ${chave}: {`);
  if (i < 0) return null;
  let j = txt.indexOf("{", i);
  let nivel = 0;
  for (let k = j; k < txt.length; k++) {
    if (txt[k] === "{") nivel++;
    else if (txt[k] === "}") { nivel--; if (nivel === 0) return txt.slice(j + 1, k); }
  }
  return null;
}

function lerEntrada(txt) {
  const perm = txt.match(/permissao: "([a-z_:]+)"/);
  if (!perm) return null;
  const pr = txt.match(/proprio: \{ escopo: "([a-z]+)", coluna: "([a-z_]+)" \}/);
  return { permissao: perm[1], proprio: pr ? { escopo: pr[1], coluna: pr[2] } : null };
}
function frontEscrita(tabela, op) {
  const corpo = corpoDaChave(bloco("ESCRITA"), tabela);
  if (!corpo) return null;
  const porOp = corpo.match(new RegExp(`${OP[op]}: \\{[^}]*(?:\\{[^}]*\\}[^}]*)*\\}`));
  const todas = corpo.match(/todas: \{[^}]*(?:\{[^}]*\}[^}]*)*\}/);
  const trecho = porOp?.[0] ?? todas?.[0];
  return trecho ? lerEntrada(trecho) : null;
}
function frontMapa(nome) {
  const txt = bloco(nome);
  const out = {};
  for (const m of txt.matchAll(/"?([a-z_:-]+)"?: \{ permissao: "([a-z_:]+)"(?:, escopo: "([a-z]+)")? \}/g)) {
    out[m[1]] = { permissao: m[2], escopo: m[3] ?? null };
  }
  return out;
}

// ---------- comparação ----------
const problemas = [];
for (const p of policies) {
  const banco = lerRegra(p.regra);
  if (!banco) continue; // policy perm_* sem tem_permissao: nada a espelhar
  const f = frontEscrita(p.tabela, p.cmd);
  if (!f) { problemas.push(`FALTA no front: ${p.tabela}.${p.cmd} exige ${banco.permissao}`); continue; }
  if (f.permissao !== banco.permissao) {
    problemas.push(`PERMISSÃO DIFERENTE: ${p.tabela}.${p.cmd} — banco ${banco.permissao}, front ${f.permissao}`);
  }
  const b = banco.proprio ? `${banco.proprio.escopo}/${banco.proprio.coluna}` : "não";
  const t = f.proprio ? `${f.proprio.escopo}/${f.proprio.coluna}` : "não";
  if (b !== t) {
    problemas.push(`ESCOPO DIFERENTE: ${p.tabela}.${p.cmd} — banco aceita próprio: ${b}, front: ${t}`);
  }
}
const rpcFront = frontMapa("RPC");
const rpcBanco = {};
for (const r of rpcs) {
  // Fora: o próprio helper e quem chama `tem_permissao` com permissão variável
  // (aí não há uma exigência fixa para a tela espelhar).
  if (!r.permissao || r.nome === "tem_permissao") continue;
  rpcBanco[r.nome] = r.permissao;
}
for (const [nome, perm] of Object.entries(rpcBanco)) {
  if (!rpcFront[nome]) problemas.push(`FALTA no front: RPC ${nome} exige ${perm}`);
  else if (rpcFront[nome].permissao !== perm) problemas.push(`PERMISSÃO DIFERENTE: RPC ${nome} — banco ${perm}, front ${rpcFront[nome].permissao}`);
}
for (const nome of Object.keys(rpcFront)) {
  if (!rpcBanco[nome]) problemas.push(`SOBRA no front: RPC ${nome} não exige permissão no banco`);
}

// edge functions: a verdade está no código delas
const fnFront = frontMapa("FUNCTION");
const dirFn = path.resolve("supabase/functions");
for (const d of fs.readdirSync(dirFn)) {
  const idx = path.join(dirFn, d, "index.ts");
  if (!fs.existsSync(idx)) continue;
  const m = fs.readFileSync(idx, "utf8").match(/exigirUsuario\(req,[^)]*permissao: "([a-z_:]+)"/);
  if (m && !fnFront[d]) problemas.push(`FALTA no front: function ${d} exige ${m[1]}`);
  else if (m && fnFront[d].permissao !== m[1]) problemas.push(`PERMISSÃO DIFERENTE: function ${d} — código ${m[1]}, front ${fnFront[d].permissao}`);
  else if (!m && fnFront[d]) problemas.push(`SOBRA no front: function ${d} não exige permissão`);
}

console.log(`espelho x banco — alvo: ${alvo}`);
console.log(`  policies de escrita conferidas: ${policies.length}`);
console.log(`  RPCs com permissão: ${Object.keys(rpcBanco).length}`);
console.log(`  functions com permissão: ${Object.keys(fnFront).length}`);
if (problemas.length === 0) {
  console.log("\nOK: o espelho do front bate com o servidor.");
  process.exit(0);
}
console.log(`\n${problemas.length} divergência(s):`);
for (const p of problemas) console.log(`  - ${p}`);
process.exit(1);

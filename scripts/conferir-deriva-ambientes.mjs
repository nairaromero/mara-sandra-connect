// Staging × produção: as PERMISSÕES dos dois bancos são as mesmas?
//
// Por que existe (item f44, 23/10): em produção, tabela nova do schema public
// nascia sem SELECT/INSERT/UPDATE/DELETE para `service_role`; no staging,
// com. Tudo é testado no staging (e no local, que é cópia dele), então a
// diferença não aparecia em teste nenhum — e o registro de uso da IA falhou em
// silêncio em produção por 5 dias. A diferença veio de fora das migrations,
// então nenhuma régua de código a enxergaria: só comparando os dois bancos.
//
// Compara, para os papéis que a API usa (anon, authenticated, service_role):
//   1. o padrão de permissão de objeto NOVO no schema public (pg_default_acl);
//   2. o privilégio de cada tabela do public que existe nos dois;
//   3. o EXECUTE de cada função do public que existe nos dois.
// Só lê. Sai 0 quando bate, 1 quando diverge (e lista as diferenças).
//
//   node scripts/conferir-deriva-ambientes.mjs
//
// Rodar antes de todo release (CLAUDE.md, "Rotina deploy").

import { execFileSync } from "node:child_process";

const PAPEIS = ["anon", "authenticated", "service_role"];

function sql(q, staging) {
  const args = ["scripts/msc-sql.mjs", ...(staging ? ["--staging"] : []), q];
  const out = execFileSync("node", args, { encoding: "utf8" });
  const txt = out.split("\n").filter((l) => !l.startsWith("[msc-sql]")).join("\n").trim();
  return txt ? JSON.parse(txt) : [];
}

const papeis = PAPEIS.map((p) => `'${p}'`).join(",");

const CONSULTAS = {
  "padrão de objeto novo": `
    select a.defaclrole::regrole::text || ' cria ' || a.defaclobjtype::text || ' → ' || x.grantee::regrole::text as chave,
           string_agg(x.privilege_type, ',' order by x.privilege_type) as valor
      from pg_default_acl a
      join pg_namespace n on n.oid = a.defaclnamespace and n.nspname = 'public'
      cross join lateral aclexplode(a.defaclacl) x
     where x.grantee::regrole::text in (${papeis})
     group by 1`,
  "tabela": `
    select c.relname || ' → ' || r.rolname as chave,
           concat_ws(',',
             case when has_table_privilege(r.oid, c.oid, 'SELECT') then 'SELECT' end,
             case when has_table_privilege(r.oid, c.oid, 'INSERT') then 'INSERT' end,
             case when has_table_privilege(r.oid, c.oid, 'UPDATE') then 'UPDATE' end,
             case when has_table_privilege(r.oid, c.oid, 'DELETE') then 'DELETE' end) as valor
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
      cross join pg_roles r
     where c.relkind in ('r', 'p', 'v') and r.rolname in (${papeis})`,
  "função": `
    select p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ') → ' || r.rolname as chave,
           case when has_function_privilege(r.oid, p.oid, 'EXECUTE') then 'EXECUTE' else '-' end as valor
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace and n.nspname = 'public'
      cross join pg_roles r
     where r.rolname in (${papeis}) and p.prokind = 'f'`,
};

const diferencas = [];
for (const [tipo, q] of Object.entries(CONSULTAS)) {
  const mapa = (linhas) => new Map(linhas.map((l) => [l.chave, l.valor ?? ""]));
  const prod = mapa(sql(q, false));
  const stg = mapa(sql(q, true));
  // Só o que existe nos DOIS: objeto que ainda não foi para produção não é deriva.
  const chaves = tipo === "padrão de objeto novo" ? new Set([...prod.keys(), ...stg.keys()]) : [...prod.keys()].filter((k) => stg.has(k));
  for (const k of chaves) {
    const a = prod.get(k) ?? "(nada)";
    const b = stg.get(k) ?? "(nada)";
    if (a !== b) diferencas.push({ tipo, objeto: k, producao: a, staging: b });
  }
}

if (!diferencas.length) {
  console.log("OK: staging e produção têm as mesmas permissões para anon, authenticated e service_role.");
  process.exit(0);
}
console.log(`${diferencas.length} diferença(s) de permissão entre staging e produção:\n`);
for (const d of diferencas) {
  console.log(`  [${d.tipo}] ${d.objeto}\n      produção: ${d.producao || "(nenhuma)"}\n      staging:  ${d.staging || "(nenhuma)"}`);
}
console.log("\nO que passa no staging pode quebrar (ou abrir) em produção. Alinhar por migration, nos dois.");
process.exit(1);

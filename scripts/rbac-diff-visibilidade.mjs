#!/usr/bin/env node
// Diff de visibilidade — a linha de base de todas as fases do RBAC multi-tenant
// (planning/MULTI_TENANT_RBAC.md, Fase 1 e portões das Fases 2–5).
//
//   node scripts/rbac-diff-visibilidade.mjs gravar <arquivo.json>
//   node scripts/rbac-diff-visibilidade.mjs comparar <antes.json> <depois.json>
//
// Para cada conta de papel (admin, interno, parceiro) e cada tabela de `public`
// com RLS, grava quantas linhas a conta VÊ e o hash das chaves visíveis — lidos
// como a própria conta (role authenticated + claims do JWT), direto no Postgres.
// Compara antes × depois de uma migration: o escritório 1 não pode ver nem uma
// linha a mais ou a menos.
//
// Só roda no banco LOCAL (127.0.0.1:55322, marcado ambiente=local).

import fs from "node:fs";
import pg from "pg";

const LOCAL_DB_URL = "postgresql://postgres:postgres@127.0.0.1:55322/postgres";

// Contas de papel. A de parceiro é a que tem mais casos (mais sinal no diff);
// a de interno comum é a primeira ativa que não é admin.
const CONTAS_SQL = `
  (select 'admin' as papel, u.id, u.email from public.usuarios u join auth.users a on a.id = u.id
    where u.tipo = 'interno' and u.eh_admin and u.ativo order by u.email limit 1)
  union all
  (select 'interno', u.id, u.email from public.usuarios u join auth.users a on a.id = u.id
    where u.tipo = 'interno' and not coalesce(u.eh_admin, false) and u.ativo order by u.email limit 1)
  union all
  (select 'parceiro', u.id, u.email from public.usuarios u join auth.users a on a.id = u.id
    where u.tipo = 'parceiro' and u.ativo and u.desligado_em is null
    order by (select count(*) from public.casos c where c.parceiro_id = u.id) desc, u.email limit 1)
  union all
  (select 'parceiro_desligado', u.id, u.email from public.usuarios u join auth.users a on a.id = u.id
    where u.tipo = 'parceiro' and (not u.ativo or u.desligado_em is not null) order by u.email limit 1)`;

async function gravar(arquivo) {
  const db = new pg.Client({ connectionString: LOCAL_DB_URL });
  await db.connect();
  // Mesmo marcador do scripts/msc-sql.mjs (posto pelo scripts/ambiente-local.sh).
  const marcador = await db.query(
    "select coalesce(obj_description('public'::regnamespace, 'pg_namespace'), '') as m",
  );
  if (marcador.rows[0].m !== "ambiente=local") {
    throw new Error("o banco em 127.0.0.1:55322 não está marcado como ambiente=local");
  }

  const { rows: contas } = await db.query(CONTAS_SQL);
  const { rows: tabelas } = await db.query(`
    select c.relname as tabela,
           (select string_agg(quote_ident(a.attname), ', ' order by k.ord)
              from pg_index i
              cross join lateral unnest(i.indkey) with ordinality k(attnum, ord)
              join pg_attribute a on a.attrelid = c.oid and a.attnum = k.attnum
             where i.indrelid = c.oid and i.indisprimary) as pk
      from pg_class c
     where c.relnamespace = 'public'::regnamespace and c.relkind = 'r' and c.relrowsecurity
     order by 1`);

  const saida = { geradoEm: new Date().toISOString(), contas: {}, tabelas: tabelas.map((t) => t.tabela) };
  for (const conta of contas) {
    const visao = {};
    for (const t of tabelas) {
      const chave = t.pk ? `(${t.pk})::text` : "t::text";
      await db.query("begin");
      try {
        await db.query("select set_config('request.jwt.claims', $1, true)", [
          JSON.stringify({ sub: conta.id, role: "authenticated", email: conta.email }),
        ]);
        await db.query("set local role authenticated");
        const r = await db.query(
          `select count(*)::int as n, md5(coalesce(string_agg(k, ',' order by k), '')) as h
             from (select ${chave} as k from public.${JSON.stringify(t.tabela)} t) s`,
        );
        visao[t.tabela] = { n: r.rows[0].n, h: r.rows[0].h };
      } catch (e) {
        visao[t.tabela] = { erro: e.message.slice(0, 120) };
      } finally {
        await db.query("rollback");
      }
    }
    saida.contas[conta.papel] = { visao };
  }
  await db.end();
  fs.writeFileSync(arquivo, JSON.stringify(saida, null, 1));
  const resumo = Object.entries(saida.contas)
    .map(([p, c]) => `${p}: ${Object.values(c.visao).reduce((s, v) => s + (v.n ?? 0), 0)} linhas`)
    .join(" · ");
  console.log(`gravado em ${arquivo} — ${tabelas.length} tabelas · ${resumo}`);
}

function comparar(a, b) {
  const antes = JSON.parse(fs.readFileSync(a, "utf8"));
  const depois = JSON.parse(fs.readFileSync(b, "utf8"));
  let diferencas = 0;
  for (const papel of Object.keys(antes.contas)) {
    const va = antes.contas[papel].visao;
    const vd = depois.contas[papel]?.visao ?? {};
    for (const tabela of Object.keys(va)) {
      const x = va[tabela];
      const y = vd[tabela];
      if (!y) {
        console.log(`DIF  ${papel} · ${tabela}: some do "depois"`);
        diferencas++;
      } else if (x.erro || y.erro) {
        if (x.erro !== y.erro) {
          console.log(`DIF  ${papel} · ${tabela}: erro antes="${x.erro ?? "-"}" depois="${y.erro ?? "-"}"`);
          diferencas++;
        }
      } else if (x.n !== y.n || x.h !== y.h) {
        console.log(`DIF  ${papel} · ${tabela}: ${x.n} → ${y.n} linhas${x.n === y.n ? " (mesma contagem, chaves diferentes)" : ""}`);
        diferencas++;
      }
    }
  }
  const novas = depois.tabelas.filter((t) => !antes.tabelas.includes(t));
  if (novas.length) console.log(`(tabelas novas, fora da comparação: ${novas.join(", ")})`);
  console.log(diferencas ? `\n${diferencas} diferença(s) de visibilidade` : "\nvisibilidade idêntica");
  process.exit(diferencas ? 1 : 0);
}

const [cmd, a, b] = process.argv.slice(2);
if (cmd === "gravar" && a) await gravar(a);
else if (cmd === "comparar" && a && b) comparar(a, b);
else {
  console.error("uso: rbac-diff-visibilidade.mjs gravar <arq.json> | comparar <antes.json> <depois.json>");
  process.exit(2);
}

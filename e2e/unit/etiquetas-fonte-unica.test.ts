// Régua das etiquetas com fonte única (#514 / PR #515). Rodar:
//   bun test e2e/unit/etiquetas-fonte-unica.test.ts
//
// Em 09/11 agendar perícia apagou as etiquetas que a equipe marcou pela tela:
// as rotinas escreviam no JSON legado `clientes.tags` e um gatilho espelhava o
// JSON nas tabelas, apagando o que não estava nele. Agora a fonte é uma só
// (etiquetas + clientes_etiquetas) e rotina de sistema aplica etiqueta por um
// túnel só: `private.garantir_etiqueta_cliente`.
//
// Esta régua acusa:
//   * código (tela, functions, scripts) voltando a gravar `clientes.tags`;
//   * as rotinas de perícia voltando a ler/gravar o JSON ou a vincular
//     etiqueta por fora do túnel.
// Sem banco, rede nem .env.
import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

const RAIZ = join(import.meta.dir, "../..");
const MIGRATION = join(RAIZ, "planning/sql-migrations/migration_etiquetas_fonte_unica.sql");

function arquivos(dir: string, fim: RegExp): string[] {
  return readdirSync(join(RAIZ, dir), { recursive: true, withFileTypes: true })
    .filter((d) => d.isFile() && fim.test(d.name) && !d.parentPath.includes("node_modules"))
    .map((d) => join(d.parentPath, d.name));
}

/** Gravações em clientes.tags, em SQL embutido ou no client do Supabase. */
const GRAVA_TAGS: Array<[string, RegExp]> = [
  ["insert em clientes com a coluna tags", /insert\s+into\s+(public\.)?clientes\s*\([^)]*\btags\b/i],
  ["update de clientes.tags", /update\s+(public\.)?clientes\s+set\s+(\w+\s*=[^;]*?,\s*)*tags\s*=/i],
  ["upsert copiando tags", /\btags\s*=\s*excluded\.tags/i],
  ["client do Supabase gravando tags em clientes", /from\(\s*["']clientes["']\s*\)[\s\S]{0,400}?\.(update|insert|upsert)\(\s*\{[^}]*\btags\s*:/],
];

/** Tira comentários SQL (linha e bloco) — a régua olha só o código. */
function semComentarios(sql: string): string {
  return sql.replace(/\/\*[\s\S]*?\*\//g, "").replace(/--[^\n]*/g, "");
}

/** Corpo de `create or replace function <nome>` no arquivo. */
function corpo(sql: string, nome: string): string {
  const m = new RegExp(`create\\s+or\\s+replace\\s+function\\s+${nome.replace(".", "\\.")}\\s*\\([\\s\\S]*?\\$\\$([\\s\\S]*?)\\$\\$`, "i").exec(sql);
  if (!m) throw new Error(`não achei ${nome} na migration`);
  return m[1];
}

describe("etiquetas com fonte única", () => {
  test("ninguém grava clientes.tags (tela, functions, scripts)", () => {
    const achados: string[] = [];
    const todos = [
      ...arquivos("src", /\.(ts|tsx)$/),
      ...arquivos("supabase/functions", /\.ts$/),
      ...arquivos("scripts", /\.(mjs|cjs|js|ts|sh)$/),
    ];
    expect(todos.length).toBeGreaterThan(50);
    for (const p of todos) {
      const texto = readFileSync(p, "utf8");
      for (const [oque, re] of GRAVA_TAGS) {
        if (re.test(texto)) achados.push(`${relative(RAIZ, p)}: ${oque}`);
      }
    }
    expect(achados, "clientes.tags é legado sem escritores — etiqueta vai em clientes_etiquetas").toEqual([]);
  });

  test("as rotinas de perícia não tocam o JSON e só vinculam pelo túnel", () => {
    const sql = semComentarios(readFileSync(MIGRATION, "utf8"));
    for (const nome of ["public.tg_etiqueta_pericia_agendada", "public.trocar_etiqueta_pos_pericia"]) {
      const c = corpo(sql, nome);
      expect(c, `${nome} lê ou grava clientes.tags`).not.toMatch(/\btags\b/);
      expect(c, `${nome} vincula etiqueta por fora do túnel`).not.toMatch(/insert\s+into\s+(public\.)?(clientes_etiquetas|etiquetas)\b/i);
      expect(c, `${nome} deveria passar por private.garantir_etiqueta_cliente`).toMatch(/private\.garantir_etiqueta_cliente\(/);
    }
  });

  test("o espelhador JSON → tabelas continua morto", () => {
    const sql = semComentarios(readFileSync(MIGRATION, "utf8"));
    expect(sql).toMatch(/drop\s+trigger\s+if\s+exists\s+clientes_sync_tags_para_etiquetas/i);
    expect(sql).toMatch(/drop\s+function\s+if\s+exists\s+public\._clientes_sync_tags_para_etiquetas/i);
  });
});

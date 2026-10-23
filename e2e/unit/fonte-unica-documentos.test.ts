// Régua de fonte única dos documentos (#434). Rodar:
//   bun test e2e/unit/fonte-unica-documentos.test.ts
//
// A revisão de 21/10 achou a mesma regra em vários lugares, sem nada que
// garantisse que andavam juntas: "o que a IA lê" em três (SQL, function,
// tela), os tipos de documento em dois (já tinham divergido: 25 x 33) e a
// lista de provedores do link em dois (já tinham divergido: `1drv.com`).
//
// Agora a tela importa as listas da function por `@shared` — o mesmo arquivo.
// O que sobra de cópia é o SQL (o banco não importa TypeScript), e é ele que
// esta régua confere.
import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { EXTENSOES_IA } from "../../supabase/functions/_shared/arquivo-ia";

const RAIZ = join(import.meta.dir, "../..");
const MIGRATIONS = join(RAIZ, "planning/sql-migrations");

function arquivos(dir: string, fim: RegExp): string[] {
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((d) => d.isFile() && fim.test(d.name))
    .map((d) => join(d.parentPath, d.name));
}

describe("fonte única dos documentos", () => {
  test("o que a tela importa de @shared é módulo puro (só importa outro de _shared)", () => {
    const usados = new Set<string>();
    for (const p of arquivos(join(RAIZ, "src"), /\.tsx?$/)) {
      for (const m of readFileSync(p, "utf8").matchAll(/from\s+["']@shared\/([\w-]+)["']/g)) {
        usados.add(m[1]);
      }
    }
    expect(usados.size, "a tela deveria importar ao menos as listas de documentos").toBeGreaterThan(2);
    const impuros: string[] = [];
    for (const nome of usados) {
      const texto = readFileSync(join(RAIZ, "supabase/functions/_shared", `${nome}.ts`), "utf8");
      for (const m of texto.matchAll(/^\s*import\s[^;]*?from\s+["']([^"']+)["']/gm)) {
        // Relativo dentro de _shared é aceito só se ele também for puro.
        if (!/^\.\/[\w-]+\.ts$/.test(m[1])) impuros.push(`${nome}: ${m[1]}`);
      }
    }
    expect(impuros, "a tela não carrega Deno, esm.sh nem jsr").toEqual([]);
  });

  test("o banco lê os mesmos formatos que a function e a tela (private.ia_le_arquivo)", () => {
    // A ÚLTIMA migration que define a função é a que vale.
    const definicoes = arquivos(MIGRATIONS, /^migration_.*\.sql$/)
      .sort()
      .map((p) => readFileSync(p, "utf8"))
      .map((t) => t.match(/function private\.ia_le_arquivo[\s\S]*?\$\$([\s\S]*?)\$\$/))
      .filter((m): m is RegExpMatchArray => !!m);
    expect(definicoes.length, "a régua não achou private.ia_le_arquivo").toBeGreaterThan(0);
    const corpo = definicoes[definicoes.length - 1][1];
    const grupo = corpo.match(/\\\.\(([^)]+)\)\$/);
    expect(grupo, `regex de extensão não reconhecida: ${corpo.trim()}`).toBeTruthy();
    // "jpe?g" vira jpg + jpeg.
    const doBanco = grupo![1]
      .split("|")
      .flatMap((e) => (e === "jpe?g" ? ["jpg", "jpeg"] : [e]))
      .sort();
    expect(doBanco).toEqual([...EXTENSOES_IA].sort());
  });

  test("ninguém mais tem lista própria de tipos, provedores ou formatos da IA", () => {
    const copias: string[] = [];
    for (const p of [...arquivos(join(RAIZ, "src"), /\.tsx?$/), ...arquivos(join(RAIZ, "supabase/functions"), /\.ts$/)]) {
      if (p.includes("/_shared/")) continue;
      const t = readFileSync(p, "utf8");
      const rel = p.replace(RAIZ + "/", "");
      if (/["']1drv\.ms["']|1drv\\\.\(/.test(t)) copias.push(`${rel}: lista de provedores`);
      if (/\(pdf\|jpe\?g\|png/.test(t)) copias.push(`${rel}: régua de formato da IA`);
      if (/["']declaracao_ausencia_duplicidade["']\s*,/.test(t)) copias.push(`${rel}: lista de tipos`);
    }
    expect(copias, "importe de @shared (tela) ou de ../_shared (function)").toEqual([]);
  });
});

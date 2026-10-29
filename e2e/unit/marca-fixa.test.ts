// Régua da marca (#496): o nome de UM escritório não aparece escrito no código.
//   bun test e2e/unit/marca-fixa.test.ts
//
// Regra do CLAUDE.md (Marca): a do PRODUTO (Legal Connect) onde não há
// escritório; a do ESCRITÓRIO ativo (escritorio_config.marca,
// useAuth().escritorio.marca, _shared/marca.ts) no resto — "nunca escrever
// 'Mara Sandra Vian' fixo em tela ou function". Até 28/10 ainda estava fixo nos
// títulos de criar/redefinir senha, no cartão "Sobre", no comprovante de
// aceite, e os termos assinados pelos parceiros diziam "Mara Sandra Connect"
// com os dados de um escritório só.
import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const RAIZ = join(import.meta.dir, "../..");

/** O que fala em nome de UM escritório de propósito — com o motivo. */
const EXCECOES: Record<string, string> = {
  "src/routes/index.tsx": "página pública de entrada: é o site do escritório (decisão da Naira, 28/10)",
  "src/lib/site-publico.ts": "dados do site público do escritório (página de entrada e /privacidade)",
};

const NOME = /Mara\s+Sandra|Mara\s+Vian|maravian/i;

function arquivos(dir: string, fim: RegExp): string[] {
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((d) => d.isFile() && fim.test(d.name) && !d.parentPath.includes("node_modules"))
    .map((d) => join(d.parentPath, d.name));
}
const semComentario = (t: string) =>
  t.replace(/\/\*[\s\S]*?\*\//g, "").split("\n").map((l) => (/^\s*\/\//.test(l) ? "" : l.replace(/\s\/\/.*$/, ""))).join("\n");

describe("marca do escritório não fica escrita no código", () => {
  test("telas, functions e documentos legais usam a marca do produto ou a do escritório ativo", () => {
    const achados: string[] = [];
    for (const p of [
      ...arquivos(join(RAIZ, "src"), /\.(tsx?|md)$/),
      ...arquivos(join(RAIZ, "supabase/functions"), /\.ts$/),
    ]) {
      const rel = p.replace(RAIZ + "/", "");
      if (rel in EXCECOES) continue;
      const texto = rel.endsWith(".md") ? readFileSync(p, "utf8") : semComentario(readFileSync(p, "utf8"));
      texto.split("\n").forEach((l, i) => {
        if (NOME.test(l)) achados.push(`${rel}:${i + 1}`);
      });
    }
    expect(achados, "use useAuth().escritorio.marca / _shared/marca.ts, ou 'Legal Connect' onde não há escritório").toEqual([]);
  });

  test("as exceções existem (lista viva, não esquecida)", () => {
    for (const rel of Object.keys(EXCECOES)) expect(() => readFileSync(join(RAIZ, rel))).not.toThrow();
  });
});

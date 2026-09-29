// Guarda: o board-sync lê a lista de arquivos do PR INTEIRA. Rodar:
//   bun test e2e/unit/board-sync-pagina.test.ts
//
// Por que existe: o GitHub entrega os arquivos de um PR em páginas de 100. O
// lote do RBAC (#396) tem 195, e até 29/09 o script parava na primeira página,
// via `totalCount > nodes.length` e segurava o card com "migrations não
// conferidas". Os cards #385 e #395 ficaram presos em "Validar no staging"
// mesmo com as 20 migrations já registradas em produção.
//
// A recusa estava CERTA e continua de pé: não dá para afirmar que não há
// migration no que não se leu, e "não consegui conferir" é resposta diferente
// de "está tudo certo". Errado era ser um beco sem saída — bastava pedir a
// página seguinte.
//
// Esta régua protege as duas metades: que a página seguinte seja pedida, e que
// a recusa continue existindo para quando a paginação falhar. Tirar uma sem a
// outra é o que dói: sem paginação o card trava de novo; sem recusa, um card
// vai para Produção com migration não aplicada, que é o acidente que a trava
// existe para evitar.
// (fora de src/ porque o tsc do app não conhece bun:test)
import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";

const RAIZ = path.resolve(import.meta.dir, "../..");
const CAMINHO = "scripts/board-sync.mjs";
const fonte = fs.readFileSync(path.join(RAIZ, CAMINHO), "utf8");

describe("board-sync: a lista de arquivos do PR vem inteira", () => {
  test("a consulta pede o pageInfo — sem ele não há como virar a página", () => {
    const campos = fonte.match(/const CAMPOS_PR = `([\s\S]*?)`/)?.[1] ?? "";
    expect(campos).toContain("files(first: 100)");
    expect(campos).toMatch(/pageInfo\s*{[^}]*hasNextPage/);
    expect(campos).toMatch(/pageInfo\s*{[^}]*endCursor/);
  });

  test("existe um laço que consome as páginas seguintes com `after`", () => {
    const fn = fonte.match(/async function completarArquivos\(pr\)\s*{([\s\S]*?)\n}/)?.[1];
    expect(fn, "função completarArquivos ausente").toBeTruthy();
    // laço, não um único `if`: um PR de 300 arquivos tem três páginas
    expect(fn).toMatch(/while\s*\(/);
    expect(fn).toContain("hasNextPage");
    expect(fn).toMatch(/files\(first: 100, after: \$c\)/);
    expect(fn).toContain("pr.files.nodes.push(");
  });

  test("nenhum caminho de prsDoCard devolve PR com a lista pela metade", () => {
    const fn = fonte.match(/async function prsDoCard\(card\)\s*{([\s\S]*?)\n}/)?.[1] ?? "";
    const retornos = [...fn.matchAll(/return ([^;]+);/g)].map((m) => m[1]);
    expect(retornos.length, "prsDoCard sem retorno — a régua está lendo o arquivo errado")
      .toBeGreaterThan(0);
    for (const r of retornos) {
      expect(r, `retorno de prsDoCard sem completarArquivos: ${r}`).toContain("completarArquivos");
    }
  });

  test("a recusa continua de pé para quando a paginação falhar", () => {
    // Se a leitura ainda vier incompleta (erro, limite novo da API), o card TEM
    // que ficar segurado. Conferir 100 de 195 e declarar tudo certo deixaria
    // passar uma migration não aplicada.
    expect(fonte).toContain("migrations não conferidas");
    expect(fonte).toMatch(/pr\.files\.totalCount > pr\.files\.nodes\.length/);
  });

  test("importar o módulo não dispara o script", () => {
    // A prova ao vivo (prsDoCard contra o PR #396) só é possível importando o
    // módulo. Se o main() rodasse no import, importar mexeria no board.
    expect(fonte).toMatch(/if \(chamadoDireto\)/);
    expect(fonte).toMatch(/import\.meta\.url === pathToFileURL\(process\.argv\[1\]\)\.href/);
    expect(fonte).toMatch(/export {[^}]*prsDoCard[^}]*}/);
  });
});

// Guarda: as recusas do board-sync continuam de pé, e nenhuma é beco sem saída.
// Rodar: bun test e2e/unit/board-sync-recusas.test.ts
//
// O script tem duas recusas, e as duas estavam CERTAS em recusar e ERRADAS em
// parar por ali:
//
// 1. "migrations não conferidas" — o GitHub entrega os arquivos do PR em
//    páginas de 100 e o lote do RBAC (#396) tem 195. O script lia a primeira e
//    desistia. Afirmar que não há migration no que não se leu seria chutar, e
//    um card iria para Produção com migration não aplicada. Mas bastava pedir
//    a página seguinte. Os #385 e #395 ficaram presos com as 20 migrations já
//    registradas em produção.
//
// 2. "nenhum PR vinculado à issue" — o #357 nunca teve `Closes #357`
//    no corpo de PR nenhum nem o campo Development preenchido. O trabalho foi
//    feito no #391, cujo corpo fecha o #364. Citar a issue no título ou no
//    prefixo do commit (`fix(#357):`) é MENÇÃO, não ligação — nem o GitHub nem
//    o script tratam como vínculo, e é assim que tem que ser: mover por menção
//    faria um PR que só comenta a issue empurrar o card. Mas a mensagem não
//    dizia onde procurar.
//
// Esta régua guarda os dois lados de cada uma: que a recusa exista (sem ela o
// acidente que ela evita volta) E que ela aponte um caminho (sem isso o card
// fica preso e alguém move à mão, que foi o que aconteceu com #357/#385/#395).
// (fora de src/ porque o tsc do app não conhece bun:test)
import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import { motivoSemMerge } from "../../scripts/board-sync.mjs";
import path from "node:path";

const RAIZ = path.resolve(import.meta.dir, "../..");
const CAMINHO = "scripts/board-sync.mjs";
const fonte = fs.readFileSync(path.join(RAIZ, CAMINHO), "utf8");

describe("recusa 1 — a lista de arquivos do PR vem inteira", () => {
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
});

describe("recusa 2 — sem vínculo o card fica, mas a mensagem diz onde procurar", () => {
  test("quem só CITA a issue é guardado à parte, nunca somado aos ligados", () => {
    const fn = fonte.match(/async function prsLigadosAIssue\([\s\S]*?\n}/)?.[0] ?? "";
    expect(fn).toContain("apenasCitam");
    // a separação é o ponto: `porNumero` (vínculo) e `apenasCitam` (menção) são
    // preenchidos em ramos EXCLUSIVOS do mesmo if
    expect(fn).toMatch(/if \(issuesFechadasPeloCorpo\([\s\S]*?porNumero\.set/);
    expect(fn).toMatch(/else if \(pr\.merged\) apenasCitam\.set/);
    // e a menção não entra na lista que decide o card
    expect(fn).toMatch(/ligados: \[\.\.\.porNumero\.values\(\)\]/);
    expect(fn).not.toMatch(/porNumero\.set\(pr\.number, pr\);\s*\n\s*apenasCitam/);
  });

  test("só PR MERGEADO vira pista — um PR aberto que cita não acusa nada", () => {
    const fn = fonte.match(/async function prsLigadosAIssue\([\s\S]*?\n}/)?.[0] ?? "";
    expect(fn).toMatch(/else if \(pr\.merged\)/);
  });

  test("o motivo separa as três situações em vez de uma frase para todas", () => {
    // "nenhum PR mergeado vinculado à issue" era literalmente verdade quando
    // não havia vínculo, quando havia e estava aberto, e quando havia e foi
    // abandonado. Verdade em três casos diferentes e útil em nenhum.
    // Aqui a função de verdade é chamada — não uma leitura do texto dela.
    const pr = (n, state) => ({ number: n, state, merged: false });
    const cita = [{ number: 391 }, { number: 412 }];

    expect(motivoSemMerge("Issue", [pr(438, "OPEN")], [])).toBe("PR vinculado #438 ainda aberto");
    expect(motivoSemMerge("Issue", [pr(9, "CLOSED")], [])).toBe("PR vinculado #9 foi fechado sem merge");
    expect(motivoSemMerge("Issue", [], [])).toBe("nenhum PR vinculado à issue");
    expect(motivoSemMerge("PullRequest", [], [])).toBe("PR não mergeado");
    // a frase velha, que confundia os três, não volta em nenhum caso
    for (const m of [
      motivoSemMerge("Issue", [pr(438, "OPEN")], cita),
      motivoSemMerge("Issue", [pr(9, "CLOSED")], cita),
      motivoSemMerge("Issue", [], cita),
    ]) {
      expect(m).not.toContain("nenhum PR mergeado vinculado à issue");
    }
  });

  test("a pista acompanha SÓ o caso sem vínculo", () => {
    // Num card cujo PR está aberto, listar quem cita é ruído: o vínculo existe
    // e o trabalho é esperar o merge. A pista serve a quem não tem vínculo.
    const cita = [{ number: 391 }, { number: 412 }];
    expect(motivoSemMerge("Issue", [], cita))
      .toBe("nenhum PR vinculado à issue — #391, #412 citam a issue sem `Closes` no corpo");
    // singular, porque "cita/citam" errado é o tipo de detalhe que ninguém
    // conserta depois
    expect(motivoSemMerge("Issue", [], [{ number: 391 }]))
      .toBe("nenhum PR vinculado à issue — #391 cita a issue sem `Closes` no corpo");
    for (const comVinculo of [
      motivoSemMerge("Issue", [{ number: 438, state: "OPEN" }], cita),
      motivoSemMerge("Issue", [{ number: 9, state: "CLOSED" }], cita),
    ]) {
      expect(comVinculo, "a pista vazou para um card que já tem vínculo").not.toContain("#391");
    }
  });

  test("o release usa a função, em vez de remontar a frase no meio do laço", () => {
    // Se a redação voltar a morar dentro do release, a régua acima passa a
    // medir uma função que ninguém chama.
    expect(fonte).toMatch(/card\.motivos\.push\(motivoSemMerge\(card\.tipo, prs, apenasCitam\)\)/);
  });

  test("todo consumidor de prsLigadosAIssue usa a forma nova", () => {
    // O retorno virou objeto. Quem ainda tratar como lista quebra calado —
    // `[].filter` num objeto estoura, mas um `.length` viraria `undefined`.
    // Foi por pouco: `outrosPrsDaIssue` ficou para trás na primeira volta.
    const chamadas = [...fonte.matchAll(/^(?!async function).*prsLigadosAIssue\(/gm)].map((m) => m[0]);
    expect(chamadas.length, "nenhuma chamada encontrada — a régua está lendo errado")
      .toBeGreaterThan(0);
    for (const c of chamadas) {
      expect(c, `chamada sem desestruturar o retorno: ${c.trim()}`).toMatch(/\{\s*ligados/);
    }
  });
});

describe("o módulo é importável — é o que permite provar no caminho real", () => {
  test("importar não dispara o script", () => {
    // A prova ao vivo (prsDoCard contra o PR #396 e contra a issue #357) só é
    // possível importando o módulo. Se o main() rodasse no import, importar
    // mexeria no board.
    expect(fonte).toMatch(/if \(chamadoDireto\)/);
    expect(fonte).toMatch(/import\.meta\.url === pathToFileURL\(process\.argv\[1\]\)\.href/);
    expect(fonte).toMatch(/export {[^}]*prsDoCard[^}]*}/);
  });
});

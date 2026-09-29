// Guarda: a regravação de coluna não arrasta um PR que foi mergeado no meio.
// Rodar: bun test e2e/unit/board-nao-regrava-pr-mergeado.test.ts
//
// O `gravarNasColunas` escreve a coluna, espera 20s e, se alguém mudou,
// REGRAVA. Isso existe para vencer o Auto-add nativo, que às vezes puxa o card
// depois do job. Mas nem toda mudança nesses 20 segundos é atropelo.
//
// O #420 provou: aberto 15:25:05, mergeado 15:25:20, regravado 15:25:29. O
// workflow nativo tinha movido para "Validar no staging" com razão — o PR
// estava mergeado — e a regravação puxou de volta para "Em revisão". O card
// ficou fora do release por 24 horas com o trabalho já na `main`, e o board
// do release nem olha "Em revisão": ele varre "Validar no staging".
//
// Por isso o alvo carrega `aindaVale`, e "Em revisão" só insiste enquanto o PR
// segue aberto. Esta régua guarda as duas metades: que a pergunta exista, e que
// a regravação continue existindo — sem ela volta o atropelo do Auto-add.
// (fora de src/ porque o tsc do app não conhece bun:test)
import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";

const RAIZ = path.resolve(import.meta.dir, "../..");
const fonte = fs.readFileSync(path.join(RAIZ, "scripts/board-sync.mjs"), "utf8");

/** O corpo do laço que regrava, depois da espera. */
const laco = fonte.match(/await dormir\(20_000\);\s*for \(const it of itens\) \{([\s\S]*?)\n  \}/)?.[1] ?? "";

describe("board-sync: a regravação respeita quem mudou com razão", () => {
  test("a regravação continua existindo — é ela que vence o Auto-add", () => {
    expect(laco, "laço de regravação não encontrado").toBeTruthy();
    expect(laco).toContain("gravarStatus(board, it.itemId, it.coluna)");
  });

  test("antes de regravar, pergunta se a razão da coluna ainda vale", () => {
    expect(laco).toMatch(/it\.aindaVale/);
    // a pergunta tem que vir ANTES da escrita, senão não serve de nada
    const pergunta = laco.indexOf("aindaVale");
    const escrita = laco.indexOf("gravarStatus(board, it.itemId, it.coluna)");
    expect(pergunta, "a pergunta precisa vir antes da regravação").toBeLessThan(escrita);
  });

  test('"Em revisão" só vale enquanto o PR está aberto', () => {
    const fn = fonte.match(/async function emRevisao\([\s\S]*?\n\}/)?.[0] ?? "";
    expect(fn, "emRevisao não encontrada").toBeTruthy();
    expect(fn).toMatch(/aindaVale\s*=\s*async \(\) =>/);
    expect(fn).toMatch(/estadoDoPr\(numero\)\)\s*===\s*"OPEN"/);
    // os DOIS alvos levam a pergunta: a issue ligada e o card do PR sem issue
    const comAlvo = fn.match(/const alvos = [\s\S]*?\];/)?.[0] ?? "";
    expect((comAlvo.match(/aindaVale/g) ?? []).length, "issue e PR precisam carregar a pergunta")
      .toBeGreaterThanOrEqual(2);
  });

  test("o estado do PR é relido na hora, não reaproveitado do início do job", () => {
    // Reaproveitar o `pr` lido no começo devolveria "OPEN" para sempre e a
    // guarda nunca dispararia — é a forma silenciosa de quebrá-la.
    const fn = fonte.match(/async function estadoDoPr\([\s\S]*?\n\}/)?.[0] ?? "";
    expect(fn, "estadoDoPr não encontrada").toBeTruthy();
    expect(fn).toContain("pullRequest(number: $n) { state }");
    // e o retorno tem que SER o da consulta. Devolver "OPEN" fixo deixaria a
    // consulta no lugar, a régua verde e o guarda mudo — a sabotagem que
    // passou na primeira volta desta régua.
    expect(fn, "o retorno precisa vir da consulta, não de um literal")
      .toMatch(/return d\.repository\.pullRequest\.state;/);
    expect(fn, "estado fixo no retorno").not.toMatch(/return\s*"(OPEN|MERGED|CLOSED)"/);
  });
});

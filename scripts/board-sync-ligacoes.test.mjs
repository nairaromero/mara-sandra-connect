// Testes da leitura do "Closes #N" do corpo do PR. Rodar manualmente:
//   bun test scripts/board-sync-ligacoes.test.mjs
import { describe, expect, test } from "bun:test";
import { issuesFechadasPeloCorpo } from "./board-sync-ligacoes.mjs";

const REPO = "nairaromero/mara-sandra-connect";
const fecha = (corpo) => issuesFechadasPeloCorpo(corpo, REPO);

describe("issuesFechadasPeloCorpo", () => {
  test("o formato dos PRs daqui: Closes #N na primeira linha", () => {
    expect(fecha("Closes #330\n\n## Por quê\nA sugestão vinha longa.")).toEqual([330]);
  });

  test("todas as palavras do GitHub, maiúscula ou minúscula, com dois-pontos", () => {
    for (const palavra of ["close", "closes", "closed", "fix", "fixes", "fixed", "resolve", "resolves", "resolved"]) {
      expect(fecha(`${palavra} #7`)).toEqual([7]);
      expect(fecha(`${palavra.toUpperCase()}: #7`)).toEqual([7]);
    }
  });

  test("menção sem palavra de fechamento não liga (o #341 cita o #330)", () => {
    expect(fecha("Closes #332\n\nTraz o mesmo commit de testes do #330.")).toEqual([332]);
  });

  test("palavra em português não liga", () => {
    expect(fecha("Fecha #330")).toEqual([]);
    expect(fecha("Resolve a #330")).toEqual([]);
  });

  test("uma palavra por referência, como no GitHub", () => {
    expect(fecha("Closes #1, closes #2")).toEqual([1, 2]);
    expect(fecha("Closes #1, #2")).toEqual([1]);
  });

  test("dono/repo#N e URL: só deste repositório", () => {
    expect(fecha("Fixes nairaromero/mara-sandra-connect#12")).toEqual([12]);
    expect(fecha("Fixes NairaRomero/Mara-Sandra-Connect#12")).toEqual([12]);
    expect(fecha("Fixes outra/coisa#12")).toEqual([]);
    expect(fecha("Resolves https://github.com/nairaromero/mara-sandra-connect/issues/13")).toEqual([13]);
    expect(fecha("Resolves https://github.com/outra/coisa/issues/13")).toEqual([]);
  });

  test("palavra dentro de outra não conta", () => {
    expect(fecha("disclosed #5 e prefixes #6")).toEqual([]);
  });

  test("código e comentário HTML ficam de fora", () => {
    expect(fecha("```\nCloses #8\n```\nTexto `closes #9` <!-- fixes #10 -->")).toEqual([]);
  });

  test("corpo vazio ou nulo", () => {
    expect(fecha("")).toEqual([]);
    expect(fecha(null)).toEqual([]);
  });

  test("repetida conta uma vez", () => {
    expect(fecha("Closes #4\n\nCloses #4")).toEqual([4]);
  });
});

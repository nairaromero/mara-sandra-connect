// Achar o modelo de contrato do ZapSign sem procurar (#522): a busca, a
// sugestão pelo tipo de benefício do caso e o agrupamento por pasta. São as
// funções que decidem o que aparece primeiro no diálogo "Gerar contrato".
import { describe, expect, test } from "bun:test";
import { filtrarModelos, modelosSugeridos, porPasta } from "../../src/lib/assinaturas-modelos";

const m = (nome: string, pasta = "/") => ({ token: nome, nome, pasta });
const MODELOS = [
  m("Procuração ad judicia"),
  m("Contrato de honorários - Aposentadoria por idade", "/Previdenciário/"),
  m("Contrato de honorários - Aposentadoria por tempo de contribuição", "/Previdenciário/"),
  m("Contrato de honorários - Pensão por morte", "/Previdenciário/"),
  m("Contrato de honorários - Auxílio-acidente", "/Previdenciário/"),
  m("Contrato cível 01", "/Cível/"),
];
const nomes = (l: Array<{ nome: string }>) => l.map((x) => x.nome);

describe("modelos do ZapSign: achar rápido", () => {
  test("a busca ignora acento e maiúscula, aceita palavras em qualquer ordem e olha a pasta", () => {
    expect(nomes(filtrarModelos(MODELOS, "pensao"))).toEqual(["Contrato de honorários - Pensão por morte"]);
    expect(nomes(filtrarModelos(MODELOS, "IDADE aposentadoria"))).toEqual(["Contrato de honorários - Aposentadoria por idade"]);
    expect(nomes(filtrarModelos(MODELOS, "civel"))).toEqual(["Contrato cível 01"]);
    expect(filtrarModelos(MODELOS, "previdenciario")).toHaveLength(4);
    expect(filtrarModelos(MODELOS, "   ")).toHaveLength(MODELOS.length);
    expect(filtrarModelos(MODELOS, "inexistente")).toEqual([]);
  });

  test("os sugeridos são os que falam do tipo de benefício do caso, o mais parecido primeiro", () => {
    expect(nomes(modelosSugeridos(MODELOS, "Aposentadoria por idade"))).toEqual([
      "Contrato de honorários - Aposentadoria por idade",
      "Contrato de honorários - Aposentadoria por tempo de contribuição",
    ]);
    expect(nomes(modelosSugeridos(MODELOS, "Auxílio-acidente"))).toEqual(["Contrato de honorários - Auxílio-acidente"]);
  });

  test("palavra genérica não vira sugestão: 'contrato', 'por', caso sem tipo definido", () => {
    expect(modelosSugeridos(MODELOS, "a_definir")).toEqual([]);
    expect(modelosSugeridos(MODELOS, null)).toEqual([]);
    expect(modelosSugeridos(MODELOS, "Outro")).toEqual([]);
    // "por" está em quase todo nome e não pode puxar a lista inteira
    expect(modelosSugeridos(MODELOS, "Benefício por incapacidade")).toEqual([]);
  });

  test("agrupa pela pasta do ZapSign, raiz primeiro, em ordem alfabética dentro de cada uma", () => {
    const grupos = porPasta(MODELOS);
    expect(grupos.map((g) => [g.rotulo, g.modelos.length])).toEqual([["Sem pasta", 1], ["Cível", 1], ["Previdenciário", 4]]);
    expect(nomes(grupos[2].modelos)[0]).toBe("Contrato de honorários - Aposentadoria por idade");
    expect(porPasta([m("x", "/A/B/")])[0].rotulo).toBe("A › B");
  });
});

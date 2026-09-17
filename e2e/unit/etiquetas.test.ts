// Ordem das etiquetas (Naira, 2026-09-17: alfabética pura). Rodar:
//   bun test e2e/unit/etiquetas.test.ts
// (fora de src/ porque o tsc do app não conhece bun:test; a Playwright só lê e2e/tests)
import { describe, expect, test } from "bun:test";
import { ordenarEtiquetas } from "../../src/lib/etiquetas";

const nomes = (lista: string[]) => ordenarEtiquetas(lista.map((nome) => ({ nome }))).map((e) => e.nome);

describe("ordenarEtiquetas", () => {
  test("alfabética pura: sem agrupar Status/Parceria/Benefício na frente", () => {
    expect(nomes(["STATUS:ATIVO", "PARCERIA_ANA/SP", "AUXILIO_DOENCA", "CONCEDIDO", "ANALISE_CIVEL"])).toEqual([
      "ANALISE_CIVEL",
      "AUXILIO_DOENCA",
      "CONCEDIDO",
      "PARCERIA_ANA/SP",
      "STATUS:ATIVO",
    ]);
  });

  test("espaço e símbolo não mudam a posição", () => {
    expect(nomes(["AVERBACAO_TEMPO_ESPECIAL", "AVERBACAO/CTC/INSS"])).toEqual([
      "AVERBACAO/CTC/INSS",
      "AVERBACAO_TEMPO_ESPECIAL",
    ]);
    expect(nomes(["PARCERIA_RITA_NAIRA/MT", "PARCERIA _RITA/BEATRIZ", "PARCERIA_RENATA/MT", "PARCERIA_ANA/SP"])).toEqual([
      "PARCERIA_ANA/SP",
      "PARCERIA_RENATA/MT",
      "PARCERIA _RITA/BEATRIZ",
      "PARCERIA_RITA_NAIRA/MT",
    ]);
  });

  test("maiúscula e acento não separam", () => {
    expect(nomes(["ANALISE_CIVEL", "Analisando_POS_Indeferimento", "ANALISADO_SEM_DIREITO"])).toEqual([
      "ANALISADO_SEM_DIREITO",
      "Analisando_POS_Indeferimento",
      "ANALISE_CIVEL",
    ]);
    expect(nomes(["PERICIA_SOCIAL", "PERÍCIA_MEDICA", "PERICIA_AGENDADA"])).toEqual([
      "PERICIA_AGENDADA",
      "PERÍCIA_MEDICA",
      "PERICIA_SOCIAL",
    ]);
  });

  test("não muta a lista original", () => {
    const original = [{ nome: "B" }, { nome: "A" }];
    ordenarEtiquetas(original);
    expect(original.map((e) => e.nome)).toEqual(["B", "A"]);
  });
});

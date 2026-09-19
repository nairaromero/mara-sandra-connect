// Ordem das etiquetas (Naira, 2026-09-17): alfabética nas listas do escritório;
// por grupo nas etiquetas de um cliente. Rodar:
//   bun test e2e/unit/etiquetas.test.ts
// (fora de src/ porque o tsc do app não conhece bun:test; a Playwright só lê e2e/tests)
import { describe, expect, test } from "bun:test";
import { grupoEtiqueta, ordenarEtiquetas, ordenarEtiquetasDoCliente } from "../../src/lib/etiquetas";

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

const doCliente = (lista: string[]) =>
  ordenarEtiquetasDoCliente(lista.map((nome) => ({ nome }))).map((e) => e.nome);

describe("ordenarEtiquetasDoCliente", () => {
  test("Status, Parceiro, Andamento processual e o resto", () => {
    expect(doCliente(["AUXILIO_ACIDENTE", "INDEFERIDO_ADMINISTRATIVO_INSS", "PARCERIA_ANA/SP", "STATUS:ATIVO"])).toEqual([
      "STATUS:ATIVO",
      "PARCERIA_ANA/SP",
      "INDEFERIDO_ADMINISTRATIVO_INSS",
      "AUXILIO_ACIDENTE",
    ]);
  });

  test("situação e resultado juntos no andamento, alfabéticos entre si", () => {
    expect(doCliente(["MENSAL_PAGANDO", "CONCEDIDO_ADM_INSS", "AGUARDANDO_PGTO_RPV", "FINANCEIRO"])).toEqual([
      "AGUARDANDO_PGTO_RPV",
      "CONCEDIDO_ADM_INSS",
      "MENSAL_PAGANDO",
      "FINANCEIRO",
    ]);
  });

  test("grupos de nomes que costumam confundir", () => {
    expect(grupoEtiqueta("PARCERIA _RITA/BEATRIZ")).toBe(2); // espaço sobrando
    expect(grupoEtiqueta("ANA_CLARA/MT")).toBe(2); // NOME/UF
    expect(grupoEtiqueta("ANALISADO_SEM_DIREITO")).toBe(3);
    expect(grupoEtiqueta("REVISAO_APOSENTADORIA")).toBe(4); // benefício, não andamento
    expect(grupoEtiqueta("PEDIDO_DE_PRORROGACAO_DE_BENEFICIO_POR_INCAPACIDADE")).toBe(4);
    expect(grupoEtiqueta("PERÍCIA_MEDICA_JUDICIAL_BOM")).toBe(3);
  });
});

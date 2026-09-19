// Testes da inferência de tipo pelo nome do arquivo. Rodar manualmente:
//   bun test e2e/unit/doc-type-inference.test.ts
//
// A inferência pré-preenche o tipo quando a equipe importa arquivos do Google
// Drive (drive-picker-dialog). Errar aqui não perde documento, mas joga o
// arquivo em "Outro" — que é onde estão 4.411 dos 7.025 documentos da
// produção hoje.
//
// Os nomes abaixo seguem o padrão dos arquivos reais (sem nome de cliente).
import { describe, expect, test } from "bun:test";
import { inferirTipoPorNome } from "../../src/lib/doc-type-inference";

describe("tipos que vieram junto do intake do Trello e voltaram sozinhos", () => {
  test.each([
    ["PGR empresa.pdf", "pgr_ppra"],
    ["PPRA 2019.pdf", "pgr_ppra"],
    ["CNIS resumido.pdf", "cnis_resumido"],
    ["cnis-resumido-2024.pdf", "cnis_resumido"],
    ["SABI laudo.pdf", "laudo_inss"],
    ["PMF.pdf", "laudo_inss"],
    ["Laudo INSS.pdf", "laudo_inss"],
    ["pericia federal.pdf", "laudo_inss"],
    ["Cartão CNPJ.pdf", "cnpj_empregadora"],
    ["Termo de representação e autorização.pdf", "termo_representacao"],
    ["representacao e autorizacao INSS.pdf", "termo_representacao"],
    ["Autodeclaração.pdf", "autodeclaracao_veracidade"],
    ["declaracao de autenticidade e veracidade.pdf", "autodeclaracao_veracidade"],
    ["Termo de renúncia ao teto dos JEF.pdf", "termo_renuncia_teto"],
    ["renuncia teto.pdf", "termo_renuncia_teto"],
    ["Termo de responsabilidade.pdf", "termo_responsabilidade"],
  ])("%s → %s", (arquivo, esperado) => {
    expect(inferirTipoPorNome(arquivo)).toBe(esperado);
  });
});

describe("a ordem das regras: o específico vence o genérico", () => {
  test("CNIS resumido não cai no CNIS comum", () => {
    expect(inferirTipoPorNome("CNIS resumido.pdf")).toBe("cnis_resumido");
    expect(inferirTipoPorNome("CNIS.pdf")).toBe("cnis");
  });

  test("laudo do INSS não cai no laudo médico", () => {
    expect(inferirTipoPorNome("Laudo INSS.pdf")).toBe("laudo_inss");
    expect(inferirTipoPorNome("Laudo médico dr fulano.pdf")).toBe("laudo_medico");
  });
});

describe("o que já funcionava continua funcionando", () => {
  test.each([
    ["CNIS_2024.pdf", "cnis"],
    ["RG-frente.jpg", "rg_cpf"],
    ["01 - PPP empresa X.pdf", "ppp"],
    ["LTCAT.pdf", "ltcat"],
    ["HISCRE.pdf", "hiscre"],
    ["Procuração.pdf", "procuracao"],
    ["Substabelecimento.pdf", "substabelecimento"],
    ["Contrato de honorários.pdf", "contrato_honorarios"],
    ["Declaração de hipossuficiência.pdf", "declaracao_hipossuficiencia"],
    ["CTPS digital.pdf", "ctps"],
    ["arquivo qualquer.pdf", "outro"],
  ])("%s → %s", (arquivo, esperado) => {
    expect(inferirTipoPorNome(arquivo)).toBe(esperado);
  });
});

describe("todo tipo inferido tem rótulo na tela", async () => {
  const { TIPOS_DOCUMENTO_LABEL } = await import("../../src/lib/documentos/tipos");
  test.each([
    "pgr_ppra",
    "cnis_resumido",
    "laudo_inss",
    "cnpj_empregadora",
    "termo_representacao",
    "autodeclaracao_veracidade",
    "termo_renuncia_teto",
    "termo_responsabilidade",
  ])("%s aparece em TIPOS_DOCUMENTO_LABEL", (tipo) => {
    expect(TIPOS_DOCUMENTO_LABEL[tipo]).toBeTruthy();
  });
});

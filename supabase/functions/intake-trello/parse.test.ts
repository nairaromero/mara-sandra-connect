// Testes do parsing de card do Trello. Rodar manualmente:
//   bun test supabase/functions/intake-trello/parse.test.ts
// Os cenários vêm de cards reais do board (2026-08), anonimizados.
import { describe, expect, test } from "bun:test";
import {
  extrairCelular,
  extrairCidadeEstado,
  extrairCpf,
  extrairDriveFolderId,
  extrairNome,
  extrairSenha,
  parsearCard,
  removerLinhaSenha,
} from "./parse";

const MODELO_PREENCHIDO = `Dia da captação: 10/08/2026
Cidade/Estado: Sorocaba / SP
Qualificação Civil: casado
CPF: 369.743.665-15
Senha [GOV.BR](http://GOV.BR): Abc@1234
Zap: 11 99276-8674 (Regina)
Indicação: Maria Raimunda (esposa)
Obs.:

Relato: sofreu acidente em 2023.`;

const MODELO_VAZIO = `Dia da captação:
Cidade/Estado:
Qualificação Civil:
CPF:
Senha [GOV.BR](http://GOV.BR):
Zap:
Indicação:
Obs.:

Relato:`;

const TEXTO_LIVRE = `TEM PROCESSO EM ANDAMENTO.

---

**TikTok**

Santo André/SP

---

_**CPF:**_ **13163788882**
_**Senha INSS: SenhaForte#9**_
_**Whatsapp: 11 93224-1851**_

---

**Quem é o segurado?** empregado;`;

describe("extrairNome", () => {
  test("remove parênteses do título", () => {
    expect(extrairNome("ERIC SUENSON (OKADO)")).toBe("ERIC SUENSON");
    expect(extrairNome("Cleodemir Dias (OKADO) (Piauí)(30SET26)")).toBe("Cleodemir Dias");
    expect(extrairNome("  Maria da Silva  ")).toBe("Maria da Silva");
  });
});

describe("extrairCpf", () => {
  test("modelo com máscara", () => {
    expect(extrairCpf(MODELO_PREENCHIDO)).toBe("36974366515");
  });
  test("texto livre com markdown", () => {
    expect(extrairCpf(TEXTO_LIVRE)).toBe("13163788882");
  });
  test("modelo vazio -> null", () => {
    expect(extrairCpf(MODELO_VAZIO)).toBeNull();
  });
  test("número incompleto -> null", () => {
    expect(extrairCpf("CPF: 12345")).toBeNull();
  });
});

describe("extrairCidadeEstado", () => {
  test("modelo Cidade/Estado", () => {
    expect(extrairCidadeEstado(MODELO_PREENCHIDO)).toEqual({ cidade: "Sorocaba", estado: "SP" });
  });
  test("linha isolada Cidade/UF (card TikTok)", () => {
    expect(extrairCidadeEstado(TEXTO_LIVRE)).toEqual({ cidade: "Santo André", estado: "SP" });
  });
  test("texto corrido 'residente em'", () => {
    expect(extrairCidadeEstado("segurado residente em Itu/SP, casado")).toEqual({
      cidade: "Itu",
      estado: "SP",
    });
  });
  test("vazio -> nulls", () => {
    expect(extrairCidadeEstado(MODELO_VAZIO)).toEqual({ cidade: null, estado: null });
  });
  test("editor do Trello comeu a barra do valor", () => {
    expect(extrairCidadeEstado("Cidade/Estado: Sorocaba  SP\nCPF: x")).toEqual({
      cidade: "Sorocaba",
      estado: "SP",
    });
  });
});

describe("extrairCelular", () => {
  test("Zap com anotação", () => {
    expect(extrairCelular(MODELO_PREENCHIDO)).toBe("11992768674");
  });
  test("Whatsapp em negrito markdown", () => {
    expect(extrairCelular(TEXTO_LIVRE)).toBe("11932241851");
  });
  test("com 55 na frente fica com os 11 finais", () => {
    expect(extrairCelular("Cel: +55 (11) 99276-8674")).toBe("11992768674");
  });
  test("vazio -> null", () => {
    expect(extrairCelular(MODELO_VAZIO)).toBeNull();
  });
});

describe("extrairSenha", () => {
  test("modelo com link markdown no rótulo", () => {
    expect(extrairSenha(MODELO_PREENCHIDO)).toBe("Abc@1234");
  });
  test("texto livre com negrito", () => {
    expect(extrairSenha(TEXTO_LIVRE)).toBe("SenhaForte#9");
  });
  test("linha em branco -> null", () => {
    expect(extrairSenha(MODELO_VAZIO)).toBeNull();
  });
});

describe("removerLinhaSenha", () => {
  test("relato não carrega a senha", () => {
    const relato = removerLinhaSenha(MODELO_PREENCHIDO);
    expect(relato).not.toContain("Abc@1234");
    expect(relato).toContain("Relato: sofreu acidente em 2023.");
  });
});

describe("extrairDriveFolderId", () => {
  test("formato open?id=", () => {
    expect(extrairDriveFolderId(["https://drive.google.com/open?id=1rT90oNDER_abc-123"])).toBe(
      "1rT90oNDER_abc-123",
    );
  });
  test("formato folders/", () => {
    expect(
      extrairDriveFolderId(["https://drive.google.com/drive/folders/1KeW-PMUJw?usp=sharing"]),
    ).toBe("1KeW-PMUJw");
  });
  test("anexo que não é Drive é ignorado", () => {
    expect(extrairDriveFolderId(["https://trello.com/1/cards/x/attachments/y/download/f.pdf"])).toBeNull();
  });
});

describe("parsearCard", () => {
  test("card completo", () => {
    const p = parsearCard("Jecivaldo Alcantara (OKADO)", MODELO_PREENCHIDO, [
      "https://drive.google.com/open?id=1rT90oNDER",
    ]);
    expect(p.nome).toBe("Jecivaldo Alcantara");
    expect(p.cpf).toBe("36974366515");
    expect(p.senhaMeuInss).toBe("Abc@1234");
    expect(p.driveFolderId).toBe("1rT90oNDER");
    expect(p.relato).not.toContain("Abc@1234");
  });
});

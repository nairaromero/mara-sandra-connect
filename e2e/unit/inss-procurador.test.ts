// Regra do procurador nos e-mails do INSS (#503).
//   bun test e2e/unit/inss-procurador.test.ts
//
// Até 28/10 a lista era fixa no código ("(procurador)", "mara sandra vian",
// "naira"), com nomes de um escritório só — e o "naira" solto casaria com
// qualquer cliente chamada Naira. Agora: o marcador, a equipe do escritório e
// os nomes que ele cadastrou, sempre com nome e sobrenome.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  ehProcurador,
  lerProcuradorEscolhido,
  lerProcuradoresCadastrados,
  nomeValeComoProcurador,
  nomesDeProcurador,
} from "../../supabase/functions/_shared/inss-procurador";

describe("procurador nos e-mails do INSS", () => {
  // O escolhido na equipe + os nomes como o INSS escreve (29/10: um só escolhido).
  const nomes = nomesDeProcurador("Ana Beatriz Lima", ["Mara Sandra Vian", "Carlos"]);

  test("o marcador do INSS sempre vale", () => {
    expect(ehProcurador("FULANO DE TAL (PROCURADOR)", [])).toBe(true);
  });

  test("o procurador escolhido e os nomes cadastrados valem, sem acento e sem caixa", () => {
    expect(ehProcurador("ANA BEATRIZ LIMA", nomes)).toBe(true);
    expect(ehProcurador("MARA SANDRA VIAN", nomes)).toBe(true);
    expect(ehProcurador("Mára  Sandra   Viãn", nomes)).toBe(true);
  });

  test("nome de uma palavra só não conta — casaria com cliente", () => {
    expect(nomes).not.toContain("carlos");
    expect(ehProcurador("CARLOS EDUARDO DOS SANTOS", nomes)).toBe(false);
    expect(nomeValeComoProcurador("Naira")).toBe(false);
    expect(nomeValeComoProcurador("Naira Romero")).toBe(true);
  });

  test("o resto da equipe não conta — só quem foi escolhido", () => {
    const soEscolhido = nomesDeProcurador("Ana Beatriz Lima", []);
    expect(ehProcurador("BRUNO COSTA ALVES", soEscolhido)).toBe(false);
    expect(nomesDeProcurador(null, [])).toEqual([]);
  });

  test("cliente comum não é procurador", () => {
    expect(ehProcurador("JOSE DA SILVA", nomes)).toBe(false);
    expect(ehProcurador("", nomes)).toBe(false);
  });

  test("a lista cadastrada é lida sem confiar no banco", () => {
    expect(lerProcuradoresCadastrados({ inss_procuradores: [" Mara Sandra Vian ", 3, "", null] })).toEqual(["Mara Sandra Vian"]);
    expect(lerProcuradoresCadastrados(null)).toEqual([]);
    expect(lerProcuradoresCadastrados({ inss_procuradores: "x" })).toEqual([]);
    expect(lerProcuradorEscolhido({ inss_procurador_id: "0b7c5f3e-1d2a-4c5b-9e8f-112233445566" })).toBe("0b7c5f3e-1d2a-4c5b-9e8f-112233445566");
    expect(lerProcuradorEscolhido({ inss_procurador_id: "drop table" })).toBeNull();
    expect(lerProcuradorEscolhido(null)).toBeNull();
  });

  test("a function não tem mais lista própria de nomes", () => {
    const t = readFileSync(join(import.meta.dir, "../../supabase/functions/inss-email-processor/index.ts"), "utf8");
    expect(t).not.toMatch(/DETECTORES_PROCURADOR/);
    expect(t).toMatch(/ehProcurador\(c\.nome_cliente, procuradores\)/);
  });
});

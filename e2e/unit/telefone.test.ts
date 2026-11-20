// Telefone: uma máscara de digitação para o sistema inteiro, e o campo com
// país (`<TelefoneComPais>`) que só produz o que o servidor aceita.
//
// De onde veio (20/11/2026): o WhatsApp do envio para assinatura era um campo
// livre onde a pessoa escrevia "+34 613761609" à mão; e havia quatro
// `maskTelefone` iguais, uma em cada tela.
import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { DDI_BRASIL, mascararTelefoneBR, mascararTelefoneDoPais, PAISES_TELEFONE, telefoneParaEnvio } from "../../src/lib/telefone";
import { telefoneDe } from "../../supabase/functions/_shared/telefone";

const RAIZ = join(import.meta.dir, "../..");

describe("telefone", () => {
  test("a máscara do Brasil acompanha a digitação: DDD, fixo e celular", () => {
    const passos = ["1", "17", "179", "17999", "179999", "1799999", "1799990000", "17999990000"].map(mascararTelefoneBR);
    expect(passos).toEqual(["1", "17", "(17) 9", "(17) 999", "(17) 9999", "(17) 9999-9", "(17) 9999-0000", "(17) 99999-0000"]);
    expect(mascararTelefoneBR("(17) 99999-0000")).toBe("(17) 99999-0000");
    expect(mascararTelefoneBR("17 99999 0000 123"), "o que passa de 11 dígitos é descartado").toBe("(17) 99999-0000");
    expect(mascararTelefoneBR("abc")).toBe("");
  });

  test("fora do Brasil o campo guarda só os dígitos; trocar de país refaz a máscara", () => {
    expect(mascararTelefoneDoPais("34", "613 761-609")).toBe("613761609");
    expect(mascararTelefoneDoPais(DDI_BRASIL, "613761609")).toBe("(61) 3761-609");
    expect(mascararTelefoneDoPais("34", "(17) 99999-0000")).toBe("17999990000");
  });

  test("o que o campo manda é o que o servidor entende — em TODOS os países do seletor", () => {
    expect(telefoneParaEnvio(DDI_BRASIL, "(17) 99999-0000")).toBe("(17) 99999-0000");
    expect(telefoneDe(telefoneParaEnvio(DDI_BRASIL, "(17) 99999-0000"))).toEqual({ ddi: "55", numero: "17999990000" });
    expect(telefoneParaEnvio("34", "613761609")).toBe("+34 613761609");
    for (const pais of PAISES_TELEFONE.filter((p) => p.ddi !== DDI_BRASIL)) {
      expect(telefoneDe(telefoneParaEnvio(pais.ddi, "613761609")), pais.nome).toEqual({ ddi: pais.ddi, numero: "613761609" });
    }
    // só o país escolhido, sem número, não é um telefone
    expect(telefoneParaEnvio("34", "")).toBe("");
    expect(telefoneParaEnvio(DDI_BRASIL, "   ")).toBe("");
  });

  test("a lista de países: Brasil primeiro, o resto em ordem alfabética, sem código repetido", () => {
    expect(PAISES_TELEFONE[0].ddi).toBe(DDI_BRASIL);
    const resto = PAISES_TELEFONE.slice(1).map((p) => p.nome);
    expect(resto).toEqual([...resto].sort((a, b) => a.localeCompare(b, "pt-BR")));
    expect(new Set(PAISES_TELEFONE.map((p) => p.ddi)).size).toBe(PAISES_TELEFONE.length);
    expect(PAISES_TELEFONE.every((p) => /^\d{1,3}$/.test(p.ddi))).toBe(true);
  });

  test("ninguém escreve a própria máscara de telefone: é mascararTelefoneBR, de src/lib/telefone.ts", () => {
    const copias = readdirSync(join(RAIZ, "src"), { recursive: true, withFileTypes: true })
      .filter((d) => d.isFile() && /\.tsx?$/.test(d.name))
      .map((d) => join(d.parentPath, d.name))
      .filter((p) => !p.endsWith("src/lib/telefone.ts"))
      .filter((p) => {
        const texto = readFileSync(p, "utf8");
        // a função com o nome antigo, ou a troca "(DD) resto" escrita à mão
        return /function\s+maskTelefone\b/.test(texto) || /["'`]\(\$1\) \$2["'`]/.test(texto);
      })
      .map((p) => p.slice(RAIZ.length + 1));
    expect(copias, "importe mascararTelefoneBR de @/lib/telefone").toEqual([]);
  });
});

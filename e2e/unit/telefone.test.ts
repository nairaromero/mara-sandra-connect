// Telefone: uma máscara de digitação para o sistema inteiro, e o campo com
// país (`<TelefoneComPais>`) que só produz o que o servidor aceita.
//
// De onde veio (20/11/2026): o WhatsApp do envio para assinatura era um campo
// livre onde a pessoa escrevia "+34 613761609" à mão; e havia quatro
// `maskTelefone` iguais, uma em cada tela.
import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  DDI_BRASIL, digitosInternacionais, formatarTelefone, mascararTelefoneBR, mascararTelefoneDoPais, PAISES_TELEFONE, separarTelefone, telefoneCompleto, telefoneParaEnvio,
} from "../../src/lib/telefone";
import { lerTelefone, telefoneDe, telefoneGuardado } from "../../supabase/functions/_shared/telefone";

const RAIZ = join(import.meta.dir, "../..");

describe("telefone", () => {
  test("a máscara do Brasil acompanha a digitação: DDD, fixo e celular", () => {
    const passos = ["1", "17", "179", "17999", "179999", "1799999", "1799990000", "17999990000"].map(mascararTelefoneBR);
    expect(passos).toEqual(["1", "17", "(17) 9", "(17) 999", "(17) 9999", "(17) 9999-9", "(17) 9999-0000", "(17) 99999-0000"]);
    expect(mascararTelefoneBR("(17) 99999-0000")).toBe("(17) 99999-0000");
    expect(mascararTelefoneBR("17 99999 0000 123"), "o que passa de 11 dígitos é descartado").toBe("(17) 99999-0000");
    expect(mascararTelefoneBR("abc")).toBe("");
  });

  test("exibição: máscara do Brasil só para número do Brasil; número de fora aparece com o código do país", () => {
    expect(["17999990000", "(17) 99999-0000", "5517999990000", "+55 17 99999-0000", "1733334444"].map(formatarTelefone))
      .toEqual(["(17) 99999-0000", "(17) 99999-0000", "(17) 99999-0000", "(17) 99999-0000", "(17) 3333-4444"]);
    // o caso que abriu a correção: cliente dos Estados Unidos aparecia "(14) 07684-4713"
    expect(formatarTelefone("+1 4076844713")).toBe("+1 (407) 684-4713");
    expect(formatarTelefone("+14076844713")).toBe("+1 (407) 684-4713");
    expect(formatarTelefone("+34 613761609")).toBe("+34 613761609");
    expect(formatarTelefone("351912345678"), "sem o +, mas longo demais para o Brasil").toBe("+351 912345678");
    for (const pais of PAISES_TELEFONE.filter((p) => p.ddi !== DDI_BRASIL)) {
      const visto = formatarTelefone(telefoneParaEnvio(pais.ddi, "4076844713"));
      expect(visto.startsWith(`+${pais.ddi} `), `${pais.nome}: ${visto}`).toBe(true);
      expect(digitosInternacionais(visto), `${pais.nome}: o que se vê é o número guardado`).toBe(`${pais.ddi}4076844713`);
    }
    // sem leitura ou incompleto: aparece como está guardado
    expect(["+999613761609", "(17) 9999", "ramal 204", "+34"].map(formatarTelefone)).toEqual(["+999613761609", "(17) 9999", "ramal 204", "+34"]);
    expect([null, undefined, ""].map(formatarTelefone)).toEqual(["", "", ""]);
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

  test("o valor guardado volta para o campo: país e número, de qualquer formato que já existe no banco", () => {
    expect(separarTelefone("17999990000")).toEqual({ ddi: "55", numero: "(17) 99999-0000" });
    expect(separarTelefone("(17) 99999-0000")).toEqual({ ddi: "55", numero: "(17) 99999-0000" });
    expect(separarTelefone("5517999990000"), "com o 55 na frente").toEqual({ ddi: "55", numero: "(17) 99999-0000" });
    expect(separarTelefone("+55 17 99999-0000")).toEqual({ ddi: "55", numero: "(17) 99999-0000" });
    expect(separarTelefone("+34 613761609")).toEqual({ ddi: "34", numero: "613761609" });
    expect(separarTelefone("+34"), "só o país escolhido").toEqual({ ddi: "34", numero: "" });
    expect(separarTelefone(null)).toEqual({ ddi: "55", numero: "" });
    // ida e volta: o que o campo emite é o que ele lê de volta
    for (const [ddi, numero] of [["55", "(17) 99999-0000"], ["34", "613761609"], ["351", "912345678"]]) {
      expect(separarTelefone(telefoneParaEnvio(ddi, numero))).toEqual({ ddi, numero });
    }
  });

  test("telefone completo: DDD + 8 ou 9 dígitos no Brasil; de 6 a 14 dígitos fora", () => {
    expect(["(17) 99999-0000", "(17) 3333-4444", "17999990000", "+34 613761609"].map(telefoneCompleto)).toEqual([true, true, true, true]);
    expect(["", "(17) 9999", "179999", "+34 613", "+34", null].map(telefoneCompleto)).toEqual([false, false, false, false, false, false]);
  });

  test("tela e servidor leem o telefone pela MESMA função: o que a tela diz completo é o que o ZapSign recebe", () => {
    // os formatos que existem no banco e os que as pessoas colam (revisão de 20/11/2026)
    const casos = [
      "(17) 99999-0000", "17999990000", "5517999990000", "+55 17 99999-0000", "+5517999990000", "+34 613761609",
      "+34613761609", "351912345678", "+999613761609", "613761609", "(55) 17999-9900", "", "+34", "17 9999",
    ];
    for (const c of casos) expect(telefoneCompleto(c), c).toBe(telefoneDe(c) !== null);
    // código de país colado ao número: se é de um país da lista, dá para ler
    expect(telefoneDe("+34613761609")).toEqual({ ddi: "34", numero: "613761609" });
    expect(separarTelefone("+34613761609")).toEqual({ ddi: "34", numero: "613761609" });
    // lead antigo do site, sem "+": longo demais para o Brasil e abre com um código da lista
    expect(separarTelefone("351912345678")).toEqual({ ddi: "351", numero: "912345678" });
    expect(digitosInternacionais("351912345678"), "não ganha 55 na frente").toBe("351912345678");
    // código desconhecido colado: não se adivinha onde termina
    expect(lerTelefone("+999613761609")).toBeNull();
    expect(telefoneCompleto("+999613761609")).toBe(false);
    // DDD 11 a 19 com um dígito a mais NÃO vira Estados Unidos (+1)
    expect(lerTelefone("119999900001")?.ddi).toBe("55");
    // o 55 nunca vira DDD: colar com o código do país dá o mesmo número
    expect(separarTelefone("+55 17 99999-0000")).toEqual(separarTelefone("(17) 99999-0000"));
    // DDD 55 (RS) de verdade continua sendo DDD
    expect(telefoneDe("55999990000")).toEqual({ ddi: "55", numero: "55999990000" });
  });

  test("o que o ZapSign devolve (país e número separados) volta para o formato que o sistema guarda e lê", () => {
    expect(telefoneGuardado("55", "17999990000")).toBe("17999990000");
    expect(telefoneGuardado("", "17999990000"), "sem país informado é Brasil").toBe("17999990000");
    expect(telefoneGuardado("34", "613761609")).toBe("+34 613761609");
    expect(telefoneGuardado("34", "")).toBe("");
    for (const pais of PAISES_TELEFONE) {
      const numero = pais.ddi === DDI_BRASIL ? "17999990000" : "613761609";
      expect(telefoneDe(telefoneGuardado(pais.ddi, numero)), pais.nome).toEqual({ ddi: pais.ddi, numero });
    }
  });

  test("a leitura de telefone e a lista de países existem num lugar só: _shared/telefone.ts", () => {
    const tela = readFileSync(join(RAIZ, "src/lib/telefone.ts"), "utf8");
    expect(tela, "a tela importa a leitura do módulo compartilhado").toMatch(/from "@shared\/telefone"/);
    expect(tela, "a lista de países não é repetida na tela").not.toMatch(/bandeira:\s*"/);
    // nas functions, ninguém monta "+código número" nem tira o 55 à mão fora do módulo
    const copias = readdirSync(join(RAIZ, "supabase/functions"), { recursive: true, withFileTypes: true })
      .filter((d) => d.isFile() && /\.ts$/.test(d.name))
      .map((d) => join(d.parentPath, d.name))
      .filter((p) => !p.endsWith("_shared/telefone.ts"))
      .filter((p) => /phone_country\s*\|\|\s*["']55["']|`\+\$\{[^}]*phone_country/.test(readFileSync(p, "utf8")))
      .map((p) => p.slice(RAIZ.length + 1));
    expect(copias, "use telefoneGuardado de _shared/telefone.ts").toEqual([]);
  });

  test("link do WhatsApp: os dígitos sempre com o código do país", () => {
    expect(digitosInternacionais("(17) 99999-0000")).toBe("5517999990000");
    expect(digitosInternacionais("17999990000")).toBe("5517999990000");
    expect(digitosInternacionais("5517999990000"), "não dobra o 55").toBe("5517999990000");
    expect(digitosInternacionais("+34 613761609"), "número de fora não ganha 55 na frente").toBe("34613761609");
    expect(digitosInternacionais("")).toBe("");
  });

  test("todo campo de telefone do sistema é o <TelefoneComPais>: ninguém monta o seu com <Input type/inputMode tel>", () => {
    const soltos = readdirSync(join(RAIZ, "src"), { recursive: true, withFileTypes: true })
      .filter((d) => d.isFile() && /\.tsx$/.test(d.name))
      .map((d) => join(d.parentPath, d.name))
      .filter((p) => !p.endsWith("src/components/telefone-com-pais.tsx"))
      .filter((p) => /(inputMode|type)=["']tel["']/.test(readFileSync(p, "utf8")))
      .map((p) => p.slice(RAIZ.length + 1));
    expect(soltos, "use <TelefoneComPais> de @/components/telefone-com-pais").toEqual([]);
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

// Guarda: escolher um valor de uma lista tem UM caminho. Rodar:
//   bun test e2e/unit/um-so-dropdown.test.ts
//
// Por que existe: até 28/09 havia quatro. `Select` do shadcn em 23 arquivos
// (sem busca), um combobox próprio em 6 (com), `<select>` nativo em 2 e
// `Command` cru em 3. O efeito estava na tela: no sheet de tarefa dava para
// buscar o cliente entre 466; na Agenda, a MESMA escolha era uma lista de 466
// para rolar. Ninguém decidiu isso — foi o que sobra quando a mesma decisão
// mora em quatro lugares.
//
// Agora mora em `src/components/ui/selecao.tsx`, e a busca liga sozinha a
// partir de LIMITE_BUSCA opções. Esta régua existe para o quinto caminho não
// nascer: sem ela, o próximo `Select` entra num PR qualquer e a divergência
// recomeça.
// (fora de src/ porque o tsc do app não conhece bun:test)
import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";

/**
 * `<select>` nativo que FICA, com o motivo. Não é dogma: em ambos o nativo é
 * melhor do que o componente, e trocar pioraria.
 */
const NATIVO_OK: Record<string, string> = {
  "src/components/comercial/lead-form.tsx":
    "site público: puxar Popover+cmdk para a página de captação engorda o bundle, e no celular o seletor nativo é melhor",
  "src/components/equipe/permissoes-sheet.tsx":
    "controle inline de 2 opções e 24px de altura na mesma linha da permissão; virar botão de largura total quebraria a linha",
};

function varrer(regex: RegExp): Array<{ arquivo: string; linha: number }> {
  const achados: Array<{ arquivo: string; linha: number }> = [];
  (function anda(dir: string) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) anda(p);
      else if (/\.tsx?$/.test(e.name)) {
        fs.readFileSync(p, "utf8").split("\n").forEach((l, i) => {
          if (/^\s*(\/\/|\*|\/\*)/.test(l)) return; // comentário não conta
          if (regex.test(l)) achados.push({ arquivo: p, linha: i + 1 });
        });
      }
    }
  })("src");
  return achados;
}

describe("um só caminho para escolher da lista", () => {
  test("o componente base existe e a busca liga sozinha", () => {
    const src = fs.readFileSync("src/components/ui/selecao.tsx", "utf8");
    expect(src).toContain("export const LIMITE_BUSCA");
    expect(src, "a busca decide pelo tamanho da lista, não por quem chamou").toContain(
      "busca ?? opcoes.length >= LIMITE_BUSCA",
    );
  });

  test("ninguém importa o Select do shadcn — ele não existe mais", () => {
    const usos = varrer(/from "@\/components\/ui\/select"/);
    expect(
      usos.length,
      usos.length === 0
        ? ""
        : `voltou o Select do shadcn:\n${usos.map((u) => `  ${u.arquivo}:${u.linha}`).join("\n")}\n\n` +
          "Use `<Selecao>` de @/components/ui/selecao.",
    ).toBe(0);
    expect(fs.existsSync("src/components/ui/select.tsx"), "o arquivo foi removido").toBe(false);
  });

  test("`<select>` nativo só onde está justificado", () => {
    const usos = varrer(/<select(\s|>|$)/);
    const fora = usos.filter((u) => !(u.arquivo in NATIVO_OK));
    expect(
      fora.length,
      fora.length === 0
        ? ""
        : `<select> nativo fora da lista:\n${fora.map((u) => `  ${u.arquivo}:${u.linha}`).join("\n")}\n\n` +
          "Use `<Selecao>` — ou acrescente o arquivo em NATIVO_OK com o motivo.",
    ).toBe(0);
  });

  test("o componente repassa o nome acessível", () => {
    // Regressão real: o codemod da migração de 28/09 largou 19 `aria-label`
    // pelo caminho. O `SelectTrigger` do Radix herdava o nome do `<Label>`;
    // um botão não herda. Sem isso, leitor de tela anuncia só o valor escolhido
    // e não diz de QUE campo ele é — e as specs que procuram o campo pelo nome
    // param de achar, que foi como o problema apareceu.
    const src = fs.readFileSync("src/components/ui/selecao.tsx", "utf8");
    expect(src, "a prop existe").toContain('"aria-label"?: string');
    expect(src, "e chega ao botão").toMatch(/aria-label=\{resto\["aria-label"\]\}/);
  });

  test("o componente repassa o que o formulário injeta", () => {
    // Segunda regressão da mesma migração: o `<FormControl>` do shadcn clona o
    // filho injetando `id` e os `aria-*` que ligam o campo ao `<FormLabel>`. O
    // codemod removeu o invólucro junto com o `SelectTrigger`, e o rótulo ficou
    // solto — clicar nele não focava o campo, e `getByLabel` parou de achar.
    const src = fs.readFileSync("src/components/ui/selecao.tsx", "utf8");
    for (const prop of ["id", "aria-labelledby", "aria-describedby", "aria-invalid"]) {
      expect(src, `${prop} precisa chegar ao botão`).toContain(prop);
    }
  });

  test("todo Selecao dentro de formulário está em FormControl", () => {
    const fora: Array<string> = [];
    for (const { arquivo } of varrer(/<Selecao/)) {
      const linhas = fs.readFileSync(arquivo, "utf8").split("\n");
      linhas.forEach((l, i) => {
        if (!l.includes("<Selecao")) return;
        // o campo de formulário vem logo depois de um <FormLabel>
        const antes = linhas.slice(Math.max(0, i - 3), i).join(" ");
        if (!antes.includes("<FormLabel>")) return;
        if (!antes.includes("<FormControl>")) fora.push(`${arquivo}:${i + 1}`);
      });
    }
    expect(
      fora.length,
      fora.length === 0 ? "" : `<Selecao> de formulário fora do <FormControl>:\n${fora.join("\n")}`,
    ).toBe(0);
  });

  test("a lista de exceções não tem entrada morta", () => {
    const comNativo = new Set(varrer(/<select(\s|>|$)/).map((u) => u.arquivo));
    const mortas = Object.keys(NATIVO_OK).filter((f) => !comNativo.has(f));
    expect(mortas.length, mortas.length === 0 ? "" : `tire de NATIVO_OK: ${mortas.join(", ")}`).toBe(0);
  });
});

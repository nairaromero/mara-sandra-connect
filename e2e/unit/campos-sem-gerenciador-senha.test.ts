// Régua: campo que não é login da pessoa não chama o gerenciador de senha.
//   bun test e2e/unit/campos-sem-gerenciador-senha.test.ts
//
// Em 27/10 o 1Password abria por cima do campo "Modelo" da integração de IA e
// oferecia salvar a chave de API como login: `autoComplete="off"` não basta, e
// cada gerenciador tem o próprio atributo. Agora há um lugar só — a prop
// `semGerenciadorDeSenha` do <Input> (src/components/ui/input.tsx) — e esta
// régua cobra que:
//   - todo campo de senha fora das telas de login da pessoa a use;
//   - toda <Input> das telas de integração (chaves, credenciais) a use;
//   - ninguém escreva os atributos dos gerenciadores à mão.
import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const RAIZ = join(import.meta.dir, "../..");
const SRC = join(RAIZ, "src");

// Telas em que a pessoa entra com a PRÓPRIA senha: aqui o gerenciador ajuda.
const LOGIN_DA_PESSOA = ["src/routes/login.tsx", "src/routes/definir-senha.tsx", "src/routes/redefinir-senha.tsx"];
// Telas de integração: tudo nelas é configuração ou segredo do escritório.
const INTEGRACOES = [
  "src/components/ia/integracao-ia-card.tsx",
  "src/components/ia/conexao-claude-card.tsx",
  "src/components/integracoes/integracao-whatsapp-card.tsx",
  "src/components/integracoes/integracao-credencial-card.tsx",
];

function arquivos(dir: string): string[] {
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((d) => d.isFile() && /\.tsx?$/.test(d.name))
    .map((d) => join(d.parentPath, d.name));
}
const rel = (p: string) => p.replace(RAIZ + "/", "");
/** Cada `<Input …>` do arquivo, com a linha. */
function inputs(texto: string): { linha: number; tag: string }[] {
  return [...texto.matchAll(/<Input\b[\s\S]*?\/>/g)].map((m) => ({
    linha: texto.slice(0, m.index).split("\n").length,
    tag: m[0],
  }));
}

describe("campos sem gerenciador de senha", () => {
  test("campo de senha fora do login da pessoa usa semGerenciadorDeSenha", () => {
    const furos: string[] = [];
    for (const p of arquivos(SRC)) {
      const r = rel(p);
      if (LOGIN_DA_PESSOA.includes(r) || r === "src/components/ui/input.tsx") continue;
      for (const i of inputs(readFileSync(p, "utf8"))) {
        if (/type="password"/.test(i.tag) && !/\bsemGerenciadorDeSenha\b/.test(i.tag)) furos.push(`${r}:${i.linha}`);
      }
    }
    expect(furos).toEqual([]);
  });

  test("toda <Input> das telas de integração usa semGerenciadorDeSenha", () => {
    const furos: string[] = [];
    for (const r of INTEGRACOES) {
      const lista = inputs(readFileSync(join(RAIZ, r), "utf8"));
      expect(lista.length, `${r} sem <Input>? a régua precisa ser revista`).toBeGreaterThan(0);
      for (const i of lista) if (!/\bsemGerenciadorDeSenha\b/.test(i.tag)) furos.push(`${r}:${i.linha}`);
    }
    expect(furos).toEqual([]);
  });

  test("ninguém escreve os atributos dos gerenciadores à mão", () => {
    const copias: string[] = [];
    for (const p of arquivos(SRC)) {
      const r = rel(p);
      if (r === "src/components/ui/input.tsx") continue;
      if (/data-1p-ignore|data-lpignore|data-bwignore|data-form-type/.test(readFileSync(p, "utf8"))) copias.push(r);
    }
    expect(copias, "use a prop semGerenciadorDeSenha do <Input>").toEqual([]);
  });
});

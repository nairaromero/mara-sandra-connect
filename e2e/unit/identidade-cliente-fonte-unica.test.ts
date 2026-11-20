// Régua do CPF e da senha do Meu INSS no caso. Rodar:
//   bun test e2e/unit/identidade-cliente-fonte-unica.test.ts
//
// Até 20/11 o cabeçalho do caso e a aba Visão geral tinham, cada um, a sua
// cópia de "ler a senha, guardar, revelar, copiar". Resultado: duas leituras na
// trilha para a mesma visita e, depois de trocar a senha, o cabeçalho ainda
// copiava a antiga. Agora há um lugar só para cada coisa, e esta régua acusa
// quem abrir o segundo:
//   * ler a senha (RPC get_senha_meu_inss) fora de identidade-cliente.tsx;
//   * escrever na área de transferência fora de src/lib/copiar.ts.
// Sem banco, rede nem .env.
import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

const RAIZ = join(import.meta.dir, "../..");

const FONTES = readdirSync(join(RAIZ, "src"), { recursive: true, withFileTypes: true })
  .filter((d) => d.isFile() && /\.tsx?$/.test(d.name))
  .map((d) => join(d.parentPath, d.name));

function quemUsa(padrao: RegExp): string[] {
  return FONTES.filter((f) => padrao.test(readFileSync(f, "utf8")))
    .map((f) => relative(RAIZ, f))
    .sort();
}

describe("identidade do cliente: um lugar só", () => {
  test("a senha do Meu INSS é lida só em identidade-cliente.tsx", () => {
    expect(quemUsa(/rpc\(\s*["']get_senha_meu_inss["']/)).toEqual([
      "src/components/casos/identidade-cliente.tsx",
    ]);
  });

  // As duas telas do ZapSign ainda copiam por conta própria: estão sendo
  // mexidas em outro trabalho e ficam de fora até ele terminar. Quando passarem
  // a usar copiarTexto, saem desta lista — não entra arquivo novo aqui.
  const AINDA_POR_FORA = [
    "src/components/assinaturas/assinaturas-caso.tsx",
    "src/components/integracoes/integracao-zapsign-card.tsx",
  ];

  test("só src/lib/copiar.ts escreve na área de transferência", () => {
    const quem = quemUsa(/clipboard\s*\.\s*write(Text)?\s*\(/).filter((f) => !AINDA_POR_FORA.includes(f));
    expect(quem).toEqual(["src/lib/copiar.ts"]);
  });
});

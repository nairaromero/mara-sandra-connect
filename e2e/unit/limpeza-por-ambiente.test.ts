// Guarda contra limpeza de spec só-local escrevendo no banco ERRADO. Rodar:
//   bun test e2e/unit/limpeza-por-ambiente.test.ts
//
// O engano: `test.skip(!ENV.local, …)` no `beforeAll` pula os TESTES, mas o
// Playwright ainda roda o `afterAll`. Como a mesma suíte aponta para o staging
// (`bun run e2e:staging`), uma limpeza sem guarda escreve lá.
//
// Não é hipótese. O `afterAll` da spec de MFA fazia
// `app_config.upsert({ qg_exigir_aal2: "false" })` sem guarda, e o staging
// estava com a trava de segundo fator do QG DESLIGADA em 27/09 — a
// `migration_rbac_11` a liga de propósito. Quem fosse validar o QG lá veria o
// sistema não pedir o código e concluiria que a feature quebrou.
//
// As outras specs só-locais escapavam por acidente (`if (ESC2)` fica vazio
// quando o `beforeAll` pula). A régua: a limpeza passa pelo túnel
// `limpezaLocal` (e2e/rbac.ts), que escreve a condição uma vez.
// (fora de src/ porque o tsc do app não conhece bun:test)
import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";

const DIR = "e2e/tests";
const specs = fs.readdirSync(DIR).filter((f) => f.endsWith(".spec.ts"));

/** Specs que se pulam fora do banco local — são as que têm o risco. */
function soLocais(): string[] {
  return specs.filter((f) =>
    /test\.skip\(\s*!ENV\.local/.test(fs.readFileSync(path.join(DIR, f), "utf8")),
  );
}

describe("limpeza de spec só-local", () => {
  test("existe spec só-local (se não, a régua perdeu o sentido)", () => {
    expect(soLocais().length).toBeGreaterThan(0);
  });

  test("todo afterAll/afterEach de spec só-local passa por limpezaLocal", () => {
    const fora: string[] = [];
    for (const f of soLocais()) {
      const src = fs.readFileSync(path.join(DIR, f), "utf8");
      for (const m of src.matchAll(/test\.(afterAll|afterEach)\(\s*([^\s(]*)/g)) {
        if (m[2] !== "limpezaLocal") fora.push(`${DIR}/${f}  test.${m[1]}(${m[2]}…`);
      }
    }
    expect(
      fora.length,
      fora.length === 0
        ? ""
        : `limpeza sem o túnel:\n${fora.map((x) => "  " + x).join("\n")}\n\n` +
          'Envolva com `limpezaLocal(…)` de e2e/rbac.ts: `test.afterAll(limpezaLocal(async () => { … }))`.',
    ).toBe(0);
  });

  test("a spec de MFA devolve o valor que estava, não um 'false' fixo", () => {
    const src = fs.readFileSync(path.join(DIR, "mfa.spec.ts"), "utf8");
    expect(src, "o flag do QG é lido antes para ser devolvido depois").toContain("aal2Antes");
    expect(src, 'nada de fixar "false" na limpeza').not.toMatch(
      /qg_exigir_aal2["'],?\s*valor:\s*["']false["']/,
    );
  });
});

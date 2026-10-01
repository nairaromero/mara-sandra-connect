// Régua do túnel da IA (#451): toda chamada ao provedor passa pelo adaptador
// COM registro de uso (ia_uso), e a chave só é escolhida em
// _shared/ia-integracao.ts. Rodar:
//   bun test e2e/unit/ia-registro-de-uso.test.ts
// (fora de src/ porque o tsc do app não conhece bun:test)
import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const RAIZ = join(import.meta.dir, "../../supabase/functions");

function arquivos(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? arquivos(p) : p.endsWith(".ts") ? [p] : [];
  });
}

/** Código sem as linhas de comentário (que citam chatWith em prosa). */
function semComentarios(texto: string): string {
  return texto
    .split("\n")
    .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
    .join("\n");
}

/** Trecho de cada chamada `chatWith(...)`, do parêntese de abertura ao de fechamento. */
function chamadas(bruto: string): string[] {
  const texto = semComentarios(bruto);
  const out: string[] = [];
  let i = texto.indexOf("chatWith(");
  while (i >= 0) {
    let prof = 0;
    let j = i + "chatWith".length;
    for (; j < texto.length; j++) {
      if (texto[j] === "(") prof++;
      else if (texto[j] === ")" && --prof === 0) break;
    }
    out.push(texto.slice(i, j + 1));
    i = texto.indexOf("chatWith(", j);
  }
  return out;
}

const TODOS = arquivos(RAIZ).filter((p) => !p.endsWith("_shared/ia-providers.ts"));

describe("túnel da IA", () => {
  test("toda chamada ao provedor leva registro de uso", () => {
    const sem: string[] = [];
    let total = 0;
    for (const p of TODOS) {
      for (const c of chamadas(readFileSync(p, "utf8"))) {
        if (c.startsWith("chatWith(provider: string")) continue; // a definição
        total++;
        if (!c.includes("registro:")) sem.push(p.replace(RAIZ + "/", ""));
      }
    }
    expect(total).toBeGreaterThan(8);
    expect(sem, "chatWith sem `registro: registroDeUso(...)`").toEqual([]);
  });

  test("ninguém escolhe a chave por fora de _shared/ia-integracao.ts", () => {
    const fora = TODOS.filter(
      (p) => !p.endsWith("_shared/ia-integracao.ts") && /from\(\s*["']ia_integracoes["']\s*\)/.test(readFileSync(p, "utf8")),
    ).map((p) => p.replace(RAIZ + "/", ""));
    expect(fora).toEqual([]);
  });
});

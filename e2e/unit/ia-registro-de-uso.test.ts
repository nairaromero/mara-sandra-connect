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
  // Linha de comentário vira linha vazia: a numeração continua a do arquivo.
  return texto
    .split("\n")
    .map((l) => (/^\s*(\/\/|\*|\/\*)/.test(l) ? "" : l))
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
        // `registro: registroDeUso(...)` ou o atalho `{ registro, … }` — a
        // primeira versão só aceitava a forma longa e ficou vermelha no
        // staging com o atalho, que registra igual.
        if (!/\bregistro\s*[:,}\n]/.test(c)) sem.push(p.replace(RAIZ + "/", ""));
      }
    }
    expect(total).toBeGreaterThan(8);
    expect(sem, "chatWith sem `registro: registroDeUso(...)`").toEqual([]);
  });

  test("ninguém decifra a chave de IA por fora (abrirCredencial)", () => {
    const fora = TODOS.filter(
      (p) => !p.endsWith("_shared/ia-integracao.ts") && /api_key_cipher/.test(semComentarios(readFileSync(p, "utf8"))),
    ).map((p) => p.replace(RAIZ + "/", ""));
    expect(fora).toEqual([]);
  });

  test("ninguém escolhe a chave por fora de _shared/ia-integracao.ts", () => {
    const fora = TODOS.filter(
      (p) => !p.endsWith("_shared/ia-integracao.ts") && /from\(\s*["']ia_integracoes["']\s*\)/.test(readFileSync(p, "utf8")),
    ).map((p) => p.replace(RAIZ + "/", ""));
    expect(fora).toEqual([]);
  });

  test("erro de IA chega à tela só pela mensagemDoErro (nunca o texto cru do provedor)", () => {
    const cru: string[] = [];
    for (const p of TODOS) {
      const texto = semComentarios(readFileSync(p, "utf8"));
      let i = texto.indexOf("chatWith(");
      while (i >= 0) {
        // O try que ENVOLVE esta chamada (o último `try {` antes dela) e o
        // catch dele, no mesmo recuo — não o primeiro catch que aparecer
        // depois (no chat, esse é o da ferramenta, que volta ao modelo).
        const t = texto.lastIndexOf("try {", i);
        const inicioLinha = texto.lastIndexOf("\n", t) + 1;
        const recuo = texto.slice(inicioLinha, t).match(/^\s*/)![0];
        const c = t < 0 ? -1 : texto.indexOf("\n" + recuo + "} catch (", t);
        if (c >= 0) {
          const fim = texto.indexOf("\n" + recuo + "}", c + 1 + recuo.length + 1);
          const bloco = texto.slice(c, fim < 0 ? c + 600 : fim);
          for (const l of bloco.split("\n")) {
            // `motivo:` entrou depois do #434: a leitura de documentos devolvia
            // o cru do provedor em `pulados[].motivo` e a régua não via.
            const resposta = /\b(error|erros?|motivo)\s*:/.test(l) && !l.includes("console.");
            const comCru =
              /String\(\s*\(?\s*(e|err|erro)\b|\b(e|err|erro)\??\.message\b|\(\s*(e|err|erro)\s+as\b[^)]*\)\??\.message|\b(m|msg)\.slice\(/.test(l);
            if (resposta && comCru) cru.push(`${p.replace(RAIZ + "/", "")}: ${l.trim().slice(0, 80)}`);
          }
        }
        i = texto.indexOf("chatWith(", i + 1);
      }
    }
    expect(cru, "use mensagemDoErro(e, 'frase de quem chama') e mande o cru para o console").toEqual([]);
  });
});

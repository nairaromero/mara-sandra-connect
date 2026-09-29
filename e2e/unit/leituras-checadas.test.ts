// Guarda contra o padrão que a lista de regressões do CLAUDE.md abre:
// "falha de query engolida virando 'não existe' (error ignorado ≠ resultado
// vazio)". Rodar:
//   bun test e2e/unit/leituras-checadas.test.ts
//
// A varredura de 27/09 achou 19 leituras que destruturam só `data` (145 já
// checavam o erro). Duas eram furo de verdade, em `src/lib/tarefas/aplicador.ts`:
// a trava anti-duplicação não disparava e o roteamento por executor caía no
// fallback — as duas em silêncio. Foram para o túnel `src/lib/leitura.ts`.
//
// As outras estão AQUI, uma a uma, com o motivo. A lista é a régua: leitura
// nova sem `error` faz este teste falhar, e quem a escreveu decide entre usar
// `lerLista`/`lerUm`/`lerContagem` ou justificar a entrada.
// (fora de src/ porque o tsc do app não conhece bun:test)
import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";

/**
 * Leituras que podem seguir sem checar o erro, com o porquê. Enriquecimento de
 * exibição é o caso comum: falhar ali quebraria a tela inteira, e mostrar sem o
 * nome é melhor do que não mostrar.
 */
const PERMITIDAS: Record<string, string> = {
  "src/integrations/supabase/auth-attacher.ts": "getSession: ausência de sessão é resposta válida, não erro",
  "src/lib/tarefas/queries.ts": "enriquecimento de exibição (nome do cliente, protocolo): falhar quebraria a lista",
  "src/lib/agenda/comprovante.ts": "checagem de anexo para o comprovante; sem ele o texto sai sem a linha",
  "src/components/tarefas/comparecimento-pericia.tsx": "acompanhamento opcional do card",
  "src/components/tarefas/enviar-aviso-parceiro.tsx": "andamento de referência do aviso",
  "src/components/tarefas/etapa-cumprimento-exigencia.tsx": "dados do caso para o texto da etapa",
  "src/components/tarefas/montagem-inicial.tsx": "responsável e dados do caso para o texto da etapa",
  "src/components/tarefas/tarefa-sheet.tsx": "functions.invoke da IA: o erro é tratado pelo retorno, não pelo destructuring",
  "src/routes/_authenticated/boas-vindas.tsx": "primeiro acesso: lista vazia e falha levam ao mesmo lugar",
  "src/routes/_authenticated/casos.$id.tsx": "enriquecimento de exibição na tela do caso",
  "src/routes/_authenticated/comercial.tsx": "caminho de recuperação do CPF duplicado: se falhar, o erro original é relançado",
};

function varrer(): Array<{ arquivo: string; linha: number; texto: string }> {
  const achados: Array<{ arquivo: string; linha: number; texto: string }> = [];
  (function anda(dir: string) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) anda(p);
      else if (/\.(ts|tsx)$/.test(e.name)) {
        fs.readFileSync(p, "utf8").split("\n").forEach((l, i) => {
          // linha de comentário não conta: o próprio túnel mostra o padrão
          // ruim na documentação dele
          if (/^\s*(\/\/|\*|\/\*)/.test(l)) return;
          const m = /const\s*\{([^}]*)\}\s*=\s*await\s+supabase/.exec(l);
          if (m && !/\berror\b/.test(m[1])) {
            achados.push({ arquivo: p, linha: i + 1, texto: l.trim().slice(0, 100) });
          }
        });
      }
    }
  })("src");
  return achados;
}

describe("leitura do supabase sem checar o erro", () => {
  test("toda ocorrência está na lista de permitidas, com motivo", () => {
    const novas = varrer().filter((a) => !(a.arquivo in PERMITIDAS));
    const texto = novas.map((a) => `  ${a.arquivo}:${a.linha}  ${a.texto}`).join("\n");
    expect(
      novas.length,
      novas.length === 0
        ? ""
        : `leitura(s) sem checar o erro fora da lista:\n${texto}\n\n` +
          "Use lerLista/lerUm/lerContagem de src/lib/leitura.ts — ou, se ignorar o erro " +
          "for deliberado, acrescente o arquivo em PERMITIDAS com o motivo.",
    ).toBe(0);
  });

  test("a lista não tem entrada morta (arquivo que já foi consertado)", () => {
    const comOcorrencia = new Set(varrer().map((a) => a.arquivo));
    const mortas = Object.keys(PERMITIDAS).filter((f) => !comOcorrencia.has(f));
    expect(
      mortas.length,
      mortas.length === 0 ? "" : `tire da lista PERMITIDAS: ${mortas.join(", ")}`,
    ).toBe(0);
  });

  test("o aplicador de templates NÃO está na lista — as duas leituras dele decidem", () => {
    expect(Object.keys(PERMITIDAS)).not.toContain("src/lib/tarefas/aplicador.ts");
    const src = fs.readFileSync("src/lib/tarefas/aplicador.ts", "utf8");
    expect(src, "a trava anti-duplicação lê pelo túnel").toContain("lerLista");
  });
});

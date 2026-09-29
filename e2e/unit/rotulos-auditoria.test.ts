// Guarda: toda ação que a trilha GRAVA precisa ter rótulo em português. Rodar:
//   bun test e2e/unit/rotulos-auditoria.test.ts
//
// Por que existe: `ROTULO_ACAO` (src/lib/suporte/rotulos.ts) é um espelho do
// que `private.auditar` e o túnel das edge functions escrevem. Espelho sem
// verificador sai do lugar em silêncio — é a mesma lição da matriz de
// permissões (CLAUDE.md).
//
// Não é hipótese: gravando o filme de 28/09 a tela de Auditoria mostrou
// `equipe.permissao_ajustada` cru, porque `rotuloAcao` devolve a própria chave
// quando não conhece. As ações que o release de setembro criou — papel
// alterado, permissão ajustada, parceiro desligado, integração salva — todas
// apareciam assim para quem abrisse a trilha.
//
// As fontes conferidas aqui são as duas que de fato escrevem:
//   · as migrations, onde `private.auditar(…, 'x.y', …)` grava pelo SQL;
//   · `supabase/functions/_shared/auditoria.ts`, o túnel das edge functions.
// (fora de src/ porque o tsc do app não conhece bun:test)
import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import { ROTULO_ACAO } from "../../src/lib/suporte/rotulos";

/**
 * Ações escritas pelo SQL: o 3º argumento de `private.auditar(...)`.
 *
 * A primeira versão desta varredura exigia o fecha-parênteses da chamada dentro
 * de 200 caracteres. Chamada com `jsonb_build_object` longo passava do limite,
 * não casava, e a régua PASSAVA medindo menos — foi assim que
 * `equipe.permissao_ajustada` escapou. Agora só se olha a janela onde o 3º
 * argumento cabe, e chamada sem literal reconhecível é DENUNCIADA em vez de
 * ignorada: régua que mede menos do que deveria é pior que régua nenhuma.
 */
function acoesDoSql(): { acoes: Set<string>; chamadas: number; semLiteral: Array<string> } {
  const dir = "planning/sql-migrations";
  const acoes = new Set<string>();
  const semLiteral: Array<string> = [];
  let chamadas = 0;
  for (const arquivo of fs.readdirSync(dir).filter((f) => f.endsWith(".sql"))) {
    const sql = fs.readFileSync(path.join(dir, arquivo), "utf8");
    // só INVOCAÇÃO (`perform private.auditar(`): a definição da função e o
    // `revoke ... on function private.auditar(...)` também casariam com o nome
    // e entravam como "chamada que não consegui ler"
    for (const m of sql.matchAll(/perform\s+private\.auditar\s*\(/g)) {
      chamadas++;
      const janela = sql.slice(m.index!, m.index! + 400);
      const lit = /'([a-z_]+\.[a-z_]+)'/.exec(janela);
      if (lit) acoes.add(lit[1]);
      else semLiteral.push(`${arquivo}: ${janela.slice(0, 80).replace(/\s+/g, " ")}…`);
    }
  }
  return { acoes, chamadas, semLiteral };
}

/** Ações do túnel das edge functions: o tipo fechado `AcaoAuditada`. */
function acoesDasEdge(): Set<string> {
  const src = fs.readFileSync("supabase/functions/_shared/auditoria.ts", "utf8");
  const bloco = /export type AcaoAuditada\s*=([\s\S]*?);/.exec(src);
  if (!bloco) throw new Error("não achei o tipo AcaoAuditada — o túnel mudou de forma?");
  return new Set([...bloco[1].matchAll(/"([a-z_]+\.[a-z_]+)"/g)].map((m) => m[1]));
}

describe("rótulos da trilha de auditoria", () => {
  test("as fontes existem, e toda chamada de auditar foi lida", () => {
    const sql = acoesDoSql();
    expect(sql.chamadas, "nenhuma chamada a private.auditar nas migrations?").toBeGreaterThan(10);
    expect(sql.acoes.size).toBeGreaterThan(5);
    expect(acoesDasEdge().size).toBeGreaterThan(3);
    // chamada que a varredura não conseguiu ler vira falha, não silêncio
    expect(
      sql.semLiteral.length,
      sql.semLiteral.length === 0 ? "" : `chamada(s) sem ação literal:\n${sql.semLiteral.join("\n")}`,
    ).toBe(0);
  });

  test("toda ação gravada tem rótulo em português", () => {
    const todas = [...acoesDoSql().acoes, ...acoesDasEdge()].sort();
    const sem = todas.filter((a) => !ROTULO_ACAO[a]);
    expect(
      sem.length,
      sem.length === 0
        ? ""
        : `sem rótulo em ROTULO_ACAO (a Auditoria mostraria a chave crua):\n` +
          sem.map((a) => `  ${a}`).join("\n") +
          "\n\nAcrescente em src/lib/suporte/rotulos.ts.",
    ).toBe(0);
  });

  test("nenhum rótulo é a própria chave disfarçada", () => {
    const iguais = Object.entries(ROTULO_ACAO).filter(([chave, rotulo]) => chave === rotulo);
    expect(iguais.length, `rótulo igual à chave: ${iguais.map(([k]) => k).join(", ")}`).toBe(0);
  });
});

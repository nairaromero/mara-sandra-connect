// Perícia judicial não tem "deferido": tem laudo (caso da Mara, 25/11/2026).
// Rodar:  bun test e2e/unit/pericia-judicial.test.ts
//
// Sem banco: confere a regra em TS, que o SQL repete a MESMA regra, e que o
// controle da tarefa não deixa o laudo chegar ao template Concedido.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  andamentoDoLaudo,
  ehPericiaJudicial,
  META_ANALISE_LAUDO,
  META_LAUDO_PUBLICADO_EM,
  periciaEhJudicial,
  TEMPLATE_LAUDO_JUDICIAL,
  TEMPLATE_PERICIA_JUDICIAL,
} from "../../src/lib/tarefas/pericia";

const raiz = join(import.meta.dir, "../..");
const ler = (p: string) => readFileSync(join(raiz, p), "utf8");

describe("ehPericiaJudicial", () => {
  const JUD = "8c51ec67-9242-4002-b513-efa1a80b7431";
  test("template judicial é judicial, com ou sem processo", () => {
    expect(ehPericiaJudicial({ metadata: { template_aplicado: "pericia_judicial" } })).toBe(true);
    expect(
      ehPericiaJudicial({
        processo_judicial_id: JUD,
        metadata: { template_aplicado: "pericia_judicial" },
      }),
    ).toBe(true);
  });
  test("marca explícita vale", () => {
    expect(ehPericiaJudicial({ metadata: { pericia_judicial: true } })).toBe(true);
  });
  test("vale o processo: template do INSS num processo judicial é judicial", () => {
    expect(
      ehPericiaJudicial({
        processo_judicial_id: JUD,
        metadata: { template_aplicado: "pericia_parceiro" },
      }),
    ).toBe(true);
    expect(ehPericiaJudicial({ metadata: { template_aplicado: "pericia_parceiro" } })).toBe(false);
  });
  test("sem template, vale o vínculo", () => {
    expect(ehPericiaJudicial({ processo_judicial_id: JUD, metadata: {} })).toBe(true);
    expect(ehPericiaJudicial({ processo_judicial_id: null, metadata: {} })).toBe(false);
    expect(ehPericiaJudicial({})).toBe(false);
  });
});

describe("andamento do laudo", () => {
  test("nunca fala em deferimento ou concessão", () => {
    for (const laudo of ["favoravel", "parcial", "desfavoravel"] as const) {
      const a = andamentoDoLaudo(laudo, "25/11/2026");
      expect(a.titulo + a.descricao).not.toMatch(/deferid|concedid/i);
      expect(a.descricao).toContain("segue até a sentença");
    }
  });
});

describe("o SQL repete a mesma regra", () => {
  const sql = ler("planning/sql-migrations/migration_pericia_judicial_laudo.sql");
  // A regra vigente é a da migration mais nova; a anterior fica como histórico.
  const regra = ler("planning/sql-migrations/migration_pericia_judicial_vale_processo.sql");
  test("mesmo template, mesma marca, e o processo na frente", () => {
    expect(regra).toContain(`'template_aplicado' = '${TEMPLATE_PERICIA_JUDICIAL}'`);
    expect(regra).toContain(`p_metadata->>'pericia_judicial'`);
    expect(regra).toContain("p_processo_judicial_id is not null");
    expect(regra).not.toContain("pericia_parceiro'");
    expect(sql).toContain(`'${TEMPLATE_LAUDO_JUDICIAL}'`);
  });
  test("o escalonamento do INSS deixa a perícia judicial de fora", () => {
    expect(sql).toMatch(/and not private\.eh_pericia_judicial\(t\.metadata, t\.processo_judicial_id\)/);
  });
});

describe("publicação sobre o laudo", () => {
  const sql = ler("planning/sql-migrations/migration_publicacao_laudo_avisa_conferencia.sql");
  test("avisa a conferência e nunca a conclui", () => {
    const bloco = sql.slice(sql.indexOf("-- >>> laudo"), sql.indexOf("-- <<< laudo"));
    expect(bloco).toContain("'laudo_publicado_em', now()");
    expect(bloco).toContain("private.eh_pericia_judicial(t.metadata, t.processo_judicial_id)");
    expect(bloco).not.toMatch(/status\s*=\s*'feito'|completed_at/);
  });
  test("a marca da análise é a mesma do botão e do template", () => {
    expect(META_ANALISE_LAUDO).toBe("analise_laudo_pericia");
    expect(sql).toContain(`jsonb_build_object('${META_ANALISE_LAUDO}', true)`);
    expect(ler("planning/sql-migrations/migration_pericia_judicial_laudo.sql")).toContain(
      `jsonb_build_object('${META_ANALISE_LAUDO}', true)`,
    );
    expect(sql).toContain(`'${META_LAUDO_PUBLICADO_EM}'`);
  });
  test("o texto é decidido num lugar só", () => {
    expect(sql.match(/manifest\[\^\.\]/g)).toHaveLength(1);
    expect(sql).toContain("private.publicacao_fala_do_laudo(v_texto)");
  });
});

describe("o controle da tarefa", () => {
  const tsx = ler("src/components/tarefas/acompanhamento-pericia.tsx");
  test("decide pelo túnel, sem ler template ou processo à mão", () => {
    expect(tsx).toContain("ehPericiaJudicial(tarefa)");
    expect(tsx).not.toContain('"pericia_judicial"');
  });
  test("os formulários de tarefa e de agenda usam a mesma regra", () => {
    for (const p of [
      "src/components/tarefas/tarefa-sheet.tsx",
      "src/components/agenda/agenda-sheet.tsx",
    ]) {
      const fonte = ler(p);
      expect(fonte).toContain("periciaEhJudicial({");
      expect(fonte).not.toContain('"pericia_judicial"');
    }
  });
  test("a regra dos formulários é a da tarefa", () => {
    expect(periciaEhJudicial({ emProcessoJudicial: true, template: "pericia_parceiro" })).toBe(true);
    expect(periciaEhJudicial({ emProcessoJudicial: false, template: "pericia_judicial" })).toBe(true);
    expect(periciaEhJudicial({ emProcessoJudicial: false, template: "pericia_parceiro" })).toBe(false);
    expect(periciaEhJudicial({ emProcessoJudicial: false })).toBe(false);
  });
});

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
  TEMPLATE_LAUDO_JUDICIAL,
  TEMPLATE_PERICIA_INSS,
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
  test("template do INSS não vira judicial por estar num processo judicial", () => {
    expect(
      ehPericiaJudicial({
        processo_judicial_id: JUD,
        metadata: { template_aplicado: "pericia_parceiro" },
      }),
    ).toBe(false);
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
  test("mesmos templates e mesma marca", () => {
    expect(sql).toContain(`'template_aplicado' = '${TEMPLATE_PERICIA_JUDICIAL}'`);
    expect(sql).toContain(`'template_aplicado' = '${TEMPLATE_PERICIA_INSS}'`);
    expect(sql).toContain(`p_metadata->>'pericia_judicial'`);
    expect(sql).toContain(`'${TEMPLATE_LAUDO_JUDICIAL}'`);
  });
  test("o escalonamento do INSS deixa a perícia judicial de fora", () => {
    expect(sql).toMatch(/and not private\.eh_pericia_judicial\(t\.metadata, t\.processo_judicial_id\)/);
  });
});

describe("o controle da tarefa", () => {
  const tsx = ler("src/components/tarefas/acompanhamento-pericia.tsx");
  test("decide pelo túnel, sem ler template ou processo à mão", () => {
    expect(tsx).toContain("ehPericiaJudicial(tarefa)");
    expect(tsx).not.toContain('"pericia_judicial"');
  });
  test("laudo e desfecho não se cruzam: judicial sem laudo não registra saída", () => {
    expect(tsx).toContain("if (saiu && judicial !== !!laudo) return;");
  });
  test("com laudo, a corrente é a do laudo — antes de olhar o desfecho", () => {
    expect(tsx).toMatch(/const proximo = laudo\s*\?\s*TEMPLATE_LAUDO_JUDICIAL/);
  });
});

// Template só cabe no processo da natureza dele (Naira, 27/11/2026).
// Rodar: bun test e2e/unit/template-natureza.test.ts
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { templateCabeNoProcesso } from "../../src/lib/tarefas/types";
import { naturezaDoToken, SEM_PROCESSO } from "../../src/lib/processos/token";

const ler = (p: string) => readFileSync(join(import.meta.dir, "../..", p), "utf8");

describe("templateCabeNoProcesso", () => {
  test("judicial não entra em requerimento, nem INSS em ação", () => {
    expect(templateCabeNoProcesso({ natureza: "judicial" }, "admin")).toBe(false);
    expect(templateCabeNoProcesso({ natureza: "admin" }, "judicial")).toBe(false);
  });
  test("mesma natureza cabe", () => {
    expect(templateCabeNoProcesso({ natureza: "judicial" }, "judicial")).toBe(true);
    expect(templateCabeNoProcesso({ natureza: "admin" }, "admin")).toBe(true);
  });
  test("template livre cabe em qualquer processo; sem processo, tudo cabe", () => {
    expect(templateCabeNoProcesso({ natureza: null }, "admin")).toBe(true);
    expect(templateCabeNoProcesso({}, "judicial")).toBe(true);
    expect(templateCabeNoProcesso({ natureza: "judicial" }, null)).toBe(true);
  });
});

describe("naturezaDoToken", () => {
  test("lê a frente escolhida", () => {
    expect(naturezaDoToken("admin:1")).toBe("admin");
    expect(naturezaDoToken("judicial:1")).toBe("judicial");
    expect(naturezaDoToken("")).toBeNull();
    expect(naturezaDoToken(SEM_PROCESSO)).toBeNull();
  });
});

describe("fonte única", () => {
  test("a natureza vem da coluna, e os dois formulários usam a mesma regra", () => {
    expect(ler("src/lib/tarefas/queries.ts")).toMatch(/oculto_na_ui, natureza"/);
    for (const p of [
      "src/components/tarefas/tarefa-sheet.tsx",
      "src/components/agenda/agenda-sheet.tsx",
    ]) {
      expect(ler(p)).toContain("templateCabeNoProcesso(t, naturezaProcesso)");
    }
  });
  test("escritório novo recebe o catálogo com a natureza", () => {
    const sql = ler("planning/sql-migrations/migration_template_natureza.sql");
    expect(sql).toContain("t.ativo, t.oculto_na_ui, t.rotulo, t.natureza");
    // só preenche onde está nulo: rodar de novo não desfaz a escolha do escritório
    expect(sql.match(/where natureza is null/g)).toHaveLength(2);
  });
});

// Prazo não cai em sábado nem domingo (Naira, 27/11/2026).
// Rodar: bun test e2e/unit/prazo-fora-do-fim-de-semana.test.ts
//
// A regra mora no banco (gatilho); aqui se confere o espelho da tela e que a
// migration cobre os dois lugares onde prazo é gravado. Os mesmos exemplos
// rodam contra o banco em e2e/tests/prazo-fora-do-fim-de-semana.spec.ts.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { prazoForaDoFimDeSemana } from "../../src/lib/tarefas/relogio";
import { EXEMPLOS_PRAZO, AGORA_DOS_EXEMPLOS } from "../prazos-exemplos";

describe("prazoForaDoFimDeSemana (espelho da tela)", () => {
  for (const ex of EXEMPLOS_PRAZO) {
    test(ex.caso, () => {
      const r = prazoForaDoFimDeSemana(ex.prazo, new Date(AGORA_DOS_EXEMPLOS), ex.travado);
      expect(new Date(r).toISOString()).toBe(new Date(ex.esperado).toISOString());
    });
  }
});

describe("a migration", () => {
  const sql = readFileSync(
    join(import.meta.dir, "../../planning/sql-migrations/migration_prazo_fora_do_fim_de_semana.sql"),
    "utf8",
  );
  test("guarda tarefas e pedidos de documento, na criação e na troca do prazo", () => {
    expect(sql).toMatch(/create trigger zz_prazo_fora_do_fds\s+before insert or update of due_at on public\.tarefas/);
    expect(sql).toMatch(/before insert or update of prazo_at on public\.solicitacoes_documento/);
  });
  test("usa a conta de recuo que já existe, sem refazer dia da semana", () => {
    expect(sql).toContain("private.recua_fim_de_semana(v_dia)");
  });
  test("perícia (data de compromisso) fica de fora", () => {
    expect(sql).toContain("if new.tipo = 'pericia' then return new; end if;");
  });
});

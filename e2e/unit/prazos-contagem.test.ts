// A contagem do prazo começa no próximo dia útil depois do evento
// (Naira, 27/11/2026). Rodar: bun test e2e/unit/prazos-contagem.test.ts
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  baseDaContagem,
  fatalEmDiasCorridos,
  recuaFimDeSemana,
  somarDias,
} from "../../supabase/functions/_shared/prazos";
import { relogioEtapasPrevistas } from "../../src/lib/tarefas/relogio";
import { prazoDe } from "../datas";

const ler = (p: string) => readFileSync(join(import.meta.dir, "../..", p), "utf8");
/** O prazo com que o sistema trabalha: fatal menos 1, fora do fim de semana. */
const noSistema = (evento: string, dias: number) =>
  recuaFimDeSemana(somarDias(fatalEmDiasCorridos(evento, dias), -1));

describe("o exemplo combinado com o escritório", () => {
  test("andamento na sexta 13/11, 10 dias: dia 1 na segunda, fatal quarta 25/11, sistema terça 24/11", () => {
    expect(somarDias(baseDaContagem("2026-11-13"), 1)).toBe("2026-11-16");
    expect(fatalEmDiasCorridos("2026-11-13", 10)).toBe("2026-11-25");
    expect(noSistema("2026-11-13", 10)).toBe("2026-11-24");
  });
});

describe("baseDaContagem: o dia 1 é o próximo dia útil", () => {
  const dia1 = (evento: string) => somarDias(baseDaContagem(evento), 1);
  test("de segunda a quinta, conta do dia seguinte", () => {
    expect(dia1("2026-11-16")).toBe("2026-11-17");
    expect(dia1("2026-11-19")).toBe("2026-11-20");
  });
  test("sexta, sábado e domingo: conta da segunda", () => {
    expect(dia1("2026-11-13")).toBe("2026-11-16");
    expect(dia1("2026-11-14")).toBe("2026-11-16");
    expect(dia1("2026-11-15")).toBe("2026-11-16");
  });
});

describe("fatal menos 1 que cai no fim de semana volta para a sexta", () => {
  test("andamento na quinta 12/11, 10 dias: fatal domingo 22/11, sistema sexta 20/11", () => {
    expect(fatalEmDiasCorridos("2026-11-12", 10)).toBe("2026-11-22");
    expect(noSistema("2026-11-12", 10)).toBe("2026-11-20");
  });
});

describe("o relógio do indeferimento usa a mesma conta", () => {
  test("indeferimento na sexta: as etapas contam da segunda", () => {
    const e = relogioEtapasPrevistas("2026-11-13");
    expect(e.analise).toBe("2026-11-25");
    expect(e.protocolo).toBe("2026-12-15");
  });
  test("indeferimento na segunda: nada muda", () => {
    expect(relogioEtapasPrevistas("2026-11-16").analise).toBe("2026-11-26");
  });
});

describe("fonte única", () => {
  const sql = ler("planning/sql-migrations/migration_prazo_conta_do_dia_util.sql");
  test("o SQL repete a mesma base (sexta +2, sábado +1)", () => {
    expect(sql).toMatch(/when 5 then p_evento \+ 2/);
    expect(sql).toMatch(/when 6 then p_evento \+ 1/);
  });
  test("relógio, fatal da exigência e teto do deferimento contam da base", () => {
    expect(sql.match(/private\.base_da_contagem\(p_origem\)/g)).toHaveLength(3);
    expect(sql).toContain("private.base_da_contagem(v_hoje) + 10");
    expect(sql).toContain("private.base_da_contagem(v_hoje) + 30");
    expect(sql).not.toMatch(/v_hoje \+ (10|30)\b/);
  });
  test("a tela não refaz a conta: vem de @shared/prazos", () => {
    const rel = ler("src/lib/tarefas/relogio.ts");
    expect(rel).toContain('from "@shared/prazos"');
    expect(rel).not.toMatch(/export function (somarDias|recuaFimDeSemana)\b/);
  });
  test("o robô do INSS conta pela mesma função", () => {
    const robo = ler("supabase/functions/inss-email-processor/index.ts");
    expect(robo).toContain("fatalEmDiasCorridos(diaDoEmail, 30)");
    expect(robo).not.toContain("Date.now() + 30 * 86400_000");
  });
  test("o helper das specs dá o mesmo que o módulo", () => {
    for (const d of ["2026-11-12", "2026-11-13", "2026-11-14", "2026-11-15", "2026-11-16"]) {
      expect(prazoDe(d, 30)).toBe(fatalEmDiasCorridos(d, 30));
    }
  });
});

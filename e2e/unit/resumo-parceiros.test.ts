// Régua do resumo periódico para parceiros. Rodar:
//   bun test e2e/unit/resumo-parceiros.test.ts
//
// As regras (blocos, modos, quem recebe, quando é a hora) moram em UM lugar:
// supabase/functions/_shared/resumo-parceiros.ts. Esta régua cobra que o SQL
// diga o mesmo que o módulo, que cada bloco tenha consulta na function, que a
// tela não reescreva as listas e que as regras puras façam o que prometem.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  CONFIG_PADRAO,
  estaNaHora,
  IDS_SECOES,
  MODOS_RESUMO,
  montarEmailResumo,
  normalizarConfig,
  periodoDoResumo,
  recebeResumo,
} from "../../supabase/functions/_shared/resumo-parceiros";

const RAIZ = join(import.meta.dir, "../..");
const ler = (p: string) => readFileSync(join(RAIZ, p), "utf8");
const SQL = ler("planning/sql-migrations/migration_resumo_parceiros.sql");
const FUNCAO = ler("supabase/functions/resumo-parceiros/index.ts");
const TELA = ler("src/components/parceiros/resumo-parceiros.tsx");
const MODULO = ler("supabase/functions/_shared/resumo-parceiros.ts");

const lista = (texto: string) => [...texto.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);

describe("resumo para parceiros — uma fonte só", () => {
  test("o módulo é puro (a tela importa)", () => {
    expect(MODULO).not.toMatch(/^import /m);
    expect(MODULO).not.toMatch(/Deno\./);
  });

  test("o check de blocos do banco é a lista do módulo", () => {
    const check = SQL.match(/resumo_parceiros_config_secoes_check\s+check \(secoes <@ array\[([^\]]+)\]/);
    expect(check, "check de secoes não encontrado").not.toBeNull();
    expect(lista(check![1]).sort()).toEqual([...IDS_SECOES].sort());
    const padrao = SQL.match(/secoes text\[\] not null default array\[([^\]]+)\]/);
    expect(lista(padrao![1])).toEqual([...CONFIG_PADRAO.secoes]);
  });

  test("o check de modo do banco é a lista do módulo (sem o 'padrao', que é a ausência de linha)", () => {
    const check = SQL.match(/modo text not null check \(modo in \(([^)]+)\)\)/);
    expect(lista(check![1]).sort()).toEqual(MODOS_RESUMO.filter((m) => m !== "padrao").sort());
  });

  test("dia e hora padrão do banco são os do módulo", () => {
    expect(SQL).toMatch(new RegExp(`dia_semana smallint not null default ${CONFIG_PADRAO.dia_semana}\\b`));
    expect(SQL).toMatch(new RegExp(`hora smallint not null default ${CONFIG_PADRAO.hora}\\b`));
  });

  test("cada bloco tem consulta na function", () => {
    expect(FUNCAO).toMatch(/const CONSULTAS: Record<SecaoResumoId, Consulta>/);
    for (const id of IDS_SECOES) expect(FUNCAO).toMatch(new RegExp(`async ${id}\\(`));
  });

  test("a tela não reescreve as listas nem a regra de quem recebe", () => {
    expect(TELA).toMatch(/from "@shared\/resumo-parceiros"/);
    expect(TELA).not.toMatch(/"andamentos",\s*"requerimentos"/);
    expect(TELA).not.toMatch(/modo === "sempre"/);
  });

  test("a function manda e-mail só pelo túnel e confere o aceite", () => {
    expect(FUNCAO).toMatch(/enviarEmail\(/);
    expect(FUNCAO).not.toMatch(/api\.resend\.com/);
    expect(FUNCAO).toMatch(/parceiroSemAceite\(/);
    expect(FUNCAO).toMatch(/permissao: "parceiros:gerenciar"/);
  });
});

describe("resumo para parceiros — regras", () => {
  const ligado = { ...CONFIG_PADRAO, ativo: true };

  test("quem recebe", () => {
    expect(recebeResumo(CONFIG_PADRAO, "sempre")).toBe(false); // escritório desligado
    expect(recebeResumo(ligado, "sempre")).toBe(true);
    expect(recebeResumo(ligado, "nunca")).toBe(false);
    expect(recebeResumo(ligado, "padrao")).toBe(false);
    expect(recebeResumo({ ...ligado, padrao_parceiros: true }, "padrao")).toBe(true);
    expect(recebeResumo({ ...ligado, padrao_parceiros: true }, "nunca")).toBe(false);
    expect(recebeResumo({ ...ligado, secoes: [] }, "sempre")).toBe(false);
  });

  test("hora certa no horário de Brasília", () => {
    // sexta 27/11/2026 20:30 em Brasília = 23:30 UTC
    expect(estaNaHora(ligado, new Date("2026-11-27T23:30:00Z"))).toBe(true);
    expect(estaNaHora(ligado, new Date("2026-11-27T22:30:00Z"))).toBe(false);
    expect(estaNaHora(ligado, new Date("2026-11-28T23:30:00Z"))).toBe(false);
    expect(estaNaHora(CONFIG_PADRAO, new Date("2026-11-27T23:30:00Z"))).toBe(false);
  });

  test("período de 7 dias: sábado a sexta", () => {
    const p = periodoDoResumo(new Date("2026-11-27T23:00:00Z"));
    expect(p.inicioDia).toBe("2026-11-21");
    expect(p.fimDia).toBe("2026-11-27");
    expect(p.rotulo).toBe("21/11 a 27/11/2026");
  });

  test("config inválida cai no padrão; bloco desconhecido some", () => {
    expect(normalizarConfig({ ativo: "sim", dia_semana: 9, hora: -1, secoes: ["judiciais", "x"] })).toEqual({
      ativo: false, dia_semana: CONFIG_PADRAO.dia_semana, hora: CONFIG_PADRAO.hora, padrao_parceiros: false, secoes: ["judiciais"],
    });
  });

  test("o e-mail escapa HTML e leva ao caso", () => {
    const r = montarEmailResumo({
      marca: { nome: "Escritório <X>", logoUrl: null, cor: "javascript:alert(1)" },
      parceiroNome: "Ana Souza",
      periodo: periodoDoResumo(new Date("2026-11-27T23:00:00Z")),
      blocos: [{ id: "andamentos", itens: [{ casoId: "c1", cliente: "<b>Zé</b>", titulo: "Perícia", detalhe: "", data: "2026-11-25" }] }],
      appUrl: "https://app.exemplo/",
    });
    expect(r.html).not.toContain("<b>Zé</b>");
    expect(r.html).toContain("&lt;b&gt;Zé&lt;/b&gt;");
    expect(r.html).toContain("https://app.exemplo/casos/c1");
    expect(r.html).not.toContain("javascript:");
    expect(r.html).toContain("Olá, Ana.");
    expect(r.total).toBe(1);
  });
});

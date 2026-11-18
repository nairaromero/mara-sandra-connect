// Régua do ZapSign (#517): uma fonte de verdade para o que a tela, as functions
// e o banco dizem sobre um envio — e uma porta só para falar com o ZapSign.
//
// De onde veio: a revisão de 17/11/2026 achou a lista "em curso" escrita na
// tela e na function, "é PDF ou DOCX" em quatro lugares, o "Testar conexão"
// falando com o ZapSign por fora do túnel e "quem é da equipe" decidido por
// `usuarios.tipo` (global) em vez do vínculo do escritório.
import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { EM_CURSO, STATUS_ASSINATURA } from "../../supabase/functions/_shared/assinatura";

const RAIZ = join(import.meta.dir, "../..");
const FUNCOES = join(RAIZ, "supabase/functions");
const ler = (rel: string) => readFileSync(join(RAIZ, rel), "utf8");

function arquivos(dir: string, fim: RegExp): string[] {
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((d) => d.isFile() && fim.test(d.name))
    .map((d) => join(d.parentPath, d.name))
    .filter((p) => !p.includes("node_modules"));
}
const relativo = (p: string) => p.slice(RAIZ.length + 1);
const codigo = [...arquivos(join(RAIZ, "src"), /\.tsx?$/), ...arquivos(FUNCOES, /\.ts$/)];
/** Listas entre aspas de um trecho de SQL: "'a', 'b'" → ["a", "b"]. */
const aspas = (trecho: string) => [...trecho.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);

describe("ZapSign: fonte única", () => {
  const migration = ler("planning/sql-migrations/migration_zapsign_assinaturas.sql");

  test("o check de status do banco é a lista STATUS_ASSINATURA", () => {
    const check = migration.match(/status text not null[\s\S]*?check \(status in \(([^)]+)\)\)/);
    expect(check, "a régua não achou o check de status em migration_zapsign_assinaturas.sql").toBeTruthy();
    expect(aspas(check![1]).sort()).toEqual([...STATUS_ASSINATURA].sort());
  });

  test("o índice de 'um envio em curso por documento' usa a lista EM_CURSO", () => {
    const indice = migration.match(/assinaturas_um_em_curso_por_documento[\s\S]*?status in \(([^)]+)\)/);
    expect(indice, "a régua não achou o índice assinaturas_um_em_curso_por_documento").toBeTruthy();
    expect(aspas(indice![1]).sort()).toEqual([...EM_CURSO].sort());
  });

  test("ninguém reescreve a lista 'em curso' nem o teste de PDF/DOCX fora de _shared/assinatura.ts", () => {
    const copias: string[] = [];
    for (const p of codigo) {
      if (p.endsWith("_shared/assinatura.ts")) continue;
      const texto = readFileSync(p, "utf8");
      // um array literal com "enviando" e "gravando" é a lista EM_CURSO (ou a de status) escrita de novo
      for (const m of texto.matchAll(/\[[^\][]*\]/g)) {
        if (/["']enviando["']/.test(m[0]) && /["']gravando["']/.test(m[0])) copias.push(`${relativo(p)}: ${m[0].slice(0, 80)}`);
      }
      if (/\(pdf\|docx/i.test(texto)) copias.push(`${relativo(p)}: regex de pdf|docx`);
    }
    expect(copias, "importe EM_CURSO / formatoAssinavel de @shared/assinatura (tela) ou ../_shared/assinatura.ts (function)").toEqual([]);
  });

  test("só _shared/zapsign.ts fala com a API do ZapSign", () => {
    const porFora: string[] = [];
    for (const p of arquivos(FUNCOES, /\.ts$/)) {
      if (p.endsWith("_shared/zapsign.ts") || p.endsWith("_shared/integracoes.ts")) continue;
      const texto = readFileSync(p, "utf8");
      if (/baseZapsign\s*\(/.test(texto) || /api\.zapsign\.com\.br/.test(texto)) porFora.push(relativo(p));
    }
    expect(porFora, "use criarDocumento / sincronizarAssinatura / testarToken de _shared/zapsign.ts").toEqual([]);
  });

  test("quem é da equipe vem do vínculo (equipeInterna), não de usuarios.tipo nem de uma segunda consulta a membros", () => {
    const zapsign = ler("supabase/functions/_shared/zapsign.ts");
    expect(zapsign).toContain("equipeInterna(");
    expect(/\.eq\(\s*["']tipo["']\s*,\s*["']interno["']\s*\)/.test(zapsign), "usuarios.tipo é global: não decide quem é da equipe").toBe(false);
    const copias = arquivos(FUNCOES, /\.ts$/)
      .filter((p) => !p.endsWith("_shared/equipe.ts"))
      // a cópia é o FILTRO "só quem tem acesso interno" sobre membros+papeis (listar todos os vínculos, como o ia-config faz, não é)
      .filter((p) => /tipo_acesso\s*[!=]==?\s*["']interno["']/.test(readFileSync(p, "utf8")))
      .map(relativo);
    expect(copias, "a leitura 'equipe interna ativa do escritório' mora em _shared/equipe.ts").toEqual([]);
  });

  test("a tela usa o helper de erro das functions, não um bloco próprio", () => {
    const tela = ler("src/lib/assinaturas.ts");
    expect(tela).toContain("mensagemDeErroEdge(");
    expect(/\.context\b/.test(tela), "o corpo do erro é lido por mensagemDeErroEdge").toBe(false);
  });
});

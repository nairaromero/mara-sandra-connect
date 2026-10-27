// Régua do #249 — parceiro sem aceite dos termos não recebe dado de cliente.
//   bun test e2e/unit/aceite-antes-do-email.test.ts
//
// Antes do conserto, nenhuma function de e-mail conferia o aceite: 17 de 23
// parceiros recebiam nome de cliente e texto do caso sem ter assinado o DPA.
// Agora há UM lugar para cada coisa, e esta régua cobra que continue assim:
//   - a regra do aceite: `parceiroSemAceite` (_shared/termos.ts) — tela,
//     e-mail e WhatsApp decidem por ela, e a versão só é escrita ali;
//   - o envio de e-mail: `enviarEmail` (_shared/email.ts) — ninguém mais
//     monta o POST no Resend (eram 5 cópias);
//   - toda function que manda e-mail ao parceiro de um caso confere o aceite.
import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { TERMOS_VERSAO, aceiteValido, parceiroSemAceite } from "../../supabase/functions/_shared/termos";

const RAIZ = join(import.meta.dir, "../..");
const FUNCTIONS = join(RAIZ, "supabase/functions");

function arquivos(dir: string, fim: RegExp): string[] {
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((d) => d.isFile() && fim.test(d.name) && !d.parentPath.includes("node_modules"))
    .map((d) => join(d.parentPath, d.name));
}
const rel = (p: string) => p.replace(RAIZ + "/", "");
// Comentário não conta (o cabeçalho das functions cita o Resend).
const semComentario = (t: string) => t.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

describe("aceite antes do e-mail (#249)", () => {
  test("a regra: parceiro sem aceite vigente é barrado; equipe não", () => {
    const hoje = "2026-10-27T12:00:00Z";
    expect(parceiroSemAceite({ tipo: "parceiro", onboarded_em: hoje, termos_versao: TERMOS_VERSAO })).toBe(false);
    expect(parceiroSemAceite({ tipo: "parceiro", onboarded_em: null, termos_versao: null })).toBe(true);
    expect(parceiroSemAceite({ tipo: "parceiro", onboarded_em: hoje, termos_versao: "0.9" })).toBe(true);
    // Equipe que é parceira comercial não assina o DPA de parceiro.
    expect(parceiroSemAceite({ tipo: "interno", onboarded_em: hoje, termos_versao: null })).toBe(false);
    // Sem a linha, ou sem `tipo`, fecha.
    expect(parceiroSemAceite(null)).toBe(true);
    expect(parceiroSemAceite({ onboarded_em: null })).toBe(true);
    expect(aceiteValido({ onboarded_em: hoje, termos_versao: TERMOS_VERSAO })).toBe(true);
  });

  test("a versão dos termos só é escrita em _shared/termos.ts", () => {
    const copias: string[] = [];
    for (const p of [
      ...arquivos(join(RAIZ, "src"), /\.tsx?$/),
      ...arquivos(FUNCTIONS, /\.ts$/),
      ...arquivos(join(RAIZ, "e2e"), /\.(ts|cjs|mjs)$/),
    ]) {
      if (p.endsWith("_shared/termos.ts") || p.endsWith("aceite-antes-do-email.test.ts")) continue;
      if (readFileSync(p, "utf8").includes(TERMOS_VERSAO)) copias.push(rel(p));
    }
    expect(copias, "importe TERMOS_VERSAO de @shared/termos").toEqual([]);
  });

  test("ninguém chama o Resend fora de _shared/email.ts", () => {
    const diretos: string[] = [];
    for (const p of arquivos(FUNCTIONS, /\.ts$/)) {
      if (p.endsWith("_shared/email.ts")) continue;
      const t = semComentario(readFileSync(p, "utf8"));
      if (/api\.resend\.com|RESEND_BASE|Deno\.env\.get\(["']RESEND_API_KEY["']\)|\/emails`/.test(t)) diretos.push(rel(p));
    }
    expect(diretos, "use enviarEmail/emailConfigurado de _shared/email.ts").toEqual([]);
  });

  test("toda function que manda e-mail ao parceiro do caso confere o aceite", () => {
    const furos: string[] = [];
    let conferidas = 0;
    for (const p of arquivos(FUNCTIONS, /index\.ts$/)) {
      const t = semComentario(readFileSync(p, "utf8"));
      if (!/usuarios_parceiro:parceiro_id\(/.test(t) || !/enviarEmail\(/.test(t)) continue;
      conferidas++;
      if (!/parceiroSemAceite\(/.test(t)) furos.push(`${rel(p)}: não chama parceiroSemAceite`);
      if (!/avisarParceiroSemAceite\(/.test(t)) furos.push(`${rel(p)}: não manda o aviso sem dado de cliente`);
      for (const m of t.matchAll(/usuarios_parceiro:parceiro_id\(([^)]*)\)/g)) {
        for (const c of ["tipo", "onboarded_em", "termos_versao"]) {
          if (!m[1].split(/\s*,\s*/).includes(c)) furos.push(`${rel(p)}: o select do parceiro não traz ${c}`);
        }
      }
    }
    expect(conferidas, "a régua deveria achar andamento, comentário e pedido de documento").toBeGreaterThanOrEqual(3);
    expect(furos).toEqual([]);
  });

  test("a saída do WhatsApp confere o aceite antes de mandar", () => {
    const t = semComentario(readFileSync(join(FUNCTIONS, "whatsapp-outbox-enviar/index.ts"), "utf8"));
    expect(t).toMatch(/parceiroSemAceite\(/);
    expect(t).toMatch(/"cancelado"/);
  });
});

// Régua do catálogo do escritório (#486). Rodar:
//   bun test e2e/unit/catalogo-escritorio.test.ts
//
// A cópia dos tipos de benefício e modelos de tarefa morava dentro do
// qg_criar_escritorio: o escritório só ganhava catálogo ao nascer, e o
// espelho de 27/10 deixou o Canário do staging sem nada. Agora há UM lugar,
// `private.semear_catalogo`, chamado pelo QG e pelo passo 6 do espelho. Esta
// régua cobra que continue assim — e que a chave de IA do staging siga
// guardada durante o espelho (decisão da Naira, 27/10).
import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const RAIZ = join(import.meta.dir, "../..");
const MIGRATIONS = join(RAIZ, "planning/sql-migrations");
const ler = (p: string) => readFileSync(join(RAIZ, p), "utf8");

/** O corpo da ÚLTIMA migration que define a função (a que vale). */
function ultimaDefinicao(nome: RegExp): string {
  const corpos = readdirSync(MIGRATIONS)
    .filter((f) => /^migration_.*\.sql$/.test(f))
    .sort()
    .map((f) => readFileSync(join(MIGRATIONS, f), "utf8"))
    .map((t) => t.match(new RegExp(`function ${nome.source}[\\s\\S]*?\\$(function)?\\$([\\s\\S]*?)\\$(function)?\\$`, "i")))
    .filter((m): m is RegExpMatchArray => !!m)
    .map((m) => m[2]);
  expect(corpos.length, `nenhuma migration define ${nome.source}`).toBeGreaterThan(0);
  return corpos[corpos.length - 1];
}

describe("catálogo do escritório (#486)", () => {
  test("o QG monta o catálogo pelo túnel, sem cópia própria", () => {
    const qg = ultimaDefinicao(/public\.qg_criar_escritorio/);
    expect(qg).toMatch(/private\.semear_catalogo\(/);
    expect(qg).not.toMatch(/insert into public\.(tipos_beneficio|tarefa_templates)/i);
  });

  test("o túnel cobre as duas tabelas e só preenche o que está vazio", () => {
    const t = ultimaDefinicao(/private\.semear_catalogo/);
    for (const tabela of ["tipos_beneficio", "tarefa_templates"]) {
      expect(t).toMatch(new RegExp(`not exists \\(select 1 from public\\.${tabela} where escritorio_id = p_destino\\)`));
      expect(t).toMatch(new RegExp(`insert into public\\.${tabela}`));
    }
  });

  test("o passo 6 do espelho recompõe o catálogo e devolve a chave de IA guardada", () => {
    const passo6 = ler("scripts/espelho-reconstruir-acesso.sql");
    expect(passo6).toMatch(/private\.semear_catalogo\(/);
    expect(passo6).toMatch(/from ops\.espelho_guarda_ia/);
    // Staff do QG nunca vira membro de escritório, nem quando o arquivo roda à mão.
    expect(passo6).toMatch(/not exists \(select 1 from public\.plataforma_staff s where s\.usuario_id = u\.id\)/);
    const espelho = ler("scripts/espelho-staging.sh");
    // A guarda acontece ANTES da limpeza do passo 2.
    const guarda = espelho.indexOf("insert into ops.espelho_guarda_ia");
    const limpeza = espelho.indexOf("==> 2/4 limpando staging");
    expect(guarda, "o espelho não guarda a chave de IA do staging").toBeGreaterThan(-1);
    expect(guarda).toBeLessThan(limpeza);
    // E não apaga a guarda quando o staging chega sem chave (espelho que abortou).
    expect(espelho).toMatch(/if exists \(select 1 from public\.escritorio_integracoes where tipo = 'ia'\) then\s+delete from ops\.espelho_guarda_ia/);
  });
});

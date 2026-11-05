// Régua: os seeds que o espelho semanal chama rodam no GitHub Actions, onde
// NÃO existe .env.local — as credenciais vêm do ambiente.
//
// Em 02/11 o `seed-local-rbac.mjs --staging` leu a senha das contas direto do
// .env.local, estourou ENOENT, o espelho transformou isso num AVISO e o run
// ficou verde. Resultado: o staging passou três dias sem as contas do Canário
// e do QG, e a suíte do staging falhou no release de 05/11.
//
// Aqui cada seed roda numa pasta vazia (sem .env.local), com as chaves no
// ambiente e SEM a senha. Ele tem de parar dizendo que a senha está ausente —
// antes de qualquer chamada de rede — e nunca por não achar o arquivo.
// E o espelho não pode engolir aviso: falha de seed faz o run terminar com erro.

import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const RAIZ = path.resolve(import.meta.dir, "../..");

function rodarSemEnvLocal(script: string, args: string[] = []) {
  const vazia = fs.mkdtempSync(path.join(os.tmpdir(), "espelho-seed-"));
  try {
    const r = spawnSync("node", [path.join(RAIZ, script), ...args], {
      cwd: vazia,
      env: {
        PATH: process.env.PATH ?? "",
        HOME: process.env.HOME ?? "",
        // Chaves falsas: o seed passa da checagem delas e chega na senha.
        STAGING_SERVICE_ROLE_KEY: "chave-falsa",
        STAGING_PUBLISHABLE_KEY: "chave-falsa",
      },
      encoding: "utf8",
      timeout: 30_000,
    });
    return { status: r.status, saida: `${r.stdout}\n${r.stderr}` };
  } finally {
    fs.rmSync(vazia, { recursive: true, force: true });
  }
}

describe("seeds do espelho rodam sem .env.local (como no Actions)", () => {
  for (const [script, args] of [
    ["scripts/seed-local-rbac.mjs", ["--staging"]],
    ["scripts/seed-staging-contas.mjs", []],
  ] as const) {
    test(`${script}: sem a senha no ambiente, para dizendo que ela falta — não por ENOENT`, () => {
      const { status, saida } = rodarSemEnvLocal(script, [...args]);
      expect(saida).not.toMatch(/ENOENT/);
      expect(saida).toMatch(/STAGING_SYNTH_PASSWORD ausente/);
      expect(status).toBe(1);
    });
  }
});

describe("o espelho não engole falha de seed", () => {
  const sh = fs.readFileSync(path.join(RAIZ, "scripts/espelho-staging.sh"), "utf8");

  test("toda chamada de seed/reconstrução que falha passa por avisar(), e aviso termina o run com erro", () => {
    const chamadas = sh.split("\n").filter((l) => /seed-(local-rbac|staging-contas)\.mjs"|espelho-reconstruir-acesso\.sql"/.test(l) && /^\s*(node|psql)\b/.test(l));
    expect(chamadas.length).toBeGreaterThanOrEqual(3);
    // A chamada que cai para a linha de baixo (psql … ||) é conferida junto com ela.
    const linhas = sh.split("\n");
    for (const c of chamadas) {
      const i = linhas.indexOf(c);
      const trecho = c.trimEnd().endsWith("||") ? `${c}\n${linhas[i + 1]}` : c;
      expect(trecho, `sem avisar(): ${c.trim()}`).toMatch(/\|\|\s*avisar /);
    }
    expect(sh).toMatch(/if \[ "\$\{#AVISOS\[@\]\}" -gt 0 \]; then[\s\S]*?exit 1/);
  });

  test("mensagem de aviso não executa comando (crase sem escape dentro de aspas roda o comando)", () => {
    const avisos = sh.split("\n").filter((l) => /avisar "|echo "AVISO/.test(l));
    expect(avisos.length).toBeGreaterThan(0);
    for (const l of avisos) expect(l, l.trim()).not.toMatch(/(?<!\\)`/);
  });
});

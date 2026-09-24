// E2E: o espelho do front bate com o que o servidor exige.
//
// `src/lib/rbac/exigencias.ts` é a cópia, legível pelo navegador, das policies
// `perm_*`, das RPCs que conferem permissão e das edge functions que pedem
// permissão. Se o banco ganhar uma exigência nova (ou mudar de permissão) e o
// espelho ficar para trás, a tela volta a oferecer o que o servidor recusa —
// que é exatamente como nasceram os ~40 botões da auditoria de 24/09
// (planning/RBAC_AUDITORIA_TELAS.md).
//
// Este teste roda o mesmo verificador da linha de comando
// (`node scripts/rbac-conferir-exigencias.mjs --local`) contra o banco do
// ambiente. Falhou? A saída diz o que sobra e o que falta.
import { test, expect } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { ENV } from "../env";

test("o espelho de exigências do front bate com o banco", () => {
  // o verificador fala com o banco por `scripts/msc-sql.mjs`: local quando a
  // suíte roda no ambiente local, staging quando roda contra o staging.
  const alvo = ENV.supabaseUrl.includes("127.0.0.1") || ENV.supabaseUrl.includes("localhost")
    ? "--local"
    : "--staging";
  let saida = "";
  try {
    saida = execFileSync("node", ["scripts/rbac-conferir-exigencias.mjs", alvo], {
      encoding: "utf8",
      cwd: process.cwd(),
    });
  } catch (e) {
    const err = e as { stdout?: string; stderr?: string };
    throw new Error(`espelho divergente do banco:\n${err.stdout ?? ""}${err.stderr ?? ""}`);
  }
  expect(saida).toContain("OK: o espelho do front bate com o servidor.");
});

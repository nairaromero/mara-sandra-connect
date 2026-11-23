// Régua (#546): o espelho semanal copia produção -> staging anonimizado. A única
// garantia de que uma tabela sensível NÃO vaze é ela estar NOMEADA no denylist
// EXCLUIR (opt-out). A trava (b) do espelho exige policy/classificação só para
// tabela COM RLS; uma tabela sensível nova sem RLS — ou que ganhe a policy
// espelho_leitura_select — e que ninguém lembre de pôr em EXCLUIR vazaria calada.
// A defesa em profundidade é a asserção POSITIVA (trava (h)): depois do restore,
// TODA tabela de EXCLUIR tem de estar vazia no staging; se vier com linha, o
// espelho aborta e o card abre sozinho (passo "Avisa que o espelho falhou").
//
// Esta régua lê scripts/espelho-staging.sh como TEXTO (sem banco, rede ou
// .env — roda no .github/workflows/reguas.yml) e prova:
//   1. a asserção pós-restore existe e aborta (exit 1), contra o STAGING;
//   2. ela é guiada pelo PRÓPRIO array EXCLUIR — então nenhuma tabela de EXCLUIR
//      fica fora da checagem sem também sair de EXCLUIR (e, com isso, da exclusão
//      do dump), que é uma mudança barulhenta e visível;
//   3. ela roda logo após o restore e ANTES de qualquer repopulação legítima
//      (seed de contas/RBAC e a volta da chave de IA) — conferir depois delas
//      daria falso-ok.
//
// (fora de src/ porque o tsc do app não conhece bun:test)
import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";

const RAIZ = path.resolve(import.meta.dir, "../..");
const sh = fs.readFileSync(path.join(RAIZ, "scripts/espelho-staging.sh"), "utf8");
const linhas = sh.split("\n");

// Extrai os membros de um array bash `NOME=( ... )`, tirando os comentários.
function lerArrayBash(texto: string, nome: string): string[] {
  const abre = `${nome}=(`;
  const inicio = texto.indexOf(abre);
  if (inicio < 0) throw new Error(`array ${nome} não encontrado no espelho`);
  const semComentarios = texto
    .slice(inicio + abre.length)
    .split("\n")
    .map((l) => l.replace(/#.*$/, "")) // comentário vai até o fim da linha
    .join("\n");
  const fim = semComentarios.indexOf(")"); // 1º ")" já sem os comentários
  if (fim < 0) throw new Error(`array ${nome} sem fechamento`);
  return semComentarios
    .slice(0, fim)
    .split(/\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

const EXCLUIR = lerArrayBash(sh, "EXCLUIR");

function indiceDe(re: RegExp): number {
  const i = linhas.findIndex((l) => re.test(l));
  expect(i, `linha não encontrada: ${re}`).toBeGreaterThanOrEqual(0);
  return i;
}

// O bloco da asserção: do capture do resultado até o guard que aborta.
const captura = sh.match(/excluir_com_linhas="\$\(psql[\s\S]*?\)"/);
const guarda = sh.match(/\[ -z "\$excluir_com_linhas" \][\s\S]*?exit 1/);

describe("espelho: asserção pós-restore de que EXCLUIR fica vazio (#546)", () => {
  test("o array EXCLUIR foi lido e traz as tabelas sensíveis conhecidas", () => {
    expect(EXCLUIR.length).toBeGreaterThanOrEqual(15);
    for (const t of [
      "escritorio_integracoes",
      "usuario_gmail_oauth",
      "aceites_termos",
      "assinaturas",
      "mensagens",
    ]) {
      expect(EXCLUIR, `EXCLUIR deveria conter ${t}`).toContain(t);
    }
  });

  test("existe a asserção pós-restore e ela aborta com exit 1, contra o staging", () => {
    expect(captura, "faltou a captura `excluir_com_linhas=$(psql …)`").not.toBeNull();
    expect(guarda, 'faltou o guard `[ -z "$excluir_com_linhas" ] … exit 1`').not.toBeNull();
    // Conta contra o STAGING, nunca contra produção.
    expect(captura![0]).toContain("$STG_URL");
    expect(captura![0]).not.toContain("$PROD_URL");
    // Mensagem clara: menciona EXCLUIR e imprime quais tabelas + a contagem.
    expect(guarda![0]).toMatch(/ABORTANDO:.*EXCLUIR/);
    expect(guarda![0]).toContain("$excluir_com_linhas");
  });

  test("a checagem é guiada pelo PRÓPRIO array EXCLUIR (cobre toda a lista)", () => {
    // Se a checagem percorre ${EXCLUIR[@]}, nenhuma tabela sai dela sem sair de
    // EXCLUIR — e sair de EXCLUIR a tira da exclusão do dump (mudança visível).
    // Assim ninguém tira uma tabela da checagem sem esta régua acusar.
    expect(captura![0]).toMatch(/\$\{EXCLUIR\[@\]\}/);
    // E realmente conta linhas de cada tabela (não é um stub que sempre passa).
    expect(captura![0]).toMatch(/count\(\*\)/);
  });

  test("roda depois do restore e antes de qualquer repopulação legítima de EXCLUIR", () => {
    const iRestore = indiceDe(/==> 3\/4 restore no staging/);
    const iCheck = indiceDe(/excluir_com_linhas="\$\(psql/);
    // Repopuladores legítimos de tabelas de EXCLUIR (casam a CHAMADA, não um
    // comentário que cite o arquivo):
    const iContas = indiceDe(/node .*seed-staging-contas\.mjs/); // usuarios, aceites_termos
    const iReconstruir = indiceDe(/psql .*espelho-reconstruir-acesso\.sql/); // membros + volta da chave de IA
    const iSeedRbac = indiceDe(/node .*seed-local-rbac\.mjs/); // Canário/QG
    expect(iCheck).toBeGreaterThan(iRestore);
    expect(iCheck).toBeLessThan(iContas);
    expect(iCheck).toBeLessThan(iReconstruir);
    expect(iCheck).toBeLessThan(iSeedRbac);
  });
});

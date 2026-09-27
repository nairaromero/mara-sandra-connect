// O túnel das leituras: erro não pode passar por vazio. Rodar:
//   bun test e2e/unit/leitura.test.ts
//
// Este teste é a evidência do problema que o túnel resolve. O primeiro bloco
// reproduz o padrão antigo — `const { data } = await …` sem `error` — e mostra
// o que ele produz quando a consulta falha: `null`, que o código de cima leu
// como "não existe" e usou para decidir. Os blocos seguintes mostram o túnel
// separando as duas coisas.
// (fora de src/ porque o tsc do app não conhece bun:test)
import { describe, expect, test } from "bun:test";
import { lerContagem, lerLista, lerUm } from "../../src/lib/leitura";

const falhou = { data: null, error: { message: "timeout" } };
const vazio = { data: [], error: null };
const achou = { data: [{ id: "a" }], error: null };

describe("o padrão antigo confunde erro com vazio", () => {
  test("destruturar só `data` transforma falha em null — indistinguível de 'não achei'", () => {
    // é o que `const { data } = await supabase…` faz
    const { data: deFalha } = falhou;
    const { data: deVazio } = vazio;
    expect(deFalha).toBeNull();
    expect(deVazio).toEqual([]);
    // e a decisão que o código tomava era esta, com `data ?? []`:
    expect((deFalha ?? []).length > 0, "falha vira 'não existe'").toBe(false);
    expect((deVazio ?? []).length > 0, "vazio vira 'não existe' também").toBe(false);
    // as duas situações dão a MESMA resposta: é o bug.
  });
});

describe("lerLista", () => {
  test("erro estoura, com o contexto na mensagem", async () => {
    await expect(lerLista(Promise.resolve(falhou), "tarefas da corrente")).rejects.toThrow(
      "tarefas da corrente: timeout",
    );
  });

  test("consulta sem resultado devolve lista vazia", async () => {
    expect(await lerLista(Promise.resolve(vazio), "tarefas")).toEqual([]);
  });

  test("com resultado, devolve as linhas", async () => {
    expect(await lerLista(Promise.resolve(achou), "tarefas")).toEqual([{ id: "a" }]);
  });

  test("data nulo SEM erro devolve vazio (não estoura)", async () => {
    expect(await lerLista(Promise.resolve({ data: null, error: null }), "tarefas")).toEqual([]);
  });
});

describe("lerUm", () => {
  test("erro estoura", async () => {
    await expect(lerUm(Promise.resolve(falhou), "cliente pelo CPF")).rejects.toThrow(
      "cliente pelo CPF: timeout",
    );
  });

  test("sem linha devolve null — e aí null significa mesmo 'não existe'", async () => {
    expect(await lerUm(Promise.resolve({ data: null, error: null }), "cliente")).toBeNull();
  });

  test("com linha devolve a linha", async () => {
    expect(await lerUm(Promise.resolve({ data: { id: "x" }, error: null }), "cliente")).toEqual({
      id: "x",
    });
  });
});

describe("lerContagem", () => {
  test("erro estoura em vez de virar zero", async () => {
    await expect(
      lerContagem(Promise.resolve({ count: null, error: { message: "sem conexão" } }), "duplicatas"),
    ).rejects.toThrow("duplicatas: sem conexão");
  });

  test("sem linhas é zero de verdade", async () => {
    expect(await lerContagem(Promise.resolve({ count: 0, error: null }), "duplicatas")).toBe(0);
  });

  test("count nulo sem erro é zero", async () => {
    expect(await lerContagem(Promise.resolve({ count: null, error: null }), "duplicatas")).toBe(0);
  });
});

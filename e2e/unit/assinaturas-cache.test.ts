// Cache dos modelos do ZapSign na tela (#542): a lista aparece na hora e é
// conferida depois de 1 minuto; o texto de cada modelo vale 30 minutos ou até o
// modelo mudar no ZapSign; nada passa de uma pessoa/escritório para outro.
import { describe, expect, test } from "bun:test";
import { criarCacheModelos, LISTA_REVALIDA_MS, TEXTO_MAXIMO, TEXTO_VALIDADE_MS } from "../../src/lib/assinaturas-cache";

const modelo = (token: string, atualizado = "2026-11-01") => ({ token, nome: token, pasta: "/", atualizado });
const paragrafo = (t: string) => [{ centro: false, trechos: [{ t, n: false }] }];

function montar() {
  let relogio = 0;
  const pedidos = { lista: 0, texto: [] as string[] };
  let listaAtual = [modelo("a"), modelo("b")];
  const cache = criarCacheModelos({
    agora: () => relogio,
    buscarLista: async () => {
      pedidos.lista++;
      return listaAtual;
    },
    buscarTexto: async (token) => {
      pedidos.texto.push(token);
      return paragrafo(`texto ${token} #${pedidos.texto.length}`);
    },
  });
  return {
    cache, pedidos,
    passar: (ms: number) => { relogio += ms; },
    trocarLista: (l: ReturnType<typeof modelo>[]) => { listaAtual = l; },
  };
}

describe("lista de modelos", () => {
  test("sem nada guardado vai ao ZapSign; depois aparece na hora e só pede conferência com mais de 1 minuto", async () => {
    const { cache, pedidos, passar } = montar();
    expect(cache.listaGuardada("ana:esc1")).toBeNull();
    await cache.atualizarLista("ana:esc1");
    expect(cache.listaGuardada("ana:esc1")).toMatchObject({ velha: false, modelos: [{ token: "a" }, { token: "b" }] });
    passar(LISTA_REVALIDA_MS);
    expect(cache.listaGuardada("ana:esc1")?.velha).toBe(false);
    passar(1);
    expect(cache.listaGuardada("ana:esc1")?.velha).toBe(true);
    expect(pedidos.lista).toBe(1);
  });
  test("dois pedidos ao mesmo tempo viram um só", async () => {
    const { cache, pedidos } = montar();
    await Promise.all([cache.atualizarLista("ana:esc1"), cache.atualizarLista("ana:esc1")]);
    expect(pedidos.lista).toBe(1);
  });
  test("outra pessoa ou outro escritório na mesma aba começa vazio", async () => {
    const { cache } = montar();
    await cache.atualizarLista("ana:esc1");
    expect(cache.listaGuardada("ana:esc2")).toBeNull();
    expect(cache.listaGuardada("bia:esc1")).toBeNull();
  });
});

describe("texto do modelo (Conferir o contrato)", () => {
  test("buscado uma vez; o segundo pedido — mesmo em outro caso — usa o guardado", async () => {
    const { cache, pedidos } = montar();
    await cache.atualizarLista("ana:esc1");
    const [p1, p2] = await Promise.all([cache.texto("ana:esc1", "a", "caso1"), cache.texto("ana:esc1", "a", "caso1")]);
    expect(p1).toEqual(p2);
    await cache.texto("ana:esc1", "a", "caso2");
    expect(pedidos.texto).toEqual(["a"]);
  });
  test("vale 30 minutos", async () => {
    const { cache, pedidos, passar } = montar();
    await cache.atualizarLista("ana:esc1");
    await cache.texto("ana:esc1", "a", "c");
    passar(TEXTO_VALIDADE_MS);
    await cache.texto("ana:esc1", "a", "c");
    expect(pedidos.texto).toEqual(["a"]);
    passar(1);
    await cache.texto("ana:esc1", "a", "c");
    expect(pedidos.texto).toEqual(["a", "a"]);
  });
  test("modelo alterado no ZapSign: a lista nova descarta o texto guardado; modelo apagado também", async () => {
    const { cache, pedidos, trocarLista } = montar();
    await cache.atualizarLista("ana:esc1");
    await cache.texto("ana:esc1", "a", "c");
    await cache.texto("ana:esc1", "b", "c");
    trocarLista([modelo("a", "2026-11-23")]); // "a" editado, "b" apagado
    await cache.atualizarLista("ana:esc1");
    expect(cache.textosGuardados).toBe(0);
    await cache.texto("ana:esc1", "a", "c");
    expect(pedidos.texto).toEqual(["a", "b", "a"]);
  });
  test(`no máximo ${TEXTO_MAXIMO} textos: o mais antigo sai`, async () => {
    const { cache, pedidos, trocarLista } = montar();
    const tokens = Array.from({ length: TEXTO_MAXIMO + 1 }, (_, i) => `m${i}`);
    trocarLista(tokens.map((t) => modelo(t)));
    await cache.atualizarLista("ana:esc1");
    for (const t of tokens) await cache.texto("ana:esc1", t, "c");
    expect(cache.textosGuardados).toBe(TEXTO_MAXIMO);
    await cache.texto("ana:esc1", "m0", "c"); // o primeiro saiu: busca de novo
    expect(pedidos.texto.filter((t) => t === "m0")).toHaveLength(2);
  });
  test("erro na busca não fica guardado: a próxima tenta de novo", async () => {
    let falhar = true;
    const pedidos: string[] = [];
    const cache = criarCacheModelos({
      buscarLista: async () => [modelo("a")],
      buscarTexto: async (t) => {
        pedidos.push(t);
        if (falhar) throw new Error("ZapSign fora");
        return paragrafo("ok");
      },
    });
    await expect(cache.texto("ana:esc1", "a", "c")).rejects.toThrow("ZapSign fora");
    falhar = false;
    expect(await cache.texto("ana:esc1", "a", "c")).toEqual(paragrafo("ok"));
    expect(pedidos).toEqual(["a", "a"]);
  });
  test("trocar de escritório no meio de uma busca: a resposta atrasada não entra no cache do outro", async () => {
    let soltar: (v: ReturnType<typeof paragrafo>) => void = () => undefined;
    const cache = criarCacheModelos({ buscarLista: async () => [modelo("a")], buscarTexto: () => new Promise((ok) => { soltar = ok; }) });
    const lento = cache.texto("ana:esc1", "a", "c");
    cache.listaGuardada("ana:esc2"); // trocou de escritório
    soltar(paragrafo("do esc1"));
    await lento;
    expect(cache.textosGuardados).toBe(0);
  });
});

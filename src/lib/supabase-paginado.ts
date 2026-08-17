// Busca paginada sobre o PostgREST.
//
// O PostgREST corta a resposta em `max_rows` (1000 aqui) e NAO avisa: vem uma
// pagina cheia, sem erro, como se fosse o resultado inteiro. Um `.limit(n)`
// fixo tem o mesmo defeito e ainda mente antes disso. Quem precisa da lista
// toda pagina com `range()` ate a pagina vir incompleta.

const PAGINA = 1000;

interface RespostaPagina<T> {
  data: T[] | null;
  error: { message: string } | null;
}

/**
 * Roda `montarPagina` em blocos de 1000 ate acabar e devolve tudo junto.
 *
 * A query montada precisa de ORDEM ESTAVEL (desempate por uma coluna unica,
 * tipo `id`), senao linhas se repetem ou somem entre as paginas.
 */
export async function buscarPaginado<T>(
  montarPagina: (inicio: number, fim: number) => PromiseLike<RespostaPagina<T>>,
): Promise<T[]> {
  const tudo: T[] = [];
  for (let inicio = 0; ; inicio += PAGINA) {
    const { data, error } = await montarPagina(inicio, inicio + PAGINA - 1);
    if (error) throw error;
    const pagina = data ?? [];
    tudo.push(...pagina);
    if (pagina.length < PAGINA) return tudo;
  }
}

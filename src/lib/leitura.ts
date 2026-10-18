// Túnel único das leituras onde ERRO não pode passar por VAZIO.
//
// Por que existe: a lista de regressões do CLAUDE.md abre com "falha de query
// engolida virando 'não existe' (error ignorado ≠ resultado vazio)". O padrão
// que produz isso é uma linha só:
//
//   const { data } = await supabase.from("tarefas").select("id")…   // sem error
//
// Quando a consulta falha, `data` vem `null`. Quem lê isso como "não achei"
// toma o caminho errado sem que nada apareça na tela. Dois exemplos reais, em
// `src/lib/tarefas/aplicador.ts` até 27/09:
//
//   · a trava anti-duplicação (`correnteJa`) NÃO disparava, e o template era
//     aplicado duas vezes — a proteção desaparecia em silêncio;
//   · o mapa de executores (`internos`) nascia vazio, e toda tarefa ia para o
//     responsável de fallback em vez de quem devia executar.
//
// Aqui a distinção é estrutural, não disciplinar: erro ESTOURA (com o contexto
// no texto, para o toast dizer algo útil), e vazio é vazio.
//
// Para lista longa que precisa de todas as páginas, use `buscarPaginado`
// (src/lib/supabase-paginado.ts) — ele resolve o corte de 1.000 do PostgREST e
// também estoura no erro.

/** O que qualquer consulta do supabase-js devolve, no mínimo que importa aqui. */
type Resultado<T> = { data: T | null; error: { message: string } | null };

/**
 * Lê uma lista. Erro estoura; consulta sem resultado devolve `[]`.
 *
 * @param consulta a consulta já montada (não precisa de `await`)
 * @param contexto o que se estava lendo, para a mensagem: "tarefas da corrente"
 */
export async function lerLista<T>(
  consulta: PromiseLike<Resultado<T[]>>,
  contexto: string,
): Promise<T[]> {
  const { data, error } = await consulta;
  if (error) throw new Error(`${contexto}: ${error.message}`);
  return data ?? [];
}

/**
 * Lê no máximo uma linha. Erro estoura; `null` significa mesmo "não existe".
 *
 * Use com `.maybeSingle()`. Com `.single()` o supabase já trata ausência como
 * erro, e aí o `null` nunca aparece.
 */
export async function lerUm<T>(
  consulta: PromiseLike<Resultado<T>>,
  contexto: string,
): Promise<T | null> {
  const { data, error } = await consulta;
  if (error) throw new Error(`${contexto}: ${error.message}`);
  return data ?? null;
}

/**
 * Lê uma contagem (`{ count: "exact", head: true }`). Erro estoura; sem linhas
 * devolve 0.
 *
 * Contagem é o caso mais traiçoeiro: `count` vem `null` no erro, e
 * `count ?? 0` transforma falha em "nenhum" — que é exatamente o que decide
 * "pode criar de novo".
 */
export async function lerContagem(
  consulta: PromiseLike<{ count: number | null; error: { message: string } | null }>,
  contexto: string,
): Promise<number> {
  const { count, error } = await consulta;
  if (error) throw new Error(`${contexto}: ${error.message}`);
  return count ?? 0;
}

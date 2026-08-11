// Destinatário da conversa: constante e regra de sugestão.
//
// Vive fora do componente porque o fast-refresh do Vite só funciona quando um
// arquivo exporta apenas componentes — e estas duas coisas são usadas também
// pela tela do caso.

/** Valor do seletor que representa "todo mundo". No banco vira NULL. */
export const DESTINATARIO_TODOS = "__todos__";

/**
 * Sugere o destinatário: a última pessoa da equipe que escreveu neste caso.
 * É o palpite certo na maioria das vezes — a conversa já está correndo com ela.
 * Sem ninguém da equipe no histórico, devolve Todos.
 */
export function sugerirDestinatario(
  comentarios: Array<{
    autor?: { id?: string; tipo?: string } | null;
    created_at: string;
  }>,
): string {
  let melhor: { id: string; quando: number } | null = null;
  for (const c of comentarios) {
    if (c.autor?.tipo !== "interno" || !c.autor?.id) continue;
    const t = new Date(c.created_at).getTime();
    if (!melhor || t > melhor.quando) melhor = { id: c.autor.id, quando: t };
  }
  return melhor ? melhor.id : DESTINATARIO_TODOS;
}

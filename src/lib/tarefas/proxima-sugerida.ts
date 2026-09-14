// Próxima tarefa sugerida pela IA ao concluir uma tarefa (card #306).
// A sugestão só PREENCHE o formulário de nova tarefa: nada é criado sem a
// pessoa conferir e salvar. Ver supabase/functions/sugerir-proxima-tarefa.

import { supabase } from "@/lib/supabase";
import type { TarefaTipo } from "@/lib/tarefas/types";

export interface SugestaoProximaTarefa {
  titulo: string;
  descricao: string | null;
  tipo: TarefaTipo;
  prioridade: number;
  due_at: string | null;
  responsavel_id: string | null;
  responsavel_nome: string | null;
  processo_admin_id: string | null;
  processo_judicial_id: string | null;
}

export interface ResultadoSugestao {
  sugestao: SugestaoProximaTarefa | null;
  motivo: string | null;
}

// O popup não pode ficar girando pra sempre se a função não responder (a edge
// corta a IA em 25s; a folga cobre o cold start).
const TIMEOUT_MS = 35_000;

/**
 * Nunca lança: falha vira `sugestao: null` com um motivo legível.
 *
 * O timeout e o `signal` vão pro próprio invoke: a requisição é abortada de
 * verdade (fechar o popup cancela) e nenhum timer fica pendurado depois.
 */
export async function sugerirProximaTarefa(
  tarefaId: string,
  signal?: AbortSignal,
): Promise<ResultadoSugestao> {
  const { data, error } = await supabase.functions.invoke<Partial<ResultadoSugestao>>(
    "sugerir-proxima-tarefa",
    { body: { tarefa_id: tarefaId }, timeout: TIMEOUT_MS, signal },
  );
  if (error) {
    // Cancelado por quem chamou não é falha: ninguém vai ler a resposta.
    if (!signal?.aborted) console.error("sugerir-proxima-tarefa:", error);
    return { sugestao: null, motivo: "Não consegui falar com a IA agora." };
  }
  return { sugestao: data?.sugestao ?? null, motivo: data?.motivo ?? null };
}

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

// O popup não pode ficar girando pra sempre se a função não responder.
const TIMEOUT_MS = 35_000;

/** Nunca lança: falha vira `sugestao: null` com um motivo legível. */
export async function sugerirProximaTarefa(tarefaId: string): Promise<ResultadoSugestao> {
  try {
    const chamada = supabase.functions.invoke("sugerir-proxima-tarefa", {
      body: { tarefa_id: tarefaId },
    });
    const limite = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("timeout")), TIMEOUT_MS),
    );
    const { data, error } = await Promise.race([chamada, limite]);
    if (error) throw error;
    const r = data as Partial<ResultadoSugestao> | null;
    return { sugestao: r?.sugestao ?? null, motivo: r?.motivo ?? null };
  } catch (err) {
    console.error("sugerir-proxima-tarefa:", err);
    return { sugestao: null, motivo: "Não consegui falar com a IA agora." };
  }
}

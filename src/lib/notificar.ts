import { supabase } from "@/lib/supabase";

// Cria uma notificacao para o sino do INTERNO a partir de uma acao do parceiro
// (comentario, documento enviado, caso novo). Fire-and-forget: nunca bloqueia a
// UI nem mostra erro ao usuario (RLS permite o parceiro inserir para os casos
// dele; SELECT continua so do interno). Inserimos SEM .select() porque o
// parceiro nao pode ler a propria notificacao de volta.
export async function notificarEquipe(n: {
  tipo: "comentario" | "documento" | "caso" | "solicitacao";
  titulo: string;
  descricao?: string | null;
  caso_id: string;
  cliente_id?: string | null;
  foco_id?: string | null;
}): Promise<void> {
  try {
    const { error } = await supabase.from("notificacoes").insert({
      tipo: n.tipo,
      titulo: n.titulo,
      descricao: n.descricao ?? null,
      caso_id: n.caso_id,
      cliente_id: n.cliente_id ?? null,
      metadata: n.foco_id ? { foco_id: n.foco_id } : null,
    });
    if (error) console.warn("notificarEquipe:", error.message);
  } catch (e) {
    console.warn("notificarEquipe falhou", e);
  }
}

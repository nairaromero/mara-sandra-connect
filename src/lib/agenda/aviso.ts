// Aviso de perícia/audiência ao parceiro — envio DIRETO (sem a antiga fila
// /a-enviar). O texto padrão vem das mesmas funções SQL que os triggers usam
// (pericia_draft_texto / audiencia_draft_texto), então UI e banco nunca
// divergem. Enviar = comentário do caso (rascunho=false) + e-mail via
// notify-novo-comentario; o trigger do banco registra o andamento
// "Parceiro comunicado…" visível ao parceiro.

import { supabase } from "@/lib/supabase";
import type { AgendaTipo } from "@/lib/agenda/types";

export interface DadosAvisoEvento {
  tipo: AgendaTipo; // só pericia | audiencia geram aviso
  natureza: "admin" | "judicial";
  cliente: string;
  servico: string;
  startIso: string | null;
  local: string | null;
}

/** Texto padrão do aviso, gerado pelas funções SQL (fonte única). */
export async function montarTextoAvisoEvento(d: DadosAvisoEvento): Promise<string> {
  if (d.tipo === "audiencia") {
    const { data, error } = await supabase.rpc("audiencia_draft_texto", {
      p_cliente: d.cliente,
      p_quando: d.startIso,
      p_local: d.local,
    });
    if (error) throw error;
    return (data as string) ?? "";
  }
  const { data, error } = await supabase.rpc("pericia_draft_texto", {
    p_natureza: d.natureza,
    p_cliente: d.cliente,
    p_servico: d.servico,
    p_protocolo: null,
    p_quando: d.startIso,
    p_local: d.local,
    p_endereco: null,
  });
  if (error) throw error;
  return (data as string) ?? "";
}

export interface EnviarAvisoInput {
  casoId: string;
  eventoId: string | null; // null: aviso avulso (nasceu de publicação, sem evento)
  tipoAviso: "pericia_aviso" | "audiencia_aviso";
  texto: string;
  autorId: string | null;
}

/**
 * Envia o aviso: comentário já-enviado + e-mail (fire-and-forget). Lança se o
 * comentário falhar; o e-mail nunca bloqueia (padrão do app).
 */
export async function enviarAvisoEvento(input: EnviarAvisoInput): Promise<string> {
  const { data, error } = await supabase
    .from("comentarios")
    .insert({
      caso_id: input.casoId,
      autor_id: input.autorId,
      texto: input.texto,
      rascunho: false,
      evento_id: input.eventoId,
      tipo_aviso: input.tipoAviso,
    })
    .select("id")
    .single();
  if (error) throw error;

  supabase.functions
    .invoke("notify-novo-comentario", { body: { comentario_id: data.id } })
    .then((r) => {
      if (r.error) console.warn("notify-novo-comentario:", r.error);
    });

  return data.id as string;
}

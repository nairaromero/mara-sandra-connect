// Envio do aviso ao parceiro DENTRO da tarefa — o herdeiro da antiga fila
// /a-enviar. Aparece quando tarefa.metadata.enviar_aviso existe (tarefa criada
// pelo trigger: evento agendado sem aviso direto, ou publicação/andamento com
// "perícia marcada"/"audiência designada").
//
// Enviar = comentário do caso (rascunho=false, e-mail via
// notify-novo-comentario) + a tarefa é concluída. Quando o aviso veio de uma
// publicação (sem evento), o comentário sai sem evento_id — o registro é a
// própria conversa do caso.

import { useState } from "react";
import { toast } from "sonner";
import { Loader2, Send } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/lib/supabase";
import { enviarAvisoEvento } from "@/lib/agenda/aviso";
import { useAuth } from "@/hooks/use-auth";
import type { TarefaComJoins } from "@/lib/tarefas/types";

export interface MetaEnviarAviso {
  tipo_aviso: "pericia_aviso" | "audiencia_aviso";
  evento_id: string | null;
  texto: string;
  origem_andamento_id?: string;
}

interface Props {
  tarefa: TarefaComJoins;
  onUpdated: () => void;
  compacto?: boolean;
  stopPropagation?: boolean;
}

export function EnviarAvisoParceiro({
  tarefa,
  onUpdated,
  compacto = false,
  stopPropagation = false,
}: Props) {
  const meta = (tarefa.metadata as { enviar_aviso?: MetaEnviarAviso } | null)?.enviar_aviso;
  const { usuario } = useAuth();
  const [texto, setTexto] = useState(meta?.texto ?? "");
  const [enviando, setEnviando] = useState(false);

  if (!meta || !tarefa.caso_id) return null;
  if (tarefa.status === "feito" || tarefa.status === "cancelado") return null;

  const rotulo = meta.tipo_aviso === "audiencia_aviso" ? "audiência" : "perícia";

  async function enviar() {
    if (enviando) return;
    if (!texto.trim()) {
      toast.error("O texto do aviso está vazio.");
      return;
    }
    // Lacunas (_____) são o sinal de texto não revisado — típico de aviso que
    // nasceu de publicação, sem data/local estruturados.
    if (texto.includes("_____")) {
      const ok = window.confirm(
        "O texto ainda tem lacunas (_____). Enviar mesmo assim?",
      );
      if (!ok) return;
    }
    setEnviando(true);
    try {
      await enviarAvisoEvento({
        casoId: tarefa.caso_id!,
        eventoId: meta!.evento_id ?? null,
        tipoAviso: meta!.tipo_aviso,
        texto: texto.trim(),
        autorId: usuario?.id ?? null,
      });
      await supabase
        .from("tarefas")
        .update({ status: "feito", completed_at: new Date().toISOString() })
        .eq("id", tarefa.id);
      toast.success(`Aviso da ${rotulo} enviado ao parceiro.`);
      onUpdated();
    } catch (e) {
      const err = e as { message?: string };
      toast.error(err.message || "Não foi possível enviar o aviso.");
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div
      className="space-y-2 rounded-lg border border-dashed border-emerald-400 bg-emerald-50/40 p-3"
      onClick={stopPropagation ? (e) => e.stopPropagation() : undefined}
    >
      <p className="text-sm font-medium text-emerald-900">
        Aviso da {rotulo} ao parceiro — revise e envie
      </p>
      <Textarea
        aria-label="Texto do aviso ao parceiro"
        value={texto}
        onChange={(e) => setTexto(e.target.value)}
        rows={compacto ? 5 : 9}
        className="font-mono text-xs"
      />
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs text-emerald-900/70">
          Sai como comentário do caso, por e-mail ao parceiro, e conclui esta tarefa.
        </p>
        <Button size="sm" onClick={enviar} disabled={enviando}>
          {enviando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          Enviar
        </Button>
      </div>
    </div>
  );
}

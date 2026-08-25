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
import { Loader2, Send, Sparkles } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/lib/supabase";
import { enviarAvisoEvento, type TipoAviso } from "@/lib/agenda/aviso";
import { extrairDePublicacao, preencherLacunasAviso } from "@/lib/agenda/comprovante";
import { useAuth } from "@/hooks/use-auth";
import type { TarefaComJoins } from "@/lib/tarefas/types";

export interface MetaEnviarAviso {
  // Inclui lembretes: rascunho legado migrado da fila pode carregar
  // pericia_lembrete (review #10).
  tipo_aviso: TipoAviso;
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
  const [completando, setCompletando] = useState(false);

  // Aviso nascido de publicação: a IA lê o andamento de origem e preenche as
  // lacunas (_____) do texto — sem apagar o que a pessoa já editou.
  async function completarComIA() {
    if (completando || !meta?.origem_andamento_id) return;
    setCompletando(true);
    try {
      const { data: and } = await supabase
        .from("andamentos")
        .select("titulo, descricao")
        .eq("id", meta.origem_andamento_id)
        .maybeSingle();
      const fonte = [and?.titulo, and?.descricao].filter(Boolean).join("\n");
      if (!fonte.trim()) {
        toast.error("Não achei o texto da publicação de origem.");
        return;
      }
      const campos = await extrairDePublicacao(fonte);
      if (!campos) {
        toast.error("A IA não conseguiu ler a publicação — complete na mão.");
        return;
      }
      setTexto((atual) => preencherLacunasAviso(atual, campos));
      toast.success("Lacunas preenchidas com os dados da publicação — revise antes de enviar.");
    } catch (e) {
      console.error("completar com IA falhou:", e);
      toast.error("Falha ao ler a publicação — complete na mão.");
    } finally {
      setCompletando(false);
    }
  }

  if (!meta || !tarefa.caso_id) return null;
  if (tarefa.status === "feito" || tarefa.status === "cancelado") return null;

  const rotulo = meta.tipo_aviso.startsWith("audiencia") ? "audiência" : "perícia";

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
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <p className="text-xs text-emerald-900/70">
          Sai como comentário do caso, por e-mail ao parceiro, e conclui esta tarefa.
        </p>
        <div className="flex items-center gap-2">
          {meta.origem_andamento_id && (
            <Button
              size="sm"
              variant="outline"
              onClick={completarComIA}
              disabled={completando || enviando}
              title="A IA lê a publicação de origem e preenche as lacunas do texto"
            >
              {completando ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Sparkles className="h-4 w-4" />
              )}
              Completar com IA
            </Button>
          )}
          <Button size="sm" onClick={enviar} disabled={enviando || completando}>
            {enviando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            Enviar
          </Button>
        </div>
      </div>
    </div>
  );
}

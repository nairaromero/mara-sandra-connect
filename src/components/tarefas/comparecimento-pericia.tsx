// Confirmação de comparecimento à perícia — dois desfechos, um clique cada.
//
// Aparece dentro do TarefaSheet/TarefaCard quando
// tarefa.metadata.confirmar_comparecimento === true.
//
//  "Compareceu"      → andamento + garante o acompanhamento do resultado
//                      (a tarefa de conferir de 10 em 10 dias).
//  "Não compareceu"  → andamento + tarefa de análise pro dia seguinte útil,
//                      e exclui (com motivo no log) o acompanhamento do
//                      resultado: não há resultado a esperar de perícia que
//                      não aconteceu.
//
// Os dois gravam andamento contando o que houve, visível ao parceiro — foi
// ele quem confirmou, e é ele quem precisa saber o que vem agora.

import { useState } from "react";
import { toast } from "sonner";
import { CheckCircle2, Loader2, UserCheck, UserX } from "lucide-react";

import { Button } from "@/components/ui/button";
import { supabase } from "@/lib/supabase";
import type { TarefaComJoins } from "@/lib/tarefas/types";
import { excluirTarefaComMotivo } from "@/lib/tarefas/queries";
import { useDestaque } from "@/lib/destaque/destaque-context";
import { proximoDiaUtil } from "@/lib/agenda/helpers";

const DIAS_ATE_PRIMEIRA_CONFERENCIA = 10;

interface Props {
  tarefa: TarefaComJoins;
  onUpdated: () => void;
  compacto?: boolean;
  stopPropagation?: boolean;
}

function fmt(d: Date): string {
  return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" });
}

export function ComparecimentoPericia({
  tarefa,
  onUpdated,
  compacto = false,
  stopPropagation = false,
}: Props) {
  const [agindo, setAgindo] = useState<"sim" | "nao" | null>(null);
  const { marcar: marcarDestaque } = useDestaque();

  const meta = (tarefa.metadata ?? {}) as { pericia_em?: string };
  const cliente = tarefa.caso?.cliente?.nome ?? "o cliente";

  async function registrar(compareceu: boolean) {
    if (agindo) return;
    setAgindo(compareceu ? "sim" : "nao");
    try {
      const agora = new Date();

      // 1) Andamento contando o que aconteceu.
      if (tarefa.caso_id) {
        const { data: and, error } = await supabase
          .from("andamentos")
          .insert({
            caso_id: tarefa.caso_id,
            processo_admin_id: tarefa.processo_admin_id,
            processo_judicial_id: tarefa.processo_judicial_id,
            origem: "interno",
            titulo: compareceu
              ? "Cliente compareceu à perícia"
              : "Cliente NÃO compareceu à perícia",
            descricao: compareceu
              ? `Compareceu à perícia conforme confirmado pelo parceiro em ${fmt(agora)}. ` +
                "Agora aguardamos o resultado."
              : `Não compareceu à perícia, conforme confirmado pelo parceiro em ${fmt(agora)}. ` +
                "Foi aberta tarefa para analisar os próximos passos.",
            data_evento: agora.toISOString(),
            visivel_parceiro: true,
            metadata: {
              comparecimento_pericia: compareceu,
              tarefa_id: tarefa.id,
            },
          })
          .select("id")
          .single();
        if (error) throw error;
        marcarDestaque(and.id as string);
        supabase.functions
          .invoke("notify-novo-andamento", { body: { andamento_id: and.id } })
          .catch(() => {});
      }

      // 2) Consequência.
      if (tarefa.caso_id) {
        const { data: acomp } = await supabase
          .from("tarefas")
          .select("id, status")
          .eq("caso_id", tarefa.caso_id)
          .eq("metadata->>acompanhamento_pericia", "true")
          .in("status", ["a_fazer", "fazendo"]);

        if (compareceu) {
          // Garante que o acompanhamento do resultado existe.
          if (!acomp || acomp.length === 0) {
            const due = proximoDiaUtil(
              new Date(Date.now() + DIAS_ATE_PRIMEIRA_CONFERENCIA * 86400_000),
            );
            await supabase.from("tarefas").insert({
              caso_id: tarefa.caso_id,
              processo_admin_id: tarefa.processo_admin_id,
              processo_judicial_id: tarefa.processo_judicial_id,
              responsavel_id: tarefa.responsavel_id,
              tipo: "contato_cliente",
              status: "a_fazer",
              prioridade: 2,
              titulo: `Conferir resultado da perícia - ${cliente}`,
              descricao:
                "Conferir se o resultado da perícia saiu. Se ainda não saiu, use o botão para reagendar a próxima conferência em 10 dias.",
              due_at: due.toISOString(),
              origem: "pericia_acompanhamento",
              metadata: {
                acompanhamento_pericia: true,
                ...(meta.pericia_em ? { pericia_em: meta.pericia_em } : {}),
                criado_por_comparecimento: tarefa.id,
              },
            });
          }
        } else {
          // Perícia que não aconteceu não tem resultado a esperar: exclui o
          // acompanhamento com motivo (fica no log de exclusões). 'cancelado'
          // saiu da UI — não criar novas linhas nesse status.
          for (const a of acomp ?? []) {
            await excluirTarefaComMotivo(
              a.id,
              "Perícia não realizada — acompanhamento do resultado sem efeito.",
            );
          }
          const amanha = proximoDiaUtil(new Date(Date.now() + 86400_000));
          amanha.setHours(9, 0, 0, 0);
          await supabase.from("tarefas").insert({
            caso_id: tarefa.caso_id,
            processo_admin_id: tarefa.processo_admin_id,
            processo_judicial_id: tarefa.processo_judicial_id,
            responsavel_id: tarefa.responsavel_id,
            tipo: "interna",
            status: "a_fazer",
            prioridade: 1,
            titulo: `Analisar não comparecimento à perícia - ${cliente}`,
            descricao:
              "O cliente não compareceu à perícia. Analisar o motivo e definir os próximos passos (remarcação, justificativa ou outra providência).",
            due_at: amanha.toISOString(),
            origem: "pericia_acompanhamento",
            metadata: {
              nao_comparecimento_pericia: true,
              tarefa_origem: tarefa.id,
              ...(meta.pericia_em ? { pericia_em: meta.pericia_em } : {}),
            },
          });
        }
      }

      // 3) A tarefa de confirmação cumpriu seu papel.
      const { error: errT } = await supabase
        .from("tarefas")
        .update({
          status: "feito",
          completed_at: agora.toISOString(),
          metadata: {
            ...(tarefa.metadata ?? {}),
            compareceu,
            confirmado_em: agora.toISOString(),
          },
        })
        .eq("id", tarefa.id);
      if (errT) throw errT;

      toast.success(
        compareceu
          ? "Comparecimento registrado. Acompanhamento do resultado em andamento."
          : "Não comparecimento registrado. Tarefa de análise criada para amanhã.",
      );
      onUpdated();
    } catch (err) {
      const e = err as { message?: string };
      toast.error(e.message || "Não foi possível registrar.");
    } finally {
      setAgindo(null);
    }
  }

  if (tarefa.status === "feito") {
    const m = (tarefa.metadata ?? {}) as { compareceu?: boolean };
    if (m.compareceu === undefined) return null;
    return (
      <p className="text-xs text-muted-foreground flex items-center gap-1">
        <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
        {m.compareceu ? "Compareceu." : "Não compareceu."}
      </p>
    );
  }

  return (
    <div
      className={
        (compacto ? "space-y-1.5" : "space-y-2 rounded-md border p-3 bg-muted/20") +
        " text-sm"
      }
      onClick={stopPropagation ? (e) => e.stopPropagation() : undefined}
    >
      {!compacto && (
        <div className="font-medium">O cliente compareceu à perícia?</div>
      )}
      <div className="flex flex-wrap gap-2">
        <Button size="sm" disabled={agindo !== null} onClick={() => registrar(true)}>
          {agindo === "sim" ? (
            <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
          ) : (
            <UserCheck className="h-3.5 w-3.5 mr-1" />
          )}
          Compareceu
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={agindo !== null}
          onClick={() => registrar(false)}
        >
          {agindo === "nao" ? (
            <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
          ) : (
            <UserX className="h-3.5 w-3.5 mr-1" />
          )}
          Não compareceu
        </Button>
      </div>
      {!compacto && (
        <p className="text-xs text-muted-foreground">
          Compareceu: começa a conferência do resultado, de 10 em 10 dias. Não
          compareceu: abre análise para amanhã e encerra a espera do resultado.
          Os dois registram andamento visível ao parceiro.
        </p>
      )}
    </div>
  );
}

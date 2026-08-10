// Acompanhamento da implantação do benefício concedido.
//
// Aparece dentro do TarefaSheet/TarefaCard quando
// tarefa.metadata.acompanhamento_implementacao === true.
//
// Benefício concedido não é benefício pago: entre a concessão e a entrada em
// folha existe um vão que ninguém vigiava. A tarefa fica voltando até alguém
// confirmar a implantação.
//
// Cadência em dias ÚTEIS, definida pelo processo vinculado à tarefa:
//   administrativo →  5 dias úteis
//   judicial       → 15 dias úteis
// Sem processo vinculado assume administrativo — o template nasce de e-mail do
// INSS, que é sempre administrativo.
//
// Dois botões:
//  - "Ainda não implantado" → registra a conferência, cria andamento INTERNO
//    (são muitas checagens; pro parceiro viraria spam) e empurra o prazo.
//  - "Benefício implantado" → encerra a tarefa e cria andamento VISÍVEL ao
//    parceiro, que é a notícia que ele espera.
//
// O escalonamento (ADM 30/60/90, judicial 60/120) NÃO mora aqui: é um job
// diário no banco. Se ninguém clicar em nada, o alerta nasce do mesmo jeito —
// é a diferença entre um lembrete e um controle de prazo.

import { useState } from "react";
import { toast } from "sonner";
import { BadgeCheck, CheckCircle2, Clock, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/lib/supabase";
import type { TarefaComJoins } from "@/lib/tarefas/types";
import { useDestaque } from "@/lib/destaque/destaque-context";

const DIAS_UTEIS_ADM = 5;
const DIAS_UTEIS_JUDICIAL = 15;

interface Props {
  tarefa: TarefaComJoins;
  onUpdated: () => void;
  compacto?: boolean;
  stopPropagation?: boolean;
}

function fmt(d: Date): string {
  return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" });
}

/**
 * Soma dias ÚTEIS: sábado e domingo não contam. Mesma convenção da véspera do
 * guichê — feriado não entra, o sistema não tem calendário deles.
 */
function somarDiasUteis(base: Date, n: number): Date {
  const d = new Date(base);
  let i = 0;
  while (i < n) {
    d.setDate(d.getDate() + 1);
    const dow = d.getDay();
    if (dow !== 0 && dow !== 6) i++;
  }
  return d;
}

export function AcompanhamentoImplementacao({
  tarefa,
  onUpdated,
  compacto = false,
  stopPropagation = false,
}: Props) {
  const meta = (tarefa.metadata ?? {}) as {
    concedido_em?: string;
    conferencias_implementacao?: string[];
  };
  const conferencias = meta.conferencias_implementacao ?? [];
  const concedidoEm = meta.concedido_em ? new Date(meta.concedido_em) : null;
  const diasDesde = concedidoEm
    ? Math.floor((Date.now() - concedidoEm.getTime()) / 86400_000)
    : null;

  // A via é a do processo vinculado à tarefa — é assim que a equipe escolhe a
  // cadência: basta apontar a tarefa pro processo certo.
  const ehJudicial = !!tarefa.processo_judicial_id;
  const cadencia = ehJudicial ? DIAS_UTEIS_JUDICIAL : DIAS_UTEIS_ADM;

  const [agindo, setAgindo] = useState<"pendente" | "implantado" | null>(null);
  const { marcar: marcarDestaque } = useDestaque();

  async function registrar(implantado: boolean) {
    if (agindo) return;
    setAgindo(implantado ? "implantado" : "pendente");
    try {
      const agora = new Date();
      const proxima = somarDiasUteis(agora, cadencia);

      if (tarefa.caso_id) {
        const { data: and, error } = await supabase
          .from("andamentos")
          .insert({
            caso_id: tarefa.caso_id,
            processo_admin_id: tarefa.processo_admin_id,
            processo_judicial_id: tarefa.processo_judicial_id,
            origem: "interno",
            titulo: implantado
              ? `Benefício implantado — ${fmt(agora)}`
              : `Conferência: benefício ainda não implantado — ${fmt(agora)}`,
            descricao: implantado
              ? "Benefício entrou em folha; acompanhamento de implementação encerrado."
              : `Conferido em ${fmt(agora)}. Próxima conferência em ${cadencia} dias úteis (${fmt(proxima)}).`,
            data_evento: agora.toISOString(),
            // Só a notícia boa vai pro parceiro. As conferências sem novidade
            // são ruído pra quem está do lado de fora.
            visivel_parceiro: implantado,
            metadata: {
              acompanhamento_implementacao: true,
              implantado,
              via: ehJudicial ? "judicial" : "admin",
              tarefa_id: tarefa.id,
            },
          })
          .select("id")
          .single();
        if (error) throw error;
        marcarDestaque(and.id as string);
        if (implantado) {
          supabase.functions
            .invoke("notify-novo-andamento", { body: { andamento_id: and.id } })
            .catch(() => {});
        }
      }

      const { error: errT } = await supabase
        .from("tarefas")
        .update({
          status: implantado ? "feito" : tarefa.status,
          completed_at: implantado ? agora.toISOString() : null,
          due_at: implantado ? null : proxima.toISOString(),
          metadata: {
            ...(tarefa.metadata ?? {}),
            conferencias_implementacao: [...conferencias, agora.toISOString()],
            ...(implantado ? { implantado_em: agora.toISOString() } : {}),
          },
        })
        .eq("id", tarefa.id);
      if (errT) throw errT;

      toast.success(
        implantado
          ? "Implantação registrada. Acompanhamento encerrado."
          : `Conferência registrada. Próxima em ${fmt(proxima)}.`,
      );
      onUpdated();
    } catch (err) {
      const e = err as { message?: string };
      toast.error(e.message || "Não foi possível registrar.");
    } finally {
      setAgindo(null);
    }
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
        <div className="flex flex-wrap items-center gap-2">
          <BadgeCheck className="h-4 w-4 text-[var(--gold)]" />
          <span className="font-medium">Implantação do benefício</span>
          <Badge variant="outline" className="font-normal">
            {ehJudicial ? "judicial" : "administrativo"} · {cadencia} dias úteis
          </Badge>
          {diasDesde !== null && (
            <Badge variant="outline" className="font-normal">
              {diasDesde}d desde a concessão
            </Badge>
          )}
          {conferencias.length > 0 && (
            <Badge variant="outline" className="font-normal">
              {conferencias.length} conferência{conferencias.length > 1 ? "s" : ""}
            </Badge>
          )}
        </div>
      )}

      {tarefa.status === "feito" ? (
        <p className="text-xs text-muted-foreground flex items-center gap-1">
          <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
          Implantação registrada.
        </p>
      ) : (
        <>
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={agindo !== null}
              onClick={() => registrar(false)}
            >
              {agindo === "pendente" ? (
                <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
              ) : (
                <Clock className="h-3.5 w-3.5 mr-1" />
              )}
              Ainda não implantado
            </Button>
            <Button
              size="sm"
              disabled={agindo !== null}
              onClick={() => registrar(true)}
            >
              {agindo === "implantado" ? (
                <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
              ) : (
                <CheckCircle2 className="h-3.5 w-3.5 mr-1" />
              )}
              Benefício implantado
            </Button>
          </div>
          {!compacto && (
            <p className="text-xs text-muted-foreground">
              {ehJudicial
                ? "Processo judicial: conferência a cada 15 dias úteis. Aos 60 e 120 dias da concessão nascem sozinhos os alertas de cumprimento de sentença e execução."
                : "Processo administrativo: conferência a cada 5 dias úteis. Aos 30, 60 e 90 dias da concessão nascem sozinhos os alertas de ouvidoria, mora e via judicial."}
              {!tarefa.processo_admin_id && !tarefa.processo_judicial_id && (
                <>
                  {" "}
                  A tarefa está sem processo vinculado, então segue a cadência
                  administrativa — vincule ao processo judicial para mudar para
                  15 dias úteis.
                </>
              )}
            </p>
          )}
        </>
      )}
    </div>
  );
}

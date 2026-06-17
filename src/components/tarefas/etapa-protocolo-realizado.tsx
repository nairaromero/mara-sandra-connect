// Checklist das tarefas dos templates protocolo / protocolo_inicial /
// protocolo_requerimento. Aparece quando tarefa.metadata.protocolo_realizado
// === true.
//
// Tem uma única etapa: "Protocolo realizado". Quando marcada:
//  1. Cria andamento visível ao parceiro. Texto depende de
//     metadata.via_judicial:
//       - via_judicial=true (protocolo_inicial): "Petição inicial
//         protocolada. Vamos seguir o processo na via judicial."
//       - senão (protocolo / protocolo_requerimento): "Protocolo
//         realizado." (com o título da tarefa como contexto).
//  2. Marca tarefa atual como feita.
//  3. Cria tarefa "Acompanhamento Processual" com
//     metadata.acompanhamento_processual=true (escalonamento
//     30d ouvidoria / 60d peticionamento de mora / 120d ajuizamento).
//     PULA esse passo quando via_judicial=true — o acompanhamento da
//     fase judicial ainda não é gerenciado pelo sistema.
//
// Espelha EtapaCumprimentoExigencia.

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { CheckCircle2, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/lib/supabase";
import type { TarefaComJoins } from "@/lib/tarefas/types";
import { useDestaque } from "@/lib/destaque/destaque-context";

interface Registro {
  feito_em: string;
  andamento_id: string | null;
  tarefa_acompanhamento_id: string | null;
}

interface Props {
  tarefa: TarefaComJoins;
  onUpdated: () => void;
  compacto?: boolean;
  stopPropagation?: boolean;
}

const DIAS_PRIMEIRA_ETAPA_ACOMPANHAMENTO = 30;

export function EtapaProtocoloRealizado({
  tarefa,
  onUpdated,
  compacto = false,
  stopPropagation = false,
}: Props) {
  const metadata = tarefa.metadata as {
    protocolo_realizado_registro?: Registro;
    via_judicial?: boolean;
    template_aplicado?: string;
  };

  const [registro, setRegistro] = useState<Registro | null>(
    metadata?.protocolo_realizado_registro ?? null,
  );
  useEffect(() => {
    const m = tarefa.metadata as { protocolo_realizado_registro?: Registro };
    setRegistro(m?.protocolo_realizado_registro ?? null);
  }, [tarefa.id, tarefa.metadata]);

  const [marcando, setMarcando] = useState(false);
  const { marcar: marcarDestaque } = useDestaque();

  async function realizar() {
    if (marcando || registro) return;
    setMarcando(true);
    try {
      const agora = new Date();
      const template = metadata?.template_aplicado ?? null;
      const viaJudicial = metadata?.via_judicial === true;

      const tituloAnd = viaJudicial
        ? "Petição inicial protocolada — seguiremos pela via judicial"
        : "Protocolo realizado";
      const descAnd = viaJudicial
        ? "Petição inicial protocolada. Vamos seguir o processo na via judicial. " +
          (tarefa.descricao ?? "")
        : `Protocolo realizado. ${tarefa.descricao ?? ""}`.trim();

      // 1) Andamento visível ao parceiro.
      let andamentoId: string | null = null;
      if (tarefa.caso_id) {
        const { data: and, error: errAnd } = await supabase
          .from("andamentos")
          .insert({
            caso_id: tarefa.caso_id,
            processo_admin_id: tarefa.processo_admin_id,
            processo_judicial_id: tarefa.processo_judicial_id,
            origem: "interno",
            titulo: tituloAnd,
            descricao: descAnd,
            data_evento: agora.toISOString(),
            visivel_parceiro: true,
            metadata: {
              etapa: "protocolo_realizado",
              tarefa_id: tarefa.id,
              template_aplicado: template,
              via_judicial: viaJudicial,
            },
          })
          .select("id")
          .single();
        if (errAnd) throw errAnd;
        andamentoId = and.id as string;
        marcarDestaque(andamentoId);
        supabase.functions
          .invoke("notify-novo-andamento", {
            body: { andamento_id: andamentoId },
          })
          .catch(() => {});
      }

      // 2) Cria tarefa "Acompanhamento Processual" com escalonamento 30/60/120.
      // Pula no caso via_judicial=true (protocolo_inicial): o acompanhamento
      // judicial não é gerenciado pelo sistema ainda — só baixa a tarefa
      // atual e gera o andamento.
      let tarefaAcompId: string | null = null;
      if (tarefa.caso_id && !viaJudicial) {
        const dueAt = new Date(
          agora.getTime() + DIAS_PRIMEIRA_ETAPA_ACOMPANHAMENTO * 86400_000,
        ).toISOString();
        const { data: novaT, error: errT } = await supabase
          .from("tarefas")
          .insert({
            caso_id: tarefa.caso_id,
            processo_admin_id: tarefa.processo_admin_id,
            processo_judicial_id: tarefa.processo_judicial_id,
            tipo: "interna",
            prioridade: 2,
            status: "a_fazer",
            titulo: "Acompanhamento Processual",
            descricao:
              "Acompanhar movimentação do processo. Escalonamento: 30d ouvidoria → 60d peticionamento de mora → 120d ajuizamento.",
            due_at: dueAt,
            origem: "manual",
            metadata: {
              origem_tarefa_id: tarefa.id,
              template_aplicado: template,
              acompanhamento_processual: true,
            },
          })
          .select("id")
          .single();
        if (errT) throw errT;
        tarefaAcompId = (novaT as { id: string }).id;
        marcarDestaque(tarefaAcompId);
      }

      // 3) Marca essa tarefa como feita + persiste registro.
      const novoRegistro: Registro = {
        feito_em: agora.toISOString(),
        andamento_id: andamentoId,
        tarefa_acompanhamento_id: tarefaAcompId,
      };
      const { error: errMain } = await supabase
        .from("tarefas")
        .update({
          status: "feito",
          metadata: {
            ...(tarefa.metadata ?? {}),
            protocolo_realizado_registro: novoRegistro,
          },
        })
        .eq("id", tarefa.id);
      if (errMain) throw errMain;

      setRegistro(novoRegistro);
      toast.success(
        viaJudicial
          ? "Petição inicial protocolada. Andamento criado."
          : "Protocolo registrado. Acompanhamento processual criado.",
      );
      onUpdated();
    } catch (e) {
      console.error(e);
      const msg = e instanceof Error ? e.message : "Falha ao marcar etapa.";
      toast.error(msg);
    } finally {
      setMarcando(false);
    }
  }

  const feito = !!registro;
  const viaJudicial = metadata?.via_judicial === true;

  return (
    <div
      className={
        compacto
          ? "space-y-1.5 rounded-md border bg-muted/40 p-2"
          : "space-y-3 rounded-md border bg-muted/30 p-3"
      }
      onClick={stopPropagation ? (e) => e.stopPropagation() : undefined}
    >
      <div className="flex items-center justify-between">
        <div className="min-w-0">
          <div className={compacto ? "text-xs font-medium" : "text-sm font-medium"}>
            {viaJudicial ? "Protocolo de petição inicial" : "Protocolo"}
          </div>
          {!compacto && (
            <div className="text-xs text-muted-foreground">
              {viaJudicial
                ? "Marque ao protocolar a petição inicial — avisa parceiro e dá baixa na tarefa."
                : "Marque ao concluir o protocolo — avisa parceiro e cria acompanhamento processual (30/60/120)."}
            </div>
          )}
        </div>
        <Badge variant="outline" className={compacto ? "font-normal text-[10px] h-5" : "font-normal"}>
          {feito ? "1/1" : "0/1"}
        </Badge>
      </div>

      <div
        className={`flex items-center justify-between gap-2 rounded-md border ${
          compacto ? "p-1.5" : "p-2"
        } bg-card`}
      >
        <div className="flex items-center gap-2 min-w-0">
          {feito ? (
            <CheckCircle2
              className={`${compacto ? "h-3.5 w-3.5" : "h-4 w-4"} text-green-600 shrink-0`}
            />
          ) : (
            <span
              className={`inline-block ${compacto ? "h-3.5 w-3.5" : "h-4 w-4"} rounded-full border shrink-0`}
            />
          )}
          <div className="min-w-0">
            <div className={compacto ? "text-xs font-medium" : "text-sm font-medium"}>
              Protocolo realizado
            </div>
            {feito && registro && (
              <div className={compacto ? "text-[10px] text-muted-foreground" : "text-xs text-muted-foreground"}>
                Feito em {new Date(registro.feito_em).toLocaleDateString("pt-BR")}
              </div>
            )}
          </div>
        </div>
        {!feito && (
          <Button
            size="sm"
            variant="default"
            className={compacto ? "h-6 px-2 text-xs" : ""}
            onClick={(e) => {
              if (stopPropagation) e.stopPropagation();
              realizar();
            }}
            disabled={marcando}
          >
            {marcando ? (
              <Loader2 className={compacto ? "h-3 w-3 animate-spin" : "h-4 w-4 animate-spin"} />
            ) : (
              "Marcar"
            )}
          </Button>
        )}
      </div>
    </div>
  );
}

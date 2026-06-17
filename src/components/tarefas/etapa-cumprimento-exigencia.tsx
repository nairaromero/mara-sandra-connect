// Checklist da tarefa "Documento entregue — cumprir exigência no INSS".
// Aparece quando tarefa.metadata.cumprimento_exigencia === true.
//
// Tem uma única etapa: "Exigência cumprida". Quando marcada:
//  1. Cria andamento visível ao parceiro avisando que cumprimos.
//  2. Marca essa tarefa como feita.
//  3. Marca a tarefa FATAL do mesmo caso/template como feita.
//  4. Cria tarefa "Acompanhamento Processual — aguardando agendamento de
//     perícia" com metadata.acompanhamento_processual=true (mesmo flag do
//     template requerimento_aberto). Assim ela herda o escalonamento
//     30d ouvidoria / 60d peticionamento de mora / 120d ajuizamento via
//     EtapasAcompanhamento.
//
// Mesmo pattern visual do EtapasAcompanhamento (30/60/120) — só que com
// 1 etapa só.

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

// 1ª etapa do EtapasAcompanhamento é ouvidoria em 30d. due_at inicial =
// hoje + 30d pra alinhar com o escalonamento.
const DIAS_PRIMEIRA_ETAPA_ACOMPANHAMENTO = 30;

export function EtapaCumprimentoExigencia({
  tarefa,
  onUpdated,
  compacto = false,
  stopPropagation = false,
}: Props) {
  const metadata = tarefa.metadata as {
    exigencia_cumprida?: Registro;
    template_aplicado?: string;
  };

  const [registro, setRegistro] = useState<Registro | null>(
    metadata?.exigencia_cumprida ?? null,
  );
  useEffect(() => {
    const m = tarefa.metadata as { exigencia_cumprida?: Registro };
    setRegistro(m?.exigencia_cumprida ?? null);
  }, [tarefa.id, tarefa.metadata]);

  const [marcando, setMarcando] = useState(false);
  const { marcar: marcarDestaque } = useDestaque();

  async function cumprir() {
    if (marcando || registro) return;
    setMarcando(true);
    try {
      const agora = new Date();
      const template = metadata?.template_aplicado ?? null;

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
            titulo: "Exigência cumprida no INSS",
            descricao:
              "Cumprimos a exigência junto ao INSS. Iremos acompanhar para agendamento de perícia.",
            data_evento: agora.toISOString(),
            visivel_parceiro: true,
            metadata: {
              etapa: "exigencia_cumprida",
              tarefa_id: tarefa.id,
              template_aplicado: template,
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

      // 2) Fecha a tarefa FATAL do mesmo caso/template.
      if (tarefa.caso_id && template) {
        await supabase
          .from("tarefas")
          .update({ status: "feito" })
          .eq("caso_id", tarefa.caso_id)
          .eq("status", "a_fazer")
          .like("titulo", "FATAL%")
          .filter("metadata->>template_aplicado", "eq", template);
      }

      // 3) Cria tarefa "Acompanhamento Processual - aguardando agendamento de
      // perícia" com acompanhamento_processual=true → ganha escalonamento
      // 30d ouvidoria / 60d peticionamento de mora / 120d ajuizamento via
      // EtapasAcompanhamento. due_at inicial = +30d (próxima etapa: ouvidoria).
      let tarefaAcompId: string | null = null;
      if (tarefa.caso_id) {
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
            titulo:
              "Acompanhamento Processual — aguardando agendamento de perícia",
            descricao:
              "Verificar se o INSS agendou perícia após o cumprimento da exigência. Escalonamento: 30d ouvidoria → 60d peticionamento de mora → 120d ajuizamento.",
            due_at: dueAt,
            origem: "manual",
            metadata: {
              origem_tarefa_id: tarefa.id,
              template_aplicado: template,
              etapa: "aguarda_agendamento_pericia",
              acompanhamento_processual: true,
            },
          })
          .select("id")
          .single();
        if (errT) throw errT;
        tarefaAcompId = (novaT as { id: string }).id;
        marcarDestaque(tarefaAcompId);
      }

      // 4) Marca essa tarefa como feita + persiste registro.
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
            exigencia_cumprida: novoRegistro,
          },
        })
        .eq("id", tarefa.id);
      if (errMain) throw errMain;

      setRegistro(novoRegistro);
      toast.success(
        "Exigência cumprida. Acompanhamento processual criado (30/60/120).",
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
            Cumprimento de exigência
          </div>
          {!compacto && (
            <div className="text-xs text-muted-foreground">
              Marque ao cumprir a exigência no Meu INSS — fecha FATAL, avisa parceiro e cria acompanhamento processual (30/60/120).
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
              Exigência cumprida
            </div>
            {feito && registro && (
              <div className={compacto ? "text-[10px] text-muted-foreground" : "text-xs text-muted-foreground"}>
                Feita em {new Date(registro.feito_em).toLocaleDateString("pt-BR")}
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
              cumprir();
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

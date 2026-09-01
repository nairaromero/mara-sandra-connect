// Desfechos da "Analise de Indeferimento" (meta.analise_indeferimento) — o
// maior gap da auditoria de 2026-09-01: a análise decidia "ajuizar ou não" e
// o template terminava no vazio. Agora a decisão É o botão:
//
//   1. Ajuizar        → abre a corrente "Montagem de inicial" (judicial).
//   2. Recurso adm.   → tarefa "Preparar recurso administrativo" (+5d).
//   3. Não prosseguir → motivo obrigatório vira andamento visível ao parceiro.

import { useState } from "react";
import { toast } from "sonner";
import { CheckCircle2, FileX2, Gavel, Loader2, Undo2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/lib/supabase";
import { aplicarTemplateProgramatico } from "@/lib/tarefas/aplicador";
import { instanteBR, partesBR } from "@/lib/fuso";
import { useAuth } from "@/hooks/use-auth";
import { useDestaque } from "@/lib/destaque/destaque-context";
import type { TarefaComJoins } from "@/lib/tarefas/types";

interface Props {
  tarefa: TarefaComJoins;
  onUpdated: () => void;
  compacto?: boolean;
  stopPropagation?: boolean;
}

function dueDias(dias: number): string {
  const p = partesBR(new Date());
  return new Date(
    instanteBR(p.ano, p.mes, p.dia, 9, 0).getTime() + dias * 86400_000,
  ).toISOString();
}

export function AnaliseIndeferimento({
  tarefa,
  onUpdated,
  compacto = false,
  stopPropagation = false,
}: Props) {
  const { usuario } = useAuth();
  const { marcar: marcarDestaque } = useDestaque();
  const [modo, setModo] = useState<null | "encerrar">(null);
  const [motivo, setMotivo] = useState("");
  const [agindo, setAgindo] = useState(false);

  if (tarefa.status === "feito" || tarefa.status === "cancelado") return null;
  const clienteNome = tarefa.caso?.cliente?.nome ?? "cliente";

  async function concluir() {
    await supabase
      .from("tarefas")
      .update({ status: "feito", completed_at: new Date().toISOString() })
      .eq("id", tarefa.id);
  }

  async function ajuizar() {
    if (agindo || !tarefa.caso_id) return;
    setAgindo(true);
    try {
      const r = await aplicarTemplateProgramatico({
        nomeTemplate: "montagem_inicial",
        casoId: tarefa.caso_id,
        clienteNome,
        responsavelId: tarefa.responsavel_id,
        autorId: usuario?.id ?? null,
      });
      if (r.primeiraTarefaId) marcarDestaque(r.primeiraTarefaId);
      await concluir();
      toast.success("Vamos ajuizar — corrente de montagem da inicial aberta.");
      onUpdated();
    } catch (e) {
      toast.error((e as { message?: string }).message || "Não consegui abrir a montagem.");
    } finally {
      setAgindo(false);
    }
  }

  async function recursoAdm() {
    if (agindo || !tarefa.caso_id) return;
    setAgindo(true);
    try {
      const { data: nova, error } = await supabase
        .from("tarefas")
        .insert({
          caso_id: tarefa.caso_id,
          processo_admin_id: tarefa.processo_admin_id,
          responsavel_id: tarefa.responsavel_id,
          tipo: "prazo",
          prioridade: 1,
          status: "a_fazer",
          titulo: "Preparar recurso administrativo - " + clienteNome,
          descricao:
            "Decisão da análise do indeferimento: recorrer administrativamente. " +
            "Confira o prazo do recurso na carta de indeferimento — o prazo desta " +
            "tarefa é lembrete de segurança.",
          due_at: dueDias(5),
          origem: "manual",
          metadata: { origem_tarefa_id: tarefa.id, recurso_administrativo: true },
        })
        .select("id")
        .single();
      if (error) throw error;
      marcarDestaque(nova.id as string);
      await supabase.from("andamentos").insert({
        caso_id: tarefa.caso_id,
        processo_admin_id: tarefa.processo_admin_id,
        origem: "interno",
        titulo: "Análise do indeferimento — vamos recorrer administrativamente",
        descricao: "Analisamos o indeferimento e vamos apresentar recurso administrativo.",
        data_evento: new Date().toISOString(),
        criado_por: usuario?.id ?? null,
        visivel_parceiro: true,
        metadata: { etapa: "indeferimento_recurso_adm", tarefa_id: tarefa.id },
      });
      await concluir();
      toast.success("Análise concluída — tarefa do recurso administrativo aberta.");
      onUpdated();
    } catch (e) {
      toast.error((e as { message?: string }).message || "Não consegui abrir o recurso.");
    } finally {
      setAgindo(false);
    }
  }

  async function encerrar() {
    if (agindo || !tarefa.caso_id || !motivo.trim()) return;
    setAgindo(true);
    try {
      const { data: and, error } = await supabase
        .from("andamentos")
        .insert({
          caso_id: tarefa.caso_id,
          processo_admin_id: tarefa.processo_admin_id,
          origem: "interno",
          titulo: "Análise do indeferimento — não vamos prosseguir",
          descricao: "Motivo: " + motivo.trim(),
          data_evento: new Date().toISOString(),
          criado_por: usuario?.id ?? null,
          visivel_parceiro: true,
          metadata: { etapa: "indeferimento_encerrado", tarefa_id: tarefa.id },
        })
        .select("id")
        .single();
      if (error) throw error;
      marcarDestaque(and.id as string);
      supabase.functions
        .invoke("notify-novo-andamento", { body: { andamento_id: and.id } })
        .catch(() => {});
      await concluir();
      toast.success("Registrado — motivo visível ao parceiro. Se o caso não segue, arquive-o.");
      onUpdated();
    } catch (e) {
      toast.error((e as { message?: string }).message || "Não consegui registrar.");
    } finally {
      setAgindo(false);
    }
  }

  return (
    <div
      className={
        (compacto ? "space-y-1.5" : "space-y-2 rounded-md border p-3 bg-muted/20") + " text-sm"
      }
      onClick={stopPropagation ? (e) => e.stopPropagation() : undefined}
    >
      {!compacto && (
        <p className="font-medium">Desfecho do indeferimento — e agora?</p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button type="button" size="sm" disabled={agindo} onClick={ajuizar}>
          {agindo ? (
            <Loader2 className="mr-1 h-4 w-4 animate-spin" />
          ) : (
            <Gavel className="mr-1 h-4 w-4" />
          )}
          Ajuizar (montagem de inicial)
        </Button>
        <Button type="button" size="sm" variant="outline" disabled={agindo} onClick={recursoAdm}>
          <Undo2 className="mr-1 h-4 w-4" />
          Recurso administrativo
        </Button>
        <Button
          type="button"
          size="sm"
          variant={modo === "encerrar" ? "default" : "outline"}
          disabled={agindo}
          onClick={() => setModo(modo === "encerrar" ? null : "encerrar")}
        >
          <FileX2 className="mr-1 h-4 w-4" />
          Não prosseguir
        </Button>
      </div>
      {modo === "encerrar" && (
        <div className="space-y-1.5">
          <Label className="text-xs">
            Por que não vamos prosseguir? (vira andamento visível ao parceiro)
          </Label>
          <Textarea
            rows={3}
            value={motivo}
            onChange={(e) => setMotivo(e.target.value)}
            placeholder="Ex.: sem prova material suficiente; reavaliar se surgirem novos documentos."
          />
          <Button type="button" size="sm" disabled={agindo || !motivo.trim()} onClick={encerrar}>
            {agindo ? (
              <Loader2 className="mr-1 h-4 w-4 animate-spin" />
            ) : (
              <CheckCircle2 className="mr-1 h-4 w-4" />
            )}
            Registrar e concluir
          </Button>
        </div>
      )}
    </div>
  );
}

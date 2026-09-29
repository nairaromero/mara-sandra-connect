// Decisões das tarefas com JANELA de prazo (#397, Mara 25/09): a tarefa nasce
// vencendo amanhã e pode ser empurrada até um teto (`metadata.teto_em`, que o
// banco trava). No teto, quem está com a tarefa decide pelos botões:
//
//   AguardandoExigencia  "Aguardando documentos do parceiro" (exigência INSS e
//                        judicial), teto = fatal − 3:
//                          · Pedir dilação de prazo → tarefa da petição, vence
//                            no fatal − 1;
//                          · Não pedir dilação → motivo no histórico interno.
//                        (Documentos que chegam fecham esta tarefa sozinhos —
//                        gatilho da solicitação.)
//   AnaliseDeferimento   Análise de Deferimento, teto = criação + 10:
//                          · Está tudo certo → conclui;
//                          · Entrar com revisão → corrente do requerimento
//                            administrativo (montagem → revisão → protocolo).

import { useState } from "react";
import { toast } from "sonner";
import { CheckCircle2, FileClock, FileX2, Loader2, RotateCcw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/hooks/use-auth";
import { useDestaque } from "@/lib/destaque/destaque-context";
import { dataBR, hojeChaveBR } from "@/lib/fuso";
import { supabase } from "@/lib/supabase";
import { aplicarTemplateProgramatico } from "@/lib/tarefas/aplicador";
import { recuaFimDeSemana, somarDias, venceNoDia } from "@/lib/tarefas/relogio";
import type { TarefaComJoins } from "@/lib/tarefas/types";

interface Props {
  tarefa: TarefaComJoins;
  onUpdated: () => void;
  compacto?: boolean;
  stopPropagation?: boolean;
}

interface MetaJanela {
  teto_em?: string;
  prazo_fatal_em?: string;
  template?: string;
  template_aplicado?: string;
}

/** Conclui a tarefa DEPOIS do efeito; erro sobe (senão um 2º clique duplica). */
async function concluir(id: string) {
  const { error } = await supabase
    .from("tarefas")
    .update({ status: "feito", completed_at: new Date().toISOString() })
    .eq("id", id);
  if (error) {
    throw new Error(
      "A decisão já foi registrada, mas a tarefa não concluiu (" + error.message +
        "). NÃO clique de novo — recarregue a página.",
    );
  }
}

async function andamentoInterno(
  tarefa: TarefaComJoins,
  autorId: string | null,
  titulo: string,
  descricao: string,
  metadata: Record<string, unknown>,
) {
  if (!tarefa.caso_id) return;
  const { error } = await supabase.from("andamentos").insert({
    caso_id: tarefa.caso_id,
    processo_admin_id: tarefa.processo_admin_id,
    processo_judicial_id: tarefa.processo_judicial_id,
    origem: "interno",
    titulo,
    descricao,
    data_evento: new Date().toISOString(),
    criado_por: autorId,
    visivel_parceiro: false,
    metadata: { ...metadata, tarefa_id: tarefa.id },
  });
  // Registro, não pode derrubar a decisão — mas a pessoa precisa saber.
  if (error) {
    toast.warning("Decisão registrada, mas o histórico do caso falhou", {
      description: error.message,
    });
  }
}

function Casca({
  compacto,
  stopPropagation,
  titulo,
  children,
}: {
  compacto: boolean;
  stopPropagation: boolean;
  titulo: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className={(compacto ? "space-y-1.5" : "space-y-2 rounded-md border p-3 bg-muted/20") + " text-sm"}
      onClick={stopPropagation ? (e) => e.stopPropagation() : undefined}
    >
      {!compacto && <p className="font-medium">{titulo}</p>}
      {children}
    </div>
  );
}

// ---------------------------------------------------------------------------

export function AguardandoExigencia({
  tarefa,
  onUpdated,
  compacto = false,
  stopPropagation = false,
}: Props) {
  const { usuario } = useAuth();
  const { marcar: marcarDestaque } = useDestaque();
  const [modo, setModo] = useState<null | "sem_dilacao">(null);
  const [motivo, setMotivo] = useState("");
  const [agindo, setAgindo] = useState(false);

  const meta = (tarefa.metadata ?? {}) as MetaJanela;
  if (tarefa.status !== "a_fazer" || !meta.teto_em) return null;
  // Antes do teto a tarefa só é empurrada; a decisão aparece a partir dele.
  if (hojeChaveBR() < meta.teto_em) {
    return compacto ? null : (
      <p className="text-xs text-muted-foreground">
        Pode ser adiada até {dataBR(meta.teto_em)} (o prazo do parceiro). A partir daí,
        decida aqui se pede dilação de prazo.
      </p>
    );
  }

  const judicial = (meta.template_aplicado ?? meta.template) === "exigencia_judicial";
  const cliente = tarefa.caso?.cliente?.nome ?? "cliente";
  // Petição vence na véspera do fatal (regra da casa: fatal − 1). O banco
  // grava o fatal junto com o teto; sem ele (tarefa anterior a isso), o teto
  // é o limite seguro.
  const fatal = meta.prazo_fatal_em ?? meta.teto_em;
  const venceDilacao = recuaFimDeSemana(somarDias(fatal, -1));

  async function pedirDilacao() {
    if (agindo || !tarefa.caso_id) return;
    setAgindo(true);
    try {
      const { data: nova, error } = await supabase
        .from("tarefas")
        .insert({
          caso_id: tarefa.caso_id,
          processo_admin_id: tarefa.processo_admin_id,
          processo_judicial_id: tarefa.processo_judicial_id,
          responsavel_id: tarefa.responsavel_id,
          tipo: "prazo",
          prioridade: 1,
          status: "a_fazer",
          titulo:
            (judicial ? "Peticionar dilação de prazo - " : "Pedir prorrogação do prazo da exigência ao INSS - ") +
            cliente,
          descricao:
            "Os documentos da exigência não chegaram até o prazo do parceiro. " +
            "Prazo fatal: " + dataBR(fatal) + ".",
          due_at: venceNoDia(venceDilacao),
          origem: "manual",
          metadata: { origem_tarefa_id: tarefa.id, dilacao_prazo: true, prazo_fatal: true, prazo_fatal_em: fatal },
        })
        .select("id")
        .single();
      if (error) throw error;
      marcarDestaque(nova.id as string);
      await andamentoInterno(
        tarefa,
        usuario?.id ?? null,
        "Exigência — vamos pedir dilação de prazo",
        "Os documentos não chegaram até " + dataBR(meta.teto_em!) + ". Fatal em " + dataBR(fatal) + ".",
        { exigencia_dilacao: true },
      );
      await concluir(tarefa.id);
      toast.success("Tarefa da dilação de prazo aberta.");
      onUpdated();
    } catch (e) {
      toast.error((e as { message?: string }).message || "Não consegui abrir a dilação.");
    } finally {
      setAgindo(false);
    }
  }

  async function semDilacao() {
    if (agindo || !motivo.trim()) return;
    setAgindo(true);
    try {
      await andamentoInterno(
        tarefa,
        usuario?.id ?? null,
        "Exigência — sem pedido de dilação",
        "Motivo: " + motivo.trim(),
        { exigencia_sem_dilacao: true },
      );
      await concluir(tarefa.id);
      toast.success("Registrado no histórico do caso.");
      onUpdated();
    } catch (e) {
      toast.error((e as { message?: string }).message || "Não consegui registrar.");
    } finally {
      setAgindo(false);
    }
  }

  return (
    <Casca compacto={compacto} stopPropagation={stopPropagation} titulo="Documentos não chegaram — e agora?">
      <p className="text-xs text-muted-foreground">
        O prazo do parceiro acabou ({dataBR(meta.teto_em)}). Fatal em {dataBR(fatal)}.
      </p>
      <div className="flex flex-wrap gap-2">
        <Button type="button" size="sm" disabled={agindo} onClick={pedirDilacao}>
          {agindo ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <FileClock className="mr-1 h-4 w-4" />}
          Pedir dilação de prazo
        </Button>
        <Button
          type="button"
          size="sm"
          variant={modo === "sem_dilacao" ? "default" : "outline"}
          disabled={agindo}
          onClick={() => setModo(modo === "sem_dilacao" ? null : "sem_dilacao")}
        >
          <FileX2 className="mr-1 h-4 w-4" />
          Não pedir dilação
        </Button>
      </div>
      {modo === "sem_dilacao" && (
        <div className="space-y-1.5">
          <Label className="text-xs">Por quê? (fica no histórico interno do caso)</Label>
          <Textarea
            rows={3}
            value={motivo}
            onChange={(e) => setMotivo(e.target.value)}
            placeholder="Ex.: vamos cumprir com os documentos que já temos."
          />
          <Button type="button" size="sm" disabled={agindo || !motivo.trim()} onClick={semDilacao}>
            {agindo ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <CheckCircle2 className="mr-1 h-4 w-4" />}
            Registrar e concluir
          </Button>
        </div>
      )}
    </Casca>
  );
}

// ---------------------------------------------------------------------------

export function AnaliseDeferimento({
  tarefa,
  onUpdated,
  compacto = false,
  stopPropagation = false,
}: Props) {
  const { usuario } = useAuth();
  const { marcar: marcarDestaque } = useDestaque();
  const [agindo, setAgindo] = useState(false);

  if (tarefa.status !== "a_fazer") return null;
  const cliente = tarefa.caso?.cliente?.nome ?? "cliente";

  async function tudoCerto() {
    if (agindo) return;
    setAgindo(true);
    try {
      await andamentoInterno(
        tarefa,
        usuario?.id ?? null,
        "Análise do deferimento — está tudo certo",
        "Conferimos a concessão: sem motivo para revisão.",
        { analise_deferimento: "ok" },
      );
      await concluir(tarefa.id);
      toast.success("Análise do deferimento concluída.");
      onUpdated();
    } catch (e) {
      toast.error((e as { message?: string }).message || "Não consegui concluir.");
    } finally {
      setAgindo(false);
    }
  }

  async function revisao() {
    if (agindo || !tarefa.caso_id) return;
    setAgindo(true);
    try {
      const r = await aplicarTemplateProgramatico({
        nomeTemplate: "montagem_requerimento_adm",
        casoId: tarefa.caso_id,
        clienteNome: cliente,
        responsavelId: tarefa.responsavel_id,
        autorId: usuario?.id ?? null,
        processoAdminId: tarefa.processo_admin_id,
        processoJudicialId: tarefa.processo_judicial_id,
      });
      if (r.primeiraTarefaId) marcarDestaque(r.primeiraTarefaId);
      await andamentoInterno(
        tarefa,
        usuario?.id ?? null,
        "Análise do deferimento — vamos pedir revisão",
        "A concessão tem ponto a revisar: aberta a corrente do requerimento administrativo.",
        { analise_deferimento: "revisao" },
      );
      await concluir(tarefa.id);
      toast.success("Revisão aberta — corrente do requerimento administrativo.");
      onUpdated();
    } catch (e) {
      toast.error((e as { message?: string }).message || "Não consegui abrir a revisão.");
    } finally {
      setAgindo(false);
    }
  }

  return (
    <Casca compacto={compacto} stopPropagation={stopPropagation} titulo="Desfecho da análise do deferimento">
      <div className="flex flex-wrap gap-2">
        <Button type="button" size="sm" disabled={agindo} onClick={tudoCerto}>
          {agindo ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <CheckCircle2 className="mr-1 h-4 w-4" />}
          Está tudo certo
        </Button>
        <Button type="button" size="sm" variant="outline" disabled={agindo} onClick={revisao}>
          <RotateCcw className="mr-1 h-4 w-4" />
          Entrar com revisão
        </Button>
      </div>
    </Casca>
  );
}

// Desfechos da tarefa "Cliente novo — Analisar" (metadata.etapa =
// 'analise_inicial_parceiro' quando o caso veio de parceiro, ou
// 'analise_inicial_interno' quando é cliente interno do escritório — as duas
// abrem os mesmos botões) — pedido da Naira, 2026-09-01: a análise não
// termina mais num "concluir" mudo; a pessoa ESCOLHE o que acontece:
//
//   1. Fazer o requerimento  → escolhe o responsável e a corrente "Montagem de
//      requerimento (INSS)" abre no nome da pessoa (montagem→revisão→protocolo).
//   2. Aguardar documentação → tarefa de aguardo (+7d) e andamento ao parceiro;
//      a solicitação em si é feita na aba Documentos do caso, como sempre.
//   3. Não há direito agora  → motivo obrigatório, que vira ANDAMENTO visível
//      ao parceiro (a razão fica registrada e comunicada).
//
// Em todos, a tarefa de análise é concluída — sem pop-up genérico: cada botão
// é um desfecho concreto.

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { CheckCircle2, FileClock, FileX2, Loader2, PlayCircle } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { supabase } from "@/lib/supabase";
import { listarInternosAtivos } from "@/lib/tarefas/queries";
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

export function AnaliseCasoNovo({
  tarefa,
  onUpdated,
  compacto = false,
  stopPropagation = false,
}: Props) {
  const { usuario } = useAuth();
  const { marcar: marcarDestaque } = useDestaque();
  const [modo, setModo] = useState<null | "requerimento" | "sem_direito">(null);
  const [responsavelId, setResponsavelId] = useState("");
  const [motivo, setMotivo] = useState("");
  const [internos, setInternos] = useState<
    Array<{ id: string; nome: string | null; email: string | null }>
  >([]);
  const [agindo, setAgindo] = useState(false);

  useEffect(() => {
    if (modo !== "requerimento" || internos.length > 0) return;
    listarInternosAtivos().then(setInternos).catch(() => {});
  }, [modo, internos.length]);

  if (tarefa.status === "feito" || tarefa.status === "cancelado") return null;
  const clienteNome = tarefa.caso?.cliente?.nome ?? "cliente";
  // Cliente interno do escritório não tem parceiro indicador: nada de
  // prometer aviso a quem não existe (Naira, 2026-09-03).
  const temParceiro = !!tarefa.caso?.parceiro_id;

  async function concluirAnalise() {
    // Roda DEPOIS dos efeitos do desfecho (template/tarefa/andamento). Se o
    // update falhar, o erro tem que subir: toast de sucesso com a tarefa ainda
    // aberta convida um segundo clique — que duplica a corrente inteira.
    const { error } = await supabase
      .from("tarefas")
      .update({ status: "feito", completed_at: new Date().toISOString() })
      .eq("id", tarefa.id);
    if (error) {
      throw new Error(
        "O desfecho já foi aplicado, mas a tarefa de análise não concluiu (" +
          error.message +
          "). NÃO clique no desfecho de novo — recarregue a página.",
      );
    }
  }

  async function fazerRequerimento() {
    if (agindo || !tarefa.caso_id || !responsavelId) return;
    setAgindo(true);
    try {
      const r = await aplicarTemplateProgramatico({
        nomeTemplate: "montagem_requerimento_adm",
        casoId: tarefa.caso_id,
        clienteNome,
        responsavelId,
        autorId: usuario?.id ?? null,
      });
      if (r.primeiraTarefaId) marcarDestaque(r.primeiraTarefaId);
      await concluirAnalise();
      toast.success(
        "Análise concluída — corrente de montagem do requerimento aberta pro responsável.",
      );
      onUpdated();
    } catch (e) {
      toast.error((e as { message?: string }).message || "Não consegui abrir o requerimento.");
    } finally {
      setAgindo(false);
    }
  }

  async function aguardarDocumentacao() {
    if (agindo || !tarefa.caso_id) return;
    setAgindo(true);
    try {
      const { data: nova, error } = await supabase
        .from("tarefas")
        .insert({
          caso_id: tarefa.caso_id,
          // Sem responsável a tarefa some de "Minhas tarefas" e vira órfã:
          // herda quem estava na análise, ou quem clicou.
          responsavel_id: tarefa.responsavel_id ?? usuario?.id ?? null,
          tipo: "interna",
          prioridade: 2,
          status: "a_fazer",
          titulo: "Aguardando documentação - " + clienteNome,
          descricao:
            "Análise feita: falta documentação pra montar o requerimento. " +
            (temParceiro
              ? "Solicite os documentos na aba Documentos do caso (o pedido chega ao " +
                "parceiro por lá) e cobre se não chegarem."
              : "Cliente interno do escritório, sem parceiro indicador: peça os " +
                "documentos direto ao cliente e registre na aba Documentos do caso."),
          due_at: dueDias(7),
          origem: "manual",
          metadata: { origem_tarefa_id: tarefa.id, aguardando_documentacao: true },
        })
        .select("id")
        .single();
      if (error) throw error;
      marcarDestaque(nova.id as string);
      // Andamento é registro do caso — erro aqui não pode passar calado (era
      // insert sem checagem: falhava e a análise fechava do mesmo jeito).
      const { data: andAguardo, error: errAnd } = await supabase
        .from("andamentos")
        .insert({
          caso_id: tarefa.caso_id,
          origem: "interno",
          titulo: "Análise concluída — aguardando documentação complementar",
          descricao:
            "Analisamos o caso e precisamos de documentação complementar antes de " +
            "protocolar. A solicitação com a lista chega em seguida.",
          data_evento: new Date().toISOString(),
          criado_por: usuario?.id ?? null,
          visivel_parceiro: true,
          metadata: { etapa: "analise_aguarda_documentacao", tarefa_id: tarefa.id },
        })
        .select("id")
        .single();
      if (errAnd) {
        toast.warning("Tarefa de aguardo criada, mas o registro no histórico falhou", {
          description: errAnd.message,
        });
      } else if (temParceiro) {
        // Os outros desfechos avisam o parceiro por e-mail; este não avisava.
        supabase.functions
          .invoke("notify-novo-andamento", { body: { andamento_id: andAguardo.id } })
          .catch(() => {});
      }
      await concluirAnalise();
      toast.success(
        "Análise concluída — tarefa de aguardo criada. Faça a solicitação na aba Documentos.",
      );
      onUpdated();
    } catch (e) {
      toast.error((e as { message?: string }).message || "Não consegui registrar o aguardo.");
    } finally {
      setAgindo(false);
    }
  }

  async function semDireito() {
    if (agindo || !tarefa.caso_id || !motivo.trim()) return;
    setAgindo(true);
    try {
      const { data: and, error } = await supabase
        .from("andamentos")
        .insert({
          caso_id: tarefa.caso_id,
          origem: "interno",
          titulo: "Análise concluída — não vamos requerer agora",
          descricao: "Motivo: " + motivo.trim(),
          data_evento: new Date().toISOString(),
          criado_por: usuario?.id ?? null,
          visivel_parceiro: true,
          metadata: { etapa: "analise_sem_direito", tarefa_id: tarefa.id },
        })
        .select("id")
        .single();
      if (error) throw error;
      marcarDestaque(and.id as string);
      if (temParceiro) {
        supabase.functions
          .invoke("notify-novo-andamento", { body: { andamento_id: and.id } })
          .catch(() => {});
      }
      await concluirAnalise();
      toast.success(
        temParceiro
          ? "Análise concluída — o motivo virou andamento visível ao parceiro. Se o caso não segue, arquive-o."
          : "Análise concluída — o motivo ficou registrado no histórico do caso. Se o caso não segue, arquive-o.",
      );
      onUpdated();
    } catch (e) {
      toast.error((e as { message?: string }).message || "Não consegui registrar o motivo.");
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
        <p className="font-medium">Desfecho da análise — o que fazemos com o caso?</p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          size="sm"
          variant={modo === "requerimento" ? "default" : "outline"}
          disabled={agindo}
          onClick={() => setModo(modo === "requerimento" ? null : "requerimento")}
        >
          <PlayCircle className="mr-1 h-4 w-4" />
          Fazer o requerimento
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={agindo}
          onClick={aguardarDocumentacao}
        >
          {agindo ? (
            <Loader2 className="mr-1 h-4 w-4 animate-spin" />
          ) : (
            <FileClock className="mr-1 h-4 w-4" />
          )}
          Aguardar documentação
        </Button>
        <Button
          type="button"
          size="sm"
          variant={modo === "sem_direito" ? "default" : "outline"}
          disabled={agindo}
          onClick={() => setModo(modo === "sem_direito" ? null : "sem_direito")}
        >
          <FileX2 className="mr-1 h-4 w-4" />
          Não há direito agora
        </Button>
      </div>

      {modo === "requerimento" && (
        <div className="space-y-1.5">
          <Label className="text-xs">Responsável pela montagem (obrigatório)</Label>
          <Select value={responsavelId} onValueChange={setResponsavelId}>
            <SelectTrigger aria-label="Responsável pela montagem">
              <SelectValue placeholder="Quem monta o requerimento" />
            </SelectTrigger>
            <SelectContent>
              {internos.map((u) => (
                <SelectItem key={u.id} value={u.id}>
                  {u.nome || u.email || u.id}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button type="button" size="sm" disabled={agindo || !responsavelId} onClick={fazerRequerimento}>
            {agindo ? (
              <Loader2 className="mr-1 h-4 w-4 animate-spin" />
            ) : (
              <CheckCircle2 className="mr-1 h-4 w-4" />
            )}
            Abrir corrente de montagem
          </Button>
        </div>
      )}

      {modo === "sem_direito" && (
        <div className="space-y-1.5">
          <Label className="text-xs">
            Por que não vamos entrar agora?{" "}
            {temParceiro
              ? "(vira andamento visível ao parceiro)"
              : "(fica registrado no histórico do caso)"}
          </Label>
          <Textarea
            rows={3}
            value={motivo}
            onChange={(e) => setMotivo(e.target.value)}
            placeholder="Ex.: carência insuficiente — faltam 8 contribuições; reavaliar em 03/2027."
          />
          <Button type="button" size="sm" disabled={agindo || !motivo.trim()} onClick={semDireito}>
            {agindo ? (
              <Loader2 className="mr-1 h-4 w-4 animate-spin" />
            ) : (
              <CheckCircle2 className="mr-1 h-4 w-4" />
            )}
            Registrar e concluir análise
          </Button>
        </div>
      )}
    </div>
  );
}

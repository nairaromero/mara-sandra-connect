// Botões das tarefas do template de audiência (pedido da Naira, 2026-09-13).
//
// Aparece no TarefaSheet/TarefaCard quando acaoAudiencia(tarefa) diz qual:
//
//  "Preparar audiência"
//    - "Cliente instruído" → andamento VISÍVEL ao parceiro contando que o
//      cliente foi orientado para a audiência + conclui a tarefa.
//
//  "Acompanhar ata/sentença"
//    - "Sentença ainda não saiu" → andamento INTERNO da conferência e o prazo
//      volta em 10 dias (mesma cadência da perícia; conferência sem novidade
//      não vai pro parceiro — viraria ruído).
//    - "Sentença saiu" → pede um resumo opcional, grava andamento VISÍVEL ao
//      parceiro + conclui a tarefa.
//
// Os andamentos levam metadata.tipo_aviso: é o sinal que os gatilhos de
// publicação usam pra não tratar comunicação do escritório como publicação
// nova (um resumo com "audiência designada" abriria tarefa de aviso fantasma).

import { useState } from "react";
import { toast } from "sonner";
import { CheckCircle2, Clock, Gavel, Loader2, UserCheck } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/lib/supabase";
import type { TarefaComJoins } from "@/lib/tarefas/types";
import { useDestaque } from "@/lib/destaque/destaque-context";
import { useAuth } from "@/hooks/use-auth";
import { formatarBR } from "@/lib/fuso";
import { foraDoFimDeSemanaBR } from "@/lib/agenda/helpers";

const DIAS_ENTRE_CONFERENCIAS = 10;

interface Props {
  tarefa: TarefaComJoins;
  acao: "preparar" | "sentenca";
  onUpdated: () => void;
  compacto?: boolean;
  stopPropagation?: boolean;
}

const dia = (d: Date | string) =>
  formatarBR(d, { day: "2-digit", month: "2-digit", year: "numeric" });
const hora = (d: Date | string) => formatarBR(d, { hour: "2-digit", minute: "2-digit" });

type Meta = {
  pericia_em?: string;
  evento_id?: string;
  checagens?: string[];
  cliente_instruido_em?: string;
  sentenca_saiu_em?: string;
};

export function AcoesAudiencia({
  tarefa,
  acao,
  onUpdated,
  compacto = false,
  stopPropagation = false,
}: Props) {
  const meta = (tarefa.metadata ?? {}) as Meta;
  const checagens = meta.checagens ?? [];
  const { usuario } = useAuth();
  const { marcar: marcarDestaque } = useDestaque();
  const [agindo, setAgindo] = useState<"instruido" | "ainda_nao" | "saiu" | null>(null);
  const [abrindoSaiu, setAbrindoSaiu] = useState(false);
  const [resumo, setResumo] = useState("");
  // Concluída AGORA: a prop `tarefa` só recarrega quando o pai reabre. Sem isto
  // o botão continuava na tela e um 2º clique avisava o parceiro de novo.
  const [concluidaEm, setConcluidaEm] = useState<string | null>(null);

  // Quando é a audiência: a data gravada na tarefa (pericia_em — nome antigo,
  // serve pra perícia e audiência) ou, na falta, o evento ligado.
  async function quandoAudiencia(): Promise<Date | null> {
    if (meta.pericia_em) return new Date(meta.pericia_em);
    if (!meta.evento_id) return null;
    const { data, error } = await supabase
      .from("agenda_eventos")
      .select("start_at")
      .eq("id", meta.evento_id)
      .maybeSingle();
    if (error) throw error;
    return data?.start_at ? new Date(data.start_at) : null;
  }

  async function gravarAndamento(input: {
    titulo: string;
    descricao: string;
    visivelParceiro: boolean;
    marca: Record<string, unknown>;
  }) {
    if (!tarefa.caso_id) return;
    const { data: and, error } = await supabase
      .from("andamentos")
      .insert({
        caso_id: tarefa.caso_id,
        processo_admin_id: tarefa.processo_admin_id,
        processo_judicial_id: tarefa.processo_judicial_id,
        origem: "interno",
        titulo: input.titulo,
        descricao: input.descricao,
        data_evento: new Date().toISOString(),
        criado_por: usuario?.id ?? null,
        visivel_parceiro: input.visivelParceiro,
        metadata: { ...input.marca, tarefa_id: tarefa.id },
      })
      .select("id")
      .single();
    if (error) throw error;
    marcarDestaque(and.id as string);
    if (input.visivelParceiro) {
      supabase.functions
        .invoke("notify-novo-andamento", { body: { andamento_id: and.id } })
        .catch(() => {});
    }
  }

  // Lê o metadata ATUAL antes de gravar: com o sheet aberto, a prop `tarefa`
  // é a de quando abriu — "ainda não saiu" seguido de "saiu" perderia a
  // primeira conferência do histórico.
  async function atualizarTarefa(
    patch: Record<string, unknown>,
    metadata: (atual: Meta & Record<string, unknown>) => Record<string, unknown>,
  ) {
    const { data: atual, error: errSel } = await supabase
      .from("tarefas")
      .select("metadata")
      .eq("id", tarefa.id)
      .single();
    if (errSel) throw errSel;
    const m = (atual?.metadata ?? {}) as Meta & Record<string, unknown>;
    const { data, error } = await supabase
      .from("tarefas")
      .update({ ...patch, metadata: { ...m, ...metadata(m) } })
      .eq("id", tarefa.id)
      .select("id");
    if (error) throw error;
    // RLS devolve 0 linhas sem erro: sem isto o botão "funcionava" sem gravar.
    if (!data || data.length === 0) throw new Error("A tarefa não foi atualizada.");
  }

  async function clienteInstruido() {
    if (agindo) return;
    setAgindo("instruido");
    try {
      const agora = new Date();
      const quando = await quandoAudiencia();
      const cliente = tarefa.caso?.cliente?.nome ?? "O cliente";
      await gravarAndamento({
        titulo: "Cliente instruído para a audiência",
        descricao:
          `${cliente} foi orientado(a) pelo escritório para a audiência` +
          (quando ? ` de ${dia(quando)} às ${hora(quando)}` : "") +
          ": chegar com antecedência, levar documento oficial com foto e, se houver " +
          `testemunhas, que também cheguem com antecedência. Registrado em ${dia(agora)}.`,
        visivelParceiro: true,
        marca: { tipo_aviso: "audiencia_cliente_instruido", cliente_instruido_audiencia: true },
      });
      await atualizarTarefa({ status: "feito", completed_at: agora.toISOString() }, () => ({
        cliente_instruido_em: agora.toISOString(),
        cliente_instruido_por: usuario?.id ?? null,
      }));
      setConcluidaEm(agora.toISOString());
      toast.success("Cliente instruído — o parceiro foi informado.");
      onUpdated();
    } catch (err) {
      toast.error((err as { message?: string }).message || "Não foi possível registrar.");
    } finally {
      setAgindo(null);
    }
  }

  async function sentencaAindaNaoSaiu() {
    if (agindo) return;
    setAgindo("ainda_nao");
    try {
      const agora = new Date();
      const proxima = foraDoFimDeSemanaBR(
        new Date(agora.getTime() + DIAS_ENTRE_CONFERENCIAS * 86400_000),
        "frente",
      );
      await gravarAndamento({
        titulo: `Conferência: ata/sentença da audiência ainda não saiu — ${dia(agora)}`,
        descricao: `Conferido em ${dia(agora)}. Próxima conferência em ${dia(proxima)}.`,
        visivelParceiro: false,
        marca: { acompanhamento_sentenca_audiencia: true, sentenca_saiu: false },
      });
      await atualizarTarefa({ due_at: proxima.toISOString() }, (m) => ({
        checagens: [...(m.checagens ?? []), agora.toISOString()],
      }));
      toast.success(`Conferência registrada. Próxima em ${dia(proxima)}.`);
      onUpdated();
    } catch (err) {
      toast.error((err as { message?: string }).message || "Não foi possível registrar.");
    } finally {
      setAgindo(null);
    }
  }

  async function sentencaSaiu() {
    if (agindo) return;
    setAgindo("saiu");
    try {
      const agora = new Date();
      const quando = await quandoAudiencia();
      const texto = resumo.trim();
      await gravarAndamento({
        titulo: "Sentença saiu",
        descricao:
          `Saiu a sentença do processo` +
          (quando ? `, referente à audiência de ${dia(quando)}` : "") +
          ` (conferido em ${dia(agora)}).` +
          (texto ? `\n\n${texto}` : "") +
          "\n\nO escritório está analisando os próximos passos.",
        visivelParceiro: true,
        marca: {
          tipo_aviso: "audiencia_sentenca",
          acompanhamento_sentenca_audiencia: true,
          sentenca_saiu: true,
        },
      });
      await atualizarTarefa({ status: "feito", completed_at: agora.toISOString() }, (m) => ({
        checagens: [...(m.checagens ?? []), agora.toISOString()],
        sentenca_saiu_em: agora.toISOString(),
        ...(texto ? { sentenca_resumo: texto } : {}),
      }));
      setConcluidaEm(agora.toISOString());
      toast.success("Sentença registrada — o parceiro foi informado.");
      setAbrindoSaiu(false);
      setResumo("");
      onUpdated();
    } catch (err) {
      toast.error((err as { message?: string }).message || "Não foi possível registrar.");
    } finally {
      setAgindo(null);
    }
  }

  const caixa =
    (compacto ? "space-y-1.5" : "space-y-2 rounded-md border p-3 bg-muted/20") + " text-sm";
  const parar = stopPropagation ? (e: React.MouseEvent) => e.stopPropagation() : undefined;

  if (concluidaEm || tarefa.status === "feito" || tarefa.status === "cancelado") {
    const feito =
      concluidaEm ?? (acao === "preparar" ? meta.cliente_instruido_em : meta.sentenca_saiu_em);
    if (!feito) return null;
    return (
      <p className="text-xs text-muted-foreground flex items-center gap-1">
        <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
        {acao === "preparar" ? "Cliente instruído" : "Sentença saiu"} em {dia(feito)}.
      </p>
    );
  }

  if (acao === "preparar") {
    return (
      <div className={caixa} onClick={parar}>
        {!compacto && <div className="font-medium">O cliente já foi instruído para a audiência?</div>}
        <Button size="sm" disabled={agindo !== null} onClick={clienteInstruido}>
          {agindo === "instruido" ? (
            <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
          ) : (
            <UserCheck className="h-3.5 w-3.5 mr-1" />
          )}
          Cliente instruído
        </Button>
        {!compacto && (
          <p className="text-xs text-muted-foreground">
            Conclui esta tarefa e registra um andamento visível ao parceiro dizendo que o
            cliente foi orientado para a audiência.
          </p>
        )}
      </div>
    );
  }

  return (
    <div className={caixa} onClick={parar}>
      {!compacto && (
        <div className="flex items-center gap-2 font-medium">
          <Gavel className="h-4 w-4 text-[var(--gold)]" />
          A ata/sentença da audiência saiu?
          {checagens.length > 0 && (
            <span className="text-xs font-normal text-muted-foreground">
              · {checagens.length} conferência{checagens.length > 1 ? "s" : ""}
            </span>
          )}
        </div>
      )}
      {!abrindoSaiu ? (
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant="outline"
            disabled={agindo !== null}
            onClick={sentencaAindaNaoSaiu}
          >
            {agindo === "ainda_nao" ? (
              <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
            ) : (
              <Clock className="h-3.5 w-3.5 mr-1" />
            )}
            Sentença ainda não saiu
          </Button>
          <Button size="sm" disabled={agindo !== null} onClick={() => setAbrindoSaiu(true)}>
            <Gavel className="h-3.5 w-3.5 mr-1" />
            Sentença saiu
          </Button>
        </div>
      ) : (
        <div className="space-y-2">
          <Textarea
            aria-label="Resumo da sentença para o parceiro"
            rows={compacto ? 2 : 3}
            value={resumo}
            onChange={(e) => setResumo(e.target.value)}
            placeholder="O que a sentença decidiu (opcional) — vai para o parceiro. Ex.: procedente, concedida a aposentadoria rural desde a DER."
          />
          <div className="flex flex-wrap gap-2">
            <Button size="sm" disabled={agindo !== null} onClick={sentencaSaiu}>
              {agindo === "saiu" ? (
                <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
              ) : (
                <CheckCircle2 className="h-3.5 w-3.5 mr-1" />
              )}
              Registrar e informar o parceiro
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={agindo !== null}
              onClick={() => {
                setAbrindoSaiu(false);
                setResumo("");
              }}
            >
              Cancelar
            </Button>
          </div>
        </div>
      )}
      {!compacto && !abrindoSaiu && (
        <p className="text-xs text-muted-foreground">
          Ainda não saiu: a conferência volta em {DIAS_ENTRE_CONFERENCIAS} dias (fora do fim de
          semana), sem avisar o parceiro. Saiu: conclui a tarefa e informa o parceiro por
          andamento.
        </p>
      )}
    </div>
  );
}

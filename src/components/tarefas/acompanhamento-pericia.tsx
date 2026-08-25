// Acompanhamento do resultado da perícia — checagem de 10 em 10 dias.
//
// Aparece dentro do TarefaSheet/TarefaCard quando
// tarefa.metadata.acompanhamento_pericia === true.
//
// Dois botões:
//  - "Ainda sem resultado" → registra a conferência, cria andamento INTERNO
//    (não vai pro parceiro: são muitas checagens, viraria spam) e empurra o
//    prazo +10 dias. O andamento é vinculado ao processo do caso quando há
//    só um — a tarefa migrada do TI vem sem processo, e sem esse resgate o
//    andamento caía em "Andamentos Gerais", parecendo que nada aconteceu.
//  - "Resultado saiu" → encerra a tarefa e cria andamento VISÍVEL ao parceiro,
//    que é a notícia que ele espera.
//
// O escalonamento (ouvidoria 30d / peticionar 60d / ajuizar 90d) NÃO mora
// aqui: é um job diário no banco. Se ninguém clicar em nada, o alerta nasce
// do mesmo jeito — é a diferença entre um lembrete e um controle de prazo.

import { useState } from "react";
import { toast } from "sonner";
import { CheckCircle2, Clock, Loader2, Stethoscope } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/lib/supabase";
import type { TarefaComJoins } from "@/lib/tarefas/types";
import { useDestaque } from "@/lib/destaque/destaque-context";
import { formatarBR } from "@/lib/fuso";

const DIAS_ENTRE_CHECAGENS = 10;

interface Props {
  tarefa: TarefaComJoins;
  onUpdated: () => void;
  compacto?: boolean;
  stopPropagation?: boolean;
}

function fmt(d: Date): string {
  return formatarBR(d, { day: "2-digit", month: "2-digit", year: "numeric" });
}

export function AcompanhamentoPericia({
  tarefa,
  onUpdated,
  compacto = false,
  stopPropagation = false,
}: Props) {
  const meta = (tarefa.metadata ?? {}) as {
    pericia_em?: string;
    checagens?: string[];
  };
  const checagens = meta.checagens ?? [];
  const periciaEm = meta.pericia_em ? new Date(meta.pericia_em) : null;
  const diasDesde = periciaEm
    ? Math.floor((Date.now() - periciaEm.getTime()) / 86400_000)
    : null;

  const [agindo, setAgindo] = useState<"sem" | "saiu" | null>(null);
  const { marcar: marcarDestaque } = useDestaque();

  // Tarefa migrada do Tramitação Inteligente chega sem processo vinculado, e o
  // andamento herdava esse vazio. Como a tela do caso agrupa andamentos por
  // processo, ele caía sozinho em "Andamentos Gerais" — longe do processo onde
  // a perícia está — e parecia que o clique não tinha feito nada. Quando o caso
  // tem um único processo, não há ambiguidade: vincula nele. Com mais de um,
  // continua sem vínculo (chutar o processo errado é pior que não vincular).
  async function resolverProcesso(): Promise<{
    processo_admin_id: string | null;
    processo_judicial_id: string | null;
  }> {
    if (tarefa.processo_admin_id || tarefa.processo_judicial_id) {
      return {
        processo_admin_id: tarefa.processo_admin_id,
        processo_judicial_id: tarefa.processo_judicial_id,
      };
    }

    const [adm, jud] = await Promise.all([
      supabase.from("processos_admin").select("id").eq("caso_id", tarefa.caso_id!),
      supabase.from("processos_judiciais").select("id").eq("caso_id", tarefa.caso_id!),
    ]);
    const admIds = adm.data ?? [];
    const judIds = jud.data ?? [];

    if (admIds.length === 1 && judIds.length === 0) {
      return { processo_admin_id: admIds[0].id as string, processo_judicial_id: null };
    }
    if (judIds.length === 1 && admIds.length === 0) {
      return { processo_admin_id: null, processo_judicial_id: judIds[0].id as string };
    }
    return { processo_admin_id: null, processo_judicial_id: null };
  }

  async function registrar(saiu: boolean) {
    if (agindo) return;
    setAgindo(saiu ? "saiu" : "sem");
    try {
      const agora = new Date();
      let semVinculo = false;

      if (tarefa.caso_id) {
        const vinculo = await resolverProcesso();
        semVinculo = !vinculo.processo_admin_id && !vinculo.processo_judicial_id;
        const { data: and, error } = await supabase
          .from("andamentos")
          .insert({
            caso_id: tarefa.caso_id,
            processo_admin_id: vinculo.processo_admin_id,
            processo_judicial_id: vinculo.processo_judicial_id,
            origem: "interno",
            titulo: saiu
              ? `Resultado da perícia disponível — ${fmt(agora)}`
              : `Conferência: resultado da perícia ainda não saiu — ${fmt(agora)}`,
            descricao: saiu
              ? "Resultado da perícia saiu; acompanhamento encerrado."
              : `Conferido em ${fmt(agora)}. Próxima conferência em ${DIAS_ENTRE_CHECAGENS} dias.`,
            data_evento: agora.toISOString(),
            // Só a notícia boa vai pro parceiro. As conferências sem novidade
            // são ruído pra quem está do lado de fora.
            visivel_parceiro: saiu,
            metadata: {
              acompanhamento_pericia: true,
              resultado_saiu: saiu,
              tarefa_id: tarefa.id,
            },
          })
          .select("id")
          .single();
        if (error) throw error;
        marcarDestaque(and.id as string);
        if (saiu) {
          supabase.functions
            .invoke("notify-novo-andamento", { body: { andamento_id: and.id } })
            .catch(() => {});
        }
      }

      const novoDue = saiu
        ? null
        : new Date(Date.now() + DIAS_ENTRE_CHECAGENS * 86400_000).toISOString();

      const { error: errT } = await supabase
        .from("tarefas")
        .update({
          status: saiu ? "feito" : tarefa.status,
          completed_at: saiu ? agora.toISOString() : null,
          due_at: novoDue,
          metadata: {
            ...(tarefa.metadata ?? {}),
            checagens: [...checagens, agora.toISOString()],
            ...(saiu ? { resultado_em: agora.toISOString() } : {}),
          },
        })
        .eq("id", tarefa.id);
      if (errT) throw errT;

      toast.success(
        saiu
          ? "Resultado registrado. Acompanhamento encerrado."
          : `Conferência registrada. Próxima em ${DIAS_ENTRE_CHECAGENS} dias.`,
        // Sem vínculo, o andamento não entra no card do processo — dizer onde
        // ele foi parar evita a leitura de que o clique não fez nada.
        semVinculo
          ? {
              description:
                "O andamento ficou em “Andamentos Gerais”: o caso tem mais de um processo, então não dá pra vincular sozinho.",
            }
          : undefined,
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
        <div className="flex items-center gap-2">
          <Stethoscope className="h-4 w-4 text-[var(--gold)]" />
          <span className="font-medium">Resultado da perícia</span>
          {diasDesde !== null && (
            <Badge variant="outline" className="font-normal">
              {diasDesde}d desde a perícia
            </Badge>
          )}
          {checagens.length > 0 && (
            <Badge variant="outline" className="font-normal">
              {checagens.length} conferência{checagens.length > 1 ? "s" : ""}
            </Badge>
          )}
        </div>
      )}

      {tarefa.status === "feito" ? (
        <p className="text-xs text-muted-foreground flex items-center gap-1">
          <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
          Resultado registrado.
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
              {agindo === "sem" ? (
                <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
              ) : (
                <Clock className="h-3.5 w-3.5 mr-1" />
              )}
              Ainda sem resultado
            </Button>
            <Button
              size="sm"
              disabled={agindo !== null}
              onClick={() => registrar(true)}
            >
              {agindo === "saiu" ? (
                <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
              ) : (
                <CheckCircle2 className="h-3.5 w-3.5 mr-1" />
              )}
              Resultado saiu
            </Button>
          </div>
          {!compacto && (
            <p className="text-xs text-muted-foreground">
              Sem resultado, a conferência volta em {DIAS_ENTRE_CHECAGENS} dias.
              Aos 30, 60 e 90 dias da perícia nascem sozinhos os alertas de
              ouvidoria, peticionamento e ajuizamento.
            </p>
          )}
        </>
      )}
    </div>
  );
}

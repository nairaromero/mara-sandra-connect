// Etapas de acompanhamento processual (30d / 60d / 120d).
// Aparece dentro do TarefaSheet quando tarefa.metadata.acompanhamento_processual=true.
//
// Cada etapa é um botão clicável:
//  - Pendente → "Marcar como feito" → cria andamento interno no caso/processo
//    + atualiza tarefa.metadata.etapas.<key> + avança due_at pra próxima etapa.
//  - Feito → mostra "✓ feito em DD/MM" e desabilita.
//
// Quando a última etapa (ajuizamento) é feita, status da tarefa vira "feito".

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { CheckCircle2, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/lib/supabase";
import type { TarefaComJoins } from "@/lib/tarefas/types";

interface EtapaConfig {
  key: "ouvidoria" | "peticionamento_mora" | "ajuizamento";
  rotulo: string;
  cta: string;
  diasDoInicio: number;       // dias desde tarefa.created_at
  proximaEtapa: "peticionamento_mora" | "ajuizamento" | null;
  // Função que gera o título do andamento com a data em que a etapa foi
  // marcada como feita. Quando null, NÃO cria andamento — a Naira que
  // fará o próximo passo manualmente (ex: criar agendamento de audiência
  // após ajuizar).
  tituloAndamento: ((dataFeita: Date) => string) | null;
}

function fmtData(d: Date): string {
  return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" });
}

const ETAPAS: EtapaConfig[] = [
  {
    key: "ouvidoria",
    rotulo: "Ouvidoria (30d)",
    cta: "Marcar ouvidoria como feita",
    diasDoInicio: 30,
    proximaEtapa: "peticionamento_mora",
    tituloAndamento: (d) => `Realizamos ouvidoria ${fmtData(d)}`,
  },
  {
    key: "peticionamento_mora",
    rotulo: "Peticionamento de mora administrativa (60d)",
    cta: "Marcar peticionamento como feito",
    diasDoInicio: 60,
    proximaEtapa: "ajuizamento",
    tituloAndamento: (d) => `Peticionamento por mora administrativa ${fmtData(d)}`,
  },
  {
    key: "ajuizamento",
    rotulo: "Ajuizamento (120d)",
    cta: "Marcar ajuizamento como feito",
    diasDoInicio: 120,
    proximaEtapa: null,
    // Ajuizamento NÃO cria andamento — a pessoa que tá acompanhando
    // criará o próximo agendamento (audiência ou outro) manualmente.
    tituloAndamento: null,
  },
];

interface EtapaRegistro {
  feito_em: string;
  andamento_id: string | null;
}

interface Props {
  tarefa: TarefaComJoins;
  onUpdated: () => void;
  compacto?: boolean;     // se true, layout enxuto pra usar dentro do TarefaCard
  stopPropagation?: boolean;  // pra não burburlar pra o card abrir o sheet
}

export function EtapasAcompanhamento({
  tarefa,
  onUpdated,
  compacto = false,
  stopPropagation = false,
}: Props) {
  // Local state mirror das etapas — atualiza imediatamente no click,
  // antes do refresh do parent. Resolve o "tela criação não atualiza"
  // quando o componente está dentro do sheet.
  const etapasIniciais =
    (tarefa.metadata as { etapas?: Record<string, EtapaRegistro> })?.etapas ??
    {};
  const [etapasState, setEtapasState] =
    useState<Record<string, EtapaRegistro>>(etapasIniciais);
  useEffect(() => {
    setEtapasState(
      (tarefa.metadata as { etapas?: Record<string, EtapaRegistro> })?.etapas ??
        {},
    );
  }, [tarefa.id, tarefa.metadata]);

  const [marcando, setMarcando] = useState<string | null>(null);
  const criadoEm = new Date(tarefa.created_at).getTime();

  async function marcarEtapa(etapa: EtapaConfig) {
    if (marcando) return;
    setMarcando(etapa.key);
    try {
      // 1) Cria andamento interno no caso (e processo, se tiver). Só
      // cria quando a etapa tem tituloAndamento — ajuizamento, por exemplo,
      // não cria andamento aqui (a Naira faz o próximo passo manualmente).
      const agora = new Date();
      let andamentoId: string | null = null;
      if (tarefa.caso_id && etapa.tituloAndamento) {
        const { data: and, error: errAnd } = await supabase
          .from("andamentos")
          .insert({
            caso_id: tarefa.caso_id,
            processo_admin_id: tarefa.processo_admin_id,
            processo_judicial_id: tarefa.processo_judicial_id,
            origem: "interno",
            titulo: etapa.tituloAndamento(agora),
            descricao: `Etapa de acompanhamento processual concluída a partir da tarefa "${tarefa.titulo}".`,
            data_evento: agora.toISOString(),
            visivel_parceiro: false,
            metadata: {
              etapa_processual: etapa.key,
              tarefa_id: tarefa.id,
            },
          })
          .select("id")
          .single();
        if (errAnd) throw errAnd;
        andamentoId = and.id as string;
      }

      // 2) Atualiza tarefa.metadata.etapas + due_at + status.
      const novasEtapas: Record<string, EtapaRegistro> = {
        ...etapasState,
        [etapa.key]: {
          feito_em: agora.toISOString(),
          andamento_id: andamentoId,
        },
      };

      let novoDueAt: string | null = tarefa.due_at;
      let novoStatus = tarefa.status;
      if (etapa.proximaEtapa) {
        // Avança o prazo pra próxima etapa (medido desde a criação da tarefa).
        const prox = ETAPAS.find((e) => e.key === etapa.proximaEtapa);
        if (prox) {
          novoDueAt = new Date(
            criadoEm + prox.diasDoInicio * 86400_000,
          ).toISOString();
        }
      } else {
        // Última etapa: tarefa concluída.
        novoStatus = "feito";
        novoDueAt = null;
      }

      const { error: errTar } = await supabase
        .from("tarefas")
        .update({
          metadata: {
            ...(tarefa.metadata ?? {}),
            etapas: novasEtapas,
          },
          due_at: novoDueAt,
          status: novoStatus,
        })
        .eq("id", tarefa.id);
      if (errTar) throw errTar;

      // Atualiza o local state pra renderizar imediatamente (sem esperar
      // o re-render do parent com fresh data).
      setEtapasState(novasEtapas);

      toast.success(
        etapa.proximaEtapa
          ? `${etapa.rotulo.split(" (")[0]} marcada. Próxima etapa: ${
              ETAPAS.find((e) => e.key === etapa.proximaEtapa)?.rotulo
            }.`
          : `${etapa.rotulo.split(" (")[0]} marcada. Tarefa concluída.`,
      );
      onUpdated();
    } catch (e) {
      console.error(e);
      const msg = e instanceof Error ? e.message : "Falha ao marcar etapa.";
      toast.error(msg);
    } finally {
      setMarcando(null);
    }
  }

  const feitas = Object.keys(etapasState).length;

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
            Etapas de acompanhamento
          </div>
          {!compacto && (
            <div className="text-xs text-muted-foreground">
              Sem movimentação? Escala em 30d (ouvidoria) → 60d (peticionamento de mora) → 120d (ajuizamento).
            </div>
          )}
        </div>
        <Badge variant="outline" className={compacto ? "font-normal text-[10px] h-5" : "font-normal"}>
          {feitas}/{ETAPAS.length}
        </Badge>
      </div>

      <div className={compacto ? "space-y-1" : "space-y-2"}>
        {ETAPAS.map((etapa) => {
          const reg = etapasState[etapa.key];
          const feito = !!reg;
          const proximaPendente =
            !feito && ETAPAS.findIndex((e) => !etapasState[e.key]) ===
              ETAPAS.findIndex((e) => e.key === etapa.key);
          return (
            <div
              key={etapa.key}
              className={`flex items-center justify-between gap-2 rounded-md border ${
                compacto ? "p-1.5" : "p-2"
              } ${feito ? "bg-card" : proximaPendente ? "bg-card" : "bg-muted/50"}`}
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
                    {etapa.rotulo}
                  </div>
                  {feito && reg && (
                    <div className={compacto ? "text-[10px] text-muted-foreground" : "text-xs text-muted-foreground"}>
                      Feita em {new Date(reg.feito_em).toLocaleDateString("pt-BR")}
                    </div>
                  )}
                </div>
              </div>
              {!feito && (
                <Button
                  size={compacto ? "sm" : "sm"}
                  variant={proximaPendente ? "default" : "outline"}
                  className={compacto ? "h-6 px-2 text-xs" : ""}
                  onClick={(e) => {
                    if (stopPropagation) e.stopPropagation();
                    marcarEtapa(etapa);
                  }}
                  disabled={marcando !== null}
                >
                  {marcando === etapa.key ? (
                    <Loader2 className={compacto ? "h-3 w-3 animate-spin" : "h-4 w-4 animate-spin"} />
                  ) : (
                    "Marcar"
                  )}
                </Button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

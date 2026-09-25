// Painel de datas do caso (#397, pedido da Mara): as datas que controlam o
// prazo, sempre à vista no topo do caso — entrada, protocolo administrativo
// (data + nº), indeferimento (data + NB), o relógio até o protocolo judicial
// e os processos judiciais (em andamento ou encerrado).
//
// Situação judicial: quem decide é a equipe (campo `situacao` do processo).
// As movimentações só SUGEREM: "Baixa definitiva" ou "Arquivamento" sem
// desarquivamento depois → "parece encerrado". Trânsito em julgado aparece
// como informação, não como encerramento (ainda vem cumprimento/RPV).

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { CalendarClock, Gavel } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { supabase } from "@/lib/supabase";
import { RelogioDoCaso } from "@/components/tarefas/relogio-prazo";
import { dataBR, diaDoEventoBR } from "@/lib/fuso";
import { buscarRelogiosDoCaso, type RelogioPrazo } from "@/lib/tarefas/relogio";

interface ProcessoAdminDatas {
  id: string;
  numero_requerimento: string | null;
  data_protocolo: string | null;
  decisao: string | null;
  data_decisao: string | null;
  numero_beneficio?: string | null;
  created_at: string;
}

interface ProcessoJudicialDatas {
  id: string;
  numero_processo: string | null;
  vara: string | null;
  comarca: string | null;
  uf: string | null;
  data_distribuicao: string | null;
  situacao?: "em_andamento" | "encerrado";
  encerrado_em?: string | null;
}

/** O que as movimentações dizem de cada processo judicial. */
interface SinalJudicial {
  sugereEncerrado: { titulo: string; dia: string } | null;
  transito: string | null;
}

const RE_ENCERRA = /baixa definitiva|arquivamento|arquivado/i;
const RE_DESARQUIVA = /desarquiv/i;
const RE_TRANSITO = /tr[aâ]nsito em julgado/i;

export function PainelDatasCaso({
  casoId,
  entradaEm,
  processosAdmin,
  processosJudiciais,
  podeEditarProcesso,
  onChange,
}: {
  casoId: string;
  entradaEm: string;
  processosAdmin: ProcessoAdminDatas[];
  processosJudiciais: ProcessoJudicialDatas[];
  podeEditarProcesso: boolean;
  onChange: () => void;
}) {
  const [sinais, setSinais] = useState<Record<string, SinalJudicial>>({});
  const [erroSinais, setErroSinais] = useState(false);
  const [marcando, setMarcando] = useState<string | null>(null);
  const idsJud = processosJudiciais.map((p) => p.id).join(",");

  useEffect(() => {
    if (!idsJud) {
      setSinais({});
      return;
    }
    let cancelado = false;
    setErroSinais(false);
    supabase
      .from("andamentos")
      .select("processo_judicial_id, titulo, data_evento")
      .in("processo_judicial_id", idsJud.split(","))
      .or(
        "titulo.ilike.%baixa definitiva%,titulo.ilike.%arquiv%," +
          "titulo.ilike.%trânsito em julgado%,titulo.ilike.%transito em julgado%",
      )
      .order("data_evento", { ascending: true })
      .then(({ data, error }) => {
        if (cancelado) return;
        if (error) {
          setErroSinais(true);
          return;
        }
        const out: Record<string, SinalJudicial> = {};
        for (const a of (data ?? []) as Array<{
          processo_judicial_id: string;
          titulo: string;
          data_evento: string;
        }>) {
          const s = (out[a.processo_judicial_id] ??= { sugereEncerrado: null, transito: null });
          const dia = diaDoEventoBR(a.data_evento);
          // Em ordem de data: desarquivamento depois do arquivamento desfaz a sugestão.
          if (RE_DESARQUIVA.test(a.titulo)) s.sugereEncerrado = null;
          else if (RE_ENCERRA.test(a.titulo)) s.sugereEncerrado = { titulo: a.titulo, dia };
          if (RE_TRANSITO.test(a.titulo)) s.transito = dia;
        }
        setSinais(out);
      });
    return () => {
      cancelado = true;
    };
  }, [idsJud]);

  async function marcarEncerrado(id: string, dia: string) {
    setMarcando(id);
    const { error } = await supabase
      .from("processos_judiciais")
      .update({ situacao: "encerrado", encerrado_em: dia })
      .eq("id", id);
    setMarcando(null);
    if (error) {
      toast.error("Não consegui marcar como encerrado", { description: error.message });
      return;
    }
    toast.success("Processo marcado como encerrado.");
    onChange();
  }

  const [relogios, setRelogios] = useState<RelogioPrazo[]>([]);
  const [erro, setErro] = useState(false);

  useEffect(() => {
    let cancelado = false;
    setErro(false);
    buscarRelogiosDoCaso(casoId)
      .then((r) => {
        if (!cancelado) setRelogios(r);
      })
      .catch(() => {
        // Falha de leitura não pode virar "sem relógio" calada.
        if (!cancelado) setErro(true);
      });
    return () => {
      cancelado = true;
    };
    // A página recarrega os processos a cada mudança no caso (aba de tarefas
    // inclusive): acompanha isso para o relógio não ficar velho depois de uma
    // decisão (recurso, protocolo, prorrogação).
  }, [casoId, processosAdmin, processosJudiciais]);

  // Um relógio por processo: vale o mais recente de cada um (a lista já vem
  // do mais novo para o mais antigo).
  const relogioDe = (adminId: string | null, judicialId: string | null) =>
    relogios.find(
      (r) => (r.processo_admin_id ?? null) === adminId && (r.processo_judicial_id ?? null) === judicialId,
    ) ?? null;
  const relogioSemProcesso = relogioDe(null, null);

  return (
    <div className="rounded-lg border bg-card p-3 space-y-3" data-testid="painel-datas-caso">
      <Dado rotulo="Entrada do caso" valor={dataBR(entradaEm)} />

      {processosAdmin.map((p) => {
        const relogio = relogioDe(p.id, null);
        const indeferido = /indefer/i.test(p.decisao ?? "") || !!relogio;
        const dataDecisao =
          relogio && !relogio.origem_estimada ? relogio.origem_em : p.data_decisao;
        return (
          <div key={p.id} className="space-y-2 border-t pt-3" data-testid="painel-admin">
            <p className="text-sm font-medium">
              Requerimento {p.numero_requerimento ? "nº " + p.numero_requerimento : "sem número"}
            </p>
            <div className="grid gap-3 sm:grid-cols-3">
              <Dado
                rotulo="Protocolo administrativo"
                valor={p.data_protocolo ? dataBR(p.data_protocolo) : "—"}
              />
              <Dado
                rotulo={indeferido ? "Indeferimento" : "Decisão"}
                valor={dataDecisao ? dataBR(dataDecisao) : "—"}
                detalhe={!indeferido && p.decisao ? p.decisao : undefined}
                alerta={!!relogio?.origem_estimada}
                alertaTexto="data não informada — o prazo contou da criação da análise"
              />
              <Dado rotulo="Número do benefício (NB)" valor={p.numero_beneficio || "—"} />
            </div>
            {relogio && <LinhaRelogio relogio={relogio} />}
          </div>
        );
      })}

      {relogioSemProcesso && (
        <div className="space-y-1 border-t pt-3">
          <p className="text-sm font-medium">Prazo sem processo vinculado</p>
          <LinhaRelogio relogio={relogioSemProcesso} />
        </div>
      )}

      {processosJudiciais.length > 0 && (
        <div className="space-y-2 border-t pt-3" data-testid="painel-judicial">
          {processosJudiciais.map((p) => {
            const sinal = sinais[p.id];
            const encerrado = p.situacao === "encerrado";
            const relogio = relogioDe(null, p.id);
            return (
              <div key={p.id} className="flex flex-wrap items-start gap-2">
                <Gavel className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">
                    {p.numero_processo ?? "Processo judicial sem número"}
                    <Badge
                      variant="outline"
                      className={
                        "ml-2 font-normal " +
                        (encerrado ? "text-muted-foreground" : "border-emerald-300 text-emerald-700 dark:text-emerald-400")
                      }
                    >
                      {encerrado
                        ? "Encerrado" + (p.encerrado_em ? " em " + dataBR(p.encerrado_em) : "")
                        : "Em andamento"}
                    </Badge>
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {[p.vara, [p.comarca, p.uf].filter(Boolean).join("/")].filter(Boolean).join(" · ") ||
                      "vara não informada"}
                    {" · distribuído em "}
                    {p.data_distribuicao ? dataBR(p.data_distribuicao) : "—"}
                    {sinal?.transito && " · trânsito em julgado em " + dataBR(sinal.transito)}
                  </p>
                  {!encerrado && sinal?.sugereEncerrado && (
                    <p className="mt-1 flex flex-wrap items-center gap-2 text-xs text-amber-800 dark:text-amber-300">
                      Parece encerrado: “{sinal.sugereEncerrado.titulo}” em{" "}
                      {dataBR(sinal.sugereEncerrado.dia)}.
                      {podeEditarProcesso && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-6 px-2 text-xs"
                          disabled={marcando === p.id}
                          onClick={() => void marcarEncerrado(p.id, sinal.sugereEncerrado!.dia)}
                        >
                          Confirmar encerrado
                        </Button>
                      )}
                    </p>
                  )}
                  {relogio && <LinhaRelogio relogio={relogio} />}
                </div>
              </div>
            );
          })}
          {erroSinais && (
            <p className="text-xs text-destructive">
              Não consegui ler as movimentações dos processos judiciais.
            </p>
          )}
        </div>
      )}
      {erro && (
        <p className="text-xs text-destructive">
          Não consegui carregar o prazo do caso. Recarregue a página.
        </p>
      )}
    </div>
  );
}

function LinhaRelogio({ relogio }: { relogio: RelogioPrazo }) {
  return (
    <div className="flex items-start gap-2">
      <CalendarClock className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
      <RelogioDoCaso relogio={relogio} />
    </div>
  );
}

function Dado({
  rotulo,
  valor,
  detalhe,
  alerta,
  alertaTexto,
}: {
  rotulo: string;
  valor: string;
  detalhe?: string;
  alerta?: boolean;
  alertaTexto?: string;
}) {
  return (
    <div className="min-w-0">
      <p className="text-xs text-muted-foreground">{rotulo}</p>
      <p className="text-sm font-medium">{valor}</p>
      {detalhe && <p className="truncate text-xs text-muted-foreground">{detalhe}</p>}
      {alerta && alertaTexto && <p className="text-xs text-destructive">{alertaTexto}</p>}
    </div>
  );
}

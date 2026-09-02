// Radar de CASO SEM PRÓXIMO PASSO — a rede de segurança anti-perda-de-prazo
// (piloto aprovado pela Naira, 2026-08-28). Prazo se perde quando o caso fica
// órfão: sem tarefa aberta e sem evento futuro, ninguém é lembrado dele.
//
// Mora na tela de Tarefas (onde o interno começa o dia): um aviso âmbar com o
// total e um diálogo listando os casos, do mais esquecido pro mais recente.
// Corrigir = abrir o caso e criar a próxima tarefa; o caso sai do radar
// sozinho na próxima olhada.

import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { ExternalLink, RadioTower } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { supabase } from "@/lib/supabase";

interface CasoOrfao {
  caso_id: string;
  cliente_nome: string | null;
  tipo_beneficio: string | null;
  parado_desde: string;
  dias_parado: number;
  em_acompanhamento_judicial: boolean;
  dias_sem_movimento: number;
  // 'sem_proximo_passo' | 'judicial_mudo' | 'acompanhamento_judicial'
  motivo: string;
}

export function RadarCasosOrfaos() {
  const [casos, setCasos] = useState<CasoOrfao[] | null>(null);
  const [aberto, setAberto] = useState(false);
  const navigate = useNavigate();

  const carregar = useCallback(async () => {
    const { data, error } = await supabase.rpc("casos_sem_proximo_passo");
    if (error) {
      console.error("radar casos_sem_proximo_passo:", error);
      return;
    }
    setCasos((data as CasoOrfao[]) ?? []);
  }, []);

  useEffect(() => {
    carregar();
  }, [carregar]);

  if (!casos) return null;

  // Dois níveis (Naira, 2026-08-31): judicial com processo cadastrado e
  // movimento recente é acompanhamento PASSIVO (neutro, sem alarme) — o
  // controle dele é por publicação acionável. Alarme âmbar só pro resto.
  const acionaveis = casos.filter((c) => c.motivo !== "acompanhamento_judicial");
  const passivos = casos.filter((c) => c.motivo === "acompanhamento_judicial");

  if (acionaveis.length === 0 && passivos.length === 0) return null;

  return (
    <>
      {acionaveis.length > 0 ? (
        <button
          type="button"
          onClick={() => {
            setAberto(true);
            carregar();
          }}
          className="flex w-full items-center gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-left text-sm text-amber-900 hover:bg-amber-100 transition-colors dark:border-amber-700 dark:bg-amber-950 dark:text-amber-200"
          aria-label={"Radar: " + acionaveis.length + " casos precisando de atenção"}
        >
          <RadioTower className="h-4 w-4 shrink-0" />
          <span className="font-medium">
            Radar: {acionaveis.length} {acionaveis.length === 1 ? "caso precisa" : "casos precisam"} de atenção
          </span>
          <span className="text-xs text-amber-800/80 dark:text-amber-300/80">
            — sem próximo passo ou processo mudo. {passivos.length > 0 &&
              passivos.length + " em acompanhamento judicial (ok)."}
          </span>
        </button>
      ) : (
        <button
          type="button"
          onClick={() => {
            setAberto(true);
            carregar();
          }}
          className="flex w-full items-center gap-2 rounded-md border px-3 py-2 text-left text-sm text-muted-foreground hover:bg-muted/50 transition-colors"
          aria-label="Radar: nenhum caso precisando de atenção"
        >
          <RadioTower className="h-4 w-4 shrink-0" />
          <span>
            ✓ Nenhum caso sem próximo passo · {passivos.length} em acompanhamento
            judicial (vigiados por DataJud/DJEN)
          </span>
        </button>
      )}

      <Dialog open={aberto} onOpenChange={setAberto}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Radar de casos</DialogTitle>
            <DialogDescription>
              Sem tarefa aberta e sem evento futuro. Os que precisam de atenção
              vêm primeiro; os em acompanhamento judicial são vigiados por
              DataJud/DJEN e só alarmam se uma publicação exigir ação ou o
              processo ficar mudo por 90 dias.
            </DialogDescription>
          </DialogHeader>
          <ul className="max-h-[60vh] space-y-1 overflow-y-auto pr-1">
            {acionaveis.map((c) => (
              <li
                key={c.caso_id}
                className="flex items-center justify-between gap-2 rounded-md border border-amber-200 bg-amber-50/40 px-3 py-2 dark:border-amber-800 dark:bg-amber-950/40"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">
                    {c.cliente_nome ?? "(sem nome)"}
                  </p>
                  <p className="truncate text-xs text-muted-foreground">
                    {c.tipo_beneficio ?? "benefício não definido"}
                    {c.motivo === "judicial_mudo" &&
                      " · processo MUDO há " + c.dias_sem_movimento + " dias"}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <Badge
                    variant="outline"
                    className={
                      c.dias_parado >= 30
                        ? "border-red-300 text-red-700 dark:text-red-400"
                        : "border-amber-300 text-amber-700 dark:text-amber-400"
                    }
                  >
                    parado há {c.dias_parado} {c.dias_parado === 1 ? "dia" : "dias"}
                  </Badge>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      setAberto(false);
                      navigate({ to: "/casos/$id", params: { id: c.caso_id } });
                    }}
                  >
                    <ExternalLink className="h-3.5 w-3.5 mr-1" />
                    Abrir
                  </Button>
                </div>
              </li>
            ))}
            {passivos.length > 0 && (
              <li className="pt-2 pb-1 text-xs font-medium text-muted-foreground">
                Em acompanhamento judicial ({passivos.length}) — sem alarme
              </li>
            )}
            {passivos.map((c) => (
              <li
                key={c.caso_id}
                className="flex items-center justify-between gap-2 rounded-md border px-3 py-2 opacity-80"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm">{c.cliente_nome ?? "(sem nome)"}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {c.tipo_beneficio ?? "benefício não definido"} · último movimento
                    há {c.dias_sem_movimento} {c.dias_sem_movimento === 1 ? "dia" : "dias"}
                  </p>
                </div>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setAberto(false);
                    navigate({ to: "/casos/$id", params: { id: c.caso_id } });
                  }}
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                </Button>
              </li>
            ))}
          </ul>
        </DialogContent>
      </Dialog>
    </>
  );
}

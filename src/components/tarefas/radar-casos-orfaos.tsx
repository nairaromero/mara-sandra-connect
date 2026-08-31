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
import { ExternalLink, Loader2, RadioTower } from "lucide-react";

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

  if (!casos || casos.length === 0) return null;

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setAberto(true);
          carregar();
        }}
        className="flex w-full items-center gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-left text-sm text-amber-900 hover:bg-amber-100 transition-colors dark:border-amber-700 dark:bg-amber-950 dark:text-amber-200"
        aria-label={"Radar: " + casos.length + " casos sem próximo passo"}
      >
        <RadioTower className="h-4 w-4 shrink-0" />
        <span className="font-medium">
          Radar: {casos.length} {casos.length === 1 ? "caso" : "casos"} sem próximo passo
        </span>
        <span className="text-xs text-amber-800/80 dark:text-amber-300/80">
          — sem tarefa aberta nem evento futuro. Clique pra ver e destravar.
        </span>
      </button>

      <Dialog open={aberto} onOpenChange={setAberto}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Casos sem próximo passo</DialogTitle>
            <DialogDescription>
              Nenhuma tarefa aberta e nenhum evento futuro — ninguém será
              lembrado destes casos. Abra e crie a próxima tarefa (ou arquive o
              que já terminou).
            </DialogDescription>
          </DialogHeader>
          {casos === null ? (
            <div className="flex justify-center p-6">
              <Loader2 className="h-5 w-5 animate-spin" />
            </div>
          ) : (
            <ul className="max-h-[60vh] space-y-1 overflow-y-auto pr-1">
              {casos.map((c) => (
                <li
                  key={c.caso_id}
                  className="flex items-center justify-between gap-2 rounded-md border px-3 py-2"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">
                      {c.cliente_nome ?? "(sem nome)"}
                    </p>
                    <p className="truncate text-xs text-muted-foreground">
                      {c.tipo_beneficio ?? "benefício não definido"}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <Badge
                      variant="outline"
                      className={
                        c.dias_parado >= 30
                          ? "border-red-300 text-red-700 dark:text-red-400"
                          : c.dias_parado >= 7
                            ? "border-amber-300 text-amber-700 dark:text-amber-400"
                            : ""
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
            </ul>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

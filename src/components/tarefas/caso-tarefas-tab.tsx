// Tab "Tarefas" dentro de /casos/$id (só para interno).
// Lista as tarefas daquele caso, agrupadas por status, com botão de criar.

import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Loader2, Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { TarefaCard } from "@/components/tarefas/tarefa-card";
import { TarefaSheet } from "@/components/tarefas/tarefa-sheet";
import {
  atualizarTarefa,
  excluirTarefa,
  listarTarefas,
} from "@/lib/tarefas/queries";
import {
  STATUS_LABEL,
  STATUS_ORDEM,
  type TarefaComJoins,
  type TarefaStatus,
} from "@/lib/tarefas/types";

type Modo =
  | { kind: "criar"; casoIdInicial: string }
  | { kind: "editar"; tarefa: TarefaComJoins };

interface Props {
  casoId: string;
}

export function CasoTarefasTab({ casoId }: Props) {
  const [carregando, setCarregando] = useState(true);
  const [tarefas, setTarefas] = useState<TarefaComJoins[]>([]);
  const [sheetModo, setSheetModo] = useState<Modo | null>(null);

  const carregar = useCallback(async () => {
    setCarregando(true);
    try {
      const data = await listarTarefas({ caso_id: casoId });
      setTarefas(data);
    } catch (e) {
      console.error(e);
      toast.error("Falha ao carregar tarefas do caso.");
    } finally {
      setCarregando(false);
    }
  }, [casoId]);

  useEffect(() => {
    carregar();
  }, [carregar]);

  const porStatus = useMemo(() => {
    const m: Record<TarefaStatus, TarefaComJoins[]> = {
      a_fazer: [],
      fazendo: [],
      feito: [],
      cancelado: [],
    };
    for (const t of tarefas) m[t.status].push(t);
    return m;
  }, [tarefas]);

  async function mudarStatus(id: string, status: TarefaStatus) {
    const original = tarefas.find((t) => t.id === id);
    setTarefas((arr) => arr.map((t) => (t.id === id ? { ...t, status } : t)));
    try {
      await atualizarTarefa({ id, patch: { status } });
    } catch (e) {
      console.error(e);
      if (original) setTarefas((arr) => arr.map((t) => (t.id === id ? original : t)));
      toast.error("Falha ao mover.");
    }
  }

  async function excluir(id: string) {
    if (!window.confirm("Excluir esta tarefa?")) return;
    const snapshot = tarefas;
    setTarefas((arr) => arr.filter((t) => t.id !== id));
    try {
      await excluirTarefa(id);
    } catch (e) {
      console.error(e);
      setTarefas(snapshot);
      toast.error("Falha ao excluir.");
    }
  }

  function abrirEditor(id: string) {
    const t = tarefas.find((x) => x.id === id);
    if (t) setSheetModo({ kind: "editar", tarefa: t });
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="font-medium">Tarefas do caso</h2>
          <p className="text-xs text-muted-foreground">
            {tarefas.length === 0
              ? "Nenhuma tarefa registrada."
              : `${tarefas.length} ${tarefas.length === 1 ? "tarefa" : "tarefas"} · use o template para abrir um pacote.`}
          </p>
        </div>
        <Button
          size="sm"
          onClick={() => setSheetModo({ kind: "criar", casoIdInicial: casoId })}
        >
          <Plus className="h-4 w-4" />
          Nova tarefa
        </Button>
      </div>

      {carregando ? (
        <div className="flex items-center justify-center h-40">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <div className="space-y-5">
          {STATUS_ORDEM.map((s) => {
            const lista = porStatus[s];
            if (lista.length === 0 && s === "cancelado") return null;
            return (
              <section key={s} className="space-y-2">
                <div className="flex items-center gap-2">
                  <h3 className="text-sm font-medium">{STATUS_LABEL[s]}</h3>
                  <Badge variant="outline" className="font-normal">
                    {lista.length}
                  </Badge>
                </div>
                {lista.length === 0 ? (
                  <p className="text-xs text-muted-foreground">— vazio —</p>
                ) : (
                  <div className="grid grid-cols-1 gap-2">
                    {lista.map((t) => (
                      <TarefaCard
                        key={t.id}
                        tarefa={t}
                        onOpenSheet={abrirEditor}
                        onChangeStatus={mudarStatus}
                        onDelete={excluir}
                        onChanged={carregar}
                        mostrarCaso={false}
                      />
                    ))}
                  </div>
                )}
              </section>
            );
          })}
        </div>
      )}

      <TarefaSheet
        modo={sheetModo}
        onClose={() => setSheetModo(null)}
        onSaved={carregar}
      />
    </div>
  );
}

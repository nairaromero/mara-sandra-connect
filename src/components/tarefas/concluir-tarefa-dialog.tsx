// Popup de conclusão de tarefa (Naira, 2026-09-02).
//
// Regra: toda tarefa concluída pelo "Feito" (não pelos botões de desfecho
// dentro dela) passa por aqui — pra nenhuma tarefa, nem o caso, ficar
// parado sem razão registrada. Ex.: análise criada por importação do
// Legalmail num caso judicial precisa ser EXCLUÍDA (com motivo), não
// concluída.
//
// Três saídas:
//   • Concluir  — marca 'feito' (some pra tarefa de desfecho pendente: ela se
//                 conclui pelo próprio widget).
//   • Editar    — abre a tarefa pra ajustar.
//   • Excluir   — pede um motivo (obrigatório) e apaga, registrando no log.

import { useState } from "react";
import { Loader2, CheckCircle2, Pencil, Trash2, AlertTriangle } from "lucide-react";
import { toast } from "sonner";

import type { TarefaComJoins } from "@/lib/tarefas/types";
import { checklistPendente } from "@/lib/tarefas/helpers";
import { atualizarTarefa, excluirTarefaComMotivo } from "@/lib/tarefas/queries";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export function ConcluirTarefaDialog(props: {
  tarefa: TarefaComJoins | null;
  onClose: () => void;
  /** concluída de verdade (status -> feito) */
  onConcluida: (id: string) => void;
  /** excluída com motivo */
  onExcluida: (id: string) => void;
  /** abrir a tarefa pra editar */
  onEditar: (t: TarefaComJoins) => void;
}) {
  const { tarefa, onClose, onConcluida, onExcluida, onEditar } = props;
  const [motivo, setMotivo] = useState("");
  const [modoExcluir, setModoExcluir] = useState(false);
  const [erroMotivo, setErroMotivo] = useState(false);
  const [salvando, setSalvando] = useState<"concluir" | "excluir" | null>(null);

  // Reseta ao trocar de tarefa (o dialog é reusado).
  const pendente = tarefa ? checklistPendente(tarefa) : null;

  function fechar() {
    setMotivo("");
    setModoExcluir(false);
    setErroMotivo(false);
    setSalvando(null);
    onClose();
  }

  async function concluir() {
    if (!tarefa) return;
    setSalvando("concluir");
    try {
      await atualizarTarefa({ id: tarefa.id, patch: { status: "feito" } });
      toast.success("Tarefa concluída.");
      onConcluida(tarefa.id);
      fechar();
    } catch (e) {
      console.error(e);
      toast.error("Falha ao concluir.");
      setSalvando(null);
    }
  }

  async function excluir() {
    if (!tarefa) return;
    if (!motivo.trim()) {
      setErroMotivo(true);
      return;
    }
    setSalvando("excluir");
    try {
      await excluirTarefaComMotivo(tarefa.id, motivo.trim());
      toast.success("Tarefa excluída.");
      onExcluida(tarefa.id);
      fechar();
    } catch (e) {
      console.error(e);
      toast.error("Falha ao excluir.");
      setSalvando(null);
    }
  }

  return (
    <Dialog open={tarefa !== null} onOpenChange={(o) => !o && fechar()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Concluir tarefa</DialogTitle>
          <DialogDescription>{tarefa?.titulo}</DialogDescription>
        </DialogHeader>

        {/* Tarefa de desfecho: não conclui pelo Feito — só editar/excluir. */}
        {pendente && !modoExcluir && (
          <div className="flex gap-2 rounded-md border border-amber-400/50 bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-200">
            <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
            <span>
              Esta tarefa se conclui por <strong>{pendente}</strong>. Se ela não se aplica a este
              caso (ex.: veio do Legalmail e o caso é judicial), edite ou exclua com motivo.
            </span>
          </div>
        )}

        {!modoExcluir ? (
          <div className="space-y-2">
            {!pendente && (
              <p className="text-sm text-muted-foreground">
                Confirme a conclusão. Se a tarefa não deveria existir (não se aplica ao caso),
                exclua com um motivo em vez de concluir — assim o caso não fica parado sem razão.
              </p>
            )}
            <div className="flex flex-col gap-2 pt-1">
              {!pendente && (
                <Button onClick={concluir} disabled={salvando !== null}>
                  {salvando === "concluir" ? (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <CheckCircle2 className="h-4 w-4 mr-2" />
                  )}
                  Concluir tarefa
                </Button>
              )}
              <Button
                variant="outline"
                disabled={salvando !== null}
                onClick={() => {
                  if (tarefa) onEditar(tarefa);
                  fechar();
                }}
              >
                <Pencil className="h-4 w-4 mr-2" />
                Editar tarefa
              </Button>
              <Button
                variant="outline"
                className="text-destructive hover:text-destructive"
                disabled={salvando !== null}
                onClick={() => setModoExcluir(true)}
              >
                <Trash2 className="h-4 w-4 mr-2" />
                Excluir com motivo
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-2">
            <Label className="text-xs">Motivo da exclusão (obrigatório)</Label>
            <Textarea
              rows={3}
              autoFocus
              placeholder="Ex.: caso é judicial, a análise do Legalmail não se aplica"
              value={motivo}
              onChange={(e) => {
                setMotivo(e.target.value);
                if (erroMotivo && e.target.value.trim()) setErroMotivo(false);
              }}
            />
            {erroMotivo && (
              <p className="text-xs text-destructive">Escreva o motivo antes de excluir.</p>
            )}
          </div>
        )}

        <DialogFooter>
          {modoExcluir ? (
            <>
              <Button variant="ghost" onClick={() => setModoExcluir(false)} disabled={salvando !== null}>
                Voltar
              </Button>
              <Button
                variant="destructive"
                onClick={excluir}
                disabled={salvando !== null}
              >
                {salvando === "excluir" && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                Excluir tarefa
              </Button>
            </>
          ) : (
            <Button variant="ghost" onClick={fechar} disabled={salvando !== null}>
              Cancelar
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// Popup de conclusão/exclusão de tarefa (Naira, 2026-09-02; revisão 2026-09-02).
//
// Regra: toda tarefa concluída pelo "Feito" E toda exclusão (card, painel)
// passam por aqui — pra nenhuma tarefa, nem o caso, ficar parado sem razão
// registrada. Ex.: análise criada por importação do Legalmail num caso
// judicial precisa ser EXCLUÍDA (com motivo), não concluída.
//
// Três saídas:
//   • Concluir  — marca 'feito' (some pra tarefa de desfecho pendente: ela se
//                 conclui pelo próprio widget). O caller pode trocar a
//                 persistência via `concluir` (o sheet salva TODAS as edições
//                 pendentes junto, não só o status).
//   • Editar    — abre a tarefa pra ajustar.
//   • Excluir   — pede um motivo (obrigatório, validado também no servidor)
//                 e apaga registrando no log; com caso ligado, vira andamento.
//
// `modoInicial="excluir"` abre direto no modo de motivo (menu do card e botão
// Excluir do painel usam isso — não existe mais exclusão sem motivo na UI).

import { useEffect, useState } from "react";
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
  /** abrir ja no modo de exclusao com motivo (default: "concluir") */
  modoInicial?: "concluir" | "excluir";
  onClose: () => void;
  /**
   * Persistencia customizada do Concluir (o sheet salva todas as edicoes
   * pendentes junto). Deve LANCAR quando nao persistir. Sem ela, o default e
   * gravar so { status: 'feito' }.
   */
  concluir?: () => Promise<void>;
  /** concluída (status -> feito) e já abrir a criação da próxima tarefa */
  onConcluidaEAdicionar: (t: TarefaComJoins) => void;
  /** excluída com motivo */
  onExcluida: (id: string) => void;
  /** abrir a tarefa pra editar */
  onEditar: (t: TarefaComJoins) => void;
}) {
  const { tarefa, modoInicial, onClose, concluir, onConcluidaEAdicionar, onExcluida, onEditar } =
    props;
  const [motivo, setMotivo] = useState("");
  const [modoExcluir, setModoExcluir] = useState(false);
  const [erroMotivo, setErroMotivo] = useState(false);
  const [salvando, setSalvando] = useState<"concluir" | "excluir" | null>(null);

  // Reset REAL ao abrir/trocar de tarefa (o dialog e reusado): sem isto, o
  // motivo da tarefa anterior vazaria pra proxima confirmacao.
  useEffect(() => {
    if (!tarefa) return;
    setModoExcluir(modoInicial === "excluir");
    setMotivo("");
    setErroMotivo(false);
    setSalvando(null);
  }, [tarefa, modoInicial]);

  const pendente = tarefa ? checklistPendente(tarefa) : null;

  function fechar() {
    setMotivo("");
    setModoExcluir(false);
    setErroMotivo(false);
    setSalvando(null);
    onClose();
  }

  async function concluirEAdicionar() {
    if (!tarefa) return;
    setSalvando("concluir");
    try {
      if (concluir) {
        await concluir(); // caller persiste (sheet: salva todas as edicoes)
      } else {
        await atualizarTarefa({ id: tarefa.id, patch: { status: "feito" } });
      }
      toast.success("Tarefa concluída. Crie a próxima do caso.");
      const t = tarefa;
      fechar();
      // Abre a criação da próxima tarefa (pode cancelar se não houver).
      onConcluidaEAdicionar(t);
    } catch (e) {
      console.error(e);
      const msg = (e as { message?: string })?.message;
      toast.error(msg || "Falha ao concluir.");
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
      // O RPC valida no servidor (tarefa inexistente/ja excluida, motivo
      // vazio) e devolve mensagem legivel — mostra ela, nao um erro generico.
      const msg = (e as { message?: string })?.message ?? "";
      toast.error(
        msg.includes("Tarefa não encontrada") || msg.includes("Motivo")
          ? msg
          : "Falha ao excluir.",
      );
      setSalvando(null);
    }
  }

  return (
    <Dialog open={tarefa !== null} onOpenChange={(o) => !o && fechar()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{modoExcluir ? "Excluir tarefa" : "Concluir tarefa"}</DialogTitle>
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
                Ao concluir, você já cria a próxima tarefa do caso — pra ele não ficar parado. Se a
                tarefa não deveria existir (não se aplica ao caso), exclua com um motivo.
              </p>
            )}
            <div className="flex flex-col gap-2 pt-1">
              {!pendente && (
                <Button onClick={concluirEAdicionar} disabled={salvando !== null}>
                  {salvando === "concluir" ? (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <CheckCircle2 className="h-4 w-4 mr-2" />
                  )}
                  Concluir tarefa e adicionar outra
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
            <p className="text-xs text-muted-foreground">
              O motivo fica no registro de exclusões e, quando a tarefa tem caso ligado, também nos
              andamentos do processo.
            </p>
            {erroMotivo && (
              <p className="text-xs text-destructive">Escreva o motivo antes de excluir.</p>
            )}
          </div>
        )}

        <DialogFooter>
          {modoExcluir ? (
            <>
              <Button
                variant="ghost"
                onClick={() => (modoInicial === "excluir" ? fechar() : setModoExcluir(false))}
                disabled={salvando !== null}
              >
                {modoInicial === "excluir" ? "Cancelar" : "Voltar"}
              </Button>
              <Button variant="destructive" onClick={excluir} disabled={salvando !== null}>
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

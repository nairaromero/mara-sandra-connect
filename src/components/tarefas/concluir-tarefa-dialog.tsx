// Popup de conclusão/exclusão de tarefa (Naira, 2026-09-02; revisão 2026-09-02).
//
// Regra: toda tarefa concluída pelo "Feito" E toda exclusão (card, painel)
// passam por aqui — pra nenhuma tarefa, nem o caso, ficar parado sem razão
// registrada. Ex.: análise criada por importação do Legalmail num caso
// judicial precisa ser EXCLUÍDA (com motivo), não concluída.
//
// Duas saídas:
//   • Concluir  — marca 'feito' (some pra tarefa de desfecho pendente: ela se
//                 conclui pelo próprio widget). O caller pode trocar a
//                 persistência via `concluir` (o sheet salva TODAS as edições
//                 pendentes junto, não só o status). Depois abre a etapa
//                 "Próxima tarefa do caso": a IA sugere o seguimento e a pessoa
//                 SEMPRE confere no formulário antes de criar — ou conclui sem
//                 criar nada. Sem sugestão, oferece o formulário em branco.
//   • Excluir   — pede um motivo (obrigatório, validado também no servidor)
//                 e apaga registrando no log; com caso ligado, vira andamento.
//
// `modoInicial="excluir"` abre direto no modo de motivo (menu do card e botão
// Excluir do painel usam isso — não existe mais exclusão sem motivo na UI).

import { useEffect, useRef, useState } from "react";
import {
  Loader2,
  CheckCircle2,
  Pencil,
  Trash2,
  AlertTriangle,
  Calendar,
  Check,
  Plus,
  Scale,
  Sparkles,
  User,
} from "lucide-react";
import { toast } from "sonner";

import type { TarefaComJoins } from "@/lib/tarefas/types";
import { checklistPendente, formatarDueAtCurto } from "@/lib/tarefas/helpers";
import {
  sugerirProximaTarefa,
  type ResultadoSugestao,
  type SugestaoProximaTarefa,
} from "@/lib/tarefas/proxima-sugerida";
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
import { usePodeAcao } from "@/components/acao-protegida";

// Etapa "Próxima tarefa do caso": null = ainda na etapa 1; "carregando" = a IA
// está pensando; senão, a resposta dela (com ou sem sugestão). Um estado só:
// não existe "carregando" com sugestão, nem sugestão fora da etapa 2.
type Proxima = null | "carregando" | ResultadoSugestao;

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
  /**
   * Já concluída, a pessoa quer criar a próxima: abre o formulário de nova
   * tarefa — preenchido com a sugestão da IA, ou em branco (null). Sem ele,
   * concluir só fecha: não chama a IA pra oferecer botões que não fariam nada.
   */
  onCriarProxima?: (t: TarefaComJoins, sugestao: SugestaoProximaTarefa | null) => void;
  /** excluída com motivo */
  onExcluida: (id: string) => void;
}) {
  // Trava própria: este popup grava direto em `tarefas` (concluir e excluir).
  // Quem não pode escrever não o vê nem se algum caminho novo tentar abri-lo.
  // O return fica lá embaixo: sair aqui pularia os hooks seguintes.
  const podeMexer = usePodeAcao({ escrever: "tarefas" });
  const { tarefa, modoInicial, onClose, concluir, onCriarProxima, onExcluida } = props;
  const [motivo, setMotivo] = useState("");
  const [modoExcluir, setModoExcluir] = useState(false);
  const [erroMotivo, setErroMotivo] = useState(false);
  const [salvando, setSalvando] = useState<"concluir" | "excluir" | null>(null);
  const [proxima, setProxima] = useState<Proxima>(null);
  // Fluxo do Concluir em curso (salvar → pedir a sugestão). Fechar, trocar de
  // tarefa ou desmontar aborta: se fechou durante o salvar a IA nem é chamada,
  // e resposta atrasada não aparece no popup seguinte.
  const fluxo = useRef<AbortController | null>(null);

  // Reset REAL ao abrir/trocar de tarefa (o dialog e reusado): sem isto, o
  // motivo da tarefa anterior vazaria pra proxima confirmacao. Fechar NÃO
  // reseta: o conteúdo não pisca de volta pra etapa 1 na animação de saída.
  useEffect(() => {
    if (!tarefa) return;
    fluxo.current?.abort();
    fluxo.current = null;
    setModoExcluir(modoInicial === "excluir");
    setMotivo("");
    setErroMotivo(false);
    setSalvando(null);
    setProxima(null);
  }, [tarefa, modoInicial]);

  useEffect(() => () => fluxo.current?.abort(), []);

  const pendente = tarefa ? checklistPendente(tarefa) : null;

  function fechar() {
    fluxo.current?.abort();
    fluxo.current = null;
    onClose();
  }

  async function concluirTarefa() {
    if (!tarefa) return;
    fluxo.current?.abort();
    const ctrl = new AbortController();
    fluxo.current = ctrl;
    setSalvando("concluir");
    try {
      if (concluir) {
        await concluir(); // caller persiste (sheet: salva todas as edicoes)
      } else {
        await atualizarTarefa({ id: tarefa.id, patch: { status: "feito" } });
      }
    } catch (e) {
      console.error(e);
      const msg = (e as { message?: string })?.message;
      toast.error(msg || "Falha ao concluir.");
      setSalvando(null);
      return;
    }
    toast.success("Tarefa concluída.");
    // Fechou o popup enquanto salvava: concluiu, mas ninguém espera a próxima.
    if (ctrl.signal.aborted) return;
    setSalvando(null);
    // Sem caso não há seguimento a sugerir; sem onCriarProxima, nada a oferecer.
    if (!tarefa.caso_id || !onCriarProxima) {
      fechar();
      return;
    }
    setProxima("carregando");
    const r = await sugerirProximaTarefa(tarefa.id, ctrl.signal);
    if (!ctrl.signal.aborted) setProxima(r);
  }

  function criarProxima(sugestao: SugestaoProximaTarefa | null) {
    if (!tarefa) return;
    fechar();
    onCriarProxima?.(tarefa, sugestao);
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


  if (!podeMexer) return null;
  return (
    <Dialog open={tarefa !== null} onOpenChange={(o) => !o && fechar()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        {proxima ? (
          <EtapaProximaTarefa
            titulo={tarefa?.titulo ?? ""}
            proxima={proxima}
            onCriar={criarProxima}
            onFechar={fechar}
          />
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>{modoExcluir ? "Excluir tarefa" : "Concluir tarefa"}</DialogTitle>
              <DialogDescription>{tarefa?.titulo}</DialogDescription>
            </DialogHeader>

            {/* Tarefa de desfecho: não conclui pelo Feito — só exclui com motivo. */}
            {pendente && !modoExcluir && (
              <div className="flex gap-2 rounded-md border border-amber-400/50 bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-200">
                <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
                <span>
                  Esta tarefa se conclui por <strong>{pendente}</strong>. Se ela não se aplica a
                  este caso (ex.: veio do Legalmail e o caso é judicial), exclua com motivo — ou
                  cancele e ajuste a tarefa.
                </span>
              </div>
            )}

            {!modoExcluir ? (
              <div className="space-y-2">
                {!pendente && (
                  <p className="text-sm text-muted-foreground">
                    Ao concluir, a IA sugere a próxima tarefa do caso — pra ele não ficar parado — e
                    você confere antes de criar. Se a tarefa não deveria existir (não se aplica ao
                    caso), exclua com um motivo.
                  </p>
                )}
                <div className="flex flex-col gap-2 pt-1">
                  {!pendente && (
                    <Button onClick={concluirTarefa} disabled={salvando !== null}>
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
                  O motivo fica no registro de exclusões e, quando a tarefa tem caso ligado, também
                  nos andamentos do processo.
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
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

// Etapa 2 (card #306): a tarefa já foi concluída; decide-se a próxima. Fechar
// no X equivale a "Concluir sem criar nova tarefa".
function EtapaProximaTarefa(props: {
  titulo: string;
  proxima: Exclude<Proxima, null>;
  onCriar: (sugestao: SugestaoProximaTarefa | null) => void;
  onFechar: () => void;
}) {
  const { titulo, proxima, onCriar, onFechar } = props;
  const carregando = proxima === "carregando";
  const sugestao = carregando ? null : proxima.sugestao;

  return (
    <>
      <DialogHeader>
        <DialogTitle>Próxima tarefa do caso</DialogTitle>
        <DialogDescription>Concluída: {titulo}</DialogDescription>
      </DialogHeader>

      <div className="space-y-3">
        {carregando ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            A IA está sugerindo a próxima tarefa…
          </p>
        ) : sugestao ? (
          <>
            <p className="text-sm text-muted-foreground">
              Após essa tarefa, a outra tarefa para seguimento seria:
            </p>
            <div className="rounded-md border p-3 space-y-1.5" data-testid="sugestao-proxima-tarefa">
              <span className="inline-flex items-center gap-1 rounded bg-violet-100 px-2 py-0.5 text-xs text-violet-800 dark:bg-violet-950 dark:text-violet-200">
                <Sparkles className="h-3 w-3" />
                Sugerida pela IA
              </span>
              <p className="text-sm font-medium">{sugestao.titulo}</p>
              {sugestao.descricao && (
                <p className="text-xs text-muted-foreground">{sugestao.descricao}</p>
              )}
              <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
                {sugestao.due_at && (
                  <span className="flex items-center gap-1">
                    <Calendar className="h-3 w-3" />
                    vence {formatarDueAtCurto(sugestao.due_at)}
                  </span>
                )}
                {sugestao.responsavel_nome && (
                  <span className="flex items-center gap-1">
                    <User className="h-3 w-3" />
                    {sugestao.responsavel_nome}
                  </span>
                )}
                {(sugestao.processo_judicial_id || sugestao.processo_admin_id) && (
                  <span className="flex items-center gap-1">
                    <Scale className="h-3 w-3" />
                    {sugestao.processo_judicial_id ? "processo judicial" : "processo administrativo"}
                  </span>
                )}
              </div>
            </div>
          </>
        ) : (
          <div className="rounded-md border border-dashed p-3 text-sm">
            <p className="font-medium">Não consegui sugerir a próxima tarefa.</p>
            {proxima.motivo && (
              <p className="text-xs text-muted-foreground mt-1">{proxima.motivo}</p>
            )}
          </div>
        )}

        <div className="flex flex-col gap-2 pt-1">
          {!carregando &&
            (sugestao ? (
              <Button onClick={() => onCriar(sugestao)}>
                <Pencil className="h-4 w-4 mr-2" />
                Editar tarefa sugerida
              </Button>
            ) : (
              <Button onClick={() => onCriar(null)}>
                <Plus className="h-4 w-4 mr-2" />
                Criar nova tarefa
              </Button>
            ))}
          <Button variant="outline" onClick={onFechar}>
            <Check className="h-4 w-4 mr-2" />
            Concluir sem criar nova tarefa
          </Button>
        </div>
      </div>
    </>
  );
}

// Sheet (slide-in) para criar/editar tarefa. Reusado em /tarefas, na home
// (Minhas hoje) e na tab Tarefas do caso. "Aplicar template" só aparece
// quando há caso selecionado.

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Loader2, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  aplicarTemplate,
  atualizarTarefa,
  criarTarefa,
  excluirTarefa,
  listarCasosResumo,
  listarInternosAtivos,
  listarTemplates,
} from "@/lib/tarefas/queries";
import {
  PRIORIDADE_LABEL,
  STATUS_LABEL,
  STATUS_ORDEM,
  TIPO_LABEL,
  type TarefaComJoins,
  type TarefaStatus,
  type TarefaTemplateRow,
  type TarefaTipo,
} from "@/lib/tarefas/types";
import { inputDateValueFromIso, isoFromInputDate } from "@/lib/tarefas/helpers";

type Modo =
  | { kind: "criar"; casoIdInicial?: string | null }
  | { kind: "editar"; tarefa: TarefaComJoins };

interface Props {
  modo: Modo | null;                 // null = fechado
  onClose: () => void;
  onSaved: () => void;               // recarregar lista
}

const TIPOS: TarefaTipo[] = ["interna", "prazo", "pericia", "pos_protocolo", "contato_cliente"];

export function TarefaSheet({ modo, onClose, onSaved }: Props) {
  const aberto = modo !== null;
  const editando = modo?.kind === "editar";
  const tarefa = modo?.kind === "editar" ? modo.tarefa : null;

  const [titulo, setTitulo] = useState("");
  const [descricao, setDescricao] = useState("");
  const [tipo, setTipo] = useState<TarefaTipo>("interna");
  const [prioridade, setPrioridade] = useState<number>(3);
  const [status, setStatus] = useState<TarefaStatus>("a_fazer");
  const [casoId, setCasoId] = useState<string | null>(null);
  const [responsavelId, setResponsavelId] = useState<string | null>(null);
  const [dueDate, setDueDate] = useState<string>("");

  const [casos, setCasos] = useState<Array<{ id: string; cliente_nome: string | null }>>([]);
  const [internos, setInternos] = useState<Array<{ id: string; nome: string | null }>>([]);
  const [templates, setTemplates] = useState<TarefaTemplateRow[]>([]);
  const [templateSelecionado, setTemplateSelecionado] = useState<string>("");

  const [salvando, setSalvando] = useState(false);
  const [aplicando, setAplicando] = useState(false);
  const [excluindo, setExcluindo] = useState(false);

  // Carrega listas auxiliares uma vez (ao abrir).
  useEffect(() => {
    if (!aberto) return;
    listarCasosResumo().then(setCasos).catch(() => {});
    listarInternosAtivos().then(setInternos).catch(() => {});
    listarTemplates().then(setTemplates).catch(() => {});
  }, [aberto]);

  // Sincroniza o formulário com o modo (abertura).
  useEffect(() => {
    if (!modo) return;
    if (modo.kind === "criar") {
      setTitulo("");
      setDescricao("");
      setTipo("interna");
      setPrioridade(3);
      setStatus("a_fazer");
      setCasoId(modo.casoIdInicial ?? null);
      setResponsavelId(null);
      setDueDate("");
      setTemplateSelecionado("");
    } else {
      const t = modo.tarefa;
      setTitulo(t.titulo);
      setDescricao(t.descricao ?? "");
      setTipo(t.tipo);
      setPrioridade(t.prioridade);
      setStatus(t.status);
      setCasoId(t.caso_id);
      setResponsavelId(t.responsavel_id);
      setDueDate(inputDateValueFromIso(t.due_at));
      setTemplateSelecionado("");
    }
  }, [modo]);

  const fechar = useCallback(() => {
    if (salvando || aplicando || excluindo) return;
    onClose();
  }, [salvando, aplicando, excluindo, onClose]);

  async function salvar() {
    if (!titulo.trim()) {
      toast.error("Título é obrigatório.");
      return;
    }
    setSalvando(true);
    try {
      const due_at = isoFromInputDate(dueDate);
      if (editando && tarefa) {
        await atualizarTarefa({
          id: tarefa.id,
          patch: {
            titulo: titulo.trim(),
            descricao: descricao.trim() || null,
            tipo,
            prioridade,
            status,
            caso_id: casoId,
            responsavel_id: responsavelId,
            due_at,
          },
        });
        toast.success("Tarefa atualizada.");
      } else {
        await criarTarefa({
          titulo: titulo.trim(),
          descricao: descricao.trim() || null,
          tipo,
          prioridade,
          caso_id: casoId,
          responsavel_id: responsavelId,
          due_at,
        });
        toast.success("Tarefa criada.");
      }
      onSaved();
      onClose();
    } catch (e) {
      console.error(e);
      const msg = e instanceof Error ? e.message : "Falha ao salvar.";
      toast.error(msg);
    } finally {
      setSalvando(false);
    }
  }

  async function aplicar() {
    if (!casoId || !templateSelecionado) return;
    setAplicando(true);
    try {
      const ids = await aplicarTemplate({
        caso_id: casoId,
        template: templateSelecionado,
        responsavel_id: responsavelId,
      });
      toast.success(
        ids.length === 1
          ? "Template aplicado: 1 tarefa criada."
          : `Template aplicado: ${ids.length} tarefas criadas.`,
      );
      onSaved();
      onClose();
    } catch (e) {
      console.error(e);
      toast.error("Falha ao aplicar template.");
    } finally {
      setAplicando(false);
    }
  }

  async function excluir() {
    if (!editando || !tarefa) return;
    if (!window.confirm("Excluir esta tarefa?")) return;
    setExcluindo(true);
    try {
      await excluirTarefa(tarefa.id);
      toast.success("Tarefa excluída.");
      onSaved();
      onClose();
    } catch (e) {
      console.error(e);
      toast.error("Falha ao excluir.");
    } finally {
      setExcluindo(false);
    }
  }

  return (
    <Sheet open={aberto} onOpenChange={(o) => !o && fechar()}>
      <SheetContent className="w-full sm:max-w-md overflow-y-auto">
        <SheetHeader>
          <SheetTitle>{editando ? "Editar tarefa" : "Nova tarefa"}</SheetTitle>
          {editando && tarefa && (
            <SheetDescription>
              Criada em {new Date(tarefa.created_at).toLocaleString("pt-BR")} · origem {tarefa.origem}
            </SheetDescription>
          )}
        </SheetHeader>

        <div className="space-y-4 py-4">
          <div className="space-y-1.5">
            <Label htmlFor="t-titulo">Título</Label>
            <Input
              id="t-titulo"
              value={titulo}
              onChange={(e) => setTitulo(e.target.value)}
              placeholder="Ex: Comunicar parceiro sobre indeferimento"
              autoFocus
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="t-descricao">Descrição</Label>
            <Textarea
              id="t-descricao"
              value={descricao}
              onChange={(e) => setDescricao(e.target.value)}
              placeholder="Notas, contexto, links..."
              rows={4}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Tipo</Label>
              <Select value={tipo} onValueChange={(v) => setTipo(v as TarefaTipo)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {TIPOS.map((t) => (
                    <SelectItem key={t} value={t}>{TIPO_LABEL[t]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Prioridade</Label>
              <Select
                value={String(prioridade)}
                onValueChange={(v) => setPrioridade(Number(v))}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {[1, 2, 3, 4].map((p) => (
                    <SelectItem key={p} value={String(p)}>{PRIORIDADE_LABEL[p]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {editando && (
            <div className="space-y-1.5">
              <Label>Status</Label>
              <Select value={status} onValueChange={(v) => setStatus(v as TarefaStatus)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {STATUS_ORDEM.map((s) => (
                    <SelectItem key={s} value={s}>{STATUS_LABEL[s]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="t-due">Prazo</Label>
            <Input
              id="t-due"
              type="date"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
            />
          </div>

          <div className="space-y-1.5">
            <Label>Responsável</Label>
            <Select
              value={responsavelId ?? "sem"}
              onValueChange={(v) => setResponsavelId(v === "sem" ? null : v)}
            >
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="sem">Sem responsável</SelectItem>
                {internos.map((u) => (
                  <SelectItem key={u.id} value={u.id}>
                    {u.nome ?? "(sem nome)"}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label>Caso</Label>
            <Select
              value={casoId ?? "sem"}
              onValueChange={(v) => setCasoId(v === "sem" ? null : v)}
            >
              <SelectTrigger><SelectValue placeholder="Sem caso" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="sem">Sem caso</SelectItem>
                {casos.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.cliente_nome ?? "(sem nome)"}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {!editando && casoId && templates.length > 0 && (
            <div className="space-y-1.5 border-t pt-4">
              <Label>Aplicar template (opcional)</Label>
              <div className="flex gap-2">
                <Select value={templateSelecionado} onValueChange={setTemplateSelecionado}>
                  <SelectTrigger className="flex-1"><SelectValue placeholder="Escolha um template" /></SelectTrigger>
                  <SelectContent>
                    {templates.map((t) => (
                      <SelectItem key={t.id} value={t.nome}>
                        {t.nome}{" "}
                        <span className="text-muted-foreground">
                          ({t.itens.length} tarefa{t.itens.length > 1 ? "s" : ""})
                        </span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button
                  variant="outline"
                  onClick={aplicar}
                  disabled={!templateSelecionado || aplicando}
                >
                  {aplicando ? <Loader2 className="h-4 w-4 animate-spin" /> : "Aplicar"}
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                Aplica todas as tarefas do template ao caso selecionado.
              </p>
            </div>
          )}
        </div>

        <SheetFooter className="gap-2 sm:gap-2">
          {editando && (
            <Button
              variant="ghost"
              onClick={excluir}
              disabled={excluindo || salvando}
              className="mr-auto text-destructive hover:text-destructive"
            >
              {excluindo ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
              Excluir
            </Button>
          )}
          <Button variant="outline" onClick={fechar} disabled={salvando}>
            Cancelar
          </Button>
          <Button onClick={salvar} disabled={salvando}>
            {salvando ? <Loader2 className="h-4 w-4 animate-spin" /> : "Salvar"}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

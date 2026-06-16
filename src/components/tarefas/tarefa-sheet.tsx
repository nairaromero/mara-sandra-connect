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
  atualizarTarefa,
  criarTarefa,
  excluirTarefa,
  listarCasosResumo,
  listarInternosAtivos,
  listarProcessosDoCaso,
  listarTemplates,
  obterContextoCaso,
} from "@/lib/tarefas/queries";
import {
  PRIORIDADE_LABEL,
  STATUS_LABEL,
  STATUS_ORDEM,
  TIPO_LABEL,
  templateTemAgenda,
  type ProcessoDoCasoOpcao,
  type TarefaComJoins,
  type TarefaStatus,
  type TarefaTemplateRow,
  type TarefaTipo,
} from "@/lib/tarefas/types";
import {
  inputDateValueFromIso,
  isoFromInputDate,
  substituirPlaceholders,
} from "@/lib/tarefas/helpers";
import { EtapasAcompanhamento } from "@/components/tarefas/etapas-acompanhamento";

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
  // Único valor para processo: "" = nenhum, "admin:<id>" ou "judicial:<id>".
  const [processoToken, setProcessoToken] = useState<string>("");
  const [responsavelId, setResponsavelId] = useState<string | null>(null);
  const [dueDate, setDueDate] = useState<string>("");

  const [casos, setCasos] = useState<Array<{ id: string; cliente_nome: string | null }>>([]);
  const [internos, setInternos] = useState<
    Array<{ id: string; nome: string | null; email: string | null }>
  >([]);
  const [templates, setTemplates] = useState<TarefaTemplateRow[]>([]);
  const [templateSelecionado, setTemplateSelecionado] = useState<string>("");
  const [processosDoCaso, setProcessosDoCaso] = useState<ProcessoDoCasoOpcao[]>([]);

  const [salvando, setSalvando] = useState(false);
  const [excluindo, setExcluindo] = useState(false);

  // Carrega listas auxiliares uma vez (ao abrir).
  useEffect(() => {
    if (!aberto) return;
    listarCasosResumo().then(setCasos).catch(() => {});
    listarInternosAtivos().then(setInternos).catch(() => {});
    // TarefaSheet só mostra templates puramente de tarefa. Templates que
    // criam evento de agenda (ex: pericia_parceiro) ficam no AgendaSheet.
    listarTemplates()
      .then((all) => setTemplates(all.filter((t) => !templateTemAgenda(t))))
      .catch(() => {});
  }, [aberto]);

  // Carrega processos do caso quando muda. Limpa quando não há caso.
  useEffect(() => {
    if (!casoId) {
      setProcessosDoCaso([]);
      return;
    }
    listarProcessosDoCaso(casoId).then(setProcessosDoCaso).catch(() => {});
  }, [casoId]);

  // Quando a Naira escolhe um template (modo criar), popula o form com os
  // dados do PRIMEIRO item — título, descrição, tipo, prioridade, prazo —
  // já substituindo placeholders com o contexto do caso/processo. Ela pode
  // editar tudo antes de salvar. Itens adicionais (templates multi-item)
  // são criados ao salvar, com os valores padrão do template.
  useEffect(() => {
    if (editando) return;
    if (!templateSelecionado || !casoId) return;
    const tpl = templates.find((t) => t.nome === templateSelecionado);
    if (!tpl || tpl.itens.length === 0) return;
    let cancelado = false;
    (async () => {
      const ctx = await obterContextoCaso(casoId, processoToken);
      if (cancelado) return;
      const item = tpl.itens[0];
      const ph = {
        nome_cliente: ctx.cliente_nome,
        protocolo: ctx.protocolo,
        cpf: ctx.cliente_cpf,
        servico: ctx.servico,
      };
      setTitulo(substituirPlaceholders(item.titulo, ph));
      setDescricao(substituirPlaceholders(item.descricao ?? "", ph));
      setTipo(item.tipo as TarefaTipo);
      setPrioridade(item.prioridade ?? 3);
      if (typeof item.offset_dias === "number") {
        const dt = new Date(Date.now() + item.offset_dias * 86400_000);
        setDueDate(dt.toISOString().slice(0, 10));
      } else {
        setDueDate("");
      }
    })();
    return () => {
      cancelado = true;
    };
  }, [templateSelecionado, casoId, processoToken, templates, editando]);

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
      setProcessoToken("");
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
      setProcessoToken(
        t.processo_admin_id
          ? `admin:${t.processo_admin_id}`
          : t.processo_judicial_id
            ? `judicial:${t.processo_judicial_id}`
            : "",
      );
      setResponsavelId(t.responsavel_id);
      setDueDate(inputDateValueFromIso(t.due_at));
      setTemplateSelecionado("");
    }
  }, [modo]);

  const fechar = useCallback(() => {
    if (salvando || excluindo) return;
    onClose();
  }, [salvando, excluindo, onClose]);

  function parseProcesso(): {
    processo_admin_id: string | null;
    processo_judicial_id: string | null;
  } {
    // "" / "admin:<id>" / "judicial:<id>"  → 2 colunas mutuamente exclusivas.
    if (!processoToken || !casoId) {
      return { processo_admin_id: null, processo_judicial_id: null };
    }
    if (processoToken.startsWith("admin:")) {
      return { processo_admin_id: processoToken.slice(6), processo_judicial_id: null };
    }
    if (processoToken.startsWith("judicial:")) {
      return { processo_admin_id: null, processo_judicial_id: processoToken.slice(9) };
    }
    return { processo_admin_id: null, processo_judicial_id: null };
  }

  async function salvar() {
    if (!titulo.trim()) {
      toast.error("Título é obrigatório.");
      return;
    }
    setSalvando(true);
    try {
      const due_at = isoFromInputDate(dueDate);
      const proc = parseProcesso();
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
            processo_admin_id: proc.processo_admin_id,
            processo_judicial_id: proc.processo_judicial_id,
          },
        });
        toast.success("Tarefa atualizada.");
      } else {
        // Modo criar: a tarefa principal usa os valores do form (editáveis,
        // mesmo quando vieram de um template). Se o template tem itens
        // adicionais, eles são criados em seguida com os valores padrão.
        const tpl = templateSelecionado
          ? templates.find((t) => t.nome === templateSelecionado)
          : null;
        const tplItens = tpl?.itens ?? [];
        const firstMeta = (tplItens[0]?.meta ?? {}) as Record<string, unknown>;

        // Tarefa #1 (a editada pela Naira).
        await criarTarefa({
          titulo: titulo.trim(),
          descricao: descricao.trim() || null,
          tipo,
          prioridade,
          caso_id: casoId,
          responsavel_id: responsavelId,
          due_at,
          processo_admin_id: proc.processo_admin_id,
          processo_judicial_id: proc.processo_judicial_id,
          metadata: tpl
            ? {
                template_aplicado: tpl.nome,
                template_item_index: 0,
                aplicado_manualmente: true,
                ...firstMeta,
              }
            : undefined,
        });

        // Itens 2+ (template multi-item) — criados com os valores padrão
        // do template (substituindo placeholders contra o mesmo contexto).
        let extras = 0;
        if (tpl && tplItens.length > 1 && casoId) {
          const ctx = await obterContextoCaso(casoId, processoToken);
          const ph = {
            nome_cliente: ctx.cliente_nome,
            protocolo: ctx.protocolo,
            cpf: ctx.cliente_cpf,
            servico: ctx.servico,
          };
          const emailParaId = new Map<string, string>();
          for (const u of internos) {
            if (u.email) emailParaId.set(u.email.toLowerCase(), u.id);
          }
          for (let i = 1; i < tplItens.length; i++) {
            const item = tplItens[i];
            let respFinal: string | null = responsavelId;
            if (!respFinal && item.executor_email) {
              respFinal = emailParaId.get(item.executor_email.toLowerCase()) ?? null;
            }
            const extraDueAt =
              typeof item.offset_dias === "number"
                ? new Date(Date.now() + item.offset_dias * 86400_000).toISOString()
                : null;
            await criarTarefa({
              caso_id: casoId,
              processo_admin_id: proc.processo_admin_id,
              processo_judicial_id: proc.processo_judicial_id,
              responsavel_id: respFinal,
              tipo: item.tipo as TarefaTipo,
              prioridade: item.prioridade ?? 3,
              titulo: substituirPlaceholders(item.titulo, ph),
              descricao:
                substituirPlaceholders(item.descricao ?? "", ph) || null,
              due_at: extraDueAt,
              metadata: {
                template_aplicado: tpl.nome,
                template_item_index: i,
                aplicado_manualmente: true,
                ...(item.meta ?? {}),
              },
            });
            extras++;
          }
        }

        const total = 1 + extras;
        toast.success(
          total === 1
            ? "Tarefa criada."
            : `${total} tarefas criadas (${extras} adicional${extras === 1 ? "" : "is"} do template).`,
        );
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
          {editando && tarefa &&
            (tarefa.metadata as { acompanhamento_processual?: boolean })?.acompanhamento_processual && (
              <EtapasAcompanhamento tarefa={tarefa} onUpdated={onSaved} />
            )}

          <div className="space-y-1.5">
            <Label>Caso</Label>
            <Select
              value={casoId ?? "sem"}
              onValueChange={(v) => {
                setCasoId(v === "sem" ? null : v);
                setProcessoToken("");
              }}
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

          {casoId && processosDoCaso.length > 0 && (
            <div className="space-y-1.5">
              <Label>Processo (opcional)</Label>
              <Select
                value={processoToken || "sem"}
                onValueChange={(v) => setProcessoToken(v === "sem" ? "" : v)}
              >
                <SelectTrigger><SelectValue placeholder="Nenhum" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="sem">Sem processo específico</SelectItem>
                  {processosDoCaso.map((p) => (
                    <SelectItem key={`${p.natureza}:${p.id}`} value={`${p.natureza}:${p.id}`}>
                      {p.rotulo}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                Vincula a tarefa a um requerimento ou processo judicial específico.
              </p>
            </div>
          )}

          {!editando && casoId && templates.length > 0 && (
            <div className="space-y-1.5 rounded-md border border-dashed p-3 bg-muted/30">
              <Label>Template (atalho)</Label>
              <Select value={templateSelecionado} onValueChange={setTemplateSelecionado}>
                <SelectTrigger><SelectValue placeholder="Escolha um template" /></SelectTrigger>
                <SelectContent>
                  {templates.map((t) => (
                    <SelectItem key={t.id} value={t.nome}>
                      {t.rotulo ?? t.nome}{" "}
                      <span className="text-muted-foreground">
                        ({t.itens.length} tarefa{t.itens.length > 1 ? "s" : ""})
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                {templateSelecionado ? (
                  <>
                    Os campos abaixo foram preenchidos com os dados do template.{" "}
                    <strong>Você pode editar tudo antes de salvar.</strong>
                    {(() => {
                      const t = templates.find((x) => x.nome === templateSelecionado);
                      const extras = (t?.itens.length ?? 0) - 1;
                      return extras > 0 ? (
                        <>
                          {" "}Ao salvar, {extras} tarefa{extras === 1 ? "" : "s"} adicional
                          {extras === 1 ? "" : "is"} do template ser{extras === 1 ? "á" : "ão"} criada
                          {extras === 1 ? "" : "s"} com os valores padrão.
                        </>
                      ) : null;
                    })()}
                  </>
                ) : (
                  <>
                    Selecionar um template preenche os campos abaixo (você pode editar antes de salvar). Sem template, preencha manualmente.
                  </>
                )}
              </p>
            </div>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="t-titulo">Título</Label>
            <Input
              id="t-titulo"
              value={titulo}
              onChange={(e) => setTitulo(e.target.value)}
              placeholder="Ex: Comunicar parceiro sobre indeferimento"
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

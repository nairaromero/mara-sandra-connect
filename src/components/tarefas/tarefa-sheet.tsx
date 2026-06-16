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
import { criarEvento } from "@/lib/agenda/queries";
import type { AgendaTipo } from "@/lib/agenda/types";
import { calcularDueAtRelativo } from "@/lib/agenda/helpers";
import {
  inputDateTimeValueFromIso,
  isoFromInputDateTime,
  substituirPlaceholders,
} from "@/lib/tarefas/helpers";
import { EtapasAcompanhamento } from "@/components/tarefas/etapas-acompanhamento";
import { useDestaque } from "@/lib/destaque/destaque-context";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/hooks/use-auth";

type Modo =
  | {
      kind: "criar";
      casoIdInicial?: string | null;
      templateInicial?: string;        // nome do template a pré-selecionar
    }
  | { kind: "editar"; tarefa: TarefaComJoins };

// Export pra outras telas (ex: /clientes "+ Perícia") abrirem o sheet
// com template pré-selecionado.
export type TarefaSheetModo = Modo;

interface Props {
  modo: Modo | null;                 // null = fechado
  onClose: () => void;
  onSaved: () => void;               // recarregar lista
}

const TIPOS: TarefaTipo[] = ["interna", "prazo", "pericia", "pos_protocolo", "contato_cliente"];

export function TarefaSheet({ modo, onClose, onSaved }: Props) {
  const aberto = modo !== null;
  const { marcar: marcarDestaque } = useDestaque();
  const { usuario } = useAuth();
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
  // Campo extra que aparece quando o template selecionado tem item
  // destino=agenda (ex: Perícia com parceiro). É o local da perícia.
  const [local, setLocal] = useState<string>("");

  const [casos, setCasos] = useState<Array<{ id: string; cliente_nome: string | null }>>([]);
  const [internos, setInternos] = useState<
    Array<{ id: string; nome: string | null; email: string | null }>
  >([]);
  const [templates, setTemplates] = useState<TarefaTemplateRow[]>([]);
  const [templateSelecionado, setTemplateSelecionado] = useState<string>("");
  const [processosDoCaso, setProcessosDoCaso] = useState<ProcessoDoCasoOpcao[]>([]);

  const [salvando, setSalvando] = useState(false);
  const [excluindo, setExcluindo] = useState(false);

  // Template atual selecionado tem item destino=agenda? Se sim, o save
  // cria evento na agenda + tarefas extras com prazos relativos. UI
  // também mostra campo "Local" e rótulos diferentes.
  const templateAgenda = templateSelecionado
    ? templates.find((t) => t.nome === templateSelecionado && templateTemAgenda(t)) ?? null
    : null;

  // Carrega listas auxiliares uma vez (ao abrir).
  useEffect(() => {
    if (!aberto) return;
    listarCasosResumo().then(setCasos).catch(() => {});
    listarInternosAtivos().then(setInternos).catch(() => {});
    // Mostra TODOS os templates ativos não-ocultos. Quando o template tem
    // item destino=agenda (ex: "Perícia (com parceiro)"), o salvar() cria
    // o agenda_evento + tarefas extras com datas relativas.
    listarTemplates().then(setTemplates).catch(() => {});
  }, [aberto]);

  // Carrega processos do caso quando muda. Limpa quando não há caso.
  useEffect(() => {
    if (!casoId) {
      setProcessosDoCaso([]);
      return;
    }
    listarProcessosDoCaso(casoId).then(setProcessosDoCaso).catch(() => {});
  }, [casoId]);

  // Quando a Naira escolhe um template (modo criar), popula o form. Se o
  // template tem item destino=agenda (ex: "Perícia com parceiro"), esse
  // item vira o "main" — a Data/hora do form passa a ser o start da
  // perícia. Os demais itens (destino=tarefa) ficam pra criação no salvar()
  // com prazos relativos ao start da perícia.
  // Quando não tem item destino=agenda, comportamento clássico: itens[0]
  // popula o form, demais viram tarefas extras.
  useEffect(() => {
    if (editando) return;
    if (!templateSelecionado || !casoId) return;
    const tpl = templates.find((t) => t.nome === templateSelecionado);
    if (!tpl || tpl.itens.length === 0) return;
    const agendaItem = tpl.itens.find((i) => i.destino === "agenda");
    // Main = item de agenda (se houver) → form é a perícia. Senão, o
    // primeiro item destino=tarefa (ou sem destino). Itens destino=
    // andamento NUNCA viram main — eles são sempre criados como
    // andamento no extras loop.
    const primeiroTarefa = tpl.itens.find(
      (i) => !i.destino || i.destino === "tarefa",
    );
    const main = agendaItem ?? primeiroTarefa ?? tpl.itens[0];
    let cancelado = false;
    (async () => {
      const ctx = await obterContextoCaso(casoId, processoToken);
      if (cancelado) return;
      const ph = {
        nome_cliente: ctx.cliente_nome,
        protocolo: ctx.protocolo,
        cpf: ctx.cliente_cpf,
        servico: ctx.servico,
      };
      setTitulo(substituirPlaceholders(main.titulo, ph));
      setDescricao(substituirPlaceholders(main.descricao ?? "", ph));
      setTipo((main.tipo as TarefaTipo) || "interna");
      setPrioridade(main.prioridade ?? 3);
      if (agendaItem) {
        // Pra agenda: form começa vazio (Naira preenche data/hora/local).
        // Não inferimos data — perícia é específica.
        setDueDate("");
        setLocal("");
      } else if (typeof main.offset_dias === "number") {
        const dt = new Date(Date.now() + main.offset_dias * 86400_000);
        setDueDate(inputDateTimeValueFromIso(dt.toISOString()));
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
      setLocal("");
      setTemplateSelecionado(modo.templateInicial ?? "");
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
      setDueDate(inputDateTimeValueFromIso(t.due_at));
      setLocal("");
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
      const due_at = isoFromInputDateTime(dueDate);
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
        // Modo criar.
        // Template define dois cenários:
        //  A) Tem item destino=agenda → "main" é o EVENTO de agenda. Form
        //     vira a perícia. Demais itens são tarefas extras com prazos
        //     relativos ao start_at do evento (due_relative_to=agenda /
        //     sexta_antes_agenda).
        //  B) Não tem destino=agenda → "main" é tarefa[0]. Form cria a
        //     tarefa principal. Demais itens viram tarefas extras (hoje + offset).
        //  C) Sem template → cria 1 tarefa do form (default).
        const tpl = templateSelecionado
          ? templates.find((t) => t.nome === templateSelecionado)
          : null;
        const tplItens = tpl?.itens ?? [];
        const agendaItem = tpl?.itens.find((i) => i.destino === "agenda") ?? null;
        // Mesmo critério do prefill: main NUNCA é destino=andamento
        // (esses sempre vão pelo extras loop). Prioriza agenda → primeiro
        // tarefa (ou sem destino) → fallback itens[0] (edge case).
        const primeiroTarefa = tpl?.itens.find(
          (i) => !i.destino || i.destino === "tarefa",
        ) ?? null;
        const mainItem = agendaItem ?? primeiroTarefa ?? tplItens[0] ?? null;

        // Contexto pra substituir placeholders e lookup de e-mail→uuid
        // (compartilhado entre main + extras).
        const ctx = casoId ? await obterContextoCaso(casoId, processoToken) : null;
        const ph = {
          nome_cliente: ctx?.cliente_nome ?? "",
          protocolo: ctx?.protocolo ?? "",
          cpf: ctx?.cliente_cpf ?? "",
          servico: ctx?.servico ?? "",
        };
        const emailParaId = new Map<string, string>();
        for (const u of internos) {
          if (u.email) emailParaId.set(u.email.toLowerCase(), u.id);
        }

        // ============== MAIN ==============
        let agendaStart: Date | null = null;
        if (agendaItem) {
          // Form values criam o agenda_evento.
          if (!dueDate) {
            toast.error("Data e hora da perícia são obrigatórias.");
            setSalvando(false);
            return;
          }
          const startIso = isoFromInputDateTime(dueDate)!;
          agendaStart = new Date(startIso);
          const dur = agendaItem.duracao_min ?? 60;
          const endIso = new Date(agendaStart.getTime() + dur * 60_000).toISOString();
          const novoEvento = await criarEvento({
            tipo: (agendaItem.tipo as AgendaTipo) || "pericia",
            titulo: titulo.trim(),
            descricao: descricao.trim() || null,
            start_at: startIso,
            end_at: endIso,
            local: local.trim() || null,
            caso_id: casoId,
            responsavel_id: responsavelId,
            processo_admin_id: proc.processo_admin_id,
            processo_judicial_id: proc.processo_judicial_id,
          });
          marcarDestaque(novoEvento.id);
        } else {
          // Comportamento clássico: form cria tarefa principal.
          const firstMeta = (mainItem?.meta ?? {}) as Record<string, unknown>;
          const novaTarefa = await criarTarefa({
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
          marcarDestaque(novaTarefa.id);
        }

        // ============== EXTRAS (todos itens que não foram o main) ==============
        let extras = 0;
        let extrasAndamento = 0;
        if (tpl && tplItens.length > 0) {
          for (let i = 0; i < tplItens.length; i++) {
            const item = tplItens[i];
            if (item === mainItem) continue;          // skip o main (já criado)
            if (item.destino === "agenda") continue;  // ignora outros agenda (1 agenda só)

            // ----- destino=andamento → cria registro em `andamentos` -----
            if (item.destino === "andamento") {
              const visivel = item.visivel_parceiro ?? true;
              const { data: novoAnd, error: errAnd } = await supabase
                .from("andamentos")
                .insert({
                  caso_id: casoId,
                  processo_admin_id: proc.processo_admin_id,
                  processo_judicial_id: proc.processo_judicial_id,
                  origem: "interno",
                  titulo: substituirPlaceholders(item.titulo, ph),
                  descricao:
                    substituirPlaceholders(item.descricao ?? "", ph) || null,
                  data_evento: new Date().toISOString(),
                  criado_por: usuario?.id ?? null,
                  visivel_parceiro: visivel,
                  metadata: {
                    template_aplicado: tpl.nome,
                    template_item_index: i,
                    aplicado_manualmente: true,
                    ...(item.meta ?? {}),
                  },
                })
                .select("id")
                .single();
              if (errAnd) throw errAnd;
              marcarDestaque(novoAnd.id);
              // Fire-and-forget: notifica parceiro por e-mail se visível.
              if (visivel) {
                supabase.functions
                  .invoke("notify-novo-andamento", {
                    body: { andamento_id: novoAnd.id },
                  })
                  .catch(() => {});
              }
              extrasAndamento++;
              continue;
            }

            // ----- destino=tarefa (default) -----
            let respFinal: string | null = responsavelId;
            if (!respFinal && item.executor_email) {
              respFinal = emailParaId.get(item.executor_email.toLowerCase()) ?? null;
            }
            const ancora = item.due_relative_to ?? "hoje";
            const extraDueAt =
              ancora === "agenda" || ancora === "sexta_antes_agenda"
                ? calcularDueAtRelativo(ancora, agendaStart, item.offset_dias)
                : calcularDueAtRelativo("hoje", null, item.offset_dias);
            const tarefaExtra = await criarTarefa({
              caso_id: casoId,
              processo_admin_id: proc.processo_admin_id,
              processo_judicial_id: proc.processo_judicial_id,
              responsavel_id: respFinal,
              tipo: (item.tipo as TarefaTipo) || "interna",
              prioridade: item.prioridade ?? 3,
              titulo: substituirPlaceholders(item.titulo, ph),
              descricao:
                substituirPlaceholders(item.descricao ?? "", ph) || null,
              due_at: extraDueAt,
              metadata: {
                template_aplicado: tpl.nome,
                template_item_index: i,
                aplicado_manualmente: true,
                ancora_prazo: ancora,
                ...(item.meta ?? {}),
              },
            });
            marcarDestaque(tarefaExtra.id);
            extras++;
          }
        }

        // Trecho dinâmico do toast (X tarefa(s) + Y andamento(s)).
        const partesTrecho: string[] = [];
        if (extras > 0) partesTrecho.push(`${extras} tarefa${extras === 1 ? "" : "s"}`);
        if (extrasAndamento > 0) partesTrecho.push(`${extrasAndamento} andamento${extrasAndamento === 1 ? "" : "s"}`);
        const trechoExtras = partesTrecho.join(" + ");

        if (agendaItem) {
          toast.success(
            partesTrecho.length === 0
              ? "Perícia agendada."
              : `Perícia agendada + ${trechoExtras}.`,
          );
          onSaved();
          onClose();
          return;
        }

        const totalTarefas = 1 + extras;
        toast.success(
          extrasAndamento === 0
            ? totalTarefas === 1
              ? "Tarefa criada."
              : `${totalTarefas} tarefas criadas (${extras} adicional${extras === 1 ? "" : "is"} do template).`
            : `Tarefa criada + ${trechoExtras}.`,
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
                      {(() => {
                        const ehAgenda = templateTemAgenda(t);
                        const tarefasN = t.itens.filter((i) => i.destino !== "agenda").length;
                        return (
                          <>
                            {t.rotulo ?? t.nome}{" "}
                            <span className="text-muted-foreground">
                              ({ehAgenda
                                ? `agenda + ${tarefasN} tarefa${tarefasN === 1 ? "" : "s"}`
                                : `${t.itens.length} tarefa${t.itens.length > 1 ? "s" : ""}`})
                            </span>
                          </>
                        );
                      })()}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                {templateSelecionado ? (
                  templateAgenda ? (
                    <>
                      <strong>Esse template cria um evento na agenda</strong> (a perícia em si)
                      {(() => {
                        const t = templateAgenda;
                        const extras = t.itens.filter((i) => i.destino !== "agenda").length;
                        return extras > 0
                          ? ` + ${extras} tarefa${extras === 1 ? "" : "s"} com prazos relativos à data da perícia.`
                          : ".";
                      })()}
                      {" "}Preencha data, hora e local da perícia abaixo.
                    </>
                  ) : (
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
                  )
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
            <Label htmlFor="t-due">
              {templateAgenda ? "Data e hora da perícia" : "Data"}
            </Label>
            <Input
              id="t-due"
              type="datetime-local"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
            />
          </div>

          {templateAgenda && (
            <div className="space-y-1.5">
              <Label htmlFor="t-local">Local</Label>
              <Input
                id="t-local"
                value={local}
                onChange={(e) => setLocal(e.target.value)}
                placeholder="Ex: APS Cabreúva, endereço, sala..."
              />
            </div>
          )}

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

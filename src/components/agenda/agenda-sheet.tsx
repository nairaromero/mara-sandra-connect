// Sheet (slide-in) para criar/editar evento de agenda. Por enquanto a UI
// foca em PERÍCIAS, mas o componente já suporta os outros tipos.

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
  atualizarEvento,
  criarEvento,
  excluirEvento,
} from "@/lib/agenda/queries";
import {
  type AgendaEventoComJoins,
  type AgendaTipo,
  TIPO_LABEL,
} from "@/lib/agenda/types";
import { calcularDueAtRelativo } from "@/lib/agenda/helpers";
import {
  criarTarefa,
  listarCasosResumo,
  listarInternosAtivos,
  listarProcessosDoCaso,
  listarTemplates,
  obterContextoCaso,
} from "@/lib/tarefas/queries";
import {
  templateTemAgenda,
  type ProcessoDoCasoOpcao,
  type TarefaTemplateRow,
  type TarefaTipo,
} from "@/lib/tarefas/types";
import { substituirPlaceholders } from "@/lib/tarefas/helpers";
import { useDestaque } from "@/lib/destaque/destaque-context";

const TIPOS: AgendaTipo[] = ["pericia", "audiencia", "reuniao", "interno"];

type Modo =
  | { kind: "criar"; tipoInicial?: AgendaTipo; casoIdInicial?: string | null; processoTokenInicial?: string }
  | { kind: "editar"; evento: AgendaEventoComJoins };

interface Props {
  modo: Modo | null;
  onClose: () => void;
  onSaved: () => void;
}

// Helpers de input <input type="datetime-local">
function isoToInputDatetime(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  // Formato YYYY-MM-DDTHH:mm em horário local.
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function inputDatetimeToIso(s: string): string {
  if (!s) return "";
  return new Date(s).toISOString();
}

export function AgendaSheet({ modo, onClose, onSaved }: Props) {
  const aberto = modo !== null;
  const { marcar: marcarDestaque } = useDestaque();
  const editando = modo?.kind === "editar";
  const evento = modo?.kind === "editar" ? modo.evento : null;

  const [tipo, setTipo] = useState<AgendaTipo>("pericia");
  const [titulo, setTitulo] = useState("");
  const [descricao, setDescricao] = useState("");
  const [local, setLocal] = useState("");
  const [startInput, setStartInput] = useState("");
  const [endInput, setEndInput] = useState("");
  const [casoId, setCasoId] = useState<string | null>(null);
  const [processoToken, setProcessoToken] = useState("");
  const [responsavelId, setResponsavelId] = useState<string | null>(null);

  const [casos, setCasos] = useState<Array<{ id: string; cliente_nome: string | null }>>([]);
  const [internos, setInternos] = useState<Array<{ id: string; nome: string | null; email: string | null }>>([]);
  const [processosDoCaso, setProcessosDoCaso] = useState<ProcessoDoCasoOpcao[]>([]);
  // Templates de agenda (com pelo menos 1 item destino=agenda).
  const [templates, setTemplates] = useState<TarefaTemplateRow[]>([]);
  const [templateSelecionado, setTemplateSelecionado] = useState<string>("");

  const [salvando, setSalvando] = useState(false);
  const [excluindo, setExcluindo] = useState(false);

  useEffect(() => {
    if (!aberto) return;
    listarCasosResumo().then(setCasos).catch(() => {});
    listarInternosAtivos().then(setInternos).catch(() => {});
    // AgendaSheet só mostra templates que criam evento de agenda
    // (ex: pericia_parceiro). Tarefa-only fica no TarefaSheet.
    listarTemplates()
      .then((all) => setTemplates(all.filter((t) => templateTemAgenda(t))))
      .catch(() => {});
  }, [aberto]);

  useEffect(() => {
    if (!casoId) {
      setProcessosDoCaso([]);
      return;
    }
    listarProcessosDoCaso(casoId).then(setProcessosDoCaso).catch(() => {});
  }, [casoId]);

  // Sincroniza form com modo na abertura.
  useEffect(() => {
    if (!modo) return;
    if (modo.kind === "criar") {
      setTipo(modo.tipoInicial ?? "pericia");
      setTitulo("");
      setDescricao("");
      setLocal("");
      // Default: próxima hora cheia + 1h de duração
      const now = new Date();
      now.setMinutes(0, 0, 0);
      now.setHours(now.getHours() + 1);
      const startStr = isoToInputDatetime(now.toISOString());
      const endDate = new Date(now);
      endDate.setHours(endDate.getHours() + 1);
      setStartInput(startStr);
      setEndInput(isoToInputDatetime(endDate.toISOString()));
      setCasoId(modo.casoIdInicial ?? null);
      setProcessoToken(modo.processoTokenInicial ?? "");
      setResponsavelId(null);
      setTemplateSelecionado("");
    } else {
      const e = modo.evento;
      setTipo(e.tipo);
      setTitulo(e.titulo);
      setDescricao(e.descricao ?? "");
      setLocal(e.local ?? "");
      setStartInput(isoToInputDatetime(e.start_at));
      setEndInput(isoToInputDatetime(e.end_at));
      setCasoId(e.caso_id);
      setProcessoToken(
        e.processo_admin_id
          ? `admin:${e.processo_admin_id}`
          : e.processo_judicial_id
            ? `judicial:${e.processo_judicial_id}`
            : "",
      );
      setResponsavelId(e.responsavel_id);
      setTemplateSelecionado("");
    }
  }, [modo]);

  // Selecionar template (modo criar): popula tipo/titulo/descricao do item
  // destino=agenda; usa duracao_min do template pra calcular end_at.
  // Os campos start_at/local/responsavel ficam pra Naira preencher.
  useEffect(() => {
    if (editando) return;
    if (!templateSelecionado || !casoId) return;
    const tpl = templates.find((t) => t.nome === templateSelecionado);
    if (!tpl) return;
    const agendaItem = tpl.itens.find((i) => i.destino === "agenda");
    if (!agendaItem) return;
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
      setTipo((agendaItem.tipo as AgendaTipo) || "pericia");
      setTitulo(substituirPlaceholders(agendaItem.titulo, ph));
      setDescricao(substituirPlaceholders(agendaItem.descricao ?? "", ph));
      // Ajusta end_at = start_at + duracao_min se o usuário ainda não mexeu.
      const dur = agendaItem.duracao_min ?? 60;
      if (startInput) {
        const startDate = new Date(startInput);
        const endDate = new Date(startDate.getTime() + dur * 60_000);
        setEndInput(isoToInputDatetime(endDate.toISOString()));
      }
    })();
    return () => {
      cancelado = true;
    };
  }, [templateSelecionado, casoId, processoToken, templates, editando]);   // eslint-disable-line react-hooks/exhaustive-deps

  const fechar = useCallback(() => {
    if (salvando || excluindo) return;
    onClose();
  }, [salvando, excluindo, onClose]);

  function parseProcesso(): {
    processo_admin_id: string | null;
    processo_judicial_id: string | null;
  } {
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
    if (!startInput || !endInput) {
      toast.error("Início e fim são obrigatórios.");
      return;
    }
    const startIso = inputDatetimeToIso(startInput);
    const endIso = inputDatetimeToIso(endInput);
    if (new Date(endIso).getTime() < new Date(startIso).getTime()) {
      toast.error("Fim não pode ser antes do início.");
      return;
    }
    setSalvando(true);
    try {
      const proc = parseProcesso();
      if (editando && evento) {
        await atualizarEvento({
          id: evento.id,
          patch: {
            tipo,
            titulo: titulo.trim(),
            descricao: descricao.trim() || null,
            start_at: startIso,
            end_at: endIso,
            local: local.trim() || null,
            caso_id: casoId,
            responsavel_id: responsavelId,
            processo_admin_id: proc.processo_admin_id,
            processo_judicial_id: proc.processo_judicial_id,
          },
        });
        toast.success("Evento atualizado.");
      } else {
        // Cria o evento de agenda.
        const novoEvento = await criarEvento({
          tipo,
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

        // Se aplicou um template de agenda com itens destino=tarefa,
        // cria essas tarefas extras (datas relativas ao start_at do evento).
        let tarefasExtras = 0;
        const tpl = templateSelecionado
          ? templates.find((t) => t.nome === templateSelecionado)
          : null;
        if (tpl && casoId) {
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
          const agendaStart = new Date(startIso);
          for (const item of tpl.itens) {
            if (item.destino !== "tarefa") continue;
            const respFinal =
              responsavelId ||
              (item.executor_email
                ? emailParaId.get(item.executor_email.toLowerCase()) ?? null
                : null);
            const ancora = item.due_relative_to ?? "hoje";
            const dueAt =
              ancora === "agenda" || ancora === "sexta_antes_agenda"
                ? calcularDueAtRelativo(ancora, agendaStart, item.offset_dias)
                : calcularDueAtRelativo("hoje", null, item.offset_dias);
            const novaTarefa = await criarTarefa({
              caso_id: casoId,
              processo_admin_id: proc.processo_admin_id,
              processo_judicial_id: proc.processo_judicial_id,
              responsavel_id: respFinal,
              tipo: (item.tipo as TarefaTipo) || "interna",
              prioridade: item.prioridade ?? 3,
              titulo: substituirPlaceholders(item.titulo, ph),
              descricao: substituirPlaceholders(item.descricao ?? "", ph) || null,
              due_at: dueAt,
              metadata: {
                template_aplicado: tpl.nome,
                aplicado_via: "agenda_sheet",
                ancora_prazo: ancora,
                ...(item.meta ?? {}),
              },
            });
            marcarDestaque(novaTarefa.id);
            tarefasExtras++;
          }
        }
        toast.success(
          tarefasExtras === 0
            ? "Evento criado."
            : `Evento criado + ${tarefasExtras} tarefa${tarefasExtras === 1 ? "" : "s"} do template.`,
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
    if (!editando || !evento) return;
    if (!window.confirm("Excluir este evento?")) return;
    setExcluindo(true);
    try {
      await excluirEvento(evento.id);
      toast.success("Evento excluído.");
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
          <SheetTitle>{editando ? "Editar evento" : "Nova perícia"}</SheetTitle>
          {editando && evento && (
            <SheetDescription>
              Criado em {new Date(evento.created_at).toLocaleString("pt-BR")}
              {evento.gcal_event_id ? " · sincronizado com Google Calendar" : " · não sincronizado"}
            </SheetDescription>
          )}
        </SheetHeader>

        <div className="space-y-4 py-4">
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
            </div>
          )}

          {!editando && casoId && templates.length > 0 && (
            <div className="space-y-1.5 rounded-md border border-dashed p-3 bg-muted/30">
              <Label>Template (atalho)</Label>
              <Select value={templateSelecionado} onValueChange={setTemplateSelecionado}>
                <SelectTrigger><SelectValue placeholder="Escolha um template" /></SelectTrigger>
                <SelectContent>
                  {templates.map((t) => {
                    const tarefasExtras = t.itens.filter((i) => i.destino === "tarefa").length;
                    return (
                      <SelectItem key={t.id} value={t.nome}>
                        {t.rotulo ?? t.nome}{" "}
                        <span className="text-muted-foreground">
                          (evento + {tarefasExtras} tarefa{tarefasExtras === 1 ? "" : "s"})
                        </span>
                      </SelectItem>
                    );
                  })}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                {templateSelecionado ? (
                  <>
                    Os campos abaixo foram preenchidos pelo template — ajuste data/hora/local e salve.
                    Ao salvar, as tarefas extras serão criadas com prazos relativos a essa data.
                  </>
                ) : (
                  <>Selecionar um template preenche os campos abaixo e cria tarefas auxiliares quando salvar.</>
                )}
              </p>
            </div>
          )}

          <div className="space-y-1.5">
            <Label>Tipo</Label>
            <Select value={tipo} onValueChange={(v) => setTipo(v as AgendaTipo)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {TIPOS.map((t) => (
                  <SelectItem key={t} value={t}>{TIPO_LABEL[t]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="a-titulo">Título</Label>
            <Input
              id="a-titulo"
              value={titulo}
              onChange={(e) => setTitulo(e.target.value)}
              placeholder={
                tipo === "pericia"
                  ? "Ex: Perícia médica - Maicon Vandson"
                  : "Ex: Audiência inicial"
              }
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="a-start">Início</Label>
              <Input
                id="a-start"
                type="datetime-local"
                value={startInput}
                onChange={(e) => setStartInput(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="a-end">Fim</Label>
              <Input
                id="a-end"
                type="datetime-local"
                value={endInput}
                onChange={(e) => setEndInput(e.target.value)}
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="a-local">Local</Label>
            <Input
              id="a-local"
              value={local}
              onChange={(e) => setLocal(e.target.value)}
              placeholder="Ex: APS Cabreúva ou endereço completo"
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
            <Label htmlFor="a-descricao">Observações</Label>
            <Textarea
              id="a-descricao"
              value={descricao}
              onChange={(e) => setDescricao(e.target.value)}
              placeholder="Detalhes, exigências, instruções pro cliente..."
              rows={4}
            />
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

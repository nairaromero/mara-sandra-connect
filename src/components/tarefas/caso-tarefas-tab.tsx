// Tab "Tarefas" dentro de /casos/$id (só para interno).
// Lista as tarefas + eventos da agenda do caso, agrupados.

import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { CalendarDays, Loader2, MapPin, Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { TarefaCard } from "@/components/tarefas/tarefa-card";
import { TarefaSheet } from "@/components/tarefas/tarefa-sheet";
import { AgendaSheet } from "@/components/agenda/agenda-sheet";
import {
  atualizarTarefa,
  excluirTarefa,
  listarTarefas,
} from "@/lib/tarefas/queries";
import {
  STATUS_LABEL,
  type TarefaComJoins,
  type TarefaStatus,
} from "@/lib/tarefas/types";
import { listarAgenda } from "@/lib/agenda/queries";
import {
  type AgendaEventoComJoins,
  TIPO_CLASS,
  TIPO_LABEL,
} from "@/lib/agenda/types";
import {
  DESTAQUE_CLASSE_GLOBAL,
  useDestaqueAtivo,
} from "@/lib/destaque/destaque-context";

const STATUS_ATIVOS: TarefaStatus[] = ["a_fazer", "fazendo"];
const STATUS_ARQUIVADOS: TarefaStatus[] = ["feito", "cancelado"];

type Modo =
  | { kind: "criar"; casoIdInicial: string }
  | { kind: "editar"; tarefa: TarefaComJoins };

interface Props {
  casoId: string;
  // Avisa o parent (casos/$id) sempre que algo mudou aqui (ex: etapa
  // de acompanhamento cria andamento → TabAndamentos precisa atualizar).
  onChange?: () => void;
}

export function CasoTarefasTab({ casoId, onChange }: Props) {
  const [carregando, setCarregando] = useState(true);
  const [tarefas, setTarefas] = useState<TarefaComJoins[]>([]);
  const [eventos, setEventos] = useState<AgendaEventoComJoins[]>([]);
  const [sheetModo, setSheetModo] = useState<Modo | null>(null);
  const [agendaSheet, setAgendaSheet] = useState<
    { kind: "editar"; evento: AgendaEventoComJoins } | null
  >(null);
  const [aba, setAba] = useState<"ativos" | "arquivados">("ativos");

  const carregar = useCallback(async () => {
    setCarregando(true);
    try {
      const [ts, es] = await Promise.all([
        listarTarefas({ caso_id: casoId }),
        listarAgenda({ caso_id: casoId }),
      ]);
      setTarefas(ts);
      setEventos(es);
      // Propaga pro parent. Andamentos do caso podem ter mudado (ex: etapa
      // de acompanhamento processual cria andamento ao marcar).
      onChange?.();
    } catch (e) {
      console.error(e);
      toast.error("Falha ao carregar atividades do caso.");
    } finally {
      setCarregando(false);
    }
  }, [casoId, onChange]);

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

  // Separa eventos em futuros (Ativos) e passados (Arquivados).
  const agora = Date.now();
  const eventosFuturos = useMemo(
    () => eventos.filter((e) => new Date(e.end_at).getTime() >= agora),
    [eventos, agora],
  );
  const eventosPassados = useMemo(
    () => eventos
      .filter((e) => new Date(e.end_at).getTime() < agora)
      .sort((a, b) => new Date(b.start_at).getTime() - new Date(a.start_at).getTime()),
    [eventos, agora],
  );
  const eventosDaAba = aba === "ativos" ? eventosFuturos : eventosPassados;

  const totalTarefas = tarefas.length;
  const totalEventos = eventos.length;
  const totalAtividades = totalTarefas + totalEventos;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="font-medium">Atividades do caso</h2>
          <p className="text-xs text-muted-foreground">
            {totalAtividades === 0
              ? "Nenhuma atividade registrada."
              : `${totalEventos} evento${totalEventos === 1 ? "" : "s"} · ${totalTarefas} tarefa${totalTarefas === 1 ? "" : "s"} · use o template para abrir um pacote.`}
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

      <Tabs value={aba} onValueChange={(v) => setAba(v as "ativos" | "arquivados")}>
        <TabsList>
          <TabsTrigger value="ativos">
            Ativos
            <Badge variant="outline" className="ml-2 font-normal">
              {STATUS_ATIVOS.reduce((acc, s) => acc + porStatus[s].length, 0) + eventosFuturos.length}
            </Badge>
          </TabsTrigger>
          <TabsTrigger value="arquivados">
            Arquivados
            <Badge variant="outline" className="ml-2 font-normal">
              {STATUS_ARQUIVADOS.reduce((acc, s) => acc + porStatus[s].length, 0) + eventosPassados.length}
            </Badge>
          </TabsTrigger>
        </TabsList>
      </Tabs>

      {carregando ? (
        <div className="flex items-center justify-center h-40">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <div className="space-y-5">
          {/* Eventos de agenda (perícias) — antes das seções de tarefa */}
          {eventosDaAba.length > 0 && (
            <section className="space-y-2">
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-medium">Agenda</h3>
                <Badge variant="outline" className="font-normal">{eventosDaAba.length}</Badge>
              </div>
              <div className="grid grid-cols-1 gap-2">
                {eventosDaAba.map((e) => (
                  <EventoCard
                    key={e.id}
                    evento={e}
                    onClick={() => setAgendaSheet({ kind: "editar", evento: e })}
                    dim={aba === "arquivados"}
                  />
                ))}
              </div>
            </section>
          )}

          {(aba === "ativos" ? STATUS_ATIVOS : STATUS_ARQUIVADOS).map((s) => {
            const lista = porStatus[s];
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

      <AgendaSheet
        modo={agendaSheet}
        onClose={() => setAgendaSheet(null)}
        onSaved={carregar}
      />
    </div>
  );
}

function EventoCard({
  evento: e,
  onClick,
  dim,
}: {
  evento: AgendaEventoComJoins;
  onClick: () => void;
  dim?: boolean;
}) {
  const start = new Date(e.start_at);
  const end = new Date(e.end_at);
  const data = start.toLocaleDateString("pt-BR", {
    weekday: "short",
    day: "2-digit",
    month: "short",
  });
  const hInicio = start.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  const hFim = end.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  const destacado = useDestaqueAtivo(e.id);
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "w-full text-left rounded-md border bg-card hover:shadow transition-shadow",
        destacado && DESTAQUE_CLASSE_GLOBAL,
        dim && "opacity-70",
      )}
    >
      <div className="p-3 space-y-2">
        <div className="flex items-center gap-2 flex-wrap">
          <Badge variant="outline" className={cn("font-normal", TIPO_CLASS[e.tipo])}>
            {TIPO_LABEL[e.tipo]}
          </Badge>
          <span className="text-xs text-muted-foreground">
            {data} · {hInicio}–{hFim}
          </span>
          {e.gcal_event_id && (
            <Badge variant="outline" className="font-normal text-xs">
              <CalendarDays className="h-3 w-3" />
              Google
            </Badge>
          )}
        </div>
        <div className="font-medium text-sm break-words">{e.titulo}</div>
        {e.descricao && (
          <p className="text-xs text-muted-foreground line-clamp-2 whitespace-pre-wrap">
            {e.descricao}
          </p>
        )}
        {e.local && (
          <div className="flex items-center gap-1 text-xs text-muted-foreground min-w-0">
            <MapPin className="h-3 w-3 shrink-0" />
            <span className="truncate">{e.local}</span>
          </div>
        )}
      </div>
    </button>
  );
}

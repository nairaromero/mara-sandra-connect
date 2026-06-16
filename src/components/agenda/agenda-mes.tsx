// Calendário mensal — grid 7×5/6 com eventos da agenda como badges
// dentro de cada célula. Navegação prev/next mês. Click numa célula
// destaca o dia (sem zoom — mantém a visão completa do mês). Click
// num evento abre o sheet de edição.

import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, MapPin } from "lucide-react";
import {
  addMonths,
  startOfMonth,
  endOfMonth,
  startOfWeek,
  endOfWeek,
  eachDayOfInterval,
  isSameMonth,
  isSameDay,
  format,
} from "date-fns";
import { ptBR } from "date-fns/locale";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { type AgendaEventoComJoins, TIPO_CLASS, TIPO_LABEL } from "@/lib/agenda/types";

interface Props {
  eventos: AgendaEventoComJoins[];
  onEventoClick: (id: string) => void;
  onDiaClick?: (data: Date) => void;
}

const WEEK_LABELS = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];

export function AgendaMes({ eventos, onEventoClick, onDiaClick }: Props) {
  const [refDate, setRefDate] = useState<Date>(new Date());
  const [diaSelecionado, setDiaSelecionado] = useState<string | null>(null);

  const dias = useMemo(() => {
    const inicio = startOfWeek(startOfMonth(refDate), { weekStartsOn: 0 });
    const fim = endOfWeek(endOfMonth(refDate), { weekStartsOn: 0 });
    return eachDayOfInterval({ start: inicio, end: fim });
  }, [refDate]);

  // Agrupa eventos por dia (chave YYYY-MM-DD) pra lookup O(1).
  const eventosPorDia = useMemo(() => {
    const m = new Map<string, AgendaEventoComJoins[]>();
    for (const e of eventos) {
      const k = format(new Date(e.start_at), "yyyy-MM-dd");
      if (!m.has(k)) m.set(k, []);
      m.get(k)!.push(e);
    }
    // Ordena cada dia por hora de início.
    for (const [k, arr] of m) {
      arr.sort((a, b) => new Date(a.start_at).getTime() - new Date(b.start_at).getTime());
      m.set(k, arr);
    }
    return m;
  }, [eventos]);

  const hoje = new Date();

  return (
    <div className="space-y-3">
      {/* Header de navegação */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="icon" onClick={() => setRefDate((d) => addMonths(d, -1))} aria-label="Mês anterior">
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <h2 className="text-base font-medium capitalize min-w-[10rem] text-center">
            {format(refDate, "MMMM 'de' yyyy", { locale: ptBR })}
          </h2>
          <Button variant="ghost" size="icon" onClick={() => setRefDate((d) => addMonths(d, 1))} aria-label="Próximo mês">
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
        <Button variant="outline" size="sm" onClick={() => { setRefDate(new Date()); setDiaSelecionado(null); }}>
          Hoje
        </Button>
      </div>

      {/* Cabeçalho dos dias da semana */}
      <div className="grid grid-cols-7 gap-1 text-xs text-muted-foreground">
        {WEEK_LABELS.map((d) => (
          <div key={d} className="px-2 py-1 capitalize font-medium">{d}</div>
        ))}
      </div>

      {/* Grid de dias */}
      <div className="grid grid-cols-7 gap-1">
        {dias.map((d) => {
          const k = format(d, "yyyy-MM-dd");
          const eventosDoDia = eventosPorDia.get(k) ?? [];
          const ehMesAtual = isSameMonth(d, refDate);
          const ehHoje = isSameDay(d, hoje);
          const selecionado = diaSelecionado === k;
          return (
            <button
              key={k}
              type="button"
              onClick={() => {
                setDiaSelecionado(k);
                onDiaClick?.(d);
              }}
              className={cn(
                "min-h-[90px] rounded-md border p-1.5 text-left transition-colors flex flex-col gap-1",
                ehMesAtual ? "bg-card" : "bg-muted/30 text-muted-foreground",
                ehHoje && "border-primary",
                selecionado && "ring-2 ring-primary/30",
                "hover:bg-muted/50",
              )}
            >
              <div className="flex items-center justify-between">
                <span className={cn("text-xs tabular-nums", ehHoje && "font-semibold")}>
                  {format(d, "d")}
                </span>
              </div>
              <div className="flex flex-col gap-0.5 overflow-hidden">
                {eventosDoDia.slice(0, 3).map((e) => (
                  <span
                    key={e.id}
                    role="link"
                    tabIndex={0}
                    onClick={(ev) => {
                      ev.stopPropagation();
                      onEventoClick(e.id);
                    }}
                    onKeyDown={(ev) => {
                      if (ev.key === "Enter" || ev.key === " ") {
                        ev.preventDefault();
                        ev.stopPropagation();
                        onEventoClick(e.id);
                      }
                    }}
                    className={cn(
                      "rounded px-1 py-0.5 text-[10px] truncate border cursor-pointer hover:opacity-80",
                      TIPO_CLASS[e.tipo],
                    )}
                    title={`${format(new Date(e.start_at), "HH:mm")} ${e.titulo}`}
                  >
                    <span className="tabular-nums">{format(new Date(e.start_at), "HH:mm")} </span>
                    {e.titulo}
                  </span>
                ))}
                {eventosDoDia.length > 3 && (
                  <span className="text-[10px] text-muted-foreground px-1">
                    +{eventosDoDia.length - 3} mais
                  </span>
                )}
              </div>
            </button>
          );
        })}
      </div>

      {/* Painel do dia selecionado — detalhe com hora, local, etc. */}
      {diaSelecionado && (
        <div className="rounded-md border bg-card p-3">
          <h3 className="text-sm font-medium mb-2 capitalize">
            {(() => {
              const partes = diaSelecionado.split("-");
              const d = new Date(
                Number(partes[0]),
                Number(partes[1]) - 1,
                Number(partes[2]),
              );
              return format(d, "EEEE, d 'de' MMMM 'de' yyyy", { locale: ptBR });
            })()}
          </h3>
          {(eventosPorDia.get(diaSelecionado) ?? []).length === 0 ? (
            <p className="text-xs text-muted-foreground">— vazio —</p>
          ) : (
            <div className="space-y-2">
              {(eventosPorDia.get(diaSelecionado) ?? []).map((e) => (
                <button
                  key={e.id}
                  type="button"
                  onClick={() => onEventoClick(e.id)}
                  className="w-full text-left rounded-md border bg-background p-2 hover:bg-muted/30"
                >
                  <div className="flex items-center gap-2 flex-wrap">
                    <Badge variant="outline" className={cn("font-normal text-xs", TIPO_CLASS[e.tipo])}>
                      {TIPO_LABEL[e.tipo]}
                    </Badge>
                    <span className="text-xs text-muted-foreground tabular-nums">
                      {format(new Date(e.start_at), "HH:mm")}—{format(new Date(e.end_at), "HH:mm")}
                    </span>
                  </div>
                  <div className="text-sm font-medium mt-1 break-words">{e.titulo}</div>
                  <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground flex-wrap">
                    {e.local && (
                      <span className="inline-flex items-center gap-1 min-w-0">
                        <MapPin className="h-3 w-3 shrink-0" />
                        <span className="truncate max-w-[200px]">{e.local}</span>
                      </span>
                    )}
                    {e.caso?.cliente?.nome && (
                      <span className="truncate">{e.caso.cliente.nome}</span>
                    )}
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// Tab "Agenda" dentro de /casos/$id — perícias e demais eventos vinculados
// ao caso. Botão "Nova perícia" pré-vincula ao caso.

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import {
  CalendarDays,
  Loader2,
  MapPin,
  Plus,
  User as UserIcon,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { AgendaSheet } from "@/components/agenda/agenda-sheet";
import { listarAgenda } from "@/lib/agenda/queries";
import {
  type AgendaEventoComJoins,
  TIPO_CLASS,
  TIPO_LABEL,
} from "@/lib/agenda/types";

interface Props {
  casoId: string;
}

type Modo =
  | { kind: "criar"; casoIdInicial: string }
  | { kind: "editar"; evento: AgendaEventoComJoins };

function fmtDataHora(start: string, end: string): string {
  const s = new Date(start);
  const e = new Date(end);
  const data = s.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "2-digit" });
  const hStart = s.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  const hEnd = e.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  return `${data} · ${hStart}–${hEnd}`;
}

export function CasoAgendaTab({ casoId }: Props) {
  const [carregando, setCarregando] = useState(true);
  const [eventos, setEventos] = useState<AgendaEventoComJoins[]>([]);
  const [sheetModo, setSheetModo] = useState<Modo | null>(null);

  const carregar = useCallback(async () => {
    setCarregando(true);
    try {
      const data = await listarAgenda({ caso_id: casoId });
      setEventos(data);
    } catch (e) {
      console.error(e);
      toast.error("Falha ao carregar agenda do caso.");
    } finally {
      setCarregando(false);
    }
  }, [casoId]);

  useEffect(() => { carregar(); }, [carregar]);

  function abrirEditor(id: string) {
    const e = eventos.find((x) => x.id === id);
    if (e) setSheetModo({ kind: "editar", evento: e });
  }

  const agora = Date.now();
  const futuros = eventos.filter((e) => new Date(e.end_at).getTime() >= agora);
  const passados = eventos
    .filter((e) => new Date(e.end_at).getTime() < agora)
    .sort((a, b) => new Date(b.start_at).getTime() - new Date(a.start_at).getTime());

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="font-medium">Agenda do caso</h2>
          <p className="text-xs text-muted-foreground">
            {eventos.length === 0
              ? "Nenhum evento registrado."
              : `${eventos.length} evento${eventos.length === 1 ? "" : "s"} (${futuros.length} futuro${futuros.length === 1 ? "" : "s"}).`}
          </p>
        </div>
        <Button
          size="sm"
          onClick={() => setSheetModo({ kind: "criar", casoIdInicial: casoId })}
        >
          <Plus className="h-4 w-4" />
          Nova perícia
        </Button>
      </div>

      {carregando ? (
        <div className="flex items-center justify-center h-40">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <div className="space-y-5">
          {futuros.length > 0 && (
            <section className="space-y-2">
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-medium">Futuros</h3>
                <Badge variant="outline" className="font-normal">{futuros.length}</Badge>
              </div>
              <div className="space-y-2">
                {futuros.map((e) => (
                  <CardEvento key={e.id} evento={e} onClick={() => abrirEditor(e.id)} />
                ))}
              </div>
            </section>
          )}
          {passados.length > 0 && (
            <section className="space-y-2">
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-medium">Passados</h3>
                <Badge variant="outline" className="font-normal">{passados.length}</Badge>
              </div>
              <div className="space-y-2">
                {passados.map((e) => (
                  <CardEvento key={e.id} evento={e} onClick={() => abrirEditor(e.id)} dim />
                ))}
              </div>
            </section>
          )}
          {eventos.length === 0 && (
            <p className="text-xs text-muted-foreground">— vazio —</p>
          )}
        </div>
      )}

      <AgendaSheet
        modo={sheetModo}
        onClose={() => setSheetModo(null)}
        onSaved={carregar}
      />
    </div>
  );
}

function CardEvento({
  evento: e,
  onClick,
  dim,
}: {
  evento: AgendaEventoComJoins;
  onClick: () => void;
  dim?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "w-full text-left rounded-md border bg-card hover:shadow transition-shadow",
        dim && "opacity-70",
      )}
    >
      <div className="p-3 space-y-2">
        <div className="flex items-center gap-2 flex-wrap">
          <Badge variant="outline" className={cn("font-normal", TIPO_CLASS[e.tipo])}>
            {TIPO_LABEL[e.tipo]}
          </Badge>
          <span className="text-xs text-muted-foreground">{fmtDataHora(e.start_at, e.end_at)}</span>
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
        <div className="flex items-center justify-between text-xs text-muted-foreground gap-2 flex-wrap">
          <div className="flex items-center gap-1 min-w-0">
            <UserIcon className="h-3 w-3 shrink-0" />
            <span className="truncate">{e.responsavel?.nome ?? "Sem responsável"}</span>
          </div>
          {e.local && (
            <div className="flex items-center gap-1 min-w-0 max-w-[60%]">
              <MapPin className="h-3 w-3 shrink-0" />
              <span className="truncate">{e.local}</span>
            </div>
          )}
        </div>
      </div>
    </button>
  );
}

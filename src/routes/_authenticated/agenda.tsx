// Página /agenda — lista de eventos (foco em perícias) agrupados por dia,
// com botão de criar e seções (Próximas / Passadas). Sync com Google
// Calendar entra no chunk 2.

import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  Calendar,
  CalendarDays,
  ExternalLink,
  Loader2,
  MapPin,
  Plus,
  User as UserIcon,
} from "lucide-react";

import { ClientOnly } from "@/components/client-only";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";

import { AgendaSheet } from "@/components/agenda/agenda-sheet";
import { listarAgenda } from "@/lib/agenda/queries";
import {
  type AgendaEventoComJoins,
  TIPO_CLASS,
  TIPO_LABEL,
} from "@/lib/agenda/types";

export const Route = createFileRoute("/_authenticated/agenda")({
  component: AgendaPage,
});

type Modo =
  | { kind: "criar" }
  | { kind: "editar"; evento: AgendaEventoComJoins };

function formatarDataLonga(iso: string): string {
  return new Date(iso).toLocaleDateString("pt-BR", {
    weekday: "long",
    day: "2-digit",
    month: "long",
  });
}

function formatarHora(iso: string): string {
  return new Date(iso).toLocaleTimeString("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function agruparPorDia(eventos: AgendaEventoComJoins[]): Array<{
  diaKey: string;
  diaLabel: string;
  eventos: AgendaEventoComJoins[];
}> {
  const map = new Map<string, AgendaEventoComJoins[]>();
  for (const e of eventos) {
    const d = new Date(e.start_at);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(e);
  }
  return Array.from(map.entries()).map(([key, evs]) => ({
    diaKey: key,
    diaLabel: formatarDataLonga(evs[0].start_at),
    eventos: evs,
  }));
}

function AgendaPage() {
  const [carregando, setCarregando] = useState(true);
  const [eventos, setEventos] = useState<AgendaEventoComJoins[]>([]);
  const [sheetModo, setSheetModo] = useState<Modo | null>(null);
  const [aba, setAba] = useState<"proximas" | "passadas">("proximas");

  const carregar = useCallback(async () => {
    setCarregando(true);
    try {
      const data = await listarAgenda({});
      setEventos(data);
    } catch (e) {
      console.error(e);
      toast.error("Falha ao carregar agenda.");
    } finally {
      setCarregando(false);
    }
  }, []);

  useEffect(() => { carregar(); }, [carregar]);

  const agora = Date.now();
  const proximas = useMemo(
    () => eventos.filter((e) => new Date(e.end_at).getTime() >= agora),
    [eventos, agora],
  );
  const passadas = useMemo(
    () => eventos
      .filter((e) => new Date(e.end_at).getTime() < agora)
      .sort((a, b) => new Date(b.start_at).getTime() - new Date(a.start_at).getTime()),
    [eventos, agora],
  );
  const lista = aba === "proximas" ? proximas : passadas;
  const dias = useMemo(() => agruparPorDia(lista), [lista]);

  function abrirEditor(id: string) {
    const e = eventos.find((x) => x.id === id);
    if (e) setSheetModo({ kind: "editar", evento: e });
  }

  return (
    <ClientOnly>
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="font-serif text-3xl font-semibold tracking-tight flex items-center gap-2">
              <Calendar className="h-6 w-6" />
              Agenda
            </h1>
            <p className="text-sm text-muted-foreground">
              Perícias e demais eventos do escritório. Sync com Google Calendar em breve.
            </p>
          </div>
          <Button onClick={() => setSheetModo({ kind: "criar" })}>
            <Plus className="h-4 w-4" />
            Nova perícia
          </Button>
        </div>

        <Tabs value={aba} onValueChange={(v) => setAba(v as "proximas" | "passadas")}>
          <TabsList>
            <TabsTrigger value="proximas">
              Próximas
              <Badge variant="outline" className="ml-2 font-normal">{proximas.length}</Badge>
            </TabsTrigger>
            <TabsTrigger value="passadas">
              Passadas
              <Badge variant="outline" className="ml-2 font-normal">{passadas.length}</Badge>
            </TabsTrigger>
          </TabsList>
        </Tabs>

        {carregando ? (
          <div className="flex items-center justify-center h-64">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : dias.length === 0 ? (
          <Card>
            <CardContent className="py-12 text-center text-sm text-muted-foreground">
              {aba === "proximas"
                ? "Nenhum evento agendado. Crie uma perícia pra começar."
                : "Nenhum evento passado registrado."}
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-6">
            {dias.map((grupo) => (
              <section key={grupo.diaKey}>
                <h2 className="text-sm font-medium text-muted-foreground mb-2 capitalize">
                  {grupo.diaLabel}
                </h2>
                <div className="space-y-2">
                  {grupo.eventos.map((e) => (
                    <button
                      key={e.id}
                      type="button"
                      onClick={() => abrirEditor(e.id)}
                      className="w-full text-left rounded-md border bg-card hover:shadow transition-shadow"
                    >
                      <div className="p-3 space-y-2">
                        <div className="flex items-center justify-between gap-2 flex-wrap">
                          <div className="flex items-center gap-2 min-w-0">
                            <Badge variant="outline" className={cn("font-normal", TIPO_CLASS[e.tipo])}>
                              {TIPO_LABEL[e.tipo]}
                            </Badge>
                            <span className="text-xs text-muted-foreground">
                              {formatarHora(e.start_at)} — {formatarHora(e.end_at)}
                            </span>
                          </div>
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
                            <span className="truncate">
                              {e.responsavel?.nome ?? "Sem responsável"}
                            </span>
                          </div>
                          {e.local && (
                            <div className="flex items-center gap-1 min-w-0 max-w-[60%]">
                              <MapPin className="h-3 w-3 shrink-0" />
                              <span className="truncate">{e.local}</span>
                            </div>
                          )}
                          {e.caso_id && (
                            <Link
                              to="/casos/$id"
                              params={{ id: e.caso_id }}
                              className="hover:underline truncate max-w-[60%] inline-flex items-center gap-1"
                              onClick={(ev) => ev.stopPropagation()}
                            >
                              {e.caso?.cliente?.nome ?? "Ver caso"}
                              <ExternalLink className="h-3 w-3" />
                            </Link>
                          )}
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              </section>
            ))}
          </div>
        )}

        <AgendaSheet
          modo={sheetModo}
          onClose={() => setSheetModo(null)}
          onSaved={carregar}
        />
      </div>
    </ClientOnly>
  );
}

// Agenda do PARCEIRO — só leitura, só PERÍCIAS dos casos dele.
//
// Os dados vêm da RPC pericias_do_parceiro() (SECURITY DEFINER): a RLS de
// agenda_eventos e tarefas é só-interno, então a função devolve a união
// sanitizada das duas fontes (eventos de agenda + tarefas de perícia),
// já filtrada por casos.parceiro_id = auth.uid().

import { Link } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  CalendarDays,
  ExternalLink,
  Loader2,
  MapPin,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { supabase } from "@/lib/supabase";
import { PERICIA_JUDICIAL_CLASS, TIPO_CLASS } from "@/lib/agenda/types";

interface PericiaParceiro {
  fonte: "evento" | "tarefa";
  id: string;
  caso_id: string | null;
  cliente_nome: string | null;
  titulo: string;
  start_at: string;
  end_at: string;
  local: string | null;
  natureza: "admin" | "judicial" | null;
}

// Mesma convenção de cores da agenda interna: judicial violeta, INSS verde.
function badgePericia(natureza: PericiaParceiro["natureza"]): {
  label: string;
  className: string;
} {
  if (natureza === "judicial")
    return { label: "Perícia Judicial", className: PERICIA_JUDICIAL_CLASS };
  if (natureza === "admin")
    return { label: "Perícia INSS", className: TIPO_CLASS.pericia };
  return { label: "Perícia", className: "" };
}

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

// Perícia "passa" só no fim do dia local: a de hoje de manhã continua em
// Próximas o dia inteiro (mesmo critério da agenda interna).
function fimDoDiaLocal(iso: string): Date {
  const d = new Date(iso);
  d.setHours(23, 59, 59, 999);
  return d;
}

function agruparPorDia(itens: PericiaParceiro[]): Array<{
  diaKey: string;
  diaLabel: string;
  itens: PericiaParceiro[];
}> {
  const map = new Map<string, PericiaParceiro[]>();
  for (const p of itens) {
    const d = new Date(p.start_at);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(p);
  }
  return Array.from(map.entries()).map(([key, its]) => ({
    diaKey: key,
    diaLabel: formatarDataLonga(its[0].start_at),
    itens: its,
  }));
}

export function AgendaPericiasParceiro() {
  const [carregando, setCarregando] = useState(true);
  const [pericias, setPericias] = useState<PericiaParceiro[]>([]);
  const [aba, setAba] = useState<"proximas" | "passadas">("proximas");

  const carregar = useCallback(async () => {
    setCarregando(true);
    try {
      const { data, error } = await supabase.rpc("pericias_do_parceiro");
      if (error) throw error;
      setPericias((data ?? []) as PericiaParceiro[]);
    } catch (e) {
      console.error(e);
      toast.error("Falha ao carregar as perícias.");
    } finally {
      setCarregando(false);
    }
  }, []);

  useEffect(() => {
    carregar();
  }, [carregar]);

  const { proximas, passadas } = useMemo(() => {
    const agora = new Date();
    const prox: PericiaParceiro[] = [];
    const pass: PericiaParceiro[] = [];
    for (const p of pericias) {
      (fimDoDiaLocal(p.end_at) < agora ? pass : prox).push(p);
    }
    prox.sort((a, b) => a.start_at.localeCompare(b.start_at));
    pass.sort((a, b) => b.start_at.localeCompare(a.start_at));
    return { proximas: prox, passadas: pass };
  }, [pericias]);

  const lista = aba === "proximas" ? proximas : passadas;
  const grupos = useMemo(() => agruparPorDia(lista), [lista]);

  if (carregando) {
    return (
      <div className="flex h-96 items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-semibold">
          <CalendarDays className="h-6 w-6" />
          Perícias
        </h1>
        <p className="text-sm text-muted-foreground">
          Perícias agendadas dos seus clientes.
        </p>
      </div>

      <Tabs value={aba} onValueChange={(v) => setAba(v as "proximas" | "passadas")}>
        <TabsList>
          <TabsTrigger value="proximas">
            Próximas ({proximas.length})
          </TabsTrigger>
          <TabsTrigger value="passadas">
            Passadas ({passadas.length})
          </TabsTrigger>
        </TabsList>
      </Tabs>

      {grupos.length === 0 && (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            {aba === "proximas"
              ? "Nenhuma perícia agendada no momento."
              : "Nenhuma perícia passada."}
          </CardContent>
        </Card>
      )}

      {grupos.map((g) => (
        <div key={g.diaKey} className="space-y-2">
          <h2 className="text-sm font-medium capitalize text-muted-foreground">
            {g.diaLabel}
          </h2>
          {g.itens.map((p) => (
            <Card key={`${p.fonte}:${p.id}`}>
              <CardContent className="flex flex-wrap items-center gap-x-4 gap-y-2 py-4">
                <div className="w-14 shrink-0 text-sm font-semibold tabular-nums">
                  {formatarHora(p.start_at)}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{p.titulo}</p>
                  <p className="truncate text-sm text-muted-foreground">
                    {p.cliente_nome ?? "(cliente não identificado)"}
                    {p.local ? (
                      <span className="ml-2 inline-flex items-center gap-1">
                        <MapPin className="inline h-3 w-3" />
                        {p.local}
                      </span>
                    ) : null}
                  </p>
                </div>
                <Badge
                  variant="outline"
                  className={cn("font-normal", badgePericia(p.natureza).className)}
                >
                  {badgePericia(p.natureza).label}
                </Badge>
                {p.caso_id && (
                  <Link
                    to="/casos/$id"
                    params={{ id: p.caso_id }}
                    className="inline-flex items-center gap-1 text-sm text-primary hover:underline"
                  >
                    Abrir caso <ExternalLink className="h-3.5 w-3.5" />
                  </Link>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      ))}
    </div>
  );
}

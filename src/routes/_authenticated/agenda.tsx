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
import { AgendaMes } from "@/components/agenda/agenda-mes";
import { listarAgenda } from "@/lib/agenda/queries";
import { type AgendaEventoComJoins, tipoBadge } from "@/lib/agenda/types";
import { TarefaSheet, type TarefaSheetModo } from "@/components/tarefas/tarefa-sheet";
import { listarTarefas } from "@/lib/tarefas/queries";
import { ehDoGrupo, type GrupoAgenda } from "@/lib/agenda/types";
import type { TarefaComJoins } from "@/lib/tarefas/types";
import { AgendaPericiasParceiro } from "@/components/agenda/agenda-pericias-parceiro";
import { useAuth } from "@/hooks/use-auth";
import { chaveDiaBR, chavesDiasBR, fimDoDiaBR, formatarBR, instanteBR } from "@/lib/fuso";

// A agenda mescla DUAS fontes: agenda_eventos + tarefas tipo='pericia' ativas
// (migradas do TI, criadas pelo processador do INSS ou na tela de Tarefas).
// A tarefa segue sendo a fonte da verdade — concluiu, some daqui. O id do
// pseudo-evento ganha este prefixo pra rotear o clique pro TarefaSheet.
const PREFIXO_TAREFA = "tarefa:";

function tarefaComoEvento(t: TarefaComJoins): AgendaEventoComJoins {
  // end_at = fim do dia (de Brasília) do prazo: perícia de hoje fica em
  // "Próximas" o dia inteiro (o filtro de passadas usa end_at < agora).
  const fimDoDia = fimDoDiaBR(t.due_at!);
  return {
    id: PREFIXO_TAREFA + t.id,
    caso_id: t.caso_id,
    processo_admin_id: t.processo_admin_id,
    processo_judicial_id: t.processo_judicial_id,
    responsavel_id: t.responsavel_id,
    tipo: "pericia",
    titulo: t.titulo,
    descricao: t.descricao,
    start_at: t.due_at!,
    end_at: fimDoDia.toISOString(),
    local: null,
    participantes: null,
    metadata: { origem_tarefa: true },
    // Tarefa nao tem conclusao propria: some da agenda quando concluida,
    // pela query. Os campos existem so pra casar com o tipo do evento.
    concluido_em: null,
    concluido_por: null,
    gcal_event_id: null,
    gcal_calendar_id: null,
    gcal_synced_at: null,
    created_by: t.created_by,
    created_at: t.created_at,
    updated_at: t.updated_at,
    responsavel: t.responsavel,
    caso: t.caso,
  };
}

function ehEventoDeTarefa(e: AgendaEventoComJoins): boolean {
  return (e.metadata as { origem_tarefa?: boolean } | null)?.origem_tarefa === true;
}

// So a PERICIA EM SI entra na agenda ("PERICIA AGENDADA - X", "Perícia INSS
// - X"...). Tarefas SOBRE pericia (acompanhar resultado, contatar parceiro,
// ligar pra agendar) ficam so em /tarefas. A flag metadata.pericia_evento e
// gravada pela migration/sheet; a heuristica cobre tarefa futura sem flag.
function ehPericiaEmSi(t: TarefaComJoins): boolean {
  const flag = (t.metadata as { pericia_evento?: boolean } | null)?.pericia_evento;
  if (flag === true) return true;
  if (flag === false) return false;
  return !/(acompanh|contatar|resultado|ligar|compareceu|agendamento de)/i.test(t.titulo);
}

export const Route = createFileRoute("/_authenticated/agenda")({
  component: AgendaRoute,
});

// Parceiro vê a agenda restrita: só perícias dos casos dele, sem criar/editar.
// Componentes separados (não early-return dentro de AgendaPage) pra não
// violar a ordem de hooks quando o tipo do usuário resolve.
function AgendaRoute() {
  const { usuario } = useAuth();
  if (!usuario) {
    return (
      <div className="flex h-96 items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }
  if (usuario.tipo === "parceiro") return <AgendaPericiasParceiro />;
  return <AgendaPage />;
}

type Modo = { kind: "criar" } | { kind: "editar"; evento: AgendaEventoComJoins };

function formatarDataLonga(iso: string): string {
  return formatarBR(iso, {
    weekday: "long",
    day: "2-digit",
    month: "long",
  });
}

function agruparPorDia(eventos: AgendaEventoComJoins[]): Array<{
  diaKey: string;
  diaLabel: string;
  eventos: AgendaEventoComJoins[];
}> {
  // Evento de vários dias (ausência) entra em todos os dias que ocupa, igual
  // ao calendário — senão some da lista a partir do segundo dia.
  const map = new Map<string, AgendaEventoComJoins[]>();
  for (const e of eventos) {
    for (const key of chavesDiasBR(e.start_at, e.end_at)) {
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(e);
    }
  }
  return Array.from(map.entries()).map(([key, evs]) => {
    // Rótulo vem da CHAVE, não do primeiro evento: num dia de continuação o
    // start_at é de dias antes e mostraria a data errada no cabeçalho.
    const [a, m, d] = key.split("-").map(Number);
    return {
      diaKey: key,
      diaLabel: formatarDataLonga(instanteBR(a, m, d, 12).toISOString()),
      eventos: evs,
    };
  });
}

function AgendaPage() {
  const [carregando, setCarregando] = useState(true);
  const [eventos, setEventos] = useState<AgendaEventoComJoins[]>([]);
  const [tarefasPericia, setTarefasPericia] = useState<TarefaComJoins[]>([]);
  // Filtro por grupo (tudo/pericias/atendimentos) e "esconder concluidos".
  // Sao so de VISTA: nao mexem no que vem do banco, so no que aparece.
  const [grupo, setGrupo] = useState<GrupoAgenda>("todos");
  const [esconderConcluidos, setEsconderConcluidos] = useState(false);
  const [sheetModo, setSheetModo] = useState<Modo | null>(null);
  const [tarefaSheetModo, setTarefaSheetModo] = useState<TarefaSheetModo | null>(null);
  const [vista, setVista] = useState<"mes" | "lista">("mes");
  const [aba, setAba] = useState<"proximas" | "passadas">("proximas");

  const carregar = useCallback(async () => {
    setCarregando(true);
    try {
      const [data, pericias] = await Promise.all([
        listarAgenda({}),
        listarTarefas({ tipo: ["pericia"], status: ["a_fazer", "fazendo"] }),
      ]);
      setEventos(data);
      setTarefasPericia(pericias.filter((t) => !!t.due_at && ehPericiaEmSi(t)));
    } catch (e) {
      console.error(e);
      toast.error("Falha ao carregar agenda.");
    } finally {
      setCarregando(false);
    }
  }, []);

  useEffect(() => {
    carregar();
  }, [carregar]);

  // Mescla eventos "de verdade" com as tarefas de perícia.
  const mesclados = useMemo(() => {
    const deTarefas = tarefasPericia.map(tarefaComoEvento);
    return [...eventos, ...deTarefas].sort(
      (a, b) => new Date(a.start_at).getTime() - new Date(b.start_at).getTime(),
    );
  }, [eventos, tarefasPericia]);

  // Vista: aplica grupo + esconder concluidos por cima da lista mesclada.
  // Tarefa de pericia nao tem `concluido_em` (some sozinha ao ser concluida,
  // pela propria query), entao ela nunca cai no filtro de concluidos.
  const itensVisiveis = useMemo(() => {
    return mesclados.filter((e) => {
      if (!ehDoGrupo(e.tipo, grupo)) return false;
      if (esconderConcluidos && e.concluido_em) return false;
      return true;
    });
  }, [mesclados, grupo, esconderConcluidos]);

  const agora = Date.now();
  const proximas = useMemo(
    () => itensVisiveis.filter((e) => new Date(e.end_at).getTime() >= agora),
    [itensVisiveis, agora],
  );
  const passadas = useMemo(
    () =>
      itensVisiveis
        .filter((e) => new Date(e.end_at).getTime() < agora)
        .sort((a, b) => new Date(b.start_at).getTime() - new Date(a.start_at).getTime()),
    [itensVisiveis, agora],
  );
  const lista = aba === "proximas" ? proximas : passadas;
  const dias = useMemo(() => agruparPorDia(lista), [lista]);

  function abrirEditor(id: string) {
    if (id.startsWith(PREFIXO_TAREFA)) {
      const t = tarefasPericia.find((x) => x.id === id.slice(PREFIXO_TAREFA.length));
      if (t) setTarefaSheetModo({ kind: "editar", tarefa: t });
      return;
    }
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
              Todos os compromissos do escritório: perícias, audiências, guichê e atendimentos. Toda
              perícia agendada entra aqui automaticamente — tarefas sobre perícia (acompanhar,
              contatar) ficam em Tarefas.
            </p>
          </div>
          <Button onClick={() => setSheetModo({ kind: "criar" })}>
            <Plus className="h-4 w-4" />
            Novo evento
          </Button>
        </div>

        {/* Filtro por grupo + esconder concluídos.
            Dois grupos em vez de um botão por tipo: "Atendimentos" junta
            guichê, atendimento e reunião, que é como a equipe pensa. */}
        <div className="flex flex-wrap items-center gap-2">
          {(
            [
              ["todos", "Tudo"],
              ["pericias", "Perícias"],
              ["audiencias", "Audiências"],
              ["atendimentos", "Atendimentos"],
            ] as Array<[GrupoAgenda, string]>
          ).map(([g, label]) => (
            <Button
              key={g}
              size="sm"
              variant={grupo === g ? "default" : "outline"}
              onClick={() => setGrupo(g)}
            >
              {label}
            </Button>
          ))}
          <Button
            size="sm"
            variant={esconderConcluidos ? "default" : "outline"}
            onClick={() => setEsconderConcluidos((v) => !v)}
            className="ml-auto"
            title="Some com o que já foi realizado"
          >
            {esconderConcluidos ? "Mostrando só pendentes" : "Esconder concluídos"}
          </Button>
        </div>

        {/* Toggle Mês ↔ Lista */}
        <Tabs value={vista} onValueChange={(v) => setVista(v as "mes" | "lista")}>
          <TabsList>
            <TabsTrigger value="mes">Calendário do mês</TabsTrigger>
            <TabsTrigger value="lista">Lista</TabsTrigger>
          </TabsList>
        </Tabs>

        {/* Tabs Próximas / Passadas — só na vista Lista */}
        {vista === "lista" && (
          <Tabs value={aba} onValueChange={(v) => setAba(v as "proximas" | "passadas")}>
            <TabsList>
              <TabsTrigger value="proximas">
                Próximas
                <Badge variant="outline" className="ml-2 font-normal">
                  {proximas.length}
                </Badge>
              </TabsTrigger>
              <TabsTrigger value="passadas">
                Passadas
                <Badge variant="outline" className="ml-2 font-normal">
                  {passadas.length}
                </Badge>
              </TabsTrigger>
            </TabsList>
          </Tabs>
        )}

        {carregando ? (
          <div className="flex items-center justify-center h-64">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : vista === "mes" ? (
          <AgendaMes eventos={itensVisiveis} onEventoClick={abrirEditor} />
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
                            <Badge
                              variant="outline"
                              className={cn("font-normal", tipoBadge(e).className)}
                            >
                              {tipoBadge(e).label}
                            </Badge>
                            {ehEventoDeTarefa(e) && (
                              <Badge variant="outline" className="font-normal text-[10px]">
                                via tarefa
                              </Badge>
                            )}
                          </div>
                          {e.gcal_event_id && (
                            <Badge variant="outline" className="font-normal text-xs">
                              <CalendarDays className="h-3 w-3" />
                              Google
                            </Badge>
                          )}
                        </div>
                        {/* Sem horário por decisão de produto: o card mostra
                          só o tipo (perícia INSS/judicial) e o nome do
                          cliente. A hora fica no evento. */}
                        <div className="font-medium text-sm break-words">
                          {e.caso?.cliente?.nome ?? e.titulo}
                        </div>
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
                              Ver caso
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

        <AgendaSheet modo={sheetModo} onClose={() => setSheetModo(null)} onSaved={carregar} />

        {/* Sheet de tarefa: abre quando o item da agenda veio de uma tarefa
          de perícia (editar prazo/responsável/status reflete aqui). */}
        <TarefaSheet
          modo={tarefaSheetModo}
          onClose={() => setTarefaSheetModo(null)}
          onSaved={carregar}
        />
      </div>
    </ClientOnly>
  );
}

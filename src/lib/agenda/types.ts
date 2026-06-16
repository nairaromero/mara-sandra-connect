// Tipos da agenda (mirror do schema em migration_agenda_eventos.sql).

export type AgendaTipo = "pericia" | "audiencia" | "reuniao" | "interno";

export interface AgendaEventoRow {
  id: string;
  caso_id: string | null;
  processo_admin_id: string | null;
  processo_judicial_id: string | null;
  responsavel_id: string | null;
  tipo: AgendaTipo;
  titulo: string;
  descricao: string | null;
  start_at: string;
  end_at: string;
  local: string | null;
  participantes: unknown;
  metadata: Record<string, unknown>;
  gcal_event_id: string | null;
  gcal_calendar_id: string | null;
  gcal_synced_at: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface AgendaEventoComJoins extends AgendaEventoRow {
  responsavel: { id: string; nome: string | null } | null;
  caso: {
    id: string;
    cliente: { id: string; nome: string | null } | null;
  } | null;
}

export const TIPO_LABEL: Record<AgendaTipo, string> = {
  pericia: "Perícia",
  audiencia: "Audiência",
  reuniao: "Reunião",
  interno: "Interno",
};

// Cores por tipo (para badges/blocos no calendário). 2 ramps no app — usa
// utilities Tailwind que adaptam a dark mode.
export const TIPO_CLASS: Record<AgendaTipo, string> = {
  pericia: "border-emerald-500/50 bg-emerald-50 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200",
  audiencia: "border-blue-500/50 bg-blue-50 text-blue-900 dark:bg-blue-950 dark:text-blue-200",
  reuniao: "border-amber-500/50 bg-amber-50 text-amber-900 dark:bg-amber-950 dark:text-amber-200",
  interno: "border-border bg-muted text-muted-foreground",
};

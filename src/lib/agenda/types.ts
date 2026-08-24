// Tipos da agenda (mirror do schema em migration_agenda_eventos.sql).

export type AgendaTipo = "pericia" | "audiencia" | "reuniao" | "interno" | "guiche" | "atendimento";

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
  /** Quando foi dado como realizado. null = pendente. */
  concluido_em: string | null;
  concluido_por: string | null;
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
  guiche: "Guichê OAB",
  audiencia: "Audiência",
  reuniao: "Reunião",
  interno: "Interno",
  atendimento: "Atendimento",
};

// Grupos do filtro da agenda. "Atendimento" junta tudo que e gente sentada na
// sua frente — guiche, atendimento e reuniao —, que e como a equipe pensa na
// pratica. Audiencia pegava carona no grupo de pericias; desde a reuniao de
// agosto/2026 tem botao proprio (pedido 00:42). Interno fica fora de todos.
export const GRUPOS_AGENDA = {
  pericias: ["pericia"] as Array<AgendaTipo>,
  audiencias: ["audiencia"] as Array<AgendaTipo>,
  atendimentos: ["guiche", "atendimento", "reuniao"] as Array<AgendaTipo>,
};

export type GrupoAgenda = keyof typeof GRUPOS_AGENDA | "todos";

export function ehDoGrupo(tipo: string, grupo: GrupoAgenda): boolean {
  if (grupo === "todos") return true;
  return (GRUPOS_AGENDA[grupo] as Array<string>).includes(tipo);
}

// Cores por tipo (para badges/blocos no calendário). 2 ramps no app — usa
// utilities Tailwind que adaptam a dark mode.
export const TIPO_CLASS: Record<AgendaTipo, string> = {
  pericia:
    "border-emerald-500/50 bg-emerald-50 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200",
  // Guichê em rosa: não colide com perícia (verde), audiência (azul),
  // reunião (âmbar) nem perícia judicial (violeta).
  guiche: "border-pink-500/50 bg-pink-50 text-pink-900 dark:bg-pink-950 dark:text-pink-200",
  audiencia: "border-blue-500/50 bg-blue-50 text-blue-900 dark:bg-blue-950 dark:text-blue-200",
  reuniao: "border-amber-500/50 bg-amber-50 text-amber-900 dark:bg-amber-950 dark:text-amber-200",
  // Atendimento em ciano: proximo do azul da audiencia sem se confundir com
  // ele, e longe do verde da pericia.
  atendimento: "border-cyan-500/50 bg-cyan-50 text-cyan-900 dark:bg-cyan-950 dark:text-cyan-200",
  interno: "border-border bg-muted text-muted-foreground",
};

// Perícia JUDICIAL destaca em violeta; perícia INSS/administrativa fica no
// verde padrão do tipo. Natureza vem do processo vinculado; sem vínculo,
// heurística pelo título ("Perícia Judicial - X" / "Perícia INSS - X").
export const PERICIA_JUDICIAL_CLASS =
  "border-violet-500/50 bg-violet-50 text-violet-900 dark:bg-violet-950 dark:text-violet-200";

// Legenda do calendário. Sai das MESMAS constantes que pintam os badges, pra
// não descrever uma cor que mudou de lugar. A ordem segue a frequência no
// escritório: perícia é o grosso da agenda.
export const LEGENDA_AGENDA: Array<{ label: string; className: string }> = [
  { label: "Perícia INSS", className: TIPO_CLASS.pericia },
  { label: "Perícia judicial", className: PERICIA_JUDICIAL_CLASS },
  { label: "Audiência", className: TIPO_CLASS.audiencia },
  { label: "Reunião", className: TIPO_CLASS.reuniao },
  { label: "Interno", className: TIPO_CLASS.interno },
];

export type PericiaNatureza = "admin" | "judicial" | null;

export function naturezaPericia(e: {
  tipo: string;
  processo_judicial_id?: string | null;
  processo_admin_id?: string | null;
  titulo: string;
}): PericiaNatureza {
  if (e.tipo !== "pericia") return null;
  if (e.processo_judicial_id) return "judicial";
  if (e.processo_admin_id) return "admin";
  if (/judicial/i.test(e.titulo)) return "judicial";
  if (/inss/i.test(e.titulo)) return "admin";
  return null;
}

// Rótulo + classe do badge considerando a natureza da perícia.
export function tipoBadge(e: {
  tipo: AgendaTipo;
  processo_judicial_id?: string | null;
  processo_admin_id?: string | null;
  titulo: string;
}): { label: string; className: string } {
  const nat = naturezaPericia(e);
  if (nat === "judicial") return { label: "Perícia Judicial", className: PERICIA_JUDICIAL_CLASS };
  if (nat === "admin") return { label: "Perícia INSS", className: TIPO_CLASS.pericia };
  return { label: TIPO_LABEL[e.tipo], className: TIPO_CLASS[e.tipo] };
}

// Tipos de tarefas (mirror do schema em planning/sql-migrations/migration_tarefas.sql).

export type TarefaStatus = "a_fazer" | "fazendo" | "feito" | "cancelado";
export type TarefaTipo =
  | "interna"
  | "prazo"
  | "pericia"
  | "pos_protocolo"
  | "contato_cliente";
export type TarefaOrigem =
  | "manual"
  | "template"
  | "sync_inss_email"
  | "sync_djen"
  | "sync_legalmail";

export interface TarefaRow {
  id: string;
  caso_id: string | null;
  processo_admin_id: string | null;
  processo_judicial_id: string | null;
  responsavel_id: string | null;
  tipo: TarefaTipo;
  status: TarefaStatus;
  prioridade: number;
  titulo: string;
  descricao: string | null;
  due_at: string | null;
  origem: TarefaOrigem;
  origem_ref: string | null;
  lembretes: unknown;
  gcal_event_id: string | null;
  metadata: Record<string, unknown>;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
}

export interface ProcessoDoCasoOpcao {
  id: string;
  natureza: "admin" | "judicial";
  rotulo: string;
}

export interface TarefaComJoins extends TarefaRow {
  responsavel: { id: string; nome: string | null } | null;
  caso: {
    id: string;
    cliente: { id: string; nome: string | null } | null;
  } | null;
}

// Item de template. Pode criar uma TAREFA (default) ou um EVENTO de agenda.
// Itens de agenda têm semântica diferente: usam o "tipo" do enum de agenda
// (pericia/audiencia/reuniao/interno), duração em minutos, sem prioridade
// nem responsável (vem do form).
export interface TarefaTemplateItem {
  // Onde o item vai parar quando o template é aplicado:
  //  - "tarefa" (default): cria registro em `tarefas`.
  //  - "agenda": cria registro em `agenda_eventos` (perícia, audiência…).
  //  - "andamento": cria registro em `andamentos` (usado p/ comunicar
  //    automaticamente o parceiro, ex: "Benefício concedido — iremos analisar
  //    e repassar"). visivel_parceiro default = true.
  destino?: "tarefa" | "agenda" | "andamento";
  titulo: string;
  descricao?: string;
  // Quando destino=tarefa, tipo é TarefaTipo. Quando destino=agenda, é AgendaTipo.
  // destino=andamento ignora.
  tipo: string;
  prioridade?: number;
  offset_dias?: number;
  // Âncora de prazo (tarefas): "hoje" (default), "data_cessacao" (do e-mail),
  // "agenda" (start_at do evento criado no mesmo apply),
  // "sexta_antes_agenda" (sexta-feira anterior ao agenda).
  due_relative_to?: "hoje" | "data_cessacao" | "agenda" | "sexta_antes_agenda";
  // Apenas itens destino=agenda
  duracao_min?: number;
  // Apenas itens destino=andamento: força visibilidade pro parceiro
  // (default true quando destino=andamento).
  visivel_parceiro?: boolean;
  executor_email?: string;
  interessados_emails?: string[];
  meta?: Record<string, unknown>;
}

export interface TarefaTemplateRow {
  id: string;
  nome: string;
  rotulo: string | null;
  gatilho: string;
  descricao: string | null;
  itens: TarefaTemplateItem[];
  ativo: boolean;
  oculto_na_ui?: boolean;
}

export function templateTemAgenda(t: TarefaTemplateRow): boolean {
  return t.itens.some((i) => i.destino === "agenda");
}

export const STATUS_LABEL: Record<TarefaStatus, string> = {
  a_fazer: "A fazer",
  fazendo: "Fazendo",
  feito: "Feito",
  cancelado: "Cancelado",
};

export const STATUS_ORDEM: TarefaStatus[] = ["a_fazer", "fazendo", "feito", "cancelado"];

export const TIPO_LABEL: Record<TarefaTipo, string> = {
  interna: "Interna",
  prazo: "Prazo",
  pericia: "Perícia",
  pos_protocolo: "Pós-protocolo",
  contato_cliente: "Contato cliente",
};

export const PRIORIDADE_LABEL: Record<number, string> = {
  1: "Urgente",
  2: "Alta",
  3: "Normal",
  4: "Baixa",
};

export const ORIGEM_LABEL: Record<TarefaOrigem, string> = {
  manual: "Manual",
  template: "Template",
  sync_inss_email: "INSS (e-mail)",
  sync_djen: "DJEN",
  sync_legalmail: "LegalMail",
};

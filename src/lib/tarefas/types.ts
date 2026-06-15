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

export interface TarefaTemplateRow {
  id: string;
  nome: string;
  gatilho: string;
  descricao: string | null;
  itens: Array<{
    titulo: string;
    descricao?: string;
    tipo: TarefaTipo;
    prioridade: number;
    offset_dias?: number;
    executor_email?: string;
    interessados_emails?: string[];
    meta?: Record<string, unknown>;          // copiado pra tarefa.metadata
  }>;
  ativo: boolean;
  oculto_na_ui?: boolean;
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

// Formas do que as funções `qg_*` devolvem — só metadados e contagens.

export interface QgEu {
  papel: "dono" | "operacao" | "suporte" | "leitura";
  break_glass: boolean;
  permissoes: Array<string>;
  exige_aal2: boolean;
  aal: string;
}

export interface QgEscritorio {
  id: string;
  slug: string;
  nome: string;
  cnpj: string | null;
  status: "provisionando" | "ativo" | "suspenso" | "encerrado";
  plano: string;
  padrao_sistema: boolean;
  criado_em: string;
  suspenso_em: string | null;
  suspenso_motivo: string | null;
  encerrado_em: string | null;
  membros_ativos: number;
  admins: number;
  admins_sem_mfa: number;
  casos: number;
  documentos: number;
  tokens_mcp: number;
  ultimo_acesso: string | null;
  suporte_aberto: number;
  /** total de escritórios que a busca alcança (count over) */
  total: number;
}

export interface QgMembro {
  usuario_id: string;
  nome: string | null;
  email: string | null;
  papel: string;
  papel_nome: string;
  tipo_acesso: "interno" | "parceiro";
  status: "convidado" | "ativo" | "desativado";
  mfa: boolean;
  ultimo_acesso: string | null;
  desde: string;
  total: number;
}

export interface QgAlerta {
  escritorio_id: string;
  nome: string;
  alerta: string;
}

export interface QgSaude {
  grupo: "rotina" | "cron" | "fila" | "rede";
  item: string;
  escritorio_id: string | null;
  estado: string;
  quando: string | null;
  detalhe: string | null;
}

export interface QgSuporte {
  id: string;
  escritorio_id: string;
  escritorio_nome: string;
  staff_nome: string | null;
  meu: boolean;
  motivo: string;
  ticket: string | null;
  horas: number;
  status: "pendente" | "aprovado" | "recusado" | "encerrado";
  break_glass: boolean;
  solicitado_em: string;
  inicio: string | null;
  fim: string | null;
  valido_agora: boolean;
}

export interface QgAprovacao {
  id: string;
  acao: string;
  escritorio_id: string | null;
  escritorio_nome: string | null;
  pedido_por_nome: string | null;
  pedido_em: string;
  status: "pendente" | "aprovada" | "cancelada" | "executada";
  posso_aprovar: boolean;
  libera_em: string | null;
}

export interface QgStaff {
  usuario_id: string;
  nome: string | null;
  email: string | null;
  papel: QgEu["papel"];
  break_glass: boolean;
  ativo: boolean;
  mfa: boolean;
  ultimo_acesso: string | null;
}

export interface QgAuditoria {
  id: number;
  escritorio_id: string | null;
  escritorio_nome: string | null;
  ator_nome: string | null;
  tipo_ator: string;
  acao: string;
  recurso: string | null;
  recurso_id: string | null;
  detalhes: Record<string, unknown>;
  created_at: string;
}

export const ROTULO_STATUS: Record<QgEscritorio["status"], string> = {
  provisionando: "Provisionando",
  ativo: "Ativo",
  suspenso: "Suspenso",
  encerrado: "Encerrado",
};

export const ROTULO_PAPEL_STAFF: Record<QgEu["papel"], string> = {
  dono: "Dono",
  operacao: "Operação",
  suporte: "Suporte",
  leitura: "Leitura",
};

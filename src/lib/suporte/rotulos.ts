// Rotulos, em portugues, do que a plataforma / o suporte / o admin fez no
// escritorio (acoes gravadas por private.auditar). Acao desconhecida aparece
// crua — melhor do que sumir.

export const ROTULO_ACAO: Record<string, string> = {
  "suporte.solicitar": "Pediu acesso de suporte",
  "suporte.aprovar": "Aprovou o acesso de suporte",
  "suporte.recusar": "Recusou o acesso de suporte",
  "suporte.encerrar": "Encerrou o acesso de suporte",
  "suporte.abrir": "Abriu, em sessão de suporte",
  "suporte.break_glass": "Entrou por emergência (break-glass)",
  "escritorio.criar": "Criou o escritório",
  "escritorio.editar": "Editou o cadastro do escritório",
  "escritorio.primeiro_admin": "Vinculou o primeiro administrador",
  "escritorio.suspender": "Suspendeu o escritório",
  "escritorio.reativar": "Reativou o escritório",
  "escritorio.encerrar": "Encerrou o escritório",
  "escritorio.eliminacao_pedida": "Pediu a eliminação dos dados",
  "escritorio.eliminar": "Eliminou os dados",
  "membro.desativar": "Desativou um vínculo",
  "membro.trocar_titular": "Trocou o titular",
  "staff.definir": "Alterou a equipe do QG",
};

export const ROTULO_TIPO_ATOR: Record<string, string> = {
  membro: "Administrador do escritório",
  suporte: "Suporte (sessão aprovada)",
  plataforma: "Equipe da plataforma",
  sistema: "Sistema",
};

export function rotuloAcao(acao: string): string {
  return ROTULO_ACAO[acao] ?? acao;
}

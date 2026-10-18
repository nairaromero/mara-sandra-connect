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
  "escritorio.marca": "Alterou a marca do escritório",
  // Mudança de ACESSO dentro do escritório (migration_rbac_25). Sem rótulo, a
  // trilha mostrava a chave crua — "equipe.permissao_ajustada" — para quem
  // abre a Auditoria.
  "equipe.convidado": "Convidou alguém para a equipe",
  "equipe.desligado": "Desligou alguém da equipe",
  "equipe.reativado": "Reativou alguém da equipe",
  "equipe.papel_alterado": "Trocou o papel de alguém",
  "equipe.permissao_ajustada": "Ajustou uma permissão por pessoa",
  "equipe.permissoes_resetadas": "Desfez os ajustes e voltou ao papel",
  "parceiro.convidado": "Convidou um parceiro",
  "parceiro.email_alterado": "Alterou o e-mail de um parceiro",
  "parceiro.desligado": "Desligou um parceiro",
  "parceiro.reativado": "Reativou um parceiro",
  "parceiro.excluido": "Excluiu um parceiro",
  "cliente.excluido": "Excluiu um cliente e o que era dele",
  "integracao.salvar": "Salvou uma credencial de integração",
  "integracao.testar": "Testou uma integração",
  "integracao.token": "Gerou um token de integração",
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

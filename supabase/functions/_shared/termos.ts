// Termos do parceiro — a versão vigente e o que é "aceite válido". UM lugar
// (card #249): a tela (o bloqueio de /boas-vindas, o selo em /parceiros) e as
// functions que mandam e-mail com dado de cliente decidem pela mesma regra.
// Antes a versão era uma constante só da tela, e nenhuma function conferia o
// aceite: 17 de 23 parceiros recebiam dado de cliente sem ter assinado o DPA.
//
// Módulo PURO (sem import): a tela importa por `@shared/termos`
// (régua: e2e/unit/fonte-unica-documentos.test.ts).

/** Versão dos termos. Incrementar quando o conteúdo mudar — habilita re-aceite. */
// 1.1 (28/10, #496): a plataforma passa a se chamar Legal Connect nos três
// documentos e os dados do escritório saem da configuração de cada escritório.
// Todo parceiro assina de novo; até lá recebe só o aviso sem dado de cliente.
export const TERMOS_VERSAO = "1.1-2026-10-28";

/** O mínimo de `usuarios` que decide o aceite. */
export interface SituacaoDoAceite {
  tipo?: string | null;
  onboarded_em?: string | null;
  termos_versao?: string | null;
}

/**
 * O parceiro assinou os termos VIGENTES? Fez o primeiro acesso (onboarded_em)
 * e a versão que aceitou é a de hoje. É a mesma condição que solta o parceiro
 * de /boas-vindas — quem não passa ali não recebe dado de cliente por e-mail.
 */
export function aceiteValido(u: SituacaoDoAceite | null | undefined): boolean {
  return !!u?.onboarded_em && u.termos_versao === TERMOS_VERSAO;
}

/**
 * Esta pessoa está barrada de receber dado de cliente por falta de aceite?
 * Só vale para quem entra como PARCEIRO (`tipo = 'parceiro'`): alguém da
 * equipe que também é parceiro comercial (tipo interno, eh_parceiro) não
 * assina o DPA de parceiro — é do escritório — e segue recebendo normalmente.
 * Sem `tipo` na linha, conta como parceiro (falha para o lado fechado).
 */
export function parceiroSemAceite(u: SituacaoDoAceite | null | undefined): boolean {
  return u?.tipo !== "interno" && !aceiteValido(u);
}

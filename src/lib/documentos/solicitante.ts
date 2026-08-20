// Quem abriu uma solicitação de documento, em texto pra UI.
//
// `solicitado_por` fica NULL quando quem criou foi o robô do e-mail INSS
// (edge function inss-email-processor, service_role) — essas vêm sempre com
// origem "template:<nome>". Sem isso a tela mostrava só "Solicitado em ..."
// e a Naira não tinha como saber de quem era o pedido.

export interface SolicitanteLite {
  id: string;
  nome: string | null;
}

export function descreverSolicitante(
  solicitante: SolicitanteLite | null | undefined,
  origem: string | null | undefined,
): string {
  if (solicitante?.nome) return solicitante.nome;
  if (origem && origem.startsWith("template:")) return "Automático (e-mail do INSS)";
  return "Não registrado";
}

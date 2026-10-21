// Checklist de conferência do caso novo (card #434).
//
// O mínimo que todo caso precisa ter, seja qual for o benefício. Proposta
// levada à Naira em 2026-09-29; vira configuração do escritório quando ela
// fechar a lista com quem confere na prática.
//
// Por benefício (fase 2, se a lista fixa incomodar): incapacidade pede laudo
// médico, atestado e laudo do INSS; tempo especial pede PPP, LTCAT e PGR/PPRA;
// rural pede declaração de atividade rural; pensão por morte pede certidão de
// óbito e de casamento.
//
// CADA ITEM ACEITA MAIS DE UM TIPO (Naira, 20/10). O caso com 24 arquivos no
// staging tinha CNIS e mesmo assim a tarefa dizia "Falta: CNIS": o arquivo era
// o `cnis_resumido` (as "relações previdenciárias") e a lista cobrava o
// `cnis`, o extrato completo. No padrão do escritório os dois são a mesma
// família — "extrato completo e resumido com o mesmo número".

export interface ItemChecklist {
  /** Tipos que satisfazem o item; o primeiro dá o nome na tela. */
  tipos: string[];
}

export const CHECKLIST_BASE: ItemChecklist[] = [
  { tipos: ["procuracao"] },
  { tipos: ["contrato_honorarios"] },
  { tipos: ["rg_cpf"] },
  { tipos: ["comprovante_residencia"] },
  // completo ou resumido: qualquer um resolve o item
  { tipos: ["cnis", "cnis_resumido"] },
];

/** Os itens do checklist que nenhum documento do caso satisfaz. */
export function itensFaltantes(tiposPresentes: Set<string>): ItemChecklist[] {
  return CHECKLIST_BASE.filter((item) => !item.tipos.some((t) => tiposPresentes.has(t)));
}

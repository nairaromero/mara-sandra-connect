// Checklist de conferência do caso novo (card #434).
//
// A LISTA não mora aqui (pedido da Naira, 05/10: "nada fixo no código"). Ela é
// do escritório e do benefício, no banco:
//   · `escritorio_config.checklist_documentos` — o que todo caso precisa ter;
//   · `tipos_beneficio.documentos_exigidos` — o a mais de cada benefício;
// editadas em Configurações › Tipos de benefício. Quem junta as duas para UM
// caso é a RPC `checklist_documentos_do_caso` — um lugar só.
//
// CADA ITEM ACEITA MAIS DE UM TIPO (Naira, 20/10). O caso com 24 arquivos no
// staging tinha CNIS e mesmo assim a tarefa dizia "Falta: CNIS": o arquivo era
// o `cnis_resumido` (as "relações previdenciárias") e a lista cobrava o
// `cnis`, o extrato completo. No padrão do escritório os dois são a mesma
// família — "extrato completo e resumido com o mesmo número".

import { supabase } from "@/lib/supabase";
import { TIPOS_DOCUMENTO_LABEL } from "@/lib/documentos/tipos";

/** Um item: os tipos que o satisfazem; o primeiro dá o nome na tela. */
export type ItemChecklist = string[];

/** O checklist de um caso (lista base do escritório + a do benefício). Erro estoura. */
export async function checklistDoCaso(casoId: string): Promise<ItemChecklist[]> {
  const { data, error } = await supabase.rpc("checklist_documentos_do_caso", { p_caso_id: casoId });
  if (error) throw new Error(`checklist do caso: ${error.message}`);
  return (data ?? []) as ItemChecklist[];
}

/** Os itens que nenhum documento do caso satisfaz. */
export function itensFaltantes(itens: ItemChecklist[], tiposPresentes: Set<string>): ItemChecklist[] {
  return itens.filter((item) => !item.some((t) => tiposPresentes.has(t)));
}

/** "CNIS" para ["cnis", "cnis_resumido"]; "CNIS ou CNIS resumido" quando `todos`. */
export function nomeDoItem(item: ItemChecklist, todos = false): string {
  const nomes = item.map((t) => TIPOS_DOCUMENTO_LABEL[t] ?? t);
  return todos ? nomes.join(" ou ") : (nomes[0] ?? "");
}

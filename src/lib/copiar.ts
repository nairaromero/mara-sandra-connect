// O ÚNICO lugar que escreve na área de transferência. Devolve se copiou, para
// quem quer reagir na tela; o aviso de sucesso é opcional (quem marca "copiado"
// de outro jeito não passa `ok`), o de falha sai sempre.

import { toast } from "sonner";

export const FALHA_AO_COPIAR = "Não foi possível copiar. Selecione o texto e copie manualmente.";

export async function copiarTexto(texto: string, ok?: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(texto);
    if (ok) toast.success(ok);
    return true;
  } catch (err) {
    console.error("copiar:", err);
    toast.error(FALHA_AO_COPIAR);
    return false;
  }
}

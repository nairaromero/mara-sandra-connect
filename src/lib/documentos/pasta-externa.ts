// A pasta que chega por LINK (card #434).
//
// Tem parceiro que não anexa nada no caso: manda um link do OneDrive (ou de um
// Google de outra conta) com a pasta do cliente. O link vive no caso, aparece
// no topo da aba Documentos e a tarefa de organizar sabe que ele existe.
//
// Um lugar só para: o nome do provedor (lido do endereço) e a validação do que
// pode ser colado — a tela e a conferência leem daqui. A LISTA de provedores é
// a mesma da function que confere o compartilhamento
// (supabase/functions/_shared/provedores-pasta.ts, por `@shared`).

import { provedorDoHost, type StatusDoLink } from "@shared/provedores-pasta";
import { supabase } from "@/lib/supabase";
import { lerLista } from "@/lib/leitura";

export type { StatusDoLink };

export interface PastaExterna {
  id: string;
  caso_id: string;
  url: string;
  rotulo: string | null;
  criado_por: string | null;
  created_at: string;
  atualizado_em: string | null;
  /** Última checagem do compartilhamento (function `checar-link-pasta`). */
  checado_em?: string | null;
  checado_status?: StatusDoLink | null;
  checado_detalhe?: string | null;
}

/** A frase e o tom de cada resultado — um lugar só, a aba Documentos e a tarefa usam. */
export const ROTULO_DO_LINK: Record<StatusDoLink, { texto: string; tom: string }> = {
  aberto: {
    texto: "compartilhado",
    tom: "bg-emerald-500/15 text-emerald-800 dark:text-emerald-300",
  },
  fechado: {
    texto: "não compartilhado — pede login",
    tom: "bg-destructive/15 text-destructive",
  },
  indefinido: {
    texto: "não deu para conferir",
    tom: "bg-muted text-muted-foreground",
  },
};

/**
 * Nome do provedor do link, para a tela dizer "Pasta no OneDrive" em vez de
 * repetir a URL. Endereço que não reconheço devolve o host — nunca "inválido":
 * reconhecer o provedor não é condição para guardar o link.
 */
export function provedorDaPasta(url: string): string {
  const host = hostDe(url);
  if (!host) return "link";
  return provedorDoHost(host)?.nome ?? host.replace(/^www\./, "");
}

function hostDe(url: string): string | null {
  try {
    return new URL(url).host.toLowerCase();
  } catch {
    return null;
  }
}

/**
 * Normaliza o que foi colado. Devolve `null` quando não dá para guardar — é a
 * mesma régua do banco (`check (url ~* '^https?://…')`), para a tela recusar
 * antes de levar um erro de constraint na cara da pessoa.
 */
export function normalizarLinkPasta(bruto: string): string | null {
  const texto = bruto.trim();
  if (!texto || /\s/.test(texto)) return null;
  // Link colado do navegador às vezes vem sem o esquema ("1drv.ms/f/…").
  const comEsquema = /^https?:\/\//i.test(texto) ? texto : `https://${texto}`;
  const host = hostDe(comEsquema);
  if (!host || !host.includes(".")) return null;
  return comEsquema;
}

/**
 * As pastas por link de um caso — a aba Documentos e a tarefa de organizar
 * leem por aqui (antes cada uma tinha a própria consulta, e a da tarefa
 * tratava o erro à mão). Erro estoura: "não consegui ler" não é "não tem".
 */
export function lerPastasDoCaso(casoId: string): Promise<PastaExterna[]> {
  return lerLista<PastaExterna>(
    supabase
      .from("caso_pastas_externas")
      .select(
        "id, caso_id, url, rotulo, criado_por, created_at, atualizado_em, checado_em, checado_status, checado_detalhe",
      )
      .eq("caso_id", casoId)
      .order("created_at")
      .order("id"),
    "pastas por link do caso",
  );
}

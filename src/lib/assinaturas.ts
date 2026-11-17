// Assinatura eletrônica (#517, ZapSign): o que a tela sabe sobre um envio. A
// tela só LÊ `assinaturas`; quem escreve é a function `zapsign-enviar`.
// Status, "em curso", signatário e formato aceito são os MESMOS das functions:
// vêm de `@shared/assinatura` (supabase/functions/_shared/assinatura.ts).
import { supabase } from "@/lib/supabase";
import { mensagemDeErroEdge } from "@/lib/edge-function-error";
import type { Signatario, StatusAssinatura } from "@shared/assinatura";

export { EM_CURSO, formatoAssinavel, type Signatario, type StatusAssinatura } from "@shared/assinatura";

/** A linha de `assinaturas` como a tela lê (as colunas de `COLUNAS_ASSINATURA`). */
export interface Assinatura {
  id: string;
  documento_id: string | null;
  documento_assinado_id: string | null;
  nome: string;
  sandbox: boolean;
  status: StatusAssinatura;
  signatarios: Array<Signatario>;
  created_at: string;
  assinado_em: string | null;
}

export const COLUNAS_ASSINATURA = "id, documento_id, documento_assinado_id, nome, sandbox, status, signatarios, created_at, assinado_em";

/** Chama a function do ZapSign; o erro sai com a frase que a function devolveu. */
export async function chamarZapsign(body: Record<string, unknown>): Promise<{ assinatura: Assinatura }> {
  const resp = await supabase.functions.invoke("zapsign-enviar", { body });
  if (resp.error) throw new Error(await mensagemDeErroEdge(resp.error, "Não consegui falar com o ZapSign agora."));
  const dados = resp.data as { error?: string; assinatura?: Assinatura } | null;
  if (dados?.error || !dados?.assinatura) throw new Error(dados?.error ?? "resposta sem a assinatura");
  return { assinatura: dados.assinatura };
}

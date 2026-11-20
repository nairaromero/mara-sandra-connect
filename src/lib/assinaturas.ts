// Assinatura eletrônica (#517, ZapSign): o que a tela sabe sobre um envio. A
// tela só LÊ `assinaturas`; quem escreve é a function `zapsign-enviar`.
// Status, "em curso", signatário e formato aceito são os MESMOS das functions:
// vêm de `@shared/assinatura` (supabase/functions/_shared/assinatura.ts).
import { supabase } from "@/lib/supabase";
import { mensagemDeErroEdge } from "@/lib/edge-function-error";
import type { CampoDoModelo, ModeloZapsign, Signatario, StatusAssinatura } from "@shared/assinatura";
import type { ParagrafoDoContrato } from "@shared/modelo-contrato";

export { EM_CURSO, formatoAssinavel, type CampoDoModelo, type ModeloZapsign, type Signatario, type StatusAssinatura } from "@shared/assinatura";

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
async function invocar<T>(body: Record<string, unknown>): Promise<T> {
  const resp = await supabase.functions.invoke("zapsign-enviar", { body });
  if (resp.error) throw new Error(await mensagemDeErroEdge(resp.error, "Não consegui falar com o ZapSign agora."));
  const dados = resp.data as ({ error?: string } & T) | null;
  if (!dados || dados.error) throw new Error(dados?.error ?? "resposta vazia do servidor");
  return dados;
}

/**
 * Envio e atualização: devolvem a linha de `assinaturas`. `aviso` vem quando o
 * envio saiu, mas não como a pessoa espera (ex.: sem WhatsApp, porque o
 * telefone do cadastro não serve) — a tela mostra, não esconde.
 */
export async function chamarZapsign(body: Record<string, unknown>): Promise<{ assinatura: Assinatura; aviso?: string }> {
  const dados = await invocar<{ assinatura?: Assinatura; aviso?: string }>(body);
  if (!dados.assinatura) throw new Error("resposta sem a assinatura");
  return { assinatura: dados.assinatura, aviso: dados.aviso };
}

/** Os modelos de contrato da conta do ZapSign do escritório ativo (#522). */
export async function listarModelosZapsign(): Promise<Array<ModeloZapsign>> {
  return (await invocar<{ modelos: Array<ModeloZapsign> }>({ action: "modelos" })).modelos;
}

/** Os campos de um modelo, já com o que o cadastro do cliente do caso responde. */
export function detalharModeloZapsign(casoId: string, modeloToken: string) {
  return invocar<{ modelo: ModeloZapsign; campos: Array<CampoDoModelo>; cliente: { nome: string; email: string; telefone: string } }>({
    action: "modelo", caso_id: casoId, modelo_token: modeloToken,
  });
}

/**
 * O contrato do modelo com os campos preenchidos, para conferir antes de
 * enviar. Não cria documento no ZapSign. `pendencias` = o que ainda impede o envio.
 */
export function previaDoModeloZapsign(casoId: string, modeloToken: string, respostas: Record<string, string>) {
  return invocar<{ paragrafos: Array<ParagrafoDoContrato>; pendencias: Array<string> }>({
    action: "previa_modelo", caso_id: casoId, modelo_token: modeloToken, respostas,
  });
}

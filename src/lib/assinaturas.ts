// Assinatura eletrônica (#517, ZapSign): o que a tela sabe sobre um envio. A
// tela só LÊ `assinaturas`; quem escreve é a function `zapsign-enviar`.
// Status, "em curso", signatário e formato aceito são os MESMOS das functions:
// vêm de `@shared/assinatura` (supabase/functions/_shared/assinatura.ts).
import { supabase } from "@/lib/supabase";
import { mensagemDeErroEdge } from "@/lib/edge-function-error";
import { criarCacheModelos } from "@/lib/assinaturas-cache";
import type { CampoDoModelo, ModeloZapsign, Signatario, StatusAssinatura } from "@shared/assinatura";
import type { ParagrafoDoContrato } from "@shared/modelo-contrato";

export { EM_CURSO, formatoAssinavel, type CampoDoModelo, type ModeloZapsign, type Signatario, type StatusAssinatura } from "@shared/assinatura";

/**
 * Um signatário como a TELA o vê (#545): a view `assinaturas_tela` esconde o
 * `sign_url` cru — a credencial de assinatura — e devolve no lugar `tem_link`,
 * que diz se há um link vivo para copiar. O link em si vem sob demanda, no
 * clique, por `buscarLinkDeAssinatura` (RPC `assinatura_sign_url`, com escopo e
 * trilha).
 */
export type SignatarioTela = Omit<Signatario, "sign_url"> & { tem_link: boolean };

/** A linha de `assinaturas` como a tela lê (a view `assinaturas_tela`, colunas de `COLUNAS_ASSINATURA`). */
export interface Assinatura {
  id: string;
  documento_id: string | null;
  documento_assinado_id: string | null;
  nome: string;
  sandbox: boolean;
  status: StatusAssinatura;
  signatarios: Array<SignatarioTela>;
  created_at: string;
  assinado_em: string | null;
}

export const COLUNAS_ASSINATURA = "id, documento_id, documento_assinado_id, nome, sandbox, status, signatarios, created_at, assinado_em";

/**
 * O link de assinatura (sign_url) de um signatário — a URL portadora que É a
 * credencial para assinar. Não vem na lista (a view esconde): é buscado sob
 * demanda, no "Copiar link", pela RPC `assinatura_sign_url`, que confere escopo
 * (quem gerencia ou o dono do caso) e registra a leitura na trilha. `null`
 * quando não há mais link.
 */
export async function buscarLinkDeAssinatura(assinaturaId: string, signatarioToken: string): Promise<string | null> {
  const { data, error } = await supabase.rpc("assinatura_sign_url", {
    p_assinatura_id: assinaturaId,
    p_signatario_token: signatarioToken,
  });
  if (error) throw new Error(error.message);
  return (data as string | null) ?? null;
}

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
  return invocar<{ modelo: ModeloZapsign; campos: Array<CampoDoModelo>; cliente: { nome: string; email: string; telefone: string; cpf: string; endereco: string } }>({
    action: "modelo", caso_id: casoId, modelo_token: modeloToken,
  });
}

/**
 * O texto do modelo (campos por preencher), para a tela montar a prévia do
 * contrato. Não cria documento no ZapSign.
 */
export async function textoDoModeloZapsign(casoId: string, modeloToken: string): Promise<Array<ParagrafoDoContrato>> {
  return (await invocar<{ paragrafos: Array<ParagrafoDoContrato> }>({ action: "texto_modelo", caso_id: casoId, modelo_token: modeloToken })).paragrafos;
}

/**
 * O cache da aba para os modelos do ZapSign: lista (aparece na hora e se confere
 * em segundo plano) e texto de cada modelo. Regras em `assinaturas-cache.ts`.
 */
export const cacheModelos = criarCacheModelos({
  buscarLista: listarModelosZapsign,
  buscarTexto: (modeloToken, casoId) => textoDoModeloZapsign(casoId, modeloToken),
});

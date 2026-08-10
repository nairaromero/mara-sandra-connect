// Resolucao da integracao de IA de um usuario, com fallback pra chave
// compartilhada do escritorio.
//
// Antes cada funcao repetia o mesmo select em ia_integracoes por usuario_id, e
// quem nao tinha chave propria simplesmente nao tinha IA. Como so uma pessoa
// cadastrou chave, na pratica a IA nao existia pro resto da equipe.
//
// Precedencia (implementada no RPC ia_integracao_efetiva):
//   1. chave propria do usuario — mesmo se estiver inativa
//   2. chave marcada como compartilhada, so pra usuario interno
//
// Manter a resolucao em UM lugar importa: ela decide qual conta e cobrada.

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";

export interface IntegracaoIA {
  provider: string;
  modelo: string;
  api_key_cipher: string;
  api_key_iv: string;
  ativo: boolean;
  /** false quando veio da chave compartilhada do escritorio. */
  eh_propria: boolean;
}

export type ResultadoIntegracao =
  | { ok: true; integ: IntegracaoIA }
  | { ok: false; error: string; code: "nao_configurado" | "desativado"; status: 412 };

/**
 * Carrega a integracao efetiva. Devolve erro pronto pra resposta HTTP em vez de
 * lancar — todas as funcoes tratam esses dois casos igual.
 */
export async function carregarIntegracao(
  admin: SupabaseClient,
  usuarioId: string,
): Promise<ResultadoIntegracao> {
  const { data } = await admin.rpc("ia_integracao_efetiva", { p_usuario: usuarioId });
  const linha = Array.isArray(data) && data.length > 0
    ? data[0] as Record<string, unknown>
    : null;

  if (!linha) {
    return {
      ok: false,
      code: "nao_configurado",
      status: 412,
      error: "assistente de IA nao configurado",
    };
  }
  if (!linha.ativo) {
    return { ok: false, code: "desativado", status: 412, error: "assistente desativado" };
  }

  return {
    ok: true,
    integ: {
      provider: String(linha.provider),
      modelo: String(linha.modelo),
      api_key_cipher: String(linha.api_key_cipher),
      api_key_iv: String(linha.api_key_iv),
      ativo: true,
      eh_propria: linha.eh_propria === true,
    },
  };
}

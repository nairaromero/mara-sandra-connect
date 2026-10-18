// Qual chave de IA vale numa chamada — UM lugar só (túnel). Decide quem é
// cobrado e para qual provedor o dado do cliente vai.
//
// Desde #451 (parte 2) a chave é do ESCRITÓRIO: `escritorio_integracoes`,
// tipo 'ia', gravada pela function integracoes-escritorio (que cifra e
// audita). A chave pessoal (ia_integracoes) não vale mais: num produto com
// vários escritórios ela furava o controle do admin e a cobrança.
// Sem escritório ativo, não há chave: nunca cair na de outro escritório.
// Rotina sem pessoa (e-mails do INSS) passa só o escritório dono do dado.
// (Antes: RPC ia_integracao_efetiva, chave pessoal primeiro e "compartilhada"
// depois; o erro da RPC era ignorado e virava "não configurado".)

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";
import type { LinhaUso, RegistroUso } from "./ia-providers.ts";

export interface IntegracaoIA {
  provider: string;
  modelo: string;
  api_key_cipher: string;
  api_key_iv: string;
  ativo: boolean;
  /** de quem é a chave cobrada (hoje sempre o escritório) */
  origem: "escritorio";
}

export type ResultadoIntegracao =
  | { ok: true; integ: IntegracaoIA }
  | { ok: false; error: string; code: "nao_configurado" | "desativado"; status: 412 };

const NAO_CONFIGURADO: ResultadoIntegracao = {
  ok: false,
  code: "nao_configurado",
  status: 412,
  error: "a IA do escritório não está configurada (Configurações › Integrações)",
};

/**
 * Carrega a chave que vale para esta chamada. Erro de leitura do banco
 * estoura (não vira "não configurado" calado); os dois casos de "sem IA"
 * voltam prontos para a resposta HTTP.
 */
export async function carregarIntegracao(
  admin: SupabaseClient,
  escritorioId: string | null | undefined,
): Promise<ResultadoIntegracao> {
  if (!escritorioId) return NAO_CONFIGURADO;

  const { data: esc, error } = await admin
    .from("escritorio_integracoes")
    .select("config, ativo, segredo_cipher, segredo_iv")
    .eq("escritorio_id", escritorioId)
    .eq("tipo", "ia")
    .maybeSingle();
  if (error) throw new Error(`lendo a IA do escritório: ${error.message}`);

  const config = (esc?.config ?? {}) as Record<string, unknown>;

  if (!esc || !esc.segredo_cipher || !esc.segredo_iv) return NAO_CONFIGURADO;
  if (!esc.ativo) {
    return { ok: false, code: "desativado", status: 412, error: "a IA do escritório está desligada" };
  }
  const provider = typeof config.provider === "string" ? config.provider : "";
  const modelo = typeof config.modelo === "string" ? config.modelo : "";
  if (!provider || !modelo) return NAO_CONFIGURADO;

  return {
    ok: true,
    integ: {
      provider,
      modelo,
      api_key_cipher: String(esc.segredo_cipher),
      api_key_iv: String(esc.segredo_iv),
      ativo: true,
      origem: "escritorio",
    },
  };
}

/**
 * Registro de uso para o adaptador (`chatWith(..., { registro })`): uma linha
 * em ia_uso por chamada, sem conteúdo. Falha de gravação não derruba a IA
 * (o adaptador só registra no log).
 */
export function registroDeUso(
  admin: SupabaseClient,
  ctx: {
    escritorioId: string | null | undefined;
    usuarioId?: string | null;
    funcao: string;
    origem: IntegracaoIA["origem"] | "teste";
  },
): RegistroUso {
  return {
    gravar: async (linha: LinhaUso) => {
      if (!ctx.escritorioId) return;
      const { error } = await admin.from("ia_uso").insert({
        escritorio_id: ctx.escritorioId,
        usuario_id: ctx.usuarioId ?? null,
        funcao: ctx.funcao,
        origem_chave: ctx.origem,
        ...linha,
      });
      if (error) throw new Error(error.message);
    },
  };
}

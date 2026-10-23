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
import { decryptSecret } from "./crypto.ts";
import type { Credencial, LinhaUso, RegistroUso } from "./ia-providers.ts";

export interface IntegracaoIA {
  provider: string;
  modelo: string;
  api_key_cipher: string;
  api_key_iv: string;
  /** Workspace da Anthropic (`wrkspc_…`), para chave que vale para mais de um. */
  workspace_id: string | null;
  ativo: boolean;
  /** de quem é a chave cobrada (hoje sempre o escritório) */
  origem: "escritorio";
}

/**
 * A credencial pronta para o adaptador: chave decifrada + workspace. UM lugar
 * decifra a chave de IA (régua: e2e/unit/ia-registro-de-uso.test.ts).
 */
export async function abrirCredencial(integ: IntegracaoIA): Promise<Credencial> {
  return {
    chave: await decryptSecret(integ.api_key_cipher, integ.api_key_iv),
    workspaceId: integ.workspace_id,
  };
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
 * Carrega a chave que vale para esta chamada. A regra de "configurada" (linha
 * 'ia' ligada, com segredo, provedor e modelo) tem espelho no banco em
 * `private.escritorio_tem_ia`, que decide quem entra na fila de leitura de
 * documentos — mude os dois juntos. Erro de leitura do banco
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

  if (!esc || !esc.segredo_cipher || !esc.segredo_iv) return NAO_CONFIGURADO;
  if (!esc.ativo) {
    return { ok: false, code: "desativado", status: 412, error: "a IA do escritório está desligada" };
  }
  const integ = integracaoDaLinha(esc);
  if (!integ || !integ.provider || !integ.modelo) return NAO_CONFIGURADO;
  return { ok: true, integ };
}

/**
 * Linha de `escritorio_integracoes` (tipo 'ia') → IntegracaoIA. UM lugar faz
 * esse mapeamento; `sobrepor` troca campos de config (o que está na tela
 * antes de salvar, no Testar/Ver modelos). Sem segredo, null.
 */
export function integracaoDaLinha(
  linha: { config: unknown; ativo: boolean; segredo_cipher: string | null; segredo_iv: string | null },
  sobrepor: Record<string, unknown> = {},
): IntegracaoIA | null {
  if (!linha.segredo_cipher || !linha.segredo_iv) return null;
  const config = { ...((linha.config ?? {}) as Record<string, unknown>), ...sobrepor };
  const texto = (v: unknown) => (typeof v === "string" ? v.trim() : "");
  return {
    provider: texto(config.provider),
    modelo: texto(config.modelo),
    api_key_cipher: linha.segredo_cipher,
    api_key_iv: linha.segredo_iv,
    workspace_id: texto(config.workspace_id) || null,
    ativo: linha.ativo,
    origem: "escritorio",
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

// Integrações POR ESCRITÓRIO (Legalmail, Tramitação Inteligente, ZapSign): a credencial
// vem de `escritorio_integracoes` do escritório ativo, decifrada aqui — nunca
// de uma variável global. O escritório padrão do sistema ainda pode cair na
// variável de ambiente antiga (LEGALMAIL_TOKEN / TI_TOKEN) enquanto não
// cadastrar a sua pela tela; os outros escritórios NUNCA caem nela (era esse o
// vazamento: qualquer escritório usava a conta da Mara).
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { decryptSecret } from "./crypto.ts";

export type TipoIntegracao = "legalmail" | "ti" | "zapsign";
export interface Integracao {
  tipo: TipoIntegracao;
  config: Record<string, unknown>;
  segredo: string;
  /** "escritorio" = cadastrada na tela; "ambiente" = legado do escritório padrão */
  origem: "escritorio" | "ambiente";
}

// O ZapSign nasceu depois do legado: não tem variável global, só a credencial
// cadastrada pelo escritório.
const ENV_LEGADO: Record<TipoIntegracao, string | null> = { legalmail: "LEGALMAIL_TOKEN", ti: "TI_TOKEN", zapsign: null };
const NOME: Record<TipoIntegracao, string> = { legalmail: "Legalmail", ti: "Tramitação Inteligente", zapsign: "ZapSign" };

export async function integracaoDoEscritorio(
  admin: SupabaseClient,
  escritorioId: string | null | undefined,
  tipo: TipoIntegracao,
): Promise<Integracao | null> {
  if (!escritorioId) return null;
  const { data, error } = await admin
    .from("escritorio_integracoes")
    .select("config, ativo, segredo_cipher, segredo_iv")
    .eq("escritorio_id", escritorioId)
    .eq("tipo", tipo)
    .maybeSingle();
  if (error) throw new Error(`lendo integração ${tipo}: ${error.message}`);
  if (data && data.ativo && data.segredo_cipher && data.segredo_iv) {
    const segredo = await decryptSecret(data.segredo_cipher, data.segredo_iv);
    return { tipo, config: (data.config ?? {}) as Record<string, unknown>, segredo, origem: "escritorio" };
  }
  // legado: só o escritório padrão do sistema, e só enquanto a variável existir
  const variavel = ENV_LEGADO[tipo];
  const legado = variavel ? Deno.env.get(variavel) : null;
  if (!legado) return null;
  const { data: esc } = await admin.from("escritorios").select("padrao_sistema").eq("id", escritorioId).maybeSingle();
  if (!esc?.padrao_sistema) return null;
  return { tipo, config: {}, segredo: legado, origem: "ambiente" };
}

/** Resposta padrão quando o escritório não tem a integração: 412, com código pra tela. */
export function semIntegracao(tipo: TipoIntegracao, corsHeaders: Record<string, string>): Response {
  const nome = NOME[tipo];
  return new Response(
    JSON.stringify({ error: `${nome} não está configurado neste escritório`, code: "integracao_nao_configurada", tipo }),
    { status: 412, headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
}

// Endereços: fixos no produto; LEGALMAIL_BASE_URL / TI_BASE_URL só existem no
// ambiente LOCAL (mock de e2e/demo/mocks). O TI ainda aceita base_url por
// escritório (instalações próprias).
export function baseLegalmail(): string {
  return (Deno.env.get("LEGALMAIL_BASE_URL") ?? "https://app.legalmail.com.br").replace(/\/+$/, "");
}
export function baseTI(config: Record<string, unknown>): string {
  const cfg = typeof config.base_url === "string" && config.base_url.trim() ? config.base_url.trim() : null;
  return (Deno.env.get("TI_BASE_URL") ?? cfg ?? "https://planilha.tramitacaointeligente.com.br/api/v1").replace(/\/+$/, "");
}
/**
 * ZapSign: produção ou sandbox conforme `config.ambiente` do escritório (o
 * sandbox não tem validade jurídica e não gasta a cota do plano).
 */
export function baseZapsign(config: Record<string, unknown>): string {
  const padrao = config.ambiente === "sandbox" ? "https://sandbox.api.zapsign.com.br" : "https://api.zapsign.com.br";
  return (Deno.env.get("ZAPSIGN_BASE_URL") ?? padrao).replace(/\/+$/, "");
}

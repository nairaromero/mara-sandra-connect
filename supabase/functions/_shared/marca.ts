// Marca do ESCRITORIO para e-mails e mensagens: nome de exibicao, logo e cor
// de escritorio_config.marca (RBAC 10). Sem escritorio ou sem marca, cai no
// nome do escritorio; sem escritorio nenhum, na marca do produto.

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

export interface MarcaEscritorio {
  nome: string;
  /** URL absoluta (e-mail nao resolve caminho relativo) ou null */
  logoUrl: string | null;
  cor: string | null;
}

const APP_URL = (Deno.env.get("APP_URL") || "https://marasandraconnect.com").replace(/\/+$/, "");
export const MARCA_PRODUTO: MarcaEscritorio = { nome: "Legal Connect", logoUrl: `${APP_URL}/marca/legal-connect-email.png`, cor: null };

export async function marcaDoEscritorio(admin: SupabaseClient, escritorioId: string | null | undefined): Promise<MarcaEscritorio> {
  if (!escritorioId) return MARCA_PRODUTO;
  const { data, error } = await admin
    .from("escritorios")
    .select("nome, escritorio_config(marca)")
    .eq("id", escritorioId)
    .maybeSingle();
  if (error || !data) return MARCA_PRODUTO;
  const cfg = data.escritorio_config as { marca?: Record<string, unknown> } | Array<{ marca?: Record<string, unknown> }> | null;
  const marca = (Array.isArray(cfg) ? cfg[0]?.marca : cfg?.marca) ?? {};
  const nome = String(marca.nome_exibicao || data.nome || "").trim() || MARCA_PRODUTO.nome;
  const logo = typeof marca.logo_url === "string" && marca.logo_url ? marca.logo_url : null;
  return {
    nome,
    logoUrl: logo ? (logo.startsWith("/") ? `${APP_URL}${logo}` : logo) : null,
    cor: typeof marca.cor === "string" ? marca.cor : null,
  };
}

/** "Nome do escritorio <noreply@...>" sem caracteres que quebram o cabecalho. */
export function remetente(m: MarcaEscritorio, endereco = "noreply@marasandraconnect.com"): string {
  const nome = m.nome.replace(/[<>"\r\n]/g, "").slice(0, 60);
  return `${nome} <${endereco}>`;
}

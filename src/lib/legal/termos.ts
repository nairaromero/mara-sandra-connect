// Documentos legais aceitos pelo parceiro no primeiro acesso.
//
// As fontes (markdown) ficam em src/content/legal/*.md com tokens {{ }} de
// autofill. Este módulo injeta os dados legais do ESCRITÓRIO (do banco:
// escritorio_config.dados_legais, editados em Configurações → Escritório — #496;
// antes eram constantes com os dados de um escritório só) e os do parceiro
// (preenchidos no aceite), e expõe utilitários de render + hash para o registro
// imutável do aceite. A plataforma é a Legal Connect.

import dpaRaw from "@/content/legal/dpa.md?raw";
import termoRaw from "@/content/legal/termo-uso.md?raw";
import politicaRaw from "@/content/legal/politica.md?raw";
import { dataBR } from "@/lib/fuso";

// Versão dos termos e a régua do aceite: um lugar só, que as edge functions de
// e-mail e WhatsApp também leem (#249). Incrementar lá quando o conteúdo mudar.
import { TERMOS_VERSAO } from "@shared/termos";
export { TERMOS_VERSAO, parceiroSemAceite } from "@shared/termos";

/** Os dados do escritório que os documentos legais citam (escritorio_config.dados_legais). */
export interface DadosLegais {
  razao_social: string;
  cnpj: string;
  endereco: string;
  /** Comarca do foro de eleição. */
  foro: string;
  // Canal de privacidade (LGPD). Escritório de pequeno porte é dispensado de
  // indicar Encarregado/DPO formal (Resolução CD/ANPD nº 2/2022), mas deve
  // manter um canal de comunicação com o titular.
  privacidade_contato: string;
  privacidade_email: string;
  privacidade_tel: string;
}

/** Sem estes, o documento sairia com "[a preencher]" — o parceiro não pode assinar. */
export const CAMPOS_LEGAIS_OBRIGATORIOS = ["razao_social", "cnpj", "endereco", "foro"] as const;

/** Lê o jsonb sem confiar nele: campo ausente ou que não é texto vira "". */
export function dadosLegaisDe(bruto: unknown): DadosLegais {
  const o = bruto && typeof bruto === "object" && !Array.isArray(bruto) ? (bruto as Record<string, unknown>) : {};
  const t = (k: string) => (typeof o[k] === "string" ? (o[k] as string).trim() : "");
  return {
    razao_social: t("razao_social"),
    cnpj: t("cnpj"),
    endereco: t("endereco"),
    foro: t("foro"),
    privacidade_contato: t("privacidade_contato"),
    privacidade_email: t("privacidade_email"),
    privacidade_tel: t("privacidade_tel"),
  };
}

/** Os campos obrigatórios que faltam (vazio = pronto para assinar). */
export function faltamDadosLegais(d: DadosLegais): Array<(typeof CAMPOS_LEGAIS_OBRIGATORIOS)[number]> {
  return CAMPOS_LEGAIS_OBRIGATORIOS.filter((k) => !d[k]);
}

export interface ParceiroDados {
  nome: string;
  documento: string; // CPF ou CNPJ
  oab: string;
  oab_uf: string;
  endereco: string;
}

export interface DocumentoRenderizado {
  id: string;
  titulo: string;
  requerAssinatura: boolean;
  texto: string;
}

const DEFS: Array<{
  id: string;
  titulo: string;
  requerAssinatura: boolean;
  raw: string;
}> = [
  { id: "dpa", titulo: "Acordo de Tratamento de Dados", requerAssinatura: true, raw: dpaRaw },
  { id: "termo-uso", titulo: "Termo de Uso", requerAssinatura: true, raw: termoRaw },
  { id: "politica", titulo: "Política de Privacidade", requerAssinatura: false, raw: politicaRaw },
];

function oabCompleta(d: ParceiroDados): string {
  const uf = (d.oab_uf || "").trim().toUpperCase();
  const num = (d.oab || "").trim();
  if (!num) return "[OAB não informada]";
  return uf ? `OAB/${uf} nº ${num}` : `OAB nº ${num}`;
}

function dataHoje(): string {
  // O "hoje" do termo é o dia em Brasília, não o do navegador.
  try {
    return dataBR(new Date());
  } catch {
    return "";
  }
}

function preencher(raw: string, d: ParceiroDados, e: DadosLegais): string {
  // Canal de privacidade: nome — e-mail — telefone, omitindo o que estiver vazio.
  const canalPrivacidade = [e.privacidade_contato, e.privacidade_email, e.privacidade_tel]
    .map((s) => (s || "").trim())
    .filter((s) => s && !s.startsWith("["))
    .join(" — ");

  const mapa: Record<string, string> = {
    "{{VERSAO}}": TERMOS_VERSAO,
    "{{DATA}}": dataHoje(),
    "{{ESCRITORIO_NOME}}": e.razao_social || "[a preencher]",
    "{{ESCRITORIO_CNPJ}}": e.cnpj || "[a preencher]",
    "{{ESCRITORIO_ENDERECO}}": e.endereco || "[a preencher]",
    "{{CANAL_PRIVACIDADE}}": canalPrivacidade || "[a preencher]",
    "{{FORO}}": e.foro || "[a preencher]",
    "{{PARCEIRO_NOME}}": d.nome || "[nome]",
    "{{PARCEIRO_DOC}}": d.documento || "[CPF/CNPJ]",
    "{{PARCEIRO_OAB}}": oabCompleta(d),
    "{{PARCEIRO_ENDERECO}}": d.endereco || "[endereço]",
  };
  let out = raw;
  for (const [token, valor] of Object.entries(mapa)) {
    out = out.split(token).join(valor);
  }
  return out;
}

export function renderDocumentos(d: ParceiroDados, escritorio: DadosLegais): Array<DocumentoRenderizado> {
  return DEFS.map((def) => ({
    id: def.id,
    titulo: def.titulo,
    requerAssinatura: def.requerAssinatura,
    texto: preencher(def.raw, d, escritorio),
  }));
}

const PARCEIRO_VAZIO: ParceiroDados = {
  nome: "",
  documento: "",
  oab: "",
  oab_uf: "",
  endereco: "",
};

// Política de Privacidade (não usa dados do parceiro — só do escritório).
export function renderPolitica(escritorio: DadosLegais): string {
  return preencher(politicaRaw, PARCEIRO_VAZIO, escritorio);
}

// SHA-256 hex de um texto (tamper-evidence do que foi assinado).
export async function sha256Hex(texto: string): Promise<string> {
  const bytes = new TextEncoder().encode(texto);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

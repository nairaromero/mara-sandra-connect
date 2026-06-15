// Documentos legais aceitos pelo parceiro no primeiro acesso.
//
// As fontes (markdown) ficam em src/content/legal/*.md com tokens {{ }} de
// autofill. Este módulo injeta os dados do escritório (constantes) e do parceiro
// (preenchidos no aceite), e expõe utilitários de render + hash para o registro
// imutável do aceite.

import dpaRaw from "@/content/legal/dpa.md?raw";
import termoRaw from "@/content/legal/termo-uso.md?raw";
import politicaRaw from "@/content/legal/politica.md?raw";

// Versão dos termos. Incrementar quando o conteúdo mudar — habilita re-aceite.
export const TERMOS_VERSAO = "1.0-2026-06-09";

// Dados do escritório (preencher uma vez). O que estiver "[a preencher]" aparece
// assim no documento até ser configurado.
export const ESCRITORIO = {
  nome: "Mara Vian Sociedade Individual de Advocacia",
  cnpj: "60.244.853/0001-09",
  endereco:
    "Rua Alagoas, nº 3081, Sala 04 – Patrimônio Velho – Votuporanga/SP – CEP 15505-169",
  // Comarca do domicílio do escritório (Votuporanga/SP) — confirmar se é o foro desejado.
  foro: "Votuporanga/SP",
  // Contato de privacidade (LGPD). Escritório de pequeno porte é dispensado de
  // indicar Encarregado/DPO formal (Resolução CD/ANPD nº 2/2022), mas deve manter
  // um canal de comunicação com o titular.
  privacidadeContato: "Mara Sandra",
  privacidadeEmail: "marasandravian.advocacia@gmail.com",
  privacidadeTel: "",
};

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
  // Evita depender de Date.now em SSR; usa a data local de exibição.
  try {
    return new Date().toLocaleDateString("pt-BR");
  } catch {
    return "";
  }
}

function preencher(raw: string, d: ParceiroDados): string {
  // Canal de privacidade: nome — e-mail — telefone, omitindo o que estiver vazio.
  const canalPrivacidade = [
    ESCRITORIO.privacidadeContato,
    ESCRITORIO.privacidadeEmail,
    ESCRITORIO.privacidadeTel,
  ]
    .map((s) => (s || "").trim())
    .filter((s) => s && !s.startsWith("["))
    .join(" — ");

  const mapa: Record<string, string> = {
    "{{VERSAO}}": TERMOS_VERSAO,
    "{{DATA}}": dataHoje(),
    "{{ESCRITORIO_NOME}}": ESCRITORIO.nome,
    "{{ESCRITORIO_CNPJ}}": ESCRITORIO.cnpj,
    "{{ESCRITORIO_ENDERECO}}": ESCRITORIO.endereco,
    "{{CANAL_PRIVACIDADE}}": canalPrivacidade || "[a preencher]",
    "{{FORO}}": ESCRITORIO.foro,
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

export function renderDocumentos(d: ParceiroDados): Array<DocumentoRenderizado> {
  return DEFS.map((def) => ({
    id: def.id,
    titulo: def.titulo,
    requerAssinatura: def.requerAssinatura,
    texto: preencher(def.raw, d),
  }));
}

const PARCEIRO_VAZIO: ParceiroDados = {
  nome: "",
  documento: "",
  oab: "",
  oab_uf: "",
  endereco: "",
};

// Política de Privacidade pública (não usa dados do parceiro — só do escritório).
export function renderPolitica(): string {
  return preencher(politicaRaw, PARCEIRO_VAZIO);
}

// SHA-256 hex de um texto (tamper-evidence do que foi assinado).
export async function sha256Hex(texto: string): Promise<string> {
  const bytes = new TextEncoder().encode(texto);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// Comprovante de agendamento de perícia — leitura por IA e upload pro caso.
// Compartilhado entre TarefaSheet e AgendaSheet (os dois agendam perícia).

import { supabase } from "@/lib/supabase";

export interface CamposComprovante {
  data?: string | null;
  hora?: string | null;
  local?: string | null;
  endereco?: string | null;
  protocolo?: string | null;
  servico?: string | null;
  requerente?: string | null;
}

/** Lê o PDF/foto via extrair-agendamento-pericia. null = não conseguiu ler. */
export async function extrairComprovante(file: File): Promise<CamposComprovante | null> {
  const base64 = await new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(",")[1] ?? "");
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });
  const { data, error } = await supabase.functions.invoke("extrair-agendamento-pericia", {
    body: {
      arquivo: { nome: file.name, mime: file.type || "application/pdf", base64 },
    },
  });
  if (error) throw error;
  return (data as { campos?: CamposComprovante | null } | null)?.campos ?? null;
}

/** Idem, mas a partir do TEXTO colado da publicação/intimação. */
export async function extrairDePublicacao(texto: string): Promise<CamposComprovante | null> {
  const { data, error } = await supabase.functions.invoke("extrair-agendamento-pericia", {
    body: { texto },
  });
  if (error) throw error;
  return (data as { campos?: CamposComprovante | null } | null)?.campos ?? null;
}

/**
 * Preenche as lacunas (_____) de um texto de aviso já montado com os campos
 * extraídos — preserva o que a pessoa já editou; só substitui o que está em
 * branco. Usado pelo botão "Completar com IA" da tarefa de aviso.
 */
export function preencherLacunasAviso(texto: string, campos: CamposComprovante): string {
  let out = texto;
  const troca = (rotuloRegex: RegExp, valor: string | null | undefined) => {
    if (valor && valor.trim()) {
      out = out.replace(rotuloRegex, (m) => m.replace("_____", valor.trim()));
    }
  };
  let dataFmt: string | null = null;
  if (campos.data) {
    const [y, m, d] = campos.data.split("-").map(Number);
    if (y && m && d) {
      const dia = new Date(y, m - 1, d).toLocaleDateString("pt-BR", { weekday: "long" });
      dataFmt = `${String(d).padStart(2, "0")}/${String(m).padStart(2, "0")}/${y} (${dia})`;
    }
  }
  troca(/📅 Data: _____/u, dataFmt);
  troca(/⏰ Horário: _____/u, campos.hora);
  troca(/📍 Local: _____/u, campos.local);
  troca(/🗺️ Endereço: _____/u, campos.endereco);
  troca(/(?:🔢 Protocolo|⚖️ Processo): _____/u, campos.protocolo);
  return out;
}

/** Nomes iguais? (sem acento/caixa) — pega comprovante da pessoa errada. */
export function mesmoNome(a: string | null | undefined, b: string | null | undefined): boolean {
  const norm = (s: string) =>
    s.normalize("NFD").replace(/[̀-ͯ]/g, "").trim().toLowerCase();
  const na = norm(a ?? "");
  const nb = norm(b ?? "");
  if (!na || !nb) return true; // sem nome pra comparar = não bloqueia
  return na === nb;
}

function sanitizeFileName(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-zA-Z0-9._-]/g, "_");
}

/**
 * Sobe o comprovante pros Documentos do caso seguindo a numeração dos
 * arquivos existentes ("24 - …" → "25 - …"). Lança em caso de falha.
 */
export async function subirComprovanteDocumento(
  casoId: string,
  file: File,
  uploadedBy: string | null,
): Promise<void> {
  const { data: docsExist } = await supabase
    .from("documentos")
    .select("nome_arquivo")
    .eq("caso_id", casoId);
  let maior = 0;
  for (const d of docsExist ?? []) {
    const m = /^(\d+)\s*-/.exec((d as { nome_arquivo: string | null }).nome_arquivo ?? "");
    if (m) maior = Math.max(maior, parseInt(m[1], 10));
  }
  const semNumero = file.name.replace(/^\d+\s*-\s*/, "");
  const nomeFinal = maior > 0 ? `${maior + 1} - ${semNumero}` : semNumero;
  const storagePath = `${casoId}/${Date.now()}_${sanitizeFileName(nomeFinal)}`;
  const up = await supabase.storage
    .from("documentos")
    .upload(storagePath, file, { cacheControl: "3600", upsert: false });
  if (up.error) throw up.error;
  const ins = await supabase.from("documentos").insert({
    caso_id: casoId,
    tipo: "outro",
    tipo_personalizado: "Comprovante de agendamento de perícia",
    nome_arquivo: nomeFinal,
    storage_path: storagePath,
    tamanho_bytes: file.size,
    uploaded_by: uploadedBy,
    visivel_parceiro: true,
  });
  if (ins.error) throw ins.error;
}

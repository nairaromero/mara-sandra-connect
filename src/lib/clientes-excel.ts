// =============================================================================
// Export/Import de clientes em formato Excel (xlsx).
//
// Export: 1 linha por CASO (cliente com varios casos vira varias linhas).
// Cobre: cliente cadastral, etiquetas, dados do caso, processos, ultimo
// andamento. Round-trip seguro com o import.
//
// Import: ver importar-clientes-excel-dialog.tsx
// =============================================================================

import * as XLSX from "xlsx";
import { supabase } from "@/lib/supabase";

const FASES_LABEL: Record<string, string> = {
  analise: "Em análise",
  admin: "Administrativo",
  judicial: "Judicial",
  finalizado: "Finalizado",
};

const FASES_VALUE: Record<string, string> = Object.fromEntries(
  Object.entries(FASES_LABEL).map(([k, v]) => [v.toLowerCase(), k]),
);

const STATUS_LABEL: Record<string, string> = {
  aguardando_documentos: "Aguardando documentos",
  em_analise: "Em análise",
  em_revisao: "Em revisão",
  em_andamento: "Em andamento",
  concluido_exito: "Concluído com êxito",
  concluido_sem_exito: "Concluído sem êxito",
  arquivado: "Arquivado",
};

const STATUS_VALUE: Record<string, string> = Object.fromEntries(
  Object.entries(STATUS_LABEL).map(([k, v]) => [v.toLowerCase(), k]),
);

export const EXCEL_COLUNAS = [
  "Nome",
  "CPF",
  "Nascimento",
  "Telefone",
  "Email",
  "Endereco",
  "Etiquetas",
  "Tipo Beneficio",
  "Fase",
  "Status",
  "Parceiro",
  "Processos Admin",
  "Processos Judiciais",
  "Ultimo Andamento Data",
  "Ultimo Andamento Titulo",
  "Ultimo Andamento Descricao",
] as const;

export type ExcelColuna = (typeof EXCEL_COLUNAS)[number];

export type LinhaImport = Partial<Record<ExcelColuna, string>>;

function onlyDigits(s: string | null | undefined): string {
  return (s || "").replace(/\D/g, "");
}

function formatCpfBr(cpf: string | null | undefined): string {
  const d = onlyDigits(cpf);
  if (d.length !== 11) return cpf || "";
  return d.slice(0, 3) + "." + d.slice(3, 6) + "." + d.slice(6, 9) + "-" + d.slice(9);
}

function formatDateBr(iso: string | null | undefined): string {
  if (!iso) return "";
  // Aceita 'YYYY-MM-DD' ou ISO completo
  const d = iso.length === 10 ? iso + "T00:00:00" : iso;
  const dt = new Date(d);
  if (isNaN(dt.getTime())) return iso;
  return dt.toLocaleDateString("pt-BR");
}

/** Converte data BR (DD/MM/AAAA) ou ISO pra YYYY-MM-DD. Vazio = null. */
export function parseDataBr(s: string | null | undefined): string | null {
  if (!s) return null;
  const t = s.trim();
  if (!t) return null;
  // ISO ja
  if (/^\d{4}-\d{2}-\d{2}/.test(t)) return t.slice(0, 10);
  // BR DD/MM/AAAA
  const m = t.match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{4})/);
  if (m) {
    const dd = m[1].padStart(2, "0");
    const mm = m[2].padStart(2, "0");
    return m[3] + "-" + mm + "-" + dd;
  }
  return null;
}

export function faseValueDe(label: string | null | undefined): string {
  if (!label) return "analise";
  return FASES_VALUE[label.trim().toLowerCase()] || "analise";
}

export function statusValueDe(label: string | null | undefined): string {
  if (!label) return "em_analise";
  return STATUS_VALUE[label.trim().toLowerCase()] || "em_analise";
}

/**
 * Baixa um xlsx com os clientes do recorte (1 linha por caso). Filtra
 * server-side; nao expoe nada fora da RLS.
 */
export async function exportarClientesExcel(clienteIds: Set<string>): Promise<void> {
  if (clienteIds.size === 0) {
    throw new Error("Nenhum cliente no recorte. Ajuste o filtro/busca.");
  }

  const idsArray = Array.from(clienteIds);

  const casosResp = await supabase
    .from("casos")
    .select(
      "id, tipo_beneficio, fase, status, created_at, " +
        "cliente:cliente_id(id, nome, cpf, data_nascimento, telefone, email, endereco, " +
        "clientes_etiquetas(etiqueta:etiqueta_id(nome))), " +
        "parceiro:parceiro_id(nome), " +
        "processos_admin(numero_requerimento), " +
        "processos_judiciais(numero_processo)",
    )
    .in("cliente_id", idsArray);
  if (casosResp.error) throw casosResp.error;

  const casos = (casosResp.data || []) as unknown as Array<{
    id: string;
    tipo_beneficio: string | null;
    fase: string | null;
    status: string | null;
    cliente: {
      id: string;
      nome: string | null;
      cpf: string | null;
      data_nascimento: string | null;
      telefone: string | null;
      email: string | null;
      endereco: string | null;
      clientes_etiquetas: Array<{ etiqueta: { nome: string | null } | null }>;
    } | null;
    parceiro: { nome: string | null } | null;
    processos_admin: Array<{ numero_requerimento: string | null }>;
    processos_judiciais: Array<{ numero_processo: string | null }>;
  }>;

  // Ultimo andamento por caso (1 query)
  const casoIds = casos.map((c) => c.id);
  const ultimoAndPorCaso = new Map<
    string,
    { data_evento: string; titulo: string | null; descricao: string | null }
  >();
  if (casoIds.length > 0) {
    const andResp = await supabase
      .from("andamentos")
      .select("caso_id, data_evento, titulo, descricao")
      .in("caso_id", casoIds)
      .order("data_evento", { ascending: false });
    if (andResp.error) throw andResp.error;
    for (const a of (andResp.data || []) as Array<{
      caso_id: string;
      data_evento: string;
      titulo: string | null;
      descricao: string | null;
    }>) {
      if (!ultimoAndPorCaso.has(a.caso_id)) {
        ultimoAndPorCaso.set(a.caso_id, a);
      }
    }
  }

  const rows: Array<Record<ExcelColuna, string>> = casos
    .filter((c) => c.cliente)
    .map((c) => {
      const cli = c.cliente!;
      const etiquetas = (cli.clientes_etiquetas || [])
        .map((e) => e.etiqueta?.nome)
        .filter((n): n is string => !!n)
        .join("; ");
      const procAdmin = (c.processos_admin || [])
        .map((p) => p.numero_requerimento)
        .filter((n): n is string => !!n)
        .join("; ");
      const procJud = (c.processos_judiciais || [])
        .map((p) => p.numero_processo)
        .filter((n): n is string => !!n)
        .join("; ");
      const ult = ultimoAndPorCaso.get(c.id);
      return {
        Nome: cli.nome || "",
        CPF: formatCpfBr(cli.cpf),
        Nascimento: formatDateBr(cli.data_nascimento),
        Telefone: cli.telefone || "",
        Email: cli.email || "",
        Endereco: cli.endereco || "",
        Etiquetas: etiquetas,
        "Tipo Beneficio": c.tipo_beneficio || "",
        Fase: FASES_LABEL[c.fase || ""] || c.fase || "",
        Status: STATUS_LABEL[c.status || ""] || c.status || "",
        Parceiro: c.parceiro?.nome || "",
        "Processos Admin": procAdmin,
        "Processos Judiciais": procJud,
        "Ultimo Andamento Data": ult ? formatDateBr(ult.data_evento) : "",
        "Ultimo Andamento Titulo": ult?.titulo || "",
        "Ultimo Andamento Descricao": ult?.descricao || "",
      };
    });

  if (rows.length === 0) {
    throw new Error("Nenhum caso encontrado pra exportar");
  }

  // Ordena por nome do cliente
  rows.sort((a, b) => a.Nome.localeCompare(b.Nome));

  const ws = XLSX.utils.json_to_sheet(rows, { header: [...EXCEL_COLUNAS] });
  // Auto-largura aproximada por coluna (max 50)
  ws["!cols"] = EXCEL_COLUNAS.map((col) => {
    const maxLen = Math.max(
      col.length,
      ...rows.map((r) => (r[col] || "").length),
    );
    return { wch: Math.min(maxLen + 2, 50) };
  });

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Clientes");

  const stamp = new Date().toISOString().slice(0, 10);
  XLSX.writeFile(wb, "clientes_" + stamp + ".xlsx");
}

/**
 * Le um arquivo xlsx do usuario e devolve as linhas como objetos com as
 * chaves de EXCEL_COLUNAS. Aceita nomes de coluna case-insensitive e com
 * acento (Endereço/Endereco, Email/E-mail, etc).
 */
export async function lerExcel(file: File): Promise<Array<LinhaImport>> {
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: "array" });
  const sheetName = wb.SheetNames[0];
  if (!sheetName) throw new Error("Planilha vazia");
  const ws = wb.Sheets[sheetName];
  const raw = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, {
    defval: "",
    raw: false, // forca string (datas viram texto)
  });

  // Normaliza headers (lowercase, sem acento) pra fazer match com EXCEL_COLUNAS
  function normalize(s: string): string {
    return s
      .toLowerCase()
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9]+/g, " ")
      .trim();
  }
  const colunaNormalizada: Record<string, ExcelColuna> = {};
  for (const col of EXCEL_COLUNAS) {
    colunaNormalizada[normalize(col)] = col;
  }

  return raw.map((linha) => {
    const out: LinhaImport = {};
    for (const [k, v] of Object.entries(linha)) {
      const match = colunaNormalizada[normalize(k)];
      if (match) out[match] = String(v).trim();
    }
    return out;
  });
}

// Helpers de apresentação de tarefas (urgência, cor, datas).

import type { TarefaStatus } from "./types";

export type Urgencia = "atrasado" | "hoje" | "proximo" | "futuro" | "sem_prazo";

// Dias de CALENDARIO ate o prazo (0 = hoje, 1 = amanha, negativo = atrasado).
// Compara datas normalizadas pra meia-noite — "amanha de manha" e amanha,
// mesmo faltando menos de 24h; "hoje as 9h" segue sendo hoje a tarde.
export function diasCorridosAte(dueAt: string): number {
  const hoje = new Date();
  hoje.setHours(0, 0, 0, 0);
  const due = new Date(dueAt);
  due.setHours(0, 0, 0, 0);
  return Math.round((due.getTime() - hoje.getTime()) / 86400_000);
}

export function urgenciaDoDueAt(dueAt: string | null, status: TarefaStatus): Urgencia {
  if (status === "feito" || status === "cancelado") return "futuro";
  if (!dueAt) return "sem_prazo";
  const dias = diasCorridosAte(dueAt);
  if (dias < 0) return "atrasado";
  if (dias === 0) return "hoje";
  if (dias <= 2) return "proximo";
  return "futuro";
}

// Tailwind classes que combinam com o resto do app (sem hex hardcoded).
export const URGENCIA_BADGE_CLASS: Record<Urgencia, string> = {
  atrasado:
    "border-destructive/40 bg-destructive/10 text-destructive",
  hoje:
    "border-amber-400/50 bg-amber-50 text-amber-900 dark:bg-amber-950 dark:text-amber-200",
  // Azul de proposito: "amanhã/próximo" precisa se distinguir de "hoje"
  // (âmbar) sem precisar ler o texto do chip.
  proximo:
    "border-sky-300/60 bg-sky-50 text-sky-800 dark:bg-sky-950/50 dark:text-sky-300",
  futuro:
    "border-border bg-muted text-muted-foreground",
  sem_prazo:
    "border-border bg-muted text-muted-foreground",
};

export function formatarDueAt(dueAt: string | null): string {
  if (!dueAt) return "Sem prazo";
  const d = new Date(dueAt);
  return d.toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
  });
}

export function formatarDueAtLongo(dueAt: string | null): string {
  if (!dueAt) return "Sem prazo";
  const d = new Date(dueAt);
  const data = d.toLocaleDateString("pt-BR", {
    weekday: "short",
    day: "2-digit",
    month: "short",
  });
  const dias = diasCorridosAte(dueAt);
  if (dias === 0) return `${data} (hoje)`;
  if (dias === 1) return `${data} (amanhã)`;
  if (dias > 1) return `${data} (em ${dias}d)`;
  if (dias === -1) return `${data} (atrasado 1d)`;
  return `${data} (atrasado ${Math.abs(dias)}d)`;
}

// Nomes vem do TI em CAIXA ALTA; exibe "Edilvan Ferreira Neves" mantendo
// particulas (de/da/dos...) minusculas.
export function nomeAmigavel(nome: string | null): string {
  if (!nome) return "";
  const particulas = new Set(["de", "da", "do", "das", "dos", "e", "d"]);
  return nome
    .toLowerCase()
    .replace(/\S+/g, (w) =>
      particulas.has(w) ? w : w.charAt(0).toUpperCase() + w.slice(1),
    );
}

export function iniciaisDoNome(nome: string | null): string {
  if (!nome) return "—";
  const partes = nome.trim().split(/\s+/);
  const primeira = partes[0]?.[0] ?? "";
  const ultima = partes.length > 1 ? (partes[partes.length - 1][0] ?? "") : "";
  return (primeira + ultima).toUpperCase() || "—";
}

// Versao enxuta pro card compacto do kanban: "hoje", "amanhã", "18 jun."
// ou "18 jun. · 32d atraso". O longo (formatarDueAtLongo) fica pros sheets.
export function formatarDueAtCurto(dueAt: string | null): string {
  if (!dueAt) return "sem prazo";
  const d = new Date(dueAt);
  const data = d
    .toLocaleDateString("pt-BR", { day: "2-digit", month: "short" })
    .replace(" de ", " ");
  const dias = diasCorridosAte(dueAt);
  if (dias === 0) return "hoje";
  if (dias === 1) return "amanhã";
  if (dias < 0) return `${data} · ${Math.abs(dias)}d atraso`;
  return data;
}

export function inputDateValueFromIso(iso: string | null): string {
  if (!iso) return "";
  return new Date(iso).toISOString().slice(0, 10);
}

export function isoFromInputDate(date: string): string | null {
  if (!date) return null;
  // Salva como meia-noite local (sem timezone confusion).
  return new Date(`${date}T00:00:00`).toISOString();
}

// Variantes com hora (datetime-local). Formato do input: YYYY-MM-DDTHH:mm.
export function inputDateTimeValueFromIso(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function isoFromInputDateTime(s: string): string | null {
  if (!s) return null;
  // O input já vem no formato local (sem TZ). new Date(s) interpreta como
  // horário local, e .toISOString() converte para UTC.
  return new Date(s).toISOString();
}

export interface PlaceholderContext {
  nome_cliente?: string;
  protocolo?: string;
  cpf?: string;
  servico?: string;
  nb?: string;
  despacho?: string;
  status_assunto?: string;
}

/**
 * Substitui {placeholders} em títulos/descrições de template aplicado
 * manualmente. Valores ausentes viram string vazia, e depois limpamos
 * blocos órfãos comuns ("Despacho:\n", linhas em branco no fim).
 */
export function substituirPlaceholders(
  texto: string,
  ctx: PlaceholderContext,
): string {
  const mapa: Record<string, string> = {
    nome_cliente: ctx.nome_cliente ?? "",
    protocolo: ctx.protocolo ?? "",
    cpf: ctx.cpf ?? "",
    servico: ctx.servico ?? "",
    nb: ctx.nb ?? "",
    despacho: ctx.despacho ?? "",
    status_assunto: ctx.status_assunto ?? "",
  };
  let out = texto.replace(/\{(\w+)\}/g, (_, key: string) => mapa[key] ?? "");

  // Limpeza de blocos órfãos comuns quando o valor era vazio.
  // Ex: "Despacho:\n" sozinho no fim, ou "Serviço: ." → "Serviço: ."
  out = out
    .replace(/\n*Despacho:\s*\n*\s*$/i, "")
    .replace(/\n*Serviço:\s*\.\s*$/i, ".")
    .replace(/Requerimento\s+\./g, "(sem requerimento).")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return out;
}

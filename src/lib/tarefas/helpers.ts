// Helpers de apresentação de tarefas (urgência, cor, datas).

import type { TarefaStatus } from "./types";
import {
  diasCorridosBR,
  formatarBR,
  isoParaInputDateBR,
  isoParaInputDateTimeBR,
  inputDateBRParaIso,
  inputDateTimeBRParaIso,
} from "@/lib/fuso";

export type Urgencia = "atrasado" | "hoje" | "proximo" | "futuro" | "sem_prazo";

// Dias de CALENDARIO ate o prazo (0 = hoje, 1 = amanha, negativo = atrasado).
// Compara dias de BRASILIA: "hoje" e o dia no Brasil, nao o do navegador —
// as 01h de Madri ainda e ontem em SP. Ver src/lib/fuso.ts.
export function diasCorridosAte(dueAt: string): number {
  return diasCorridosBR(dueAt);
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
  return formatarBR(dueAt, {
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
  });
}

export function formatarDueAtLongo(dueAt: string | null): string {
  if (!dueAt) return "Sem prazo";
  const data = formatarBR(dueAt, {
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
  const data = formatarBR(dueAt, { day: "2-digit", month: "short" }).replace(" de ", " ");
  const dias = diasCorridosAte(dueAt);
  if (dias === 0) return "hoje";
  if (dias === 1) return "amanhã";
  if (dias < 0) return `${data} · ${Math.abs(dias)}d atraso`;
  return data;
}

// Os inputs de data/hora sao SEMPRE horario de Brasilia, nao do navegador:
// prazo digitado como 14:00 e 14:00 no Brasil, esteja quem digitou onde
// estiver. Ver src/lib/fuso.ts.
export function inputDateValueFromIso(iso: string | null): string {
  return isoParaInputDateBR(iso);
}

export function isoFromInputDate(date: string): string | null {
  return inputDateBRParaIso(date);
}

// Variantes com hora (datetime-local). Formato do input: YYYY-MM-DDTHH:mm.
export function inputDateTimeValueFromIso(iso: string | null): string {
  return isoParaInputDateTimeBR(iso);
}

export function isoFromInputDateTime(s: string): string | null {
  return inputDateTimeBRParaIso(s);
}

export interface PlaceholderContext {
  nome_cliente?: string;
  protocolo?: string;
  cpf?: string;
  servico?: string;
  nb?: string;
  despacho?: string;
  status_assunto?: string;
  // Nome de quem está aplicando o template (ausência da equipe, por ex.).
  nome_usuario?: string;
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
    nome_usuario: ctx.nome_usuario ?? "",
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

// ---------------------------------------------------------------------------
// Autoria (quem criou / quem concluiu ou cancelou). Preenchida por trigger —
// ver migration_tarefas_autoria.sql. Autor NULL com data = "sistema" (edge
// function/cron); sem data = tarefa anterior à migration.
// ---------------------------------------------------------------------------

interface PessoaLite {
  id: string;
  nome: string | null;
}

export function formatarDataHoraCurtaBR(iso: string | null | undefined): string {
  if (!iso) return "";
  return formatarBR(iso, {
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function nomeOuSistema(p: PessoaLite | null | undefined, temData: boolean): string {
  if (p?.nome) return nomeAmigavel(p.nome);
  return temData ? "sistema" : "—";
}

/**
 * "Concluída por Mara Sandra em 13/08/26 14:02" / "Cancelada pelo sistema em ..."
 * Só pra tarefas arquivadas (feito/cancelado). null quando não há o que dizer.
 */
export function descreverAutoriaStatus(t: {
  status: TarefaStatus;
  status_alterado_em?: string | null;
  status_autor?: PessoaLite | null;
  completed_at?: string | null;
}): string | null {
  if (t.status !== "feito" && t.status !== "cancelado") return null;
  const quando = t.status_alterado_em ?? (t.status === "feito" ? t.completed_at : null);
  const verbo = t.status === "feito" ? "Concluída" : "Cancelada";
  if (!quando) return null;
  // Sem status_alterado_em = anterior à migration: sabemos quando, não quem.
  const quem = t.status_autor?.nome
    ? ` por ${nomeAmigavel(t.status_autor.nome)}`
    : t.status_alterado_em
      ? " pelo sistema"
      : "";
  return `${verbo}${quem} em ${formatarDataHoraCurtaBR(quando)}`;
}

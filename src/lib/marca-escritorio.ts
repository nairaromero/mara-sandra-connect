// Helpers da marca do escritorio (sem componente, para o fast refresh).

import type { Vinculo } from "@/hooks/use-auth";

export function nomeDoEscritorio(v: Vinculo | null | undefined): string {
  return (v?.marca?.nome_exibicao || v?.escritorio_nome || "Escritório").trim();
}

export function iniciaisDe(nome: string): string {
  const partes = nome
    .replace(/[^\p{L}\p{N} ]/gu, " ")
    .split(/\s+/)
    .filter((p) => p.length > 1 && !["de", "da", "do", "dos", "das", "e"].includes(p.toLowerCase()));
  const ini = partes.slice(0, 3).map((p) => p[0]).join("");
  return (ini || nome.slice(0, 2)).toUpperCase();
}

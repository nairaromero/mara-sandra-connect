// Agrupamento por mês do arquivo de tarefas — a parte de dados do
// componente SecoesPorMes (src/components/tarefas/secoes-por-mes.tsx).

import { partesBR, formatarBR } from "@/lib/fuso";

export interface GrupoMes<T> {
  // "2026-08" (ordena sozinho) ou "sem-data".
  chave: string;
  // "Agosto de 2026".
  rotulo: string;
  itens: T[];
}

const SEM_DATA = "sem-data";

/**
 * Mês de calendário DE BRASÍLIA — nunca `new Date().getMonth()`: o escritório
 * é operado da Espanha e uma tarefa concluída "01/09 00:30" no Brasil cairia
 * em agosto ou setembro conforme o fuso do navegador (ver src/lib/fuso.ts).
 */
function mesBR(iso: string): { chave: string; rotulo: string } {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return { chave: SEM_DATA, rotulo: "Sem data" };
  const p = partesBR(d);
  const nome = formatarBR(d, { month: "long", year: "numeric" });
  return {
    chave: `${p.ano}-${String(p.mes).padStart(2, "0")}`,
    rotulo: nome.charAt(0).toUpperCase() + nome.slice(1),
  };
}

/**
 * Agrupa por mês, do mais recente pro mais antigo, com os sem-data no fim.
 * Dentro do mês, o mais recente primeiro — é arquivo: o que acabou de sair
 * de circulação é o que a pessoa procura.
 */
export function agruparPorMes<T>(itens: T[], dataDe: (t: T) => string | null): GrupoMes<T>[] {
  const mapa = new Map<string, GrupoMes<T> & { ordem: Array<{ item: T; quando: string }> }>();
  for (const item of itens) {
    const quando = dataDe(item);
    const { chave, rotulo } = quando ? mesBR(quando) : { chave: SEM_DATA, rotulo: "Sem data" };
    let g = mapa.get(chave);
    if (!g) {
      g = { chave, rotulo, itens: [], ordem: [] };
      mapa.set(chave, g);
    }
    g.ordem.push({ item, quando: quando ?? "" });
  }
  const grupos = Array.from(mapa.values());
  grupos.sort((a, b) => {
    if (a.chave === SEM_DATA) return 1;
    if (b.chave === SEM_DATA) return -1;
    return b.chave.localeCompare(a.chave);
  });
  for (const g of grupos) {
    g.ordem.sort((a, b) => b.quando.localeCompare(a.quando));
    g.itens = g.ordem.map((o) => o.item);
  }
  return grupos.map(({ chave, rotulo, itens: is }) => ({ chave, rotulo, itens: is }));
}

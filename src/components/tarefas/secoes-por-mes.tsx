// Arquivo por mês: as abas "Arquivados" acumulam centenas de linhas (402
// feitas, 231 excluídas/canceladas) e uma coluna única não tinha fim — a
// pessoa rolava sem achar nada (Naira, 2026-09-09). Aqui cada mês vira uma
// seção dobrável; só o mês mais recente abre sozinho.
//
// Bônus: mês fechado não renderiza os filhos, então o DOM da aba cai de
// centenas de cards pra alguns poucos.

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import type { GrupoMes } from "@/lib/tarefas/agrupar-mes";

interface Props<T> {
  grupos: GrupoMes<T>[];
  // Conteúdo de um mês aberto.
  children: (itens: T[], grupo: GrupoMes<T>) => ReactNode;
  vazio?: ReactNode;
}

export function SecoesPorMes<T>({ grupos, children, vazio }: Props<T>) {
  // Só o mês mais recente nasce aberto. `null` = ainda não semeado: os grupos
  // chegam depois do fetch, então o estado inicial não tem como saber o mês.
  // Sem essa distinção, um Set vazio parecia "não semeado" e o último mês
  // aberto se recusava a fechar.
  const primeiro = grupos[0]?.chave;
  const [abertos, setAbertos] = useState<Set<string> | null>(null);

  useEffect(() => {
    if (abertos === null && primeiro) setAbertos(new Set([primeiro]));
  }, [abertos, primeiro]);

  // Antes do efeito rodar, o mês mais recente já aparece aberto — nada pisca.
  const abertosEfetivos = useMemo(
    () => abertos ?? new Set<string>(primeiro ? [primeiro] : []),
    [abertos, primeiro],
  );

  function alternar(chave: string) {
    setAbertos((prev) => {
      const base = prev ?? new Set<string>(primeiro ? [primeiro] : []);
      const next = new Set(base);
      if (next.has(chave)) next.delete(chave);
      else next.add(chave);
      return next;
    });
  }

  if (grupos.length === 0) return <>{vazio}</>;

  return (
    <div className="divide-y">
      {grupos.map((g) => {
        const aberto = abertosEfetivos.has(g.chave);
        return (
          <div key={g.chave}>
            <button
              type="button"
              onClick={() => alternar(g.chave)}
              aria-expanded={aberto}
              className="w-full flex items-center gap-2 px-2 py-2 text-left hover:bg-muted/40 rounded-sm"
            >
              {aberto ? (
                <ChevronDown className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
              ) : (
                <ChevronRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
              )}
              <span className="text-sm font-medium">{g.rotulo}</span>
              <Badge variant="outline" className="font-normal tabular-nums">
                {g.itens.length}
              </Badge>
            </button>
            {aberto && <div className="pb-2">{children(g.itens, g)}</div>}
          </div>
        );
      })}
    </div>
  );
}

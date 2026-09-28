// Paginador classico: "1–25 de 32", primeira / anterior / numeros / proxima /
// ultima e itens por pagina. So a pagina escolhida e buscada (ou fatiada, nas
// listas locais) — nada de acumular "mostrar mais".

import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const OPCOES_POR_PAGINA = [10, 25, 50, 100];

export interface PaginadorProps {
  pagina: number;
  porPagina: number;
  /** total de itens; null quando a fonte nao informa (ai so anterior/proxima) */
  total: number | null;
  /** so importa com total null: a pagina veio cheia, entao pode haver proxima */
  temMais?: boolean;
  carregando?: boolean;
  onPagina: (p: number) => void;
  onPorPagina: (n: number) => void;
  opcoes?: Array<number>;
  /** o que sao os itens, no plural: "pessoas", "publicações" */
  nome?: string;
  className?: string;
}

// 1 … 4 [5] 6 … 20 — sempre a primeira, a ultima e a vizinhanca da atual.
function numeros(pagina: number, totalPaginas: number): Array<number | "…"> {
  if (totalPaginas <= 7) return Array.from({ length: totalPaginas }, (_, i) => i + 1);
  const fixas = new Set([1, totalPaginas, pagina - 1, pagina, pagina + 1]);
  const lista: Array<number | "…"> = [];
  for (let p = 1; p <= totalPaginas; p++) {
    if (fixas.has(p)) lista.push(p);
    else if (lista[lista.length - 1] !== "…") lista.push("…");
  }
  return lista;
}

export function Paginador(props: PaginadorProps) {
  const { pagina, porPagina, total, temMais, carregando, onPagina, onPorPagina, opcoes = OPCOES_POR_PAGINA, nome, className } = props;
  const totalPaginas = total != null ? Math.max(1, Math.ceil(total / porPagina)) : null;
  const inicio = total === 0 ? 0 : (pagina - 1) * porPagina + 1;
  const fim = total != null ? Math.min(pagina * porPagina, total) : pagina * porPagina;
  const contagem = total != null ? `${inicio}–${fim} de ${total}${nome ? ` ${nome}` : ""}` : `${inicio}–${fim}`;
  const naPrimeira = pagina <= 1;
  const naUltima = totalPaginas != null ? pagina >= totalPaginas : temMais === false;
  const setinha = "h-8 w-8";

  return (
    <nav
      aria-label="Paginação"
      className={"flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3 text-sm text-muted-foreground " + (className ?? "")}
    >
      <span data-contagem className="mr-auto tabular-nums">
        {contagem}
      </span>
      {carregando && <Loader2 className="h-4 w-4 animate-spin" aria-label="Carregando" />}
      <div className="flex items-center gap-0.5">
        <Button type="button" variant="ghost" size="icon" className={setinha} aria-label="Primeira página" disabled={naPrimeira} onClick={() => onPagina(1)}>
          <ChevronsLeft className="h-4 w-4" />
        </Button>
        <Button type="button" variant="ghost" size="icon" className={setinha} aria-label="Página anterior" disabled={naPrimeira} onClick={() => onPagina(pagina - 1)}>
          <ChevronLeft className="h-4 w-4" />
        </Button>
        {totalPaginas != null ? (
          numeros(pagina, totalPaginas).map((p, i) =>
            p === "…" ? (
              <span key={`e${i}`} className="px-1" aria-hidden="true">
                …
              </span>
            ) : (
              <Button
                key={p}
                type="button"
                variant={p === pagina ? "default" : "ghost"}
                size="icon"
                className={setinha + " text-sm tabular-nums"}
                aria-label={`Página ${p}`}
                aria-current={p === pagina ? "page" : undefined}
                onClick={() => onPagina(p)}
              >
                {p}
              </Button>
            ),
          )
        ) : (
          <span className="px-2 tabular-nums text-foreground" aria-current="page">
            {pagina}
          </span>
        )}
        <Button type="button" variant="ghost" size="icon" className={setinha} aria-label="Próxima página" disabled={naUltima} onClick={() => onPagina(pagina + 1)}>
          <ChevronRight className="h-4 w-4" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className={setinha}
          aria-label="Última página"
          disabled={naUltima || totalPaginas == null}
          onClick={() => totalPaginas != null && onPagina(totalPaginas)}
        >
          <ChevronsRight className="h-4 w-4" />
        </Button>
      </div>
      <Select value={String(porPagina)} onValueChange={(v) => onPorPagina(Number(v))}>
        <SelectTrigger className="h-8 w-[4.75rem]" aria-label="Itens por página">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {opcoes.map((n) => (
            <SelectItem key={n} value={String(n)}>
              {n}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </nav>
  );
}

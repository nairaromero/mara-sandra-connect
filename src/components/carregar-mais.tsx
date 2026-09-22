// Rodape de lista paginada: "10 de 34" + botao "Mostrar mais". Sem scroll
// infinito de proposito — em tabela com acoes a pessoa perde o lugar.

import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";

export function CarregarMais(props: {
  mostrando: number;
  total: number | null;
  temMais: boolean;
  carregando: boolean;
  onMais: () => void;
  /** quantos vem por clique (so para o rotulo) */
  passo?: number;
  /** o que sao as linhas, no plural: "pessoas", "publicações" */
  nome?: string;
  className?: string;
}) {
  const { mostrando, total, temMais, carregando, onMais, passo, nome, className } = props;
  if (mostrando === 0 && !temMais) return null;
  const contagem =
    total != null ? `${mostrando} de ${total}${nome ? ` ${nome}` : ""}` : `mostrando ${mostrando}${nome ? ` ${nome}` : ""}`;
  return (
    <div className={"flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm text-muted-foreground " + (className ?? "")}>
      <span data-contagem>{contagem}</span>
      {temMais && (
        <Button variant="outline" size="sm" onClick={onMais} disabled={carregando}>
          {carregando && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Mostrar mais{passo ? ` ${passo}` : ""}
        </Button>
      )}
    </div>
  );
}

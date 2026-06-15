// Tab "Atividades" do caso — layout 2 colunas (tarefas | andamentos compacto).
// O objetivo é dar ao escritório a visão "do que precisa fazer" e "do que
// já aconteceu" lado a lado, sem precisar trocar de aba.
//
// Andamentos completos (timeline com vínculos, edição, etc.) ficam na aba
// "Andamentos" dedicada — esta aqui é um resumo navegável.

import { useState } from "react";
import { ArrowRight, ClipboardList } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CasoTarefasTab } from "@/components/tarefas/caso-tarefas-tab";

interface AndamentoLite {
  id: string;
  origem: string;
  titulo: string | null;
  descricao: string | null;
  data_evento: string | null;
  created_at: string;
}

interface Props {
  casoId: string;
  andamentos: AndamentoLite[];
  onIrParaAndamentos: (andamentoId?: string) => void;
}

const ORIGEM_LABEL: Record<string, string> = {
  interno: "Interno",
  tramitacao: "Tramitação",
  legalmail: "LegalMail",
  sistema: "Sistema",
  djen: "DJEN",
  inss_email: "INSS",
};

const ORIGEM_BADGE: Record<string, string> = {
  interno: "bg-secondary text-secondary-foreground",
  tramitacao: "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200",
  legalmail: "bg-blue-100 text-blue-900 dark:bg-blue-950 dark:text-blue-200",
  sistema: "bg-muted text-muted-foreground",
  djen: "bg-purple-100 text-purple-900 dark:bg-purple-950 dark:text-purple-200",
  inss_email: "bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200",
};

function formatarDataCurta(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "2-digit" });
}

export function CasoAtividadesTab({ casoId, andamentos, onIrParaAndamentos }: Props) {
  const recentes = andamentos.slice(0, 20);
  const [expandidoId, setExpandidoId] = useState<string | null>(null);

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      {/* Coluna esquerda: tarefas */}
      <div className="min-w-0">
        <CasoTarefasTab casoId={casoId} />
      </div>

      {/* Coluna direita: andamentos compactos */}
      <div className="min-w-0 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="font-medium flex items-center gap-2">
              <ClipboardList className="h-4 w-4" />
              Andamentos
            </h2>
            <p className="text-xs text-muted-foreground">
              {andamentos.length === 0
                ? "Nenhum andamento registrado."
                : `Últimos ${recentes.length} de ${andamentos.length} no total.`}
            </p>
          </div>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => onIrParaAndamentos()}
          >
            Ver tudo
            <ArrowRight className="h-4 w-4" />
          </Button>
        </div>

        {recentes.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Andamentos novos aparecerão aqui — vindos do INSS (e-mail), DJEN, LegalMail ou registro manual.
          </p>
        ) : (
          <ol className="relative space-y-3 border-l ml-2 pl-4">
            {recentes.map((a) => {
              const data = a.data_evento ?? a.created_at;
              const origemKey = a.origem;
              const expandido = expandidoId === a.id;
              return (
                <li key={a.id} className="relative">
                  <span className="absolute -left-[1.4rem] top-1.5 h-2 w-2 rounded-full bg-border" />
                  <div className="flex items-baseline justify-between gap-2 flex-wrap">
                    <div className="text-xs text-muted-foreground">
                      {formatarDataCurta(data)}
                    </div>
                    <Badge
                      variant="outline"
                      className={`font-normal text-[10px] ${ORIGEM_BADGE[origemKey] ?? "bg-secondary"}`}
                    >
                      {ORIGEM_LABEL[origemKey] ?? origemKey}
                    </Badge>
                  </div>
                  <div className="text-sm font-medium">
                    {a.titulo ?? "(sem título)"}
                  </div>
                  {a.descricao && (
                    <>
                      <div
                        className={
                          expandido
                            ? "text-xs text-muted-foreground whitespace-pre-wrap"
                            : "text-xs text-muted-foreground line-clamp-2"
                        }
                      >
                        {a.descricao}
                      </div>
                      {a.descricao.length > 120 && (
                        <button
                          type="button"
                          className="text-xs underline text-muted-foreground hover:text-foreground"
                          onClick={() => setExpandidoId(expandido ? null : a.id)}
                        >
                          {expandido ? "Recolher" : "Ver mais"}
                        </button>
                      )}
                    </>
                  )}
                  <button
                    type="button"
                    onClick={() => onIrParaAndamentos(a.id)}
                    className="text-xs text-muted-foreground hover:text-foreground hover:underline"
                  >
                    Abrir na aba Andamentos →
                  </button>
                </li>
              );
            })}
          </ol>
        )}
      </div>
    </div>
  );
}

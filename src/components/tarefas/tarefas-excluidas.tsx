// Lista de tarefas EXCLUÍDAS (log alimentado por trigger — ver
// migration_tarefas_autoria.sql). Mostra quem excluiu e quando; a tarefa em
// si já não existe, então não abre sheet. Aparece na aba "Arquivados" do
// caso e da tela /tarefas.

import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { ChevronDown, ChevronRight, Loader2, Trash2 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { listarTarefasExcluidas } from "@/lib/tarefas/queries";
import { formatarDataHoraCurtaBR, nomeAmigavel, nomeOuSistema } from "@/lib/tarefas/helpers";
import { STATUS_LABEL, type TarefaExcluidaRow } from "@/lib/tarefas/types";

interface Props {
  casoId?: string;
  mostrarCaso?: boolean;
  // Re-busca quando muda (ex.: depois de excluir uma tarefa na mesma tela).
  versao?: number;
  // Começa aberta? No caso (poucas linhas) sim; na tela geral, fechada.
  abertaInicial?: boolean;
}

export function TarefasExcluidas({ casoId, mostrarCaso = false, versao = 0, abertaInicial = true }: Props) {
  const [rows, setRows] = useState<TarefaExcluidaRow[] | null>(null);
  const [aberta, setAberta] = useState(abertaInicial);

  useEffect(() => {
    let vivo = true;
    listarTarefasExcluidas({ caso_id: casoId, limite: casoId ? 100 : 50 })
      .then((r) => {
        if (vivo) setRows(r);
      })
      .catch((e) => {
        console.error(e);
        if (vivo) setRows([]);
      });
    return () => {
      vivo = false;
    };
  }, [casoId, versao]);

  // Sem nada excluído, a seção nem aparece (não polui a aba).
  if (rows && rows.length === 0) return null;

  return (
    <section className="space-y-2">
      <button
        type="button"
        onClick={() => setAberta((v) => !v)}
        className="flex items-center gap-2 text-left"
      >
        {aberta ? (
          <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
        ) : (
          <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
        )}
        <h3 className="text-sm font-medium flex items-center gap-1.5">
          <Trash2 className="h-3.5 w-3.5 text-muted-foreground" />
          Excluídas
        </h3>
        <Badge variant="outline" className="font-normal">
          {rows ? rows.length : <Loader2 className="h-3 w-3 animate-spin" />}
        </Badge>
        {!casoId && rows && rows.length >= 50 && (
          <span className="text-xs text-muted-foreground">(últimas 50)</span>
        )}
      </button>

      {aberta && rows && (
        <ul className="rounded-md border bg-muted/30 divide-y">
          {rows.map((r) => {
            const clienteNome = r.caso?.cliente?.nome ?? null;
            return (
              <li key={r.id} className="px-3 py-2 text-xs space-y-0.5">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="text-sm line-through text-muted-foreground truncate min-w-0">
                    {r.titulo}
                  </span>
                  <Badge variant="outline" className="font-normal text-[10px] shrink-0">
                    {STATUS_LABEL[r.status] ?? r.status}
                  </Badge>
                  {mostrarCaso &&
                    (r.caso_id && clienteNome ? (
                      <Link
                        to="/casos/$id"
                        params={{ id: r.caso_id }}
                        className="ml-auto shrink-0 hover:underline text-foreground/80 truncate max-w-[220px]"
                      >
                        {nomeAmigavel(clienteNome)}
                      </Link>
                    ) : (
                      <span className="ml-auto shrink-0 italic text-muted-foreground">
                        {r.caso_id ? "caso excluído" : "sem caso"}
                      </span>
                    ))}
                </div>
                <div className="text-muted-foreground">
                  Excluída por{" "}
                  <span className="font-medium text-foreground">
                    {nomeOuSistema(r.excluidor, true)}
                  </span>{" "}
                  em {formatarDataHoraCurtaBR(r.excluida_em)}
                  {r.responsavel?.nome ? ` · responsável: ${nomeAmigavel(r.responsavel.nome)}` : ""}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

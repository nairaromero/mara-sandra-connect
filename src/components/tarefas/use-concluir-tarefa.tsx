// Chokepoint da regra "nada e baixado sem razao" (revisao 2026-09-02).
//
// Toda superficie que conclui pelo "Feito" ou exclui uma tarefa usa ESTE hook
// em vez de re-implementar o intercept — foi a copia por-superficie que
// deixou o Excluir do menu do card sem motivo no lote original. O hook e dono
// do estado do popup; a tela so diz o que fazer depois.
//
// Uso:
//   const concluir = useConcluirTarefa({ aoConcluida, aoExcluida, aoEditar, aoNovaTarefa });
//   ... concluir.pedirConclusao(tarefa)  // status -> feito passa pelo popup
//   ... concluir.pedirExclusao(tarefa)   // exclusao SEMPRE com motivo
//   ... {concluir.elemento}              // renderiza o dialog uma vez

import { useState, type ReactNode } from "react";

import type { TarefaComJoins } from "@/lib/tarefas/types";
import { ConcluirTarefaDialog } from "@/components/tarefas/concluir-tarefa-dialog";

export function useConcluirTarefa(opts: {
  /** depois de concluir (status=feito ja persistido) */
  aoConcluida: (t: TarefaComJoins) => void;
  /** depois de excluir com motivo */
  aoExcluida: (id: string) => void;
  /** usuario pediu pra editar em vez de concluir */
  aoEditar: (t: TarefaComJoins) => void;
  /** abrir a criacao da proxima tarefa do caso */
  aoNovaTarefa: (casoId: string | null) => void;
}): {
  pedirConclusao: (t: TarefaComJoins) => void;
  pedirExclusao: (t: TarefaComJoins) => void;
  elemento: ReactNode;
} {
  const [alvo, setAlvo] = useState<TarefaComJoins | null>(null);
  const [modo, setModo] = useState<"concluir" | "excluir">("concluir");

  function pedirConclusao(t: TarefaComJoins) {
    setModo("concluir");
    setAlvo(t);
  }

  function pedirExclusao(t: TarefaComJoins) {
    setModo("excluir");
    setAlvo(t);
  }

  const elemento = (
    <ConcluirTarefaDialog
      tarefa={alvo}
      modoInicial={modo}
      onClose={() => setAlvo(null)}
      onConcluidaEAdicionar={(t) => {
        opts.aoConcluida(t);
        opts.aoNovaTarefa(t.caso_id);
      }}
      onExcluida={(id) => opts.aoExcluida(id)}
      onEditar={(t) => opts.aoEditar(t)}
    />
  );

  return { pedirConclusao, pedirExclusao, elemento };
}

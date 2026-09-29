// Bloco da tarefa "Providenciar documentos" (metadata.providenciar_documento).
//
// A tarefa nasce quando a solicitação é INTERNA e alguém da equipe é escolhido
// como responsável. Antes deste bloco (Naira, 2026-09-18) ela vivia solta: dava
// pra concluir a tarefa, subir o arquivo pelo upload comum e o PEDIDO continuar
// pendente pra sempre — a ligação só existia no sentido pedido → tarefa.
//
// Aqui a tarefa mostra o pedido e leva direto ao cumprimento: anexar o
// documento fecha o pedido e o banco conclui esta tarefa sozinho
// (_solicitacao_resolvida_fecha_providenciar).

import { useState } from "react";
import { FileUp, CheckCircle2 } from "lucide-react";

import { usePedidoDaTarefa } from "@/lib/tarefas/pedido-documento";
import type { TarefaComJoins } from "@/lib/tarefas/types";
import { Button } from "@/components/ui/button";
import { CumprirSolicitacaoDialog } from "@/components/documentos/cumprir-solicitacao-dialog";

export function EtapaProvidenciarDocumento(props: {
  tarefa: TarefaComJoins;
  onUpdated: () => void;
  /** no card da lista: sem moldura nem texto de apoio, só o botão. */
  compacto?: boolean;
  /** no card, clicar no botão não pode abrir o painel da tarefa. */
  stopPropagation?: boolean;
}) {
  const { tarefa, onUpdated, compacto = false, stopPropagation = false } = props;
  const pedido = usePedidoDaTarefa(tarefa.metadata);
  const [cumprindo, setCumprindo] = useState<string | null>(null);
  const [cumpridoAgora, setCumpridoAgora] = useState(false);

  // Carregando ou sem pedido: nada a mostrar. Erro de leitura entra no bloco
  // (compacto ou não) como aviso — silêncio aqui seria dizer que está tudo
  // certo sem saber (achado 7 da revisão do Yuri).
  if (pedido === undefined || pedido === null) return null;

  if (pedido === "erro") {
    if (compacto) return null;
    return (
      <div className="rounded-md border border-dashed p-3">
        <p className="text-xs text-muted-foreground">
          Não consegui conferir o pedido de documento desta tarefa. Recarregue a página antes
          de concluí-la.
        </p>
      </div>
    );
  }

  const resolvido = cumpridoAgora || pedido.status !== "pendente";

  // Diálogo montado junto nos dois formatos: é ele que faz o cumprimento.
  const dialogo = (
    <CumprirSolicitacaoDialog
      solicitacaoId={cumprindo}
      onFechar={() => setCumprindo(null)}
      onCumprida={() => {
        setCumpridoAgora(true);
        onUpdated();
      }}
    />
  );

  // No card da lista (Naira, 2026-09-18): cumprir sem precisar abrir a tarefa.
  if (compacto) {
    if (resolvido) return null;
    return (
      <div onClick={stopPropagation ? (e) => e.stopPropagation() : undefined}>
        <Button
          size="sm"
          variant="outline"
          className="h-7 text-xs"
          onClick={(e) => {
            if (stopPropagation) e.stopPropagation();
            setCumprindo(pedido.id);
          }}
        >
          <FileUp className="h-3.5 w-3.5 mr-1.5" />
          Anexar documento e cumprir
        </Button>
        {dialogo}
      </div>
    );
  }

  return (
    <div className="rounded-md border p-3 space-y-2">
      <div className="flex items-start gap-2">
        <FileUp className="h-4 w-4 mt-0.5 shrink-0 text-muted-foreground" />
        <div className="min-w-0">
          <p className="text-sm font-medium">Pedido de documento</p>
          <p className="text-xs text-muted-foreground break-words">{pedido.rotulo}</p>
        </div>
      </div>
      {resolvido ? (
        <p className="text-xs text-muted-foreground flex items-center gap-1.5">
          <CheckCircle2 className="h-3.5 w-3.5 text-success" />
          Pedido cumprido — esta tarefa se conclui sozinha.
        </p>
      ) : (
        <>
          <Button size="sm" onClick={() => setCumprindo(pedido.id)}>
            <FileUp className="h-3.5 w-3.5 mr-2" />
            Anexar documento e cumprir o pedido
          </Button>
          <p className="text-xs text-muted-foreground">
            Concluir a tarefa pelo "Feito" não fecha o pedido — ele continua na lista de
            documentos pendentes.
          </p>
        </>
      )}
      {dialogo}
    </div>
  );
}

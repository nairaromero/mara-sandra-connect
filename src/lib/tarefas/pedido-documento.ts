// Pedido de documento ligado a uma tarefa "Providenciar documentos"
// (metadata.providenciar_documento). Fica fora do componente porque o popup de
// conclusão também precisa saber se o pedido continua aberto.

import { useCallback, useEffect, useState } from "react";

import { supabase } from "@/lib/supabase";
import { rotuloSolicitacao, type ItemSolicitacao } from "@/lib/documentos/cumprimento";

/** `undefined` = carregando · `"erro"` = leitura falhou · `null` = não tem. */
export type EstadoPedido = PedidoDaTarefa | null | undefined | "erro";

export interface PedidoDaTarefa {
  id: string;
  status: string;
  rotulo: string;
}

/** id da solicitação que originou a tarefa, ou null. */
export function solicitacaoDaTarefa(metadata: unknown): string | null {
  const m = (metadata ?? {}) as Record<string, unknown>;
  if (m.providenciar_documento !== true) return null;
  const id = m.origem_solicitacao_documento_id;
  return typeof id === "string" && id ? id : null;
}

/**
 * Carrega o pedido ligado à tarefa. Três respostas que NÃO se confundem
 * (achado 7 da revisão do Yuri no PR #391):
 *   `undefined` = ainda carregando
 *   `"erro"`    = não consegui ler (≠ "não tem pedido")
 *   `null`      = a tarefa não tem pedido, ou ele sumiu
 */
export function usePedidoDaTarefa(metadata: unknown): EstadoPedido {
  const solicId = solicitacaoDaTarefa(metadata);
  const [pedido, setPedido] = useState<EstadoPedido>(solicId ? undefined : null);

  const carregar = useCallback(() => {
    if (!solicId) {
      setPedido(null);
      return;
    }
    let vivo = true;
    setPedido(undefined);
    supabase
      .from("solicitacoes_documento")
      .select("id, status, tipo, tipos")
      .eq("id", solicId)
      .maybeSingle()
      .then(({ data, error }) => {
        if (!vivo) return;
        if (error) {
          // Falha de leitura NÃO é "não tem pedido": quem consome avisa que
          // não deu para conferir, em vez de dizer que está tudo certo.
          console.error("pedido da tarefa:", error);
          setPedido("erro");
          return;
        }
        setPedido(
          data
            ? {
                id: data.id as string,
                status: data.status as string,
                rotulo: rotuloSolicitacao(
                  data.tipo as string,
                  (data.tipos ?? null) as ItemSolicitacao[] | null,
                ),
              }
            : null,
        );
      });
    return () => {
      vivo = false;
    };
  }, [solicId]);

  useEffect(() => carregar(), [carregar]);

  return pedido;
}

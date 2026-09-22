// Pedido de acesso de suporte visto pelo escritorio (RPC suporte_pedidos).

export interface PedidoSuporte {
  id: string;
  staff_nome: string | null;
  motivo: string;
  ticket: string | null;
  horas: number;
  status: "pendente" | "aprovado" | "recusado" | "encerrado";
  break_glass: boolean;
  solicitado_em: string;
  inicio: string | null;
  fim: string | null;
}

/** Aprovado e dentro do prazo = sessao que pode estar aberta agora. */
export function emAndamento(p: PedidoSuporte, agora = Date.now()): boolean {
  return p.status === "aprovado" && !!p.fim && new Date(p.fim).getTime() > agora;
}

/** Quem aprova/recusa/encerra avisa o resto da tela (o aviso do topo some na hora). */
export const EVENTO_SUPORTE = "msc:suporte-mudou";

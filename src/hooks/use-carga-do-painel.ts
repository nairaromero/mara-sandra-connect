// Lista auxiliar de um painel (clientes, responsáveis…), carregada quando o
// painel abre. UM lugar para o que os painéis de Tarefa e de Agenda faziam com
// duas cópias e `.catch(() => {})`: falha virava seletor vazio, calado, ou —
// depois do #460 — um toast que sumia e deixava o seletor dizendo "nenhum
// encontrado" (falso). Aqui a falha vira ESTADO: o painel mostra o aviso no
// lugar, com "Tentar de novo", até a lista carregar.
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

export interface CargaDoPainel<T> {
  dados: Array<T>;
  /** Mensagem para a pessoa (nunca o texto cru do banco), ou null. */
  erro: string | null;
  carregando: boolean;
  recarregar: () => void;
}

/**
 * @param aberto  carrega quando vira true (e de novo a cada abertura)
 * @param carregar a consulta — deve LANÇAR em erro (não devolver [] calado)
 * @param oQue    "a lista de clientes": entra na mensagem de erro
 */
export function useCargaDoPainel<T>(
  aberto: boolean,
  carregar: () => Promise<Array<T>>,
  oQue: string,
): CargaDoPainel<T> {
  const [dados, setDados] = useState<Array<T>>([]);
  const [erro, setErro] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(false);
  const [tentativa, setTentativa] = useState(0);

  useEffect(() => {
    if (!aberto) return;
    let vivo = true;
    setCarregando(true);
    setErro(null);
    carregar()
      .then((r) => {
        if (vivo) setDados(r);
      })
      .catch((e: unknown) => {
        if (!vivo) return;
        // O detalhe técnico vai para o console; a pessoa lê o que fazer.
        console.error(`carregando ${oQue}:`, e);
        const msg = `Não consegui carregar ${oQue}.`;
        setErro(msg);
        toast.error(msg, { description: "Use “Tentar de novo” no painel." });
      })
      .finally(() => {
        if (vivo) setCarregando(false);
      });
    return () => {
      vivo = false;
    };
  }, [aberto, carregar, oQue, tentativa]);

  const recarregar = useCallback(() => setTentativa((n) => n + 1), []);
  return { dados, erro, carregando, recarregar };
}

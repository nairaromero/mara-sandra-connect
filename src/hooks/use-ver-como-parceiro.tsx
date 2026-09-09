// "Ver como parceiro" — modo SOMENTE-LEITURA pro admin (Naira/Mara) enxergar
// o lado do parceiro (kanban de Tarefas + Agenda) sem senha e sem derrubar a
// sessão de ninguém (Naira, 2026-09-02).
//
// Segurança: o modo só vale pra is_admin() — o efetivo é anulado pra qualquer
// outro. E o dado em si é escopado no BANCO (agenda_do_parceiro só aceita
// p_parceiro_id de admin; as queries de solicitação filtram por parceiro_id
// sob RLS de interno). O front nunca é a única barreira.
//
// Estado em sessionStorage: sobrevive a reload/navegação, morre ao fechar a
// aba — não quero um admin "preso" vendo como parceiro sem perceber.

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useAuth } from "@/hooks/use-auth";

export interface VerComoAlvo {
  parceiroId: string;
  parceiroNome: string;
}

interface VerComoCtx {
  verComo: VerComoAlvo | null;
  entrarVerComo: (alvo: VerComoAlvo) => void;
  sairVerComo: () => void;
}

const Ctx = createContext<VerComoCtx | undefined>(undefined);
const CHAVE = "msc:ver_como_parceiro";

function lerInicial(): VerComoAlvo | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(CHAVE);
    return raw ? (JSON.parse(raw) as VerComoAlvo) : null;
  } catch {
    return null;
  }
}

export function VerComoParceiroProvider({ children }: { children: ReactNode }) {
  const { isAdmin } = useAuth();
  const [alvo, setAlvo] = useState<VerComoAlvo | null>(lerInicial);

  const entrarVerComo = useCallback((novo: VerComoAlvo) => {
    setAlvo(novo);
    try {
      window.sessionStorage.setItem(CHAVE, JSON.stringify(novo));
    } catch {
      /* sessionStorage indisponível: modo vale só nesta navegação */
    }
  }, []);

  const sairVerComo = useCallback(() => {
    setAlvo(null);
    try {
      window.sessionStorage.removeItem(CHAVE);
    } catch {
      /* ignore */
    }
  }, []);

  // Só admin fica em modo ver-como. Não-admin (ou ainda carregando): anulado —
  // o dado no banco também não viria, mas a UI não deve nem sugerir o modo.
  const value = useMemo<VerComoCtx>(
    () => ({ verComo: isAdmin ? alvo : null, entrarVerComo, sairVerComo }),
    [isAdmin, alvo, entrarVerComo, sairVerComo],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useVerComoParceiro(): VerComoCtx {
  const c = useContext(Ctx);
  // Fora do provider (ex.: telas públicas): modo sempre inativo.
  return c ?? { verComo: null, entrarVerComo: () => {}, sairVerComo: () => {} };
}

// Destaque global pra itens recém-criados (tarefas, andamentos, eventos).
// Quando um componente cria algo, chama `marcar(id)`. Cards que renderizam
// usam `useDestaqueAtivo(id)` pra aplicar o realce visual por ~5 segundos.
//
// Uso:
//   const { marcar } = useDestaque();
//   ...
//   const t = await criarTarefa({...});
//   marcar(t.id);
//
//   // no card:
//   const ativo = useDestaqueAtivo(tarefa.id);
//   <div className={ativo ? DESTAQUE_CLASSE : ""}>...</div>

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";

const DURACAO_MS = 5000;

interface DestaqueContextValue {
  marcar: (id: string | null | undefined) => void;
  ativos: ReadonlySet<string>;
}

const DestaqueContext = createContext<DestaqueContextValue | null>(null);

export function DestaqueProvider({ children }: { children: ReactNode }) {
  const [ativos, setAtivos] = useState<Set<string>>(() => new Set());
  // Refs pra timers ativos por id — permite cancelar/reagendar sem leak.
  const timersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  const marcar = useCallback((id: string | null | undefined) => {
    if (!id) return;
    setAtivos((prev) => {
      if (prev.has(id)) return prev;
      const next = new Set(prev);
      next.add(id);
      return next;
    });
    // Reset timer pra esse id.
    const existente = timersRef.current.get(id);
    if (existente) clearTimeout(existente);
    const t = setTimeout(() => {
      setAtivos((prev) => {
        if (!prev.has(id)) return prev;
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
      timersRef.current.delete(id);
    }, DURACAO_MS);
    timersRef.current.set(id, t);
  }, []);

  useEffect(() => {
    const timers = timersRef.current;
    return () => {
      for (const t of timers.values()) clearTimeout(t);
      timers.clear();
    };
  }, []);

  return (
    <DestaqueContext.Provider value={{ marcar, ativos }}>
      {children}
    </DestaqueContext.Provider>
  );
}

export function useDestaque(): DestaqueContextValue {
  const ctx = useContext(DestaqueContext);
  if (!ctx) {
    // Fora do provider — funciona como no-op pra evitar quebrar telas que
    // ainda não foram embrulhadas.
    return { marcar: () => {}, ativos: new Set() };
  }
  return ctx;
}

export function useDestaqueAtivo(id: string | null | undefined): boolean {
  const { ativos } = useDestaque();
  if (!id) return false;
  return ativos.has(id);
}

export const DESTAQUE_CLASSE_GLOBAL =
  "ring-2 ring-[var(--gold)] bg-gold-soft/40 rounded-md transition-all duration-300";

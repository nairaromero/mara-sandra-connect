// Quem sou eu no QG — contexto das rotas /qg/*.
//
// Mora FORA do arquivo de rota de propósito: o roteador separa o componente de
// cada rota num chunk próprio (`?tsr-split=component`), e um contexto criado
// dentro de `routes/qg.tsx` viraria DOIS objetos — o layout proveria um e as
// páginas leriam o outro ("useQg fora do QG", visto em 22/09).

import { createContext, useContext } from "react";
import type { QgEu } from "@/lib/qg/tipos";

export const QgContext = createContext<QgEu | null>(null);

export function useQg(): QgEu & { pode: (permissao: string) => boolean } {
  const eu = useContext(QgContext);
  if (!eu) throw new Error("useQg fora do QG");
  return { ...eu, pode: (p) => eu.permissoes.includes(p) };
}

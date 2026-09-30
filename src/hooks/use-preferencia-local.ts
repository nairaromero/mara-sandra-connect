// Preferência de tela lembrada no navegador (por pessoa e dispositivo): tamanho
// de página de uma lista, painel recolhido… Um lugar só para isso — não repetir
// o try/catch do localStorage em cada tela.
//
// Guardar/ler pode falhar (janela privada, armazenamento bloqueado): aí a
// escolha vale só nesta visita. Sem `chave`, também só nesta visita.
// Não serve para estado que precisa valer entre pessoas ou dispositivos.

import { useCallback, useState } from "react";

/** Valor guardado (texto) ou null quando nada foi escolhido. `null` no set apaga. */
export function usePreferenciaLocal(
  chave: string | undefined,
): [string | null, (valor: string | null) => void] {
  const [valor, setValorState] = useState<string | null>(() => {
    if (!chave || typeof window === "undefined") return null;
    try {
      return window.localStorage.getItem(chave);
    } catch {
      return null;
    }
  });
  const setValor = useCallback(
    (v: string | null) => {
      setValorState(v);
      if (!chave || typeof window === "undefined") return;
      try {
        if (v === null) window.localStorage.removeItem(chave);
        else window.localStorage.setItem(chave, v);
      } catch {
        /* sem armazenamento: só nesta visita */
      }
    },
    [chave],
  );
  return [valor, setValor];
}

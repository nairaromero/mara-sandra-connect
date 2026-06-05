import { useEffect, useState } from "react";

// Destaque de item via deep-link (?foco=<id>). Rola ate o elemento com
// id="foco-<id>" e mantem o realce ativo por alguns segundos. Faz retry porque
// a lista pode renderizar depois (dados async / accordion expandindo).
//
// Uso no componente:
//   const foco = useFocoItem(focoId);
//   <li id={"foco-" + item.id} className={foco === item.id ? DESTAQUE : ""}>
export const DESTAQUE_CLASSE =
  "ring-2 ring-[var(--gold)] bg-gold-soft/40 rounded-md transition-all";

export function useFocoItem(focoId?: string | null): string | null {
  const [ativo, setAtivo] = useState<string | null>(null);

  useEffect(() => {
    if (!focoId) return;
    setAtivo(focoId);
    let tries = 0;
    let scrollTimer: ReturnType<typeof setTimeout>;
    const tryScroll = () => {
      const el = document.getElementById("foco-" + focoId);
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "center" });
        return;
      }
      if (tries++ < 10) scrollTimer = setTimeout(tryScroll, 250);
    };
    const start = setTimeout(tryScroll, 150);
    const off = setTimeout(() => setAtivo(null), 5000);
    return () => {
      clearTimeout(start);
      clearTimeout(scrollTimer);
      clearTimeout(off);
    };
  }, [focoId]);

  return ativo;
}

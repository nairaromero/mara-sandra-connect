// Marca do ESCRITORIO ativo (escritorio_config.marca, via useAuth): logo, ou o
// nome em texto quando nao ha logo; versao compacta = iniciais na cor do
// escritorio. A marca do PRODUTO (Legal Connect) e outro componente.

import { useAuth } from "@/hooks/use-auth";
import { iniciaisDe, nomeDoEscritorio } from "@/lib/marca-escritorio";

export function MarcaEscritorio(props: { variante?: "logo" | "compacta"; className?: string }) {
  const { variante = "logo", className } = props;
  const { escritorio } = useAuth();
  const nome = nomeDoEscritorio(escritorio);
  const logo = escritorio?.marca?.logo_url || null;
  const cor = escritorio?.marca?.cor || null;

  if (variante === "compacta") {
    return (
      <div
        data-marca-escritorio="compacta"
        className={"flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-white text-xs font-bold " + (className ?? "")}
        style={cor ? { background: cor } : { background: "linear-gradient(135deg, #c9a14a 0%, #e8c878 50%, #b8862e 100%)" }}
        title={nome}
        aria-label={nome}
      >
        {iniciaisDe(nome)}
      </div>
    );
  }
  if (logo) {
    return <img data-marca-escritorio="logo" src={logo} alt={nome} className={className} draggable={false} />;
  }
  return (
    <span
      data-marca-escritorio="nome"
      className={"font-serif text-lg font-semibold leading-tight tracking-tight " + (className ?? "")}
      style={cor ? { color: cor } : undefined}
    >
      {nome}
    </span>
  );
}

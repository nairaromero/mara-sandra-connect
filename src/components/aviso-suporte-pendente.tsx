// Aviso no topo para o ADMIN: a plataforma pediu acesso de suporte a este
// escritorio e alguem precisa responder. Consulta leve (RPC suporte_pedidos)
// ao abrir e a cada minuto; some na hora quando a aba Suporte responde
// (evento msc:suporte-mudou).

import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { LifeBuoy } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/hooks/use-auth";
import { EVENTO_SUPORTE, type PedidoSuporte } from "@/lib/suporte/pedidos";

export function AvisoSuportePendente() {
  const { isAdmin, emSuporte } = useAuth();
  const [pendentes, setPendentes] = useState(0);

  useEffect(() => {
    if (!isAdmin || emSuporte) return;
    let vivo = true;
    async function conferir() {
      const { data, error } = await supabase.rpc("suporte_pedidos");
      if (!vivo || error) return; // falha aqui nao pode derrubar a tela; a aba mostra o erro
      setPendentes(((data ?? []) as Array<PedidoSuporte>).filter((p) => p.status === "pendente").length);
    }
    void conferir();
    const t = setInterval(conferir, 60000);
    window.addEventListener(EVENTO_SUPORTE, conferir);
    return () => {
      vivo = false;
      clearInterval(t);
      window.removeEventListener(EVENTO_SUPORTE, conferir);
    };
  }, [isAdmin, emSuporte]);

  if (!isAdmin || emSuporte || pendentes === 0) return null;
  return (
    <div
      role="status"
      data-aviso-suporte
      className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 border-b border-amber-300 bg-amber-50 px-4 py-2 text-sm text-amber-900"
    >
      <LifeBuoy className="h-4 w-4 shrink-0" />
      <span>
        A equipe da plataforma pediu <strong>acesso de suporte</strong> a este escritório
        {pendentes > 1 ? ` (${pendentes} pedidos)` : ""}. Só um administrador pode liberar.
      </span>
      <Link to="/configuracoes" search={{ tab: "suporte" }} className="font-medium underline underline-offset-2">
        Ver pedido
      </Link>
    </div>
  );
}

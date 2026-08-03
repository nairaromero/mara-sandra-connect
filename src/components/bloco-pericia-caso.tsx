import { useCallback, useEffect, useState } from "react";
import { CalendarClock, Stethoscope } from "lucide-react";

import { supabase } from "@/lib/supabase";
import {
  PERICIA_JUDICIAL_CLASS,
  TIPO_CLASS,
  type PericiaNatureza,
} from "@/lib/agenda/types";

// Uma perícia agendada do caso, como vem da RPC pericias_do_caso().
interface PericiaDoCaso {
  fonte: string;
  id: string;
  caso_id: string;
  titulo: string;
  start_at: string;
  end_at: string | null;
  local: string | null;
  natureza: PericiaNatureza;
}

interface BlocoPericiaCasoProps {
  casoId: string;
  // Sinal externo para recarregar (ex.: após criar/editar andamento/tarefa).
  recarregarSinal?: number;
}

function classeNatureza(nat: PericiaNatureza): string {
  // Judicial = violeta; INSS/administrativa = verde (mesma paleta da agenda).
  if (nat === "judicial") return PERICIA_JUDICIAL_CLASS;
  return TIPO_CLASS.pericia;
}

function rotuloNatureza(nat: PericiaNatureza): string {
  if (nat === "judicial") return "Perícia Judicial";
  if (nat === "admin") return "Perícia INSS";
  return "Perícia";
}

function formatarQuando(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "-";
  const data = d.toLocaleDateString("pt-BR", {
    weekday: "short",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
  const hora = d.toLocaleTimeString("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
  });
  // Tarefas migradas sem hora ficam em 00:00 — não mostrar hora nesse caso.
  const semHora = d.getHours() === 0 && d.getMinutes() === 0;
  return semHora ? data : data + " às " + hora;
}

function ehFutura(iso: string): boolean {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return false;
  // Considera "próxima" até o fim do dia da perícia.
  const fimDoDia = new Date(d);
  fimDoDia.setHours(23, 59, 59, 999);
  return fimDoDia.getTime() >= Date.now();
}

// Bloco "Perícia" que aparece no topo dos Andamentos (equipe e parceiro).
// Mostra as perícias agendadas do caso com a cor da natureza (judicial=violeta,
// INSS/adm=verde). Some quando o caso não tem perícia.
export function BlocoPericiaCaso(props: BlocoPericiaCasoProps) {
  const { casoId, recarregarSinal } = props;
  const [pericias, setPericias] = useState<Array<PericiaDoCaso>>([]);
  const [carregado, setCarregado] = useState(false);

  const carregar = useCallback(async () => {
    const resp = await supabase.rpc("pericias_do_caso", { p_caso_id: casoId });
    if (!resp.error && resp.data) {
      setPericias(resp.data as Array<PericiaDoCaso>);
    }
    setCarregado(true);
  }, [casoId]);

  useEffect(() => {
    carregar();
  }, [carregar, recarregarSinal]);

  // Enquanto não carregou, ou sem perícia: não renderiza nada (bloco discreto).
  if (!carregado || pericias.length === 0) return null;

  // Próximas primeiro (as futuras no topo, ordenadas por data).
  const ordenadas = [...pericias].sort(
    (a, b) => new Date(a.start_at).getTime() - new Date(b.start_at).getTime(),
  );

  return (
    <div className="rounded-md border bg-card p-3 shadow-sm">
      <div className="mb-2 flex items-center gap-2">
        <Stethoscope className="h-4 w-4 text-muted-foreground" />
        <span className="text-sm font-medium">Perícia</span>
        {ordenadas.length > 1 && (
          <span className="text-xs text-muted-foreground">
            ({ordenadas.length})
          </span>
        )}
      </div>
      <ul className="space-y-2">
        {ordenadas.map((p) => {
          const futura = ehFutura(p.start_at);
          return (
            <li
              key={p.fonte + ":" + p.id}
              className={
                "flex flex-col gap-1 rounded-md border px-3 py-2 text-sm " +
                classeNatureza(p.natureza) +
                (futura ? "" : " opacity-70")
              }
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded-full bg-black/5 px-2 py-0.5 text-[11px] font-medium dark:bg-white/10">
                  {rotuloNatureza(p.natureza)}
                </span>
                {!futura && (
                  <span className="text-[11px] font-medium opacity-80">
                    já realizada
                  </span>
                )}
              </div>
              <div className="flex items-center gap-1.5 font-medium">
                <CalendarClock className="h-3.5 w-3.5 shrink-0" />
                {formatarQuando(p.start_at)}
              </div>
              {p.titulo && (
                <div className="text-xs opacity-90">{p.titulo}</div>
              )}
              {p.local && (
                <div className="text-xs opacity-80">Local: {p.local}</div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

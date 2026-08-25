import { useCallback, useEffect, useState } from "react";
import {
  CalendarClock,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Stethoscope,
} from "lucide-react";

import { supabase } from "@/lib/supabase";
import {
  PERICIA_JUDICIAL_CLASS,
  TIPO_CLASS,
  type PericiaNatureza,
} from "@/lib/agenda/types";
import { fimDoDiaBR, formatarBR, horaBR, partesBR } from "@/lib/fuso";

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
  const data = formatarBR(d, {
    weekday: "short",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
  // Tarefas migradas sem hora ficam em 00:00 — não mostrar hora nesse caso.
  const p = partesBR(d);
  const semHora = p.hora === 0 && p.min === 0;
  return semHora ? data : data + " às " + horaBR(d);
}

function ehFutura(iso: string): boolean {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return false;
  // Considera "próxima" até o fim do dia (de Brasília) da perícia.
  return fimDoDiaBR(d).getTime() >= Date.now();
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

  const [mostrarRealizadas, setMostrarRealizadas] = useState(false);

  // Enquanto não carregou, ou sem perícia: não renderiza nada (bloco discreto).
  if (!carregado || pericias.length === 0) return null;

  // Ordena por data e separa em próximas (futuras/hoje) e já realizadas.
  const ordenadas = [...pericias].sort(
    (a, b) => new Date(a.start_at).getTime() - new Date(b.start_at).getTime(),
  );
  const proximas = ordenadas.filter((p) => ehFutura(p.start_at));
  // Realizadas: mais recentes primeiro (a última perícia feita no topo).
  const realizadas = ordenadas
    .filter((p) => !ehFutura(p.start_at))
    .reverse();

  return (
    <div className="rounded-md border bg-card p-3 shadow-sm">
      <div className="mb-2 flex items-center gap-2">
        <Stethoscope className="h-4 w-4 text-muted-foreground" />
        <span className="text-sm font-medium">Perícia</span>
        {proximas.length > 1 && (
          <span className="text-xs text-muted-foreground">
            ({proximas.length})
          </span>
        )}
      </div>

      {proximas.length > 0 ? (
        <ul className="space-y-2">
          {proximas.map((p) => (
            <PericiaItem key={p.fonte + ":" + p.id} pericia={p} />
          ))}
        </ul>
      ) : (
        realizadas.length > 0 && (
          <p className="text-xs text-muted-foreground">
            Nenhuma perícia futura agendada.
          </p>
        )
      )}

      {realizadas.length > 0 && (
        <div className={proximas.length > 0 ? "mt-2" : "mt-1"}>
          <button
            type="button"
            onClick={() => setMostrarRealizadas((v) => !v)}
            className="flex w-full items-center gap-1.5 rounded-md px-1 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted/60"
          >
            {mostrarRealizadas ? (
              <ChevronDown className="h-3.5 w-3.5" />
            ) : (
              <ChevronRight className="h-3.5 w-3.5" />
            )}
            <CheckCircle2 className="h-3.5 w-3.5" />
            Perícias realizadas ({realizadas.length})
          </button>
          {mostrarRealizadas && (
            <ul className="mt-2 space-y-2">
              {realizadas.map((p) => (
                <PericiaItem key={p.fonte + ":" + p.id} pericia={p} realizada />
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

// Um cartão de perícia (usado tanto nas próximas quanto nas realizadas).
function PericiaItem(props: { pericia: PericiaDoCaso; realizada?: boolean }) {
  const { pericia: p, realizada } = props;
  return (
    <li
      className={
        "flex flex-col gap-1 rounded-md border px-3 py-2 text-sm " +
        classeNatureza(p.natureza) +
        (realizada ? " opacity-70" : "")
      }
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="rounded-full bg-black/5 px-2 py-0.5 text-[11px] font-medium dark:bg-white/10">
          {rotuloNatureza(p.natureza)}
        </span>
        {realizada && (
          <span className="flex items-center gap-1 text-[11px] font-medium opacity-80">
            <CheckCircle2 className="h-3 w-3" />
            já realizada
          </span>
        )}
      </div>
      <div className="flex items-center gap-1.5 font-medium">
        <CalendarClock className="h-3.5 w-3.5 shrink-0" />
        {formatarQuando(p.start_at)}
      </div>
      {p.titulo && <div className="text-xs opacity-90">{p.titulo}</div>}
      {p.local && <div className="text-xs opacity-80">Local: {p.local}</div>}
    </li>
  );
}

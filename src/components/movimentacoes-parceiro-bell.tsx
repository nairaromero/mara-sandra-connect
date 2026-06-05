import { useCallback, useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import {
  Bell,
  CheckCheck,
  ClipboardList,
  FileCheck,
  FileText,
  MessageSquare,
  Scale,
} from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

// Sino de movimentacoes do PARCEIRO. Caixa de NAO-LIDOS: junta andamentos,
// comentarios, solicitacoes, documentos e novos processos dos casos dele;
// clicar (ou "marcar todas") marca como lido e o item SAI do sino. Estado de
// leitura por dispositivo (localStorage) — versao leve; o feed por-usuario no
// servidor vem na #7. Na 1a carga, tudo que ja existe vira "lido" (slate limpo)
// -> so movimentacao nova aparece.

const LIDOS_KEY = "msc:parceiro_lidos";
const INIT_KEY = "msc:parceiro_lidos_init";

type TipoMov =
  | "andamento"
  | "comentario"
  | "solicitacao"
  | "documento"
  | "processo";

const CFG: Record<
  TipoMov,
  // deno-lint-ignore no-explicit-any
  { tab: string; label: string; icon: any }
> = {
  andamento: { tab: "andamentos", label: "andamento", icon: ClipboardList },
  comentario: { tab: "comentarios", label: "comentario", icon: MessageSquare },
  solicitacao: {
    tab: "documentos",
    label: "solicitacao de documento",
    icon: FileText,
  },
  documento: { tab: "documentos", label: "documento", icon: FileCheck },
  processo: { tab: "processos", label: "novo processo", icon: Scale },
};

interface Mov {
  id: string;
  refId: string; // id real do registro (sem prefixo) p/ destaque ?foco=
  tipo: TipoMov;
  texto: string;
  created_at: string;
  caso_id: string;
  cliente: string;
}

function tempoRelativo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const min = Math.floor(diff / 60000);
  if (min < 1) return "agora";
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h}h`;
  const dias = Math.floor(h / 24);
  if (dias < 30) return `${dias}d`;
  return new Date(iso).toLocaleDateString("pt-BR");
}

function getLidos(): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    return new Set(
      JSON.parse(window.localStorage.getItem(LIDOS_KEY) || "[]") as string[],
    );
  } catch {
    return new Set();
  }
}
function saveLidos(s: Set<string>) {
  if (typeof window !== "undefined") {
    window.localStorage.setItem(LIDOS_KEY, JSON.stringify([...s]));
  }
}

// deno-lint-ignore no-explicit-any
function nome(row: any): string {
  return row?.casos?.cliente?.nome || "Caso";
}

const SEL_CASO = "casos:caso_id(cliente:cliente_id(nome))";

export function MovimentacoesParceiroBell() {
  const { usuario } = useAuth();
  const [open, setOpen] = useState(false);
  const [itens, setItens] = useState<Array<Mov>>([]);

  const carregar = useCallback(async () => {
    const uid = usuario?.id;
    const vazio = Promise.resolve({ data: [], error: null });
    const [and, com, sol, doc, pa, pj] = await Promise.all([
      supabase
        .from("andamentos")
        .select(`id, titulo, created_at, caso_id, ${SEL_CASO}`)
        .eq("visivel_parceiro", true)
        .order("created_at", { ascending: false })
        .limit(25),
      uid
        ? supabase
          .from("comentarios")
          .select(`id, texto, created_at, caso_id, autor_id, ${SEL_CASO}`)
          .neq("autor_id", uid)
          .order("created_at", { ascending: false })
          .limit(25)
        : vazio,
      supabase
        .from("solicitacoes_documento")
        .select(`id, tipo, data_solicitacao, caso_id, ${SEL_CASO}`)
        .order("data_solicitacao", { ascending: false })
        .limit(25),
      supabase
        .from("documentos")
        .select(`id, nome_arquivo, created_at, caso_id, ${SEL_CASO}`)
        .eq("visivel_parceiro", true)
        .order("created_at", { ascending: false })
        .limit(25),
      supabase
        .from("processos_admin")
        .select(`id, numero_requerimento, created_at, caso_id, ${SEL_CASO}`)
        .order("created_at", { ascending: false })
        .limit(25),
      supabase
        .from("processos_judiciais")
        .select(`id, numero_processo, created_at, caso_id, ${SEL_CASO}`)
        .order("created_at", { ascending: false })
        .limit(25),
    ]);

    const movs: Array<Mov> = [];
    const add = (
      arr: unknown,
      tipo: TipoMov,
      prefix: string,
      // deno-lint-ignore no-explicit-any
      texto: (r: any) => string,
      // deno-lint-ignore no-explicit-any
      data: (r: any) => string,
    ) => {
      // deno-lint-ignore no-explicit-any
      for (const r of (arr || []) as Array<any>) {
        if (!data(r)) continue;
        movs.push({
          id: prefix + ":" + r.id,
          refId: String(r.id),
          tipo,
          texto: texto(r),
          created_at: data(r),
          caso_id: r.caso_id,
          cliente: nome(r),
        });
      }
    };
    add(and.data, "andamento", "a", (r) => r.titulo || "Novo andamento", (r) =>
      r.created_at);
    add(com.data, "comentario", "c", (r) => r.texto || "Novo comentario", (r) =>
      r.created_at);
    add(sol.data, "solicitacao", "s", (r) =>
      "Solicitacao: " + (r.tipo || "documento"), (r) => r.data_solicitacao);
    add(doc.data, "documento", "d", (r) => r.nome_arquivo || "Documento", (r) =>
      r.created_at);
    add(pa.data, "processo", "pa", (r) =>
      "Processo admin: " + (r.numero_requerimento || "novo"), (r) =>
      r.created_at);
    add(pj.data, "processo", "pj", (r) =>
      "Processo judicial: " + (r.numero_processo || "novo"), (r) =>
      r.created_at);

    movs.sort((x, y) =>
      new Date(y.created_at).getTime() - new Date(x.created_at).getTime()
    );
    const top = movs.slice(0, 50);

    let lidos = getLidos();
    const initDone = typeof window !== "undefined" &&
      window.localStorage.getItem(INIT_KEY) === "1";
    if (!initDone) {
      // Slate limpo: tudo que ja existe vira "lido".
      lidos = new Set(top.map((m) => m.id));
      saveLidos(lidos);
      if (typeof window !== "undefined") {
        window.localStorage.setItem(INIT_KEY, "1");
      }
    } else {
      // Poda: mantem so ids ainda presentes (evita crescer infinito).
      const presentes = new Set(top.map((m) => m.id));
      lidos = new Set([...lidos].filter((id) => presentes.has(id)));
      saveLidos(lidos);
    }

    setItens(top.filter((m) => !lidos.has(m.id)));
  }, [usuario?.id]);

  useEffect(() => {
    carregar();
    const t = setInterval(carregar, 30000);
    const onSyncDone = () => carregar();
    window.addEventListener("msc:sync-done", onSyncDone);
    return () => {
      clearInterval(t);
      window.removeEventListener("msc:sync-done", onSyncDone);
    };
  }, [carregar]);

  function dispensar(id: string) {
    const lidos = getLidos();
    lidos.add(id);
    saveLidos(lidos);
    setItens((prev) => prev.filter((m) => m.id !== id));
  }

  function marcarTodasLidas() {
    const lidos = getLidos();
    itens.forEach((m) => lidos.add(m.id));
    saveLidos(lidos);
    setItens([]);
  }

  const novos = itens.length;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="relative"
          aria-label="Movimentacoes"
        >
          <Bell className="h-5 w-5" />
          {novos > 0 && (
            <span className="absolute -top-0.5 -right-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-medium text-destructive-foreground">
              {novos > 9 ? "9+" : novos}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[22rem] p-0">
        <div className="flex items-center justify-between gap-2 border-b p-3">
          <div>
            <span className="text-sm font-semibold">Movimentacoes</span>
            <p className="text-xs text-muted-foreground">
              Novidades dos seus casos.
            </p>
          </div>
          {novos > 0 && (
            <Button
              size="icon"
              variant="ghost"
              className="h-7 w-7 shrink-0"
              onClick={marcarTodasLidas}
              title="Marcar todas como lidas"
            >
              <CheckCheck className="h-4 w-4" />
            </Button>
          )}
        </div>
        <div className="max-h-96 overflow-y-auto">
          {itens.length === 0
            ? (
              <p className="p-6 text-center text-sm text-muted-foreground">
                Nenhuma movimentacao nova.
              </p>
            )
            : (
              <ul className="divide-y">
                {itens.map((m) => {
                  const cfg = CFG[m.tipo];
                  const Icon = cfg.icon;
                  return (
                    <li
                      key={m.id}
                      className="p-3 hover:bg-muted/50 transition-colors"
                    >
                      <Link
                        to="/casos/$id"
                        params={{ id: m.caso_id }}
                        search={{ tab: cfg.tab, foco: m.refId }}
                        onClick={() => {
                          dispensar(m.id);
                          setOpen(false);
                        }}
                        className="block"
                      >
                        <div className="flex items-start gap-2">
                          <Icon className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-medium truncate">
                              {m.cliente}
                              <span className="text-xs font-normal text-muted-foreground">
                                {" · " + cfg.label}
                              </span>
                            </p>
                            <p className="text-xs text-muted-foreground line-clamp-2">
                              {m.texto}
                            </p>
                            <p className="text-[11px] text-muted-foreground mt-0.5">
                              {tempoRelativo(m.created_at)}
                            </p>
                          </div>
                          <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-destructive" />
                        </div>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

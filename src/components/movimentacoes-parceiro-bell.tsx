import { useCallback, useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import {
  Bell,
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

// Sino de movimentacoes do PARCEIRO (versao leve, somente-leitura).
// Junta TODAS as movimentacoes visiveis dos casos do parceiro: andamentos,
// comentarios, solicitacoes de documento, documentos juntados e novos
// processos. Badge = mais novos que a ultima abertura (localStorage).
// Cadastro do cliente + "dispensar por item" vem no feed completo (#7), que
// usa triggers/event-log (sem isso, "cadastro" daria falso-positivo a cada sync).

const VISTO_KEY = "msc:parceiro_mov_visto";

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

function getVisto(): number {
  if (typeof window === "undefined") return 0;
  const v = window.localStorage.getItem(VISTO_KEY);
  return v ? new Date(v).getTime() : 0;
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
  const [novos, setNovos] = useState(0);

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
    // deno-lint-ignore no-explicit-any
    for (const r of (and.data || []) as Array<any>) {
      movs.push({
        id: "a:" + r.id,
        tipo: "andamento",
        texto: r.titulo || "Novo andamento",
        created_at: r.created_at,
        caso_id: r.caso_id,
        cliente: nome(r),
      });
    }
    // deno-lint-ignore no-explicit-any
    for (const r of (com.data || []) as Array<any>) {
      movs.push({
        id: "c:" + r.id,
        tipo: "comentario",
        texto: r.texto || "Novo comentario",
        created_at: r.created_at,
        caso_id: r.caso_id,
        cliente: nome(r),
      });
    }
    // deno-lint-ignore no-explicit-any
    for (const r of (sol.data || []) as Array<any>) {
      movs.push({
        id: "s:" + r.id,
        tipo: "solicitacao",
        texto: "Solicitacao: " + (r.tipo || "documento"),
        created_at: r.data_solicitacao,
        caso_id: r.caso_id,
        cliente: nome(r),
      });
    }
    // deno-lint-ignore no-explicit-any
    for (const r of (doc.data || []) as Array<any>) {
      movs.push({
        id: "d:" + r.id,
        tipo: "documento",
        texto: r.nome_arquivo || "Documento juntado",
        created_at: r.created_at,
        caso_id: r.caso_id,
        cliente: nome(r),
      });
    }
    // deno-lint-ignore no-explicit-any
    for (const r of (pa.data || []) as Array<any>) {
      movs.push({
        id: "pa:" + r.id,
        tipo: "processo",
        texto: "Processo admin: " + (r.numero_requerimento || "novo"),
        created_at: r.created_at,
        caso_id: r.caso_id,
        cliente: nome(r),
      });
    }
    // deno-lint-ignore no-explicit-any
    for (const r of (pj.data || []) as Array<any>) {
      movs.push({
        id: "pj:" + r.id,
        tipo: "processo",
        texto: "Processo judicial: " + (r.numero_processo || "novo"),
        created_at: r.created_at,
        caso_id: r.caso_id,
        cliente: nome(r),
      });
    }

    movs.sort((x, y) =>
      new Date(y.created_at).getTime() - new Date(x.created_at).getTime()
    );
    const top = movs.slice(0, 40);
    setItens(top);
    const visto = getVisto();
    setNovos(
      top.filter((m) => new Date(m.created_at).getTime() > visto).length,
    );
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

  function abrir(o: boolean) {
    setOpen(o);
    if (o) {
      if (typeof window !== "undefined") {
        window.localStorage.setItem(VISTO_KEY, new Date().toISOString());
      }
      setNovos(0);
      carregar();
    }
  }

  return (
    <Popover open={open} onOpenChange={abrir}>
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
        <div className="border-b p-3">
          <span className="text-sm font-semibold">Movimentacoes recentes</span>
          <p className="text-xs text-muted-foreground">
            Atualizacoes recentes dos seus casos.
          </p>
        </div>
        <div className="max-h-96 overflow-y-auto">
          {itens.length === 0
            ? (
              <p className="p-6 text-center text-sm text-muted-foreground">
                Nenhuma movimentacao recente.
              </p>
            )
            : (
              <ul className="divide-y">
                {itens.map((m) => {
                  const novo = new Date(m.created_at).getTime() > getVisto();
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
                        search={{ tab: cfg.tab }}
                        onClick={() => setOpen(false)}
                        className="block"
                      >
                        <div className="flex items-start gap-2">
                          <Icon
                            className={"mt-0.5 h-4 w-4 shrink-0 " +
                              (novo ? "text-primary" : "text-muted-foreground")}
                          />
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
                          {novo && (
                            <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-destructive" />
                          )}
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

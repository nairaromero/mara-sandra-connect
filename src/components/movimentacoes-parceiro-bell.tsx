import { useCallback, useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { Bell, ClipboardList, MessageSquare } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

// Sino de movimentacoes do PARCEIRO (versao leve, somente-leitura).
// Mostra andamentos VISIVEIS + comentarios (de outros) dos casos do parceiro.
// Badge = quantos sao mais novos que a ultima vez que ele abriu (localStorage).
// O feed completo por-usuario (dispensar, docs/processos/cadastro) vem na #7.

const VISTO_KEY = "msc:parceiro_mov_visto";

interface Mov {
  id: string;
  tipo: "andamento" | "comentario";
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
function nomeCliente(row: any): string {
  return row?.casos?.cliente?.nome || "Caso";
}

export function MovimentacoesParceiroBell() {
  const { usuario } = useAuth();
  const [open, setOpen] = useState(false);
  const [itens, setItens] = useState<Array<Mov>>([]);
  const [novos, setNovos] = useState(0);

  const carregar = useCallback(async () => {
    const [andResp, comResp] = await Promise.all([
      supabase
        .from("andamentos")
        .select(
          "id, titulo, created_at, caso_id, casos:caso_id(cliente:cliente_id(nome))",
        )
        .eq("visivel_parceiro", true)
        .order("created_at", { ascending: false })
        .limit(30),
      usuario?.id
        ? supabase
          .from("comentarios")
          .select(
            "id, texto, created_at, caso_id, autor_id, casos:caso_id(cliente:cliente_id(nome))",
          )
          .neq("autor_id", usuario.id)
          .order("created_at", { ascending: false })
          .limit(30)
        : Promise.resolve({ data: [], error: null }),
    ]);

    const movs: Array<Mov> = [];
    // deno-lint-ignore no-explicit-any
    for (const a of (andResp.data || []) as Array<any>) {
      movs.push({
        id: "a:" + a.id,
        tipo: "andamento",
        texto: a.titulo || "Novo andamento",
        created_at: a.created_at,
        caso_id: a.caso_id,
        cliente: nomeCliente(a),
      });
    }
    // deno-lint-ignore no-explicit-any
    for (const c of (comResp.data || []) as Array<any>) {
      movs.push({
        id: "c:" + c.id,
        tipo: "comentario",
        texto: c.texto || "Novo comentario",
        created_at: c.created_at,
        caso_id: c.caso_id,
        cliente: nomeCliente(c),
      });
    }
    movs.sort((x, y) =>
      new Date(y.created_at).getTime() - new Date(x.created_at).getTime()
    );
    const top = movs.slice(0, 30);
    setItens(top);
    const visto = getVisto();
    setNovos(top.filter((m) => new Date(m.created_at).getTime() > visto).length);
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
            Andamentos e comentarios recentes dos seus casos.
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
                  return (
                    <li
                      key={m.id}
                      className="p-3 hover:bg-muted/50 transition-colors"
                    >
                      <Link
                        to="/casos/$id"
                        params={{ id: m.caso_id }}
                        search={{
                          tab: m.tipo === "comentario"
                            ? "comentarios"
                            : "andamentos",
                        }}
                        onClick={() => setOpen(false)}
                        className="block"
                      >
                        <div className="flex items-start gap-2">
                          {m.tipo === "comentario"
                            ? (
                              <MessageSquare
                                className={"mt-0.5 h-4 w-4 shrink-0 " +
                                  (novo
                                    ? "text-primary"
                                    : "text-muted-foreground")}
                              />
                            )
                            : (
                              <ClipboardList
                                className={"mt-0.5 h-4 w-4 shrink-0 " +
                                  (novo
                                    ? "text-primary"
                                    : "text-muted-foreground")}
                              />
                            )}
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-medium truncate">
                              {m.cliente}
                              <span className="text-xs font-normal text-muted-foreground">
                                {m.tipo === "comentario"
                                  ? " · comentario"
                                  : " · andamento"}
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

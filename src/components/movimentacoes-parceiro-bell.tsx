import { useCallback, useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { Bell, ClipboardList, Loader2 } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

// Sino de movimentacoes do PARCEIRO (versao leve, somente-leitura).
// Mostra os andamentos recentes VISIVEIS dos casos do parceiro (RLS +
// visivel_parceiro). Badge = quantos sao mais novos que a ultima vez que ele
// abriu o sino (guardado no localStorage). O feed completo por-usuario (com
// dispensar, comentarios/docs/processos/cadastro) vem na tarefa #7.

const VISTO_KEY = "msc:parceiro_mov_visto";

interface MovRow {
  id: string;
  titulo: string | null;
  descricao: string | null;
  created_at: string;
  caso_id: string;
  casos: { cliente: { nome: string | null } | null } | null;
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

export function MovimentacoesParceiroBell() {
  const [open, setOpen] = useState(false);
  const [itens, setItens] = useState<Array<MovRow>>([]);
  const [novos, setNovos] = useState(0);

  const carregar = useCallback(async () => {
    const { data, error } = await supabase
      .from("andamentos")
      .select(
        "id, titulo, descricao, created_at, caso_id, casos:caso_id(cliente:cliente_id(nome))",
      )
      .eq("visivel_parceiro", true)
      .order("created_at", { ascending: false })
      .limit(30);
    if (!error) {
      const lista = (data || []) as unknown as Array<MovRow>;
      setItens(lista);
      const visto = getVisto();
      setNovos(lista.filter((a) => new Date(a.created_at).getTime() > visto)
        .length);
    }
  }, []);

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
      // Marca tudo como "visto" agora (zera o badge), sem apagar nada.
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
            Ultimas atualizacoes dos seus casos.
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
                {itens.map((a) => {
                  const novo = new Date(a.created_at).getTime() > getVisto();
                  return (
                    <li
                      key={a.id}
                      className="p-3 hover:bg-muted/50 transition-colors"
                    >
                      <Link
                        to="/casos/$id"
                        params={{ id: a.caso_id }}
                        search={{ tab: "andamentos" }}
                        onClick={() => setOpen(false)}
                        className="block"
                      >
                        <div className="flex items-start gap-2">
                          <ClipboardList
                            className={"mt-0.5 h-4 w-4 shrink-0 " +
                              (novo ? "text-primary" : "text-muted-foreground")}
                          />
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-medium truncate">
                              {a.casos?.cliente?.nome || "Caso"}
                            </p>
                            {a.titulo && (
                              <p className="text-xs text-muted-foreground line-clamp-2">
                                {a.titulo}
                              </p>
                            )}
                            <p className="text-[11px] text-muted-foreground mt-0.5">
                              {tempoRelativo(a.created_at)}
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

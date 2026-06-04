import { useCallback, useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import {
  Bell,
  CheckCheck,
  ClipboardList,
  Loader2,
  RefreshCw,
  Tag,
  UserPlus,
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";

interface Notificacao {
  id: string;
  tipo: string;
  titulo: string;
  descricao: string | null;
  caso_id: string | null;
  cliente_id: string | null;
  lida: boolean;
  created_at: string;
}

function tempoRelativo(iso: string): string {
  const d = new Date(iso).getTime();
  const diff = Date.now() - d;
  const min = Math.floor(diff / 60000);
  if (min < 1) return "agora";
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h}h`;
  const dias = Math.floor(h / 24);
  if (dias < 30) return `${dias}d`;
  return new Date(iso).toLocaleDateString("pt-BR");
}

function iconeTipo(tipo: string) {
  if (tipo === "cliente_ti") return <UserPlus className="h-4 w-4" />;
  if (tipo === "tags") return <Tag className="h-4 w-4" />;
  return <ClipboardList className="h-4 w-4" />;
}

export function NotificacoesBell() {
  const { usuario } = useAuth();
  const [open, setOpen] = useState(false);
  const [itens, setItens] = useState<Array<Notificacao>>([]);
  const [naoLidas, setNaoLidas] = useState(0);
  const [sincronizando, setSincronizando] = useState(false);

  const carregar = useCallback(async () => {
    const { data, error } = await supabase
      .from("notificacoes")
      .select(
        "id, tipo, titulo, descricao, caso_id, cliente_id, lida, created_at",
      )
      .order("lida", { ascending: true })
      .order("created_at", { ascending: false })
      .limit(50);
    if (!error) {
      const lista = (data || []) as Array<Notificacao>;
      setItens(lista);
      setNaoLidas(lista.filter((n) => !n.lida).length);
    }
  }, []);

  useEffect(() => {
    carregar();
    const t = setInterval(carregar, 60000);
    return () => clearInterval(t);
  }, [carregar]);

  async function marcarLida(id: string) {
    await supabase.from("notificacoes").update({ lida: true }).eq("id", id);
    carregar();
  }

  async function marcarTodasLidas() {
    await supabase
      .from("notificacoes")
      .update({ lida: true })
      .eq("lida", false);
    carregar();
  }

  async function sincronizarTudo() {
    setSincronizando(true);
    try {
      const resp = await supabase.functions.invoke("sync-ti-todos", {
        body: { usuario_id: usuario?.id ?? null },
      });
      if (resp.error) throw resp.error;
      const r = (resp.data || {}) as {
        andamentos_novos?: number;
        clientes_ti_novos?: number;
        tags_alteradas?: number;
        clientes_sincronizados?: number;
      };
      toast.success(
        `Sync concluido: ${r.andamentos_novos || 0} andamento(s) novo(s), ` +
          `${r.clientes_ti_novos || 0} cliente(s) novo(s) no TI, ` +
          `${r.tags_alteradas || 0} tag(s) alterada(s).`,
      );
      await carregar();
      // Avisa telas abertas (ex.: detalhe do caso) para recarregarem os dados
      // sem o usuario precisar dar refresh manual.
      if (typeof window !== "undefined") {
        window.dispatchEvent(new CustomEvent("msc:sync-done"));
      }
    } catch (err) {
      console.error(err);
      const e = err as { message?: string };
      toast.error(e.message || "Erro ao sincronizar");
    } finally {
      setSincronizando(false);
    }
  }

  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (o) carregar();
      }}
    >
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="relative"
          aria-label="Notificacoes"
        >
          <Bell className="h-5 w-5" />
          {naoLidas > 0 && (
            <span className="absolute -top-0.5 -right-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-medium text-destructive-foreground">
              {naoLidas > 9 ? "9+" : naoLidas}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[22rem] p-0">
        <div className="flex items-center justify-between gap-2 border-b p-3">
          <span className="text-sm font-semibold">Notificacoes</span>
          <div className="flex items-center gap-1">
            <Button
              size="sm"
              variant="outline"
              className="h-7 px-2 text-xs"
              onClick={sincronizarTudo}
              disabled={sincronizando}
              title="Sincronizar todos os clientes com o Tramitacao Inteligente"
            >
              {sincronizando
                ? <Loader2 className="h-3 w-3 animate-spin" />
                : <RefreshCw className="h-3 w-3" />}
              <span className="ml-1">Sincronizar tudo</span>
            </Button>
            {naoLidas > 0 && (
              <Button
                size="icon"
                variant="ghost"
                className="h-7 w-7"
                onClick={marcarTodasLidas}
                title="Marcar todas como lidas"
              >
                <CheckCheck className="h-4 w-4" />
              </Button>
            )}
          </div>
        </div>
        <ScrollArea className="max-h-96">
          {itens.length === 0
            ? (
              <p className="p-6 text-center text-sm text-muted-foreground">
                Nenhuma notificacao.
              </p>
            )
            : (
              <ul className="divide-y">
                {itens.map((n) => {
                  const corpo = (
                    <div className="flex items-start gap-2">
                      <span
                        className={"mt-0.5 shrink-0 " +
                          (n.lida ? "text-muted-foreground" : "text-primary")}
                      >
                        {iconeTipo(n.tipo)}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p
                          className={"text-sm " +
                            (n.lida ? "text-muted-foreground" : "font-medium")}
                        >
                          {n.titulo}
                        </p>
                        {n.descricao && (
                          <p className="text-xs text-muted-foreground line-clamp-2">
                            {n.descricao}
                          </p>
                        )}
                        <p className="text-[11px] text-muted-foreground mt-0.5">
                          {tempoRelativo(n.created_at)}
                        </p>
                      </div>
                      {!n.lida && (
                        <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-destructive" />
                      )}
                    </div>
                  );
                  return (
                    <li
                      key={n.id}
                      className="p-3 hover:bg-muted/50 transition-colors"
                    >
                      {n.caso_id
                        ? (
                          <Link
                            to="/casos/$id"
                            params={{ id: n.caso_id }}
                            onClick={() => {
                              marcarLida(n.id);
                              setOpen(false);
                            }}
                            className="block"
                          >
                            {corpo}
                          </Link>
                        )
                        : (
                          <button
                            type="button"
                            onClick={() => marcarLida(n.id)}
                            className="block w-full text-left"
                          >
                            {corpo}
                          </button>
                        )}
                    </li>
                  );
                })}
              </ul>
            )}
        </ScrollArea>
      </PopoverContent>
    </Popover>
  );
}

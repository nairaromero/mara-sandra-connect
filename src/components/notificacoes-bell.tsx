import { useCallback, useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { Bell, ClipboardList, Tag, Trash2, UserPlus } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";

interface Notificacao {
  id: string;
  tipo: string;
  titulo: string;
  descricao: string | null;
  caso_id: string | null;
  cliente_id: string | null;
  metadata: { foco_id?: string } | null;
  lida: boolean;
  destinatario_id: string | null;
  created_at: string;
}

const TAB_POR_TIPO: Record<string, string> = {
  andamento: "andamentos",
  comentario: "comentarios",
  documento: "documentos",
  solicitacao: "documentos",
  processo: "processos",
  caso: "visao_geral",
  tags: "visao_geral",
};

function destinoSearch(n: Notificacao): { tab?: string; foco?: string } {
  const s: { tab?: string; foco?: string } = {};
  const tab = TAB_POR_TIPO[n.tipo];
  if (tab) s.tab = tab;
  if (n.metadata?.foco_id) s.foco = n.metadata.foco_id;
  return s;
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

  const carregar = useCallback(async () => {
    if (!usuario?.id) return;
    // O sino agora e de cada um: mostra o que foi endereçado a mim mais o que
    // foi pro escritorio todo (destinatario_id null), tirando o que eu ja
    // dispensei. Dispensar deixou de apagar a linha — ver
    // migration_notificacao_por_pessoa.
    const [notifResp, dispResp] = await Promise.all([
      supabase
        .from("notificacoes")
        .select(
          "id, tipo, titulo, descricao, caso_id, cliente_id, metadata, lida, destinatario_id, created_at",
        )
        .or(`destinatario_id.is.null,destinatario_id.eq.${usuario.id}`)
        .order("created_at", { ascending: false })
        .limit(50),
      supabase.from("notificacao_dispensada").select("notificacao_id"),
    ]);
    if (notifResp.error) return;
    const dispensadas = new Set(
      ((dispResp.data || []) as Array<{ notificacao_id: string }>).map((d) => d.notificacao_id),
    );
    const lista = ((notifResp.data || []) as Array<Notificacao>).filter(
      (n) => !dispensadas.has(n.id),
    );
    setItens(lista);
    // Sem dispensa = nao lida. A coluna `lida` continua no banco por causa do
    // sync-ti-todos, mas nao e mais o que o sino usa.
    setNaoLidas(lista.length);
  }, [usuario?.id]);

  useEffect(() => {
    carregar();
    // Realtime: assim que QUALQUER linha de `notificacoes` muda (insert do
    // backend, ou delete em outro dispositivo), recarrega na hora - sem
    // precisar dar refresh. O payload nao e usado; so dispara a re-busca
    // (que respeita RLS). Poll de 60s fica como fallback se o socket cair.
    const canal = supabase
      .channel("notificacoes-bell")
      .on("postgres_changes", { event: "*", schema: "public", table: "notificacoes" }, () =>
        carregar(),
      )
      .subscribe();
    const t = setInterval(carregar, 60000);
    return () => {
      supabase.removeChannel(canal);
      clearInterval(t);
    };
  }, [carregar]);

  // Clicar dispensa do MEU sino. Antes isto fazia `delete` na notificacao, o
  // que a apagava pra todo mundo — uma pessoa clicava e sumia da equipe
  // inteira, sem volta. Agora grava a dispensa em nome de quem clicou.
  async function dispensar(id: string) {
    if (!usuario?.id) return;
    setItens((prev) => prev.filter((n) => n.id !== id)); // some na hora
    await supabase
      .from("notificacao_dispensada")
      .upsert(
        { usuario_id: usuario.id, notificacao_id: id },
        { onConflict: "usuario_id,notificacao_id" },
      );
    carregar();
  }

  async function limparTodas() {
    const ids = itens.map((n) => n.id);
    setItens([]);
    setNaoLidas(0);
    if (ids.length > 0) {
      await supabase.from("notificacoes").delete().in("id", ids);
    }
    carregar();
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
        <Button variant="ghost" size="icon" className="relative" aria-label="Notificações">
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
          <span className="text-sm font-semibold">Notificações</span>
          <div className="flex items-center gap-1">
            {naoLidas > 0 && (
              <Button
                size="icon"
                variant="ghost"
                className="h-7 w-7"
                onClick={limparTodas}
                title="Limpar todas"
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            )}
          </div>
        </div>
        <ScrollArea className="max-h-96">
          {itens.length === 0 ? (
            <p className="p-6 text-center text-sm text-muted-foreground">Nenhuma notificação.</p>
          ) : (
            <ul className="divide-y">
              {itens.map((n) => {
                const corpo = (
                  <div className="flex items-start gap-2">
                    <span
                      className={
                        "mt-0.5 shrink-0 " + (n.lida ? "text-muted-foreground" : "text-primary")
                      }
                    >
                      {iconeTipo(n.tipo)}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p
                        className={"text-sm " + (n.lida ? "text-muted-foreground" : "font-medium")}
                      >
                        {n.titulo}
                      </p>
                      {n.descricao && (
                        <p className="text-xs text-muted-foreground line-clamp-2">{n.descricao}</p>
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
                  <li key={n.id} className="p-3 hover:bg-muted/50 transition-colors">
                    {n.tipo === "comentario" && n.caso_id ? (
                      <Link
                        to="/conversas"
                        search={{ caso: n.caso_id }}
                        onClick={() => {
                          dispensar(n.id);
                          setOpen(false);
                        }}
                        className="block"
                      >
                        {corpo}
                      </Link>
                    ) : n.caso_id ? (
                      <Link
                        to="/casos/$id"
                        params={{ id: n.caso_id }}
                        search={destinoSearch(n)}
                        onClick={() => {
                          dispensar(n.id);
                          setOpen(false);
                        }}
                        className="block"
                      >
                        {corpo}
                      </Link>
                    ) : n.tipo === "cliente_ti" ? (
                      <Link
                        to="/clientes"
                        onClick={() => {
                          dispensar(n.id);
                          setOpen(false);
                        }}
                        className="block"
                      >
                        {corpo}
                      </Link>
                    ) : (
                      <button
                        type="button"
                        onClick={() => dispensar(n.id)}
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

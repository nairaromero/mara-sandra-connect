import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Loader2,
  MessagesSquare,
  Search,
  AlertCircle,
  ChevronDown,
  ChevronRight,
  UserRound,
} from "lucide-react";

import { useAuth } from "@/hooks/use-auth";
import { supabase } from "@/lib/supabase";
import { ClientOnly } from "@/components/client-only";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";

export const Route = createFileRoute("/_authenticated/conversas")({
  component: ConversasPage,
});

// ===========================================================================
// Tipos
// ===========================================================================

interface ClienteLite {
  id: string;
  nome: string;
}

interface CasoLite {
  id: string;
  tipo_beneficio: string;
  fase: string;
  status: string;
  parceiro_id: string | null;
  clientes: ClienteLite | null;
}

interface ComentarioComCaso {
  id: string;
  caso_id: string;
  autor_id: string | null;
  texto: string;
  created_at: string;
  casos: CasoLite | null;
}

// Uma thread = um caso com seus comentários.
interface Thread {
  caso: CasoLite;
  ultimo: ComentarioComCaso;
  total: number;
  naoLidas: number;
}

// Um grupo = um parceiro (ou "Interno") com suas threads.
interface Grupo {
  parceiroId: string | null;
  parceiroNome: string;
  threads: Array<Thread>;
  naoLidas: number;
}

// ===========================================================================
// Helpers
// ===========================================================================

function formatRelativo(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "-";
  const diffMs = Date.now() - d.getTime();
  const min = Math.floor(diffMs / (1000 * 60));
  if (min < 1) return "agora";
  if (min < 60) return min + " min atrás";
  const horas = Math.floor(min / 60);
  if (horas < 24) return horas + "h atrás";
  const dias = Math.floor(horas / 24);
  if (dias < 7) return dias + "d atrás";
  return d.toLocaleDateString("pt-BR");
}

function truncar(texto: string, max: number): string {
  if (texto.length <= max) return texto;
  return texto.slice(0, max - 1) + "...";
}

const FASE_LABEL: Record<string, string> = {
  analise: "Em análise",
  admin: "Administrativo",
  judicial: "Judicial",
  finalizado: "Finalizado",
};

// ===========================================================================
// Componente principal
// ===========================================================================

function ConversasPage() {
  const { usuario } = useAuth();
  const usuarioId = usuario ? usuario.id : null;
  const navigate = useNavigate();

  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [comentarios, setComentarios] = useState<Array<ComentarioComCaso>>([]);
  const [leituraPorCaso, setLeituraPorCaso] = useState<Map<string, string>>(new Map());
  const [nomePorParceiro, setNomePorParceiro] = useState<Map<string, string>>(new Map());
  const [colapsados, setColapsados] = useState<Set<string>>(new Set());
  const jaCarregouRef = useRef(false);

  const [busca, setBusca] = useState("");

  const carregar = useCallback(async () => {
    if (!jaCarregouRef.current) setLoading(true);
    setErro(null);
    try {
      const [comResp, leiResp, parResp] = await Promise.all([
        supabase
          .from("comentarios")
          .select(
            "id, caso_id, autor_id, texto, created_at, casos!inner(id, tipo_beneficio, fase, status, parceiro_id, clientes(id, nome))",
          )
          .eq("rascunho", false)
          .order("created_at", { ascending: false }),
        supabase.from("conversa_leitura").select("caso_id, last_read_at"),
        supabase.from("usuarios").select("id, nome").eq("tipo", "parceiro"),
      ]);
      if (comResp.error) throw comResp.error;
      setComentarios((comResp.data || []) as unknown as Array<ComentarioComCaso>);

      const lmap = new Map<string, string>();
      for (const r of (leiResp.data || []) as Array<{ caso_id: string; last_read_at: string }>) {
        lmap.set(r.caso_id, r.last_read_at);
      }
      setLeituraPorCaso(lmap);

      const pmap = new Map<string, string>();
      for (const p of (parResp.data || []) as Array<{ id: string; nome: string }>) {
        pmap.set(p.id, p.nome);
      }
      setNomePorParceiro(pmap);
    } catch (err) {
      console.error(err);
      const errObj = err as { message?: string };
      setErro(errObj.message || "Erro ao carregar conversas");
    } finally {
      setLoading(false);
      jaCarregouRef.current = true;
    }
  }, []);

  useEffect(() => {
    carregar();
  }, [carregar]);

  // Polling leve a cada 30s (fase 3 troca por realtime).
  useEffect(() => {
    const id = setInterval(() => carregar(), 30000);
    return () => clearInterval(id);
  }, [carregar]);

  // Agrupa comentários -> threads (por caso) -> grupos (por parceiro).
  const grupos = useMemo<Array<Grupo>>(() => {
    const threadsPorCaso = new Map<string, Thread>();
    // comentarios vem desc por created_at: o 1º de cada caso é o mais recente.
    for (const c of comentarios) {
      if (!c.casos) continue;
      const lida = leituraPorCaso.get(c.caso_id);
      const naoLida =
        (!lida || new Date(c.created_at) > new Date(lida)) &&
        usuarioId !== null &&
        c.autor_id !== usuarioId;
      const t = threadsPorCaso.get(c.caso_id);
      if (t) {
        t.total += 1;
        if (naoLida) t.naoLidas += 1;
      } else {
        threadsPorCaso.set(c.caso_id, {
          caso: c.casos,
          ultimo: c,
          total: 1,
          naoLidas: naoLida ? 1 : 0,
        });
      }
    }

    const gruposPorParceiro = new Map<string, Grupo>();
    for (const t of threadsPorCaso.values()) {
      const pid = t.caso.parceiro_id;
      const chave = pid || "__interno__";
      const nome = pid
        ? nomePorParceiro.get(pid) || "Parceiro"
        : "Interno / sem parceiro";
      let g = gruposPorParceiro.get(chave);
      if (!g) {
        g = { parceiroId: pid, parceiroNome: nome, threads: [], naoLidas: 0 };
        gruposPorParceiro.set(chave, g);
      }
      g.threads.push(t);
      g.naoLidas += t.naoLidas;
    }

    const lista = Array.from(gruposPorParceiro.values());
    // Threads por mais recente; grupos por não-lidas desc, depois nome.
    for (const g of lista) {
      g.threads.sort(
        (a, b) =>
          new Date(b.ultimo.created_at).getTime() -
          new Date(a.ultimo.created_at).getTime(),
      );
    }
    lista.sort((a, b) => {
      if (b.naoLidas !== a.naoLidas) return b.naoLidas - a.naoLidas;
      return a.parceiroNome.localeCompare(b.parceiroNome, "pt-BR");
    });
    return lista;
  }, [comentarios, leituraPorCaso, nomePorParceiro, usuarioId]);

  // Filtro por busca (cliente, benefício, parceiro ou texto do comentário).
  const gruposFiltrados = useMemo(() => {
    const q = busca.trim().toLowerCase();
    if (!q) return grupos;
    return grupos
      .map((g) => ({
        ...g,
        threads: g.threads.filter((t) => {
          const nome = t.caso.clientes ? t.caso.clientes.nome.toLowerCase() : "";
          const benef = t.caso.tipo_beneficio.toLowerCase();
          const texto = t.ultimo.texto.toLowerCase();
          return (
            nome.includes(q) ||
            benef.includes(q) ||
            texto.includes(q) ||
            g.parceiroNome.toLowerCase().includes(q)
          );
        }),
      }))
      .filter((g) => g.threads.length > 0);
  }, [grupos, busca]);

  const totalThreadsNaoLidas = grupos.reduce(
    (acc, g) => acc + g.threads.filter((t) => t.naoLidas > 0).length,
    0,
  );

  // Marca a conversa como lida e abre o caso na aba de comentários.
  async function abrirThread(casoId: string) {
    if (usuarioId) {
      try {
        await supabase.from("conversa_leitura").upsert(
          {
            usuario_id: usuarioId,
            caso_id: casoId,
            last_read_at: new Date().toISOString(),
          },
          { onConflict: "usuario_id,caso_id" },
        );
        window.dispatchEvent(new CustomEvent("msc:conversas-mudou"));
      } catch {
        // marcar leitura é best-effort; não bloqueia a navegação
      }
    }
    navigate({ to: "/casos/$id", params: { id: casoId }, hash: "comentarios" });
  }

  function toggleGrupo(chave: string) {
    setColapsados((prev) => {
      const n = new Set(prev);
      if (n.has(chave)) n.delete(chave);
      else n.add(chave);
      return n;
    });
  }

  if (loading) {
    return (
      <div className="flex h-96 items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <ClientOnly
      fallback={
        <div className="flex h-96 items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      }
    >
      <div className="space-y-6">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div>
            <h1 className="font-serif text-3xl font-semibold tracking-tight flex items-center gap-2">
              <MessagesSquare className="h-6 w-6" />
              Conversas
              {totalThreadsNaoLidas > 0 && (
                <Badge className="bg-destructive hover:bg-destructive text-destructive-foreground">
                  {totalThreadsNaoLidas} não lida
                  {totalThreadsNaoLidas > 1 ? "s" : ""}
                </Badge>
              )}
            </h1>
            <p className="text-sm text-muted-foreground">
              Comunicação com os parceiros, agrupada por parceiro.
            </p>
          </div>
        </div>

        <Card>
          <CardContent className="pt-4">
            <Label className="text-xs">Buscar</Label>
            <div className="relative">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                className="pl-8"
                placeholder="Parceiro, cliente, benefício ou trecho da mensagem..."
                value={busca}
                onChange={(e) => setBusca(e.target.value)}
              />
            </div>
          </CardContent>
        </Card>

        {erro && (
          <Card>
            <CardContent className="py-6 text-center">
              <AlertCircle className="h-8 w-8 mx-auto text-destructive mb-2" />
              <p className="text-sm text-destructive">{erro}</p>
            </CardContent>
          </Card>
        )}

        {!erro && gruposFiltrados.length === 0 ? (
          <Card>
            <CardContent className="py-12 text-center">
              <MessagesSquare className="h-10 w-10 mx-auto text-muted-foreground mb-2" />
              <p className="text-sm text-muted-foreground">
                {grupos.length === 0
                  ? "Nenhuma conversa ainda. Quando um parceiro comentar num caso, aparece aqui."
                  : "Nenhuma conversa encontrada com a busca aplicada."}
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-4">
            {gruposFiltrados.map((g) => {
              const chave = g.parceiroId || "__interno__";
              const colapsado = colapsados.has(chave);
              return (
                <Card key={chave}>
                  <button
                    type="button"
                    onClick={() => toggleGrupo(chave)}
                    className="flex w-full items-center gap-2 p-4 text-left hover:bg-muted/40 transition-colors"
                  >
                    {colapsado ? (
                      <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                    ) : (
                      <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
                    )}
                    <UserRound className="h-4 w-4 shrink-0 text-muted-foreground" />
                    <span className="font-medium">{g.parceiroNome}</span>
                    <span className="text-xs text-muted-foreground">
                      {g.threads.length} conversa{g.threads.length > 1 ? "s" : ""}
                    </span>
                    {g.naoLidas > 0 && (
                      <Badge className="ml-auto bg-destructive hover:bg-destructive text-destructive-foreground">
                        {g.naoLidas > 99 ? "99+" : g.naoLidas}
                      </Badge>
                    )}
                  </button>
                  {!colapsado && (
                    <CardContent className="p-0">
                      <ul className="divide-y border-t">
                        {g.threads.map((t) => (
                          <ThreadItem key={t.caso.id} thread={t} onAbrir={abrirThread} />
                        ))}
                      </ul>
                    </CardContent>
                  )}
                </Card>
              );
            })}
          </div>
        )}
      </div>
    </ClientOnly>
  );
}

// ===========================================================================
// Sub-componente: ThreadItem
// ===========================================================================

interface ThreadItemProps {
  thread: Thread;
  onAbrir: (casoId: string) => void;
}

function ThreadItem(props: ThreadItemProps) {
  const { thread, onAbrir } = props;
  const { caso, ultimo, total, naoLidas } = thread;
  const nomeCliente = caso.clientes ? caso.clientes.nome : "(cliente sem nome)";

  return (
    <li>
      <button
        type="button"
        onClick={() => onAbrir(caso.id)}
        className="block w-full text-left hover:bg-muted/40 transition-colors"
      >
        <div className="flex items-start gap-3 p-4">
          <div
            className={
              "flex h-10 w-10 shrink-0 items-center justify-center rounded-full " +
              (naoLidas > 0
                ? "bg-primary text-primary-foreground"
                : "bg-muted text-muted-foreground")
            }
          >
            <MessagesSquare className="h-4 w-4" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 min-w-0">
                <p className="text-sm font-medium truncate">{nomeCliente}</p>
                <Badge variant="outline" className="text-xs shrink-0">
                  {FASE_LABEL[caso.fase] || caso.fase}
                </Badge>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {naoLidas > 0 && (
                  <Badge className="bg-destructive hover:bg-destructive text-destructive-foreground">
                    {naoLidas}
                  </Badge>
                )}
                <span className="text-xs text-muted-foreground">
                  {formatRelativo(ultimo.created_at)}
                </span>
              </div>
            </div>
            <p className="text-xs text-muted-foreground mt-0.5 truncate">
              {caso.tipo_beneficio}
            </p>
            <p
              className={
                "text-sm mt-1 line-clamp-2 " +
                (naoLidas > 0 ? "text-foreground font-medium" : "text-muted-foreground")
              }
              title={ultimo.texto}
            >
              {truncar(ultimo.texto, 200)}
            </p>
            <p className="text-[10px] text-muted-foreground mt-1">
              {total} {total > 1 ? "mensagens" : "mensagem"}
            </p>
          </div>
        </div>
      </button>
    </li>
  );
}

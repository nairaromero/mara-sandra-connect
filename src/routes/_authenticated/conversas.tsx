import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Loader2,
  MessagesSquare,
  Search,
  AlertCircle,
  ChevronDown,
  ChevronRight,
  UserRound,
  ArrowLeft,
  Send,
  ExternalLink,
} from "lucide-react";

import { useAuth } from "@/hooks/use-auth";
import { supabase } from "@/lib/supabase";
import { ClientOnly } from "@/components/client-only";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";

export const Route = createFileRoute("/_authenticated/conversas")({
  component: ConversasPage,
  // ?caso=<id> abre direto a conversa daquele caso (deep-link do sininho, fase 4).
  validateSearch: (s: Record<string, unknown>): { caso?: string } => ({
    caso: typeof s.caso === "string" ? s.caso : undefined,
  }),
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

interface Thread {
  caso: CasoLite;
  ultimo: ComentarioComCaso;
  total: number;
  naoLidas: number;
}

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

function formatHora(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  return (
    d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" }) +
    " " +
    d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })
  );
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
  const isParceiro = usuario?.tipo === "parceiro";
  const search = Route.useSearch();

  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [comentarios, setComentarios] = useState<Array<ComentarioComCaso>>([]);
  const [leituraPorCaso, setLeituraPorCaso] = useState<Map<string, string>>(new Map());
  const [nomePorUsuario, setNomePorUsuario] = useState<Map<string, string>>(new Map());
  const [parceiroIds, setParceiroIds] = useState<Set<string>>(new Set());
  const [colapsados, setColapsados] = useState<Set<string>>(new Set());
  const jaCarregouRef = useRef(false);

  const [busca, setBusca] = useState("");
  const [selecionado, setSelecionado] = useState<string | null>(null);
  const [resposta, setResposta] = useState("");
  const [enviando, setEnviando] = useState(false);

  const carregar = useCallback(async () => {
    if (!jaCarregouRef.current) setLoading(true);
    setErro(null);
    try {
      const [comResp, leiResp, usrResp] = await Promise.all([
        supabase
          .from("comentarios")
          .select(
            "id, caso_id, autor_id, texto, created_at, casos!inner(id, tipo_beneficio, fase, status, parceiro_id, clientes(id, nome))",
          )
          .eq("rascunho", false)
          .order("created_at", { ascending: false }),
        supabase.from("conversa_leitura").select("caso_id, last_read_at"),
        supabase.from("usuarios").select("id, nome, tipo"),
      ]);
      if (comResp.error) throw comResp.error;
      setComentarios((comResp.data || []) as unknown as Array<ComentarioComCaso>);

      const lmap = new Map<string, string>();
      for (const r of (leiResp.data || []) as Array<{ caso_id: string; last_read_at: string }>) {
        lmap.set(r.caso_id, r.last_read_at);
      }
      setLeituraPorCaso(lmap);

      const nmap = new Map<string, string>();
      const pset = new Set<string>();
      for (const u of (usrResp.data || []) as Array<{ id: string; nome: string; tipo: string }>) {
        nmap.set(u.id, u.nome);
        if (u.tipo === "parceiro") pset.add(u.id);
      }
      setNomePorUsuario(nmap);
      setParceiroIds(pset);
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

  // Tempo real: qualquer mudança em comentarios recarrega a caixa (fase 3).
  useEffect(() => {
    const canal = supabase
      .channel("conversas-comentarios")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "comentarios" },
        () => carregar(),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(canal);
    };
  }, [carregar]);

  // Marca a conversa como lida (upsert + evento pro badge da sidebar).
  const marcarLida = useCallback(
    async (casoId: string) => {
      if (!usuarioId) return;
      try {
        await supabase.from("conversa_leitura").upsert(
          { usuario_id: usuarioId, caso_id: casoId, last_read_at: new Date().toISOString() },
          { onConflict: "usuario_id,caso_id" },
        );
        setLeituraPorCaso((prev) => {
          const n = new Map(prev);
          n.set(casoId, new Date().toISOString());
          return n;
        });
        window.dispatchEvent(new CustomEvent("msc:conversas-mudou"));
      } catch {
        // best-effort
      }
    },
    [usuarioId],
  );

  // Deep-link do sininho: ?caso=<id> abre a conversa daquele caso.
  useEffect(() => {
    if (search.caso) {
      setSelecionado(search.caso);
      marcarLida(search.caso);
    }
  }, [search.caso, marcarLida]);

  function abrirThread(casoId: string) {
    setSelecionado(casoId);
    setResposta("");
    marcarLida(casoId);
  }

  async function enviarResposta() {
    if (!selecionado || !usuarioId) return;
    const texto = resposta.trim();
    if (!texto) return;
    setEnviando(true);
    try {
      const { data, error } = await supabase
        .from("comentarios")
        .insert({ caso_id: selecionado, autor_id: usuarioId, texto, rascunho: false })
        .select("id")
        .single();
      if (error) throw error;
      setResposta("");
      await carregar();
      await marcarLida(selecionado);
      // Notifica a outra parte (e-mail/notificação). Best-effort.
      if (data?.id) {
        supabase.functions
          .invoke("notify-novo-comentario", { body: { comentario_id: data.id } })
          .catch(() => {});
      }
    } catch (err) {
      const errObj = err as { message?: string };
      setErro(errObj.message || "Falha ao enviar.");
    } finally {
      setEnviando(false);
    }
  }

  function toggleGrupo(chave: string) {
    setColapsados((prev) => {
      const n = new Set(prev);
      if (n.has(chave)) n.delete(chave);
      else n.add(chave);
      return n;
    });
  }

  // ---- Agrupamento: comentários -> threads (caso) -> grupos (parceiro) ----
  const grupos = useMemo<Array<Grupo>>(() => {
    const threadsPorCaso = new Map<string, Thread>();
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

    const porParceiro = new Map<string, Grupo>();
    for (const t of threadsPorCaso.values()) {
      const pid = t.caso.parceiro_id;
      const chave = pid || "__interno__";
      const nome = pid
        ? nomePorUsuario.get(pid) || "Parceiro"
        : "Interno / sem parceiro";
      let g = porParceiro.get(chave);
      if (!g) {
        g = { parceiroId: pid, parceiroNome: nome, threads: [], naoLidas: 0 };
        porParceiro.set(chave, g);
      }
      g.threads.push(t);
      g.naoLidas += t.naoLidas;
    }

    const lista = Array.from(porParceiro.values());
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
  }, [comentarios, leituraPorCaso, nomePorUsuario, usuarioId]);

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

  const totalNaoLidas = grupos.reduce(
    (acc, g) => acc + g.threads.filter((t) => t.naoLidas > 0).length,
    0,
  );

  // Mensagens da conversa selecionada (ordem cronológica).
  const conversaSel = useMemo(() => {
    if (!selecionado) return null;
    const msgs = comentarios
      .filter((c) => c.caso_id === selecionado)
      .slice()
      .sort(
        (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
      );
    const caso = msgs[0]?.casos || null;
    return { caso, msgs };
  }, [selecionado, comentarios]);

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
      <div className="space-y-4">
        <div>
          <h1 className="font-serif text-3xl font-semibold tracking-tight flex items-center gap-2">
            <MessagesSquare className="h-6 w-6" />
            Conversas
            {totalNaoLidas > 0 && (
              <Badge className="bg-destructive hover:bg-destructive text-destructive-foreground">
                {totalNaoLidas} não lida{totalNaoLidas > 1 ? "s" : ""}
              </Badge>
            )}
          </h1>
          <p className="text-sm text-muted-foreground">
            Comunicação com os parceiros, agrupada por parceiro.
          </p>
        </div>

        {erro && (
          <Card>
            <CardContent className="py-4 text-center">
              <AlertCircle className="h-6 w-6 mx-auto text-destructive mb-1" />
              <p className="text-sm text-destructive">{erro}</p>
            </CardContent>
          </Card>
        )}

        <div className="flex gap-4 items-start">
          {/* Lista (esconde no mobile quando há conversa aberta) */}
          <div
            className={
              (selecionado ? "hidden md:flex" : "flex") +
              " flex-col gap-3 w-full md:w-[360px] shrink-0"
            }
          >
            <div className="relative">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                className="pl-8"
                placeholder="Parceiro, cliente ou mensagem..."
                value={busca}
                onChange={(e) => setBusca(e.target.value)}
              />
            </div>

            {gruposFiltrados.length === 0 ? (
              <Card>
                <CardContent className="py-10 text-center">
                  <MessagesSquare className="h-8 w-8 mx-auto text-muted-foreground mb-2" />
                  <p className="text-sm text-muted-foreground">
                    {grupos.length === 0
                      ? "Nenhuma conversa ainda. Quando um parceiro comentar num caso, aparece aqui."
                      : "Nada encontrado com a busca."}
                  </p>
                </CardContent>
              </Card>
            ) : isParceiro ? (
              <Card>
                <CardContent className="p-0">
                  <ul className="divide-y">
                    {gruposFiltrados
                      .flatMap((g) => g.threads)
                      .sort(
                        (a, b) =>
                          new Date(b.ultimo.created_at).getTime() -
                          new Date(a.ultimo.created_at).getTime(),
                      )
                      .map((t) => (
                        <ThreadItem
                          key={t.caso.id}
                          thread={t}
                          ativo={t.caso.id === selecionado}
                          onAbrir={abrirThread}
                        />
                      ))}
                  </ul>
                </CardContent>
              </Card>
            ) : (
              <div className="space-y-3">
                {gruposFiltrados.map((g) => {
                  const chave = g.parceiroId || "__interno__";
                  const colapsado = colapsados.has(chave);
                  return (
                    <Card key={chave}>
                      <button
                        type="button"
                        onClick={() => toggleGrupo(chave)}
                        className="flex w-full items-center gap-2 p-3 text-left hover:bg-muted/40 transition-colors"
                      >
                        {colapsado ? (
                          <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                        ) : (
                          <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
                        )}
                        <UserRound className="h-4 w-4 shrink-0 text-muted-foreground" />
                        <span className="font-medium text-sm truncate">{g.parceiroNome}</span>
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
                              <ThreadItem
                                key={t.caso.id}
                                thread={t}
                                ativo={t.caso.id === selecionado}
                                onAbrir={abrirThread}
                              />
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

          {/* Painel da conversa */}
          <div className={(selecionado ? "flex" : "hidden md:flex") + " flex-1 min-w-0"}>
            {conversaSel && conversaSel.caso ? (
              <ConversaPanel
                caso={conversaSel.caso}
                msgs={conversaSel.msgs}
                usuarioId={usuarioId}
                nomePorUsuario={nomePorUsuario}
                parceiroIds={parceiroIds}
                resposta={resposta}
                setResposta={setResposta}
                enviando={enviando}
                onEnviar={enviarResposta}
                onVoltar={() => setSelecionado(null)}
              />
            ) : (
              <Card className="w-full">
                <CardContent className="py-20 text-center">
                  <MessagesSquare className="h-10 w-10 mx-auto text-muted-foreground mb-2" />
                  <p className="text-sm text-muted-foreground">
                    Escolha uma conversa à esquerda para ler e responder.
                  </p>
                </CardContent>
              </Card>
            )}
          </div>
        </div>
      </div>
    </ClientOnly>
  );
}

// ===========================================================================
// ThreadItem
// ===========================================================================

interface ThreadItemProps {
  thread: Thread;
  ativo: boolean;
  onAbrir: (casoId: string) => void;
}

function ThreadItem({ thread, ativo, onAbrir }: ThreadItemProps) {
  const { caso, ultimo, naoLidas } = thread;
  const nomeCliente = caso.clientes ? caso.clientes.nome : "(cliente sem nome)";
  return (
    <li>
      <button
        type="button"
        onClick={() => onAbrir(caso.id)}
        className={
          "block w-full text-left transition-colors " +
          (ativo ? "bg-muted" : "hover:bg-muted/40")
        }
      >
        <div className="flex items-start gap-3 p-3">
          <div
            className={
              "flex h-9 w-9 shrink-0 items-center justify-center rounded-full " +
              (naoLidas > 0
                ? "bg-primary text-primary-foreground"
                : "bg-muted text-muted-foreground")
            }
          >
            <MessagesSquare className="h-4 w-4" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center justify-between gap-2">
              <p className="text-sm font-medium truncate">{nomeCliente}</p>
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
            <p
              className={
                "text-sm mt-0.5 line-clamp-1 " +
                (naoLidas > 0 ? "text-foreground font-medium" : "text-muted-foreground")
              }
            >
              {truncar(ultimo.texto, 120)}
            </p>
          </div>
        </div>
      </button>
    </li>
  );
}

// ===========================================================================
// ConversaPanel
// ===========================================================================

interface ConversaPanelProps {
  caso: CasoLite;
  msgs: Array<ComentarioComCaso>;
  usuarioId: string | null;
  nomePorUsuario: Map<string, string>;
  parceiroIds: Set<string>;
  resposta: string;
  setResposta: (v: string) => void;
  enviando: boolean;
  onEnviar: () => void;
  onVoltar: () => void;
}

function ConversaPanel(props: ConversaPanelProps) {
  const {
    caso,
    msgs,
    usuarioId,
    nomePorUsuario,
    parceiroIds,
    resposta,
    setResposta,
    enviando,
    onEnviar,
    onVoltar,
  } = props;
  const fimRef = useRef<HTMLDivElement>(null);
  const nomeCliente = caso.clientes ? caso.clientes.nome : "(cliente sem nome)";

  useEffect(() => {
    fimRef.current?.scrollIntoView({ block: "end" });
  }, [msgs.length]);

  return (
    <Card className="w-full flex flex-col" style={{ maxHeight: "calc(100vh - 12rem)" }}>
      <div className="flex items-center gap-2 p-3 border-b">
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 md:hidden"
          onClick={onVoltar}
        >
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className="font-medium truncate">{nomeCliente}</p>
            <Badge variant="outline" className="text-xs shrink-0">
              {FASE_LABEL[caso.fase] || caso.fase}
            </Badge>
          </div>
          <p className="text-xs text-muted-foreground truncate">{caso.tipo_beneficio}</p>
        </div>
        <Link
          to="/casos/$id"
          params={{ id: caso.id }}
          className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1 shrink-0"
        >
          <ExternalLink className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">Abrir caso</span>
        </Link>
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-2 min-h-[240px]">
        {msgs.map((m) => {
          const meu = m.autor_id === usuarioId;
          const autorNome = m.autor_id
            ? nomePorUsuario.get(m.autor_id) || "Usuário"
            : "—";
          const ehParceiro = m.autor_id ? parceiroIds.has(m.autor_id) : false;
          return (
            <div key={m.id} className={"flex " + (meu ? "justify-end" : "justify-start")}>
              <div
                className={
                  "max-w-[80%] rounded-lg px-3 py-2 " +
                  (meu
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted text-foreground")
                }
              >
                {!meu && (
                  <p className="text-[11px] font-medium mb-0.5 opacity-80">
                    {autorNome}
                    {ehParceiro ? " · parceiro" : ""}
                  </p>
                )}
                <p className="text-sm whitespace-pre-wrap break-words">{m.texto}</p>
                <p
                  className={
                    "text-[10px] mt-1 " +
                    (meu ? "text-primary-foreground/70" : "text-muted-foreground")
                  }
                >
                  {formatHora(m.created_at)}
                </p>
              </div>
            </div>
          );
        })}
        <div ref={fimRef} />
      </div>

      <div className="border-t p-3">
        <Label className="sr-only">Responder</Label>
        <div className="flex items-end gap-2">
          <Textarea
            rows={2}
            placeholder="Escreva uma resposta..."
            value={resposta}
            onChange={(e) => setResposta(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                onEnviar();
              }
            }}
            className="resize-none"
          />
          <Button onClick={onEnviar} disabled={enviando || !resposta.trim()}>
            {enviando ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Send className="h-4 w-4" />
            )}
          </Button>
        </div>
        <p className="text-[10px] text-muted-foreground mt-1">
          Enter + Ctrl/⌘ envia. A mensagem vira um comentário no caso e notifica a outra parte.
        </p>
      </div>
    </Card>
  );
}

import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import {
  Loader2,
  Send,
  AlertCircle,
  Stethoscope,
  BellRing,
  ExternalLink,
  Inbox,
  Trash2,
} from "lucide-react";

import { useAuth } from "@/hooks/use-auth";
import { listarInternosAtivos } from "@/lib/tarefas/queries";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { supabase } from "@/lib/supabase";
import { ClientOnly } from "@/components/client-only";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";

export const Route = createFileRoute("/_authenticated/a-enviar")({
  component: AEnviarPage,
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
  parceiro_id: string | null;
  clientes: ClienteLite | null;
}

interface RascunhoRow {
  id: string;
  caso_id: string;
  texto: string;
  created_at: string;
  andamento_id: string | null;
  evento_id: string | null;
  tipo_aviso: string | null;
  casos: CasoLite | null;
}

// ===========================================================================
// Helpers
// ===========================================================================

const FASE_LABEL: Record<string, string> = {
  analise: "Em análise",
  admin: "Administrativo",
  judicial: "Judicial",
  finalizado: "Finalizado",
};

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

// ===========================================================================
// Componente principal
// ===========================================================================

function AEnviarPage() {
  const { usuario } = useAuth();
  const usuarioId = usuario ? usuario.id : null;
  const isInterno = usuario?.tipo === "interno";

  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [rascunhos, setRascunhos] = useState<Array<RascunhoRow>>([]);
  const [descartandoId, setDescartandoId] = useState<string | null>(null);
  // Texto editado por linha (id -> texto). Ausente = usa o texto original.
  const [editados, setEditados] = useState<Record<string, string>>({});
  const [enviandoId, setEnviandoId] = useState<string | null>(null);
  // Dono do rascunho = responsável da tarefa "Avisar cliente da perícia"
  // daquele caso. O rascunho em si nasce por trigger, sem autor, então não
  // tem dono próprio — a tarefa é que diz de quem é o trabalho de comunicar.
  const [respPorCaso, setRespPorCaso] = useState<Record<string, string | null>>({});
  const [filtroPessoa, setFiltroPessoa] = useState<string>("__eu__");
  const [internos, setInternos] = useState<Array<{ id: string; nome: string | null }>>([]);
  const jaCarregou = useRef(false);

  const carregar = useCallback(async () => {
    if (!jaCarregou.current) setLoading(true);
    setErro(null);
    try {
      const resp = await supabase
        .from("comentarios")
        .select(
          "id, caso_id, texto, created_at, andamento_id, evento_id, tipo_aviso, casos(id, tipo_beneficio, fase, parceiro_id, clientes(id, nome))",
        )
        .eq("rascunho", true)
        .order("created_at", { ascending: false });
      if (resp.error) throw resp.error;
      const linhas = (resp.data || []) as unknown as Array<RascunhoRow>;
      setRascunhos(linhas);

      // Responsável por caso, pra saber de quem é cada rascunho.
      const casoIds = [...new Set(linhas.map((r) => r.caso_id).filter(Boolean))];
      if (casoIds.length > 0) {
        const { data: tars } = await supabase
          .from("tarefas")
          .select("caso_id, responsavel_id, created_at")
          .in("caso_id", casoIds)
          .ilike("titulo", "Avisar cliente da perícia%")
          .order("created_at", { ascending: false });
        const mapa: Record<string, string | null> = {};
        for (const t of (tars || []) as Array<{ caso_id: string; responsavel_id: string | null }>) {
          if (!(t.caso_id in mapa)) mapa[t.caso_id] = t.responsavel_id;
        }
        setRespPorCaso(mapa);
      } else {
        setRespPorCaso({});
      }
    } catch (err) {
      const e = err as { message?: string };
      setErro(e.message || "Erro ao carregar rascunhos");
    } finally {
      setLoading(false);
      jaCarregou.current = true;
    }
  }, []);

  useEffect(() => {
    carregar();
  }, [carregar]);

  useEffect(() => {
    if (!isInterno) return;
    listarInternosAtivos().then(setInternos).catch(() => {});
  }, [isInterno]);

  // Sem tarefa "Avisar cliente" no caso, o rascunho fica visível em QUALQUER
  // recorte: melhor aparecer pra mais gente do que sumir e ninguém enviar.
  const pessoaAlvo = filtroPessoa === "__eu__" ? usuarioId : filtroPessoa;
  const visiveis = rascunhos.filter((r) => {
    if (!isInterno || filtroPessoa === "__todos__") return true;
    const resp = respPorCaso[r.caso_id];
    return resp == null || resp === pessoaAlvo;
  });

  // Reserva: recarrega periodicamente e quando outra tela mexe em rascunho.
  useEffect(() => {
    const t = setInterval(carregar, 60000);
    if (typeof window !== "undefined") {
      window.addEventListener("msc:rascunhos-mudou", carregar);
    }
    return () => {
      clearInterval(t);
      if (typeof window !== "undefined") {
        window.removeEventListener("msc:rascunhos-mudou", carregar);
      }
    };
  }, [carregar]);

  // Descartar = apagar o rascunho. Nada e enviado ao parceiro e nada fica na
  // conversa — o rascunho so existe nesta fila ate alguem decidir por ele.
  async function descartar(row: RascunhoRow) {
    const nome = row.casos?.clientes?.nome;
    const ok = window.confirm(
      `Descartar este rascunho${nome ? " de " + nome : ""}?

` +
        "Ele some da fila e nao e enviado ao parceiro. Nao da pra desfazer.",
    );
    if (!ok) return;
    setDescartandoId(row.id);
    try {
      const del = await supabase.from("comentarios").delete().eq("id", row.id);
      if (del.error) throw del.error;
      setRascunhos((atual) => atual.filter((r) => r.id !== row.id));
      if (typeof window !== "undefined") {
        window.dispatchEvent(new Event("msc:rascunhos-mudou"));
      }
      toast.success("Rascunho descartado.");
    } catch (err) {
      const e = err as { message?: string };
      toast.error(e.message || "Nao foi possivel descartar.");
    } finally {
      setDescartandoId(null);
    }
  }

  async function enviar(row: RascunhoRow) {
    const texto = (editados[row.id] ?? row.texto).trim();
    if (!texto) {
      toast.error("O comentário está vazio.");
      return;
    }
    setEnviandoId(row.id);
    try {
      // Enviar = rascunho vira comentário normal (autor = quem enviou). Isso
      // dispara notify-novo-comentario (e-mail ao parceiro) e o WhatsApp.
      const upd = await supabase
        .from("comentarios")
        .update({ texto, rascunho: false, autor_id: usuarioId })
        .eq("id", row.id);
      if (upd.error) throw upd.error;

      // E-mail fire-and-forget; não trava a UI.
      supabase.functions
        .invoke("notify-novo-comentario", { body: { comentario_id: row.id } })
        .then((r) => {
          if (r.error) console.warn("notify-novo-comentario:", r.error);
        });

      // Some da fila + avisa sidebar (badge) e caixa de conversas.
      setRascunhos((atual) => atual.filter((r) => r.id !== row.id));
      if (typeof window !== "undefined") {
        window.dispatchEvent(new Event("msc:rascunhos-mudou"));
        window.dispatchEvent(new Event("msc:conversas-mudou"));
      }
      const nome = row.casos?.clientes?.nome;
      toast.success(nome ? `Enviado ao parceiro de ${nome}.` : "Comentário enviado.");
    } catch (err) {
      const e = err as { message?: string };
      toast.error(e.message || "Não foi possível enviar.");
    } finally {
      setEnviandoId(null);
    }
  }

  if (!isInterno) {
    return (
      <Card>
        <CardContent className="py-12 text-center">
          <AlertCircle className="mx-auto mb-2 h-8 w-8 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">
            Área restrita à equipe interna.
          </p>
        </CardContent>
      </Card>
    );
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
        <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 font-serif text-3xl font-semibold tracking-tight">
            <Send className="h-6 w-6" />
            A enviar
            {visiveis.length > 0 && (
              <Badge className="bg-destructive text-destructive-foreground hover:bg-destructive">
                {visiveis.length}
              </Badge>
            )}
          </h1>
          <p className="text-sm text-muted-foreground">
            Rascunhos de aviso aguardando revisão e envio ao parceiro. Revise o
            texto e clique em <strong>Enviar ao parceiro</strong> — só aí o
            e-mail é disparado e fica registrado na conversa.
          </p>
        </div>
        {isInterno && (
          <div className="w-full sm:w-56">
            <Select value={filtroPessoa} onValueChange={setFiltroPessoa}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__eu__">Meus avisos</SelectItem>
                <SelectItem value="__todos__">Todos do escritório</SelectItem>
                {internos
                  // Fora os usuários de teste ([E2E], [TESTE]) — existem em
                  // produção e não são gente do escritório.
                  .filter((u) => u.id !== usuarioId && !(u.nome ?? "").startsWith("["))
                  .map((u) => (
                    <SelectItem key={u.id} value={u.id}>
                      {u.nome ?? "(sem nome)"}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
          </div>
        )}
        </div>

        {erro && (
          <Card>
            <CardContent className="py-6 text-center">
              <AlertCircle className="mx-auto mb-2 h-8 w-8 text-destructive" />
              <p className="text-sm text-destructive">{erro}</p>
            </CardContent>
          </Card>
        )}

        {!erro && visiveis.length === 0 ? (
          <Card>
            <CardContent className="py-12 text-center">
              <Inbox className="mx-auto mb-2 h-10 w-10 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">
                {isInterno && filtroPessoa !== "__todos__" && rascunhos.length > 0
                  ? `Nenhum aviso nesse recorte. Há ${rascunhos.length} na fila do escritório.`
                  : "Nenhum rascunho aguardando envio."}
              </p>
            </CardContent>
          </Card>
        ) : (
          <ul className="space-y-4">
            {visiveis.map((row) => {
              const nome = row.casos?.clientes?.nome || "(cliente sem nome)";
              const ehPericia = !!(row.andamento_id || row.evento_id);
              const ehLembrete = row.tipo_aviso === "pericia_lembrete";
              const semParceiro = !row.casos?.parceiro_id;
              const enviando = enviandoId === row.id;
              return (
                <li key={row.id}>
                  <Card>
                    <CardContent className="space-y-3 pt-4">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-sm font-medium">{nome}</span>
                          {row.casos && (
                            <Badge variant="outline" className="text-xs">
                              {FASE_LABEL[row.casos.fase] || row.casos.fase}
                            </Badge>
                          )}
                          {/* Aviso e lembrete chegam na mesma fila com texto
                              parecido. Sem distinguir aqui, a equipe manda o
                              segundo achando que é repetição do primeiro (ou
                              vice-versa) — cor e rótulo separam os dois de
                              longe, antes de ler o texto. */}
                          {ehPericia &&
                            (ehLembrete ? (
                              <Badge className="border-amber-500/50 bg-amber-50 text-amber-900 hover:bg-amber-50 dark:bg-amber-950 dark:text-amber-200">
                                <BellRing className="mr-1 h-3 w-3" />
                                Perícia · lembrete
                              </Badge>
                            ) : (
                              <Badge className="border-emerald-500/50 bg-emerald-50 text-emerald-900 hover:bg-emerald-50 dark:bg-emerald-950 dark:text-emerald-200">
                                <Stethoscope className="mr-1 h-3 w-3" />
                                Perícia · 1º aviso
                              </Badge>
                            ))}
                        </div>
                        <span className="text-xs text-muted-foreground">
                          {formatRelativo(row.created_at)}
                        </span>
                      </div>

                      {row.casos && (
                        <p className="text-xs text-muted-foreground">
                          {row.casos.tipo_beneficio}
                        </p>
                      )}

                      <Textarea
                        value={editados[row.id] ?? row.texto}
                        onChange={(e) =>
                          setEditados((m) => ({ ...m, [row.id]: e.target.value }))
                        }
                        rows={5}
                        className="text-sm"
                      />

                      {semParceiro && (
                        <p className="flex items-center gap-1 text-xs text-amber-600 dark:text-amber-500">
                          <AlertCircle className="h-3.5 w-3.5" />
                          Este caso não tem parceiro vinculado — nenhum e-mail
                          será enviado (vira comentário interno).
                        </p>
                      )}

                      <div className="flex items-center justify-between gap-2">
                        {row.casos ? (
                          <Link
                            to="/casos/$id"
                            params={{ id: row.casos.id }}
                            search={{ tab: "comentarios" }}
                            className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                          >
                            <ExternalLink className="h-3.5 w-3.5" />
                            Abrir caso
                          </Link>
                        ) : (
                          <span />
                        )}
                        <div className="flex items-center gap-2">
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => descartar(row)}
                          disabled={enviando || descartandoId === row.id}
                          className="text-muted-foreground hover:text-destructive"
                        >
                          {descartandoId === row.id ? (
                            <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                          ) : (
                            <Trash2 className="mr-1 h-4 w-4" />
                          )}
                          Descartar
                        </Button>
                        <Button
                          size="sm"
                          onClick={() => enviar(row)}
                          disabled={enviando || descartandoId === row.id}
                        >
                          {enviando ? (
                            <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                          ) : (
                            <Send className="mr-1 h-4 w-4" />
                          )}
                          {semParceiro ? "Publicar comentário" : "Enviar ao parceiro"}
                        </Button>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </ClientOnly>
  );
}

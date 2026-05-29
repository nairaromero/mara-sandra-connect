import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Loader2,
  MessagesSquare,
  Search,
  AlertCircle,
} from "lucide-react";

import { useAuth } from "@/hooks/use-auth";
import { supabase } from "@/lib/supabase";
import { ClientOnly } from "@/components/client-only";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";

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

interface MensagemComCaso {
  id: string;
  caso_id: string;
  remetente_id: string;
  texto: string;
  lida: boolean;
  created_at: string;
  casos: CasoLite | null;
}

interface Conversa {
  caso: CasoLite;
  ultimaMensagem: MensagemComCaso;
  totalNaoLidas: number;
  totalMensagens: number;
}

// ===========================================================================
// Helpers
// ===========================================================================

function formatDateTime(iso: string | null): string {
  if (!iso) return "-";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "-";
  return (
    d.toLocaleDateString("pt-BR") +
    " " +
    d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })
  );
}

function formatRelativo(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "-";
  const diffMs = Date.now() - d.getTime();
  const min = Math.floor(diffMs / (1000 * 60));
  if (min < 1) return "agora";
  if (min < 60) return min + " min atras";
  const horas = Math.floor(min / 60);
  if (horas < 24) return horas + "h atras";
  const dias = Math.floor(horas / 24);
  if (dias < 7) return dias + "d atras";
  return d.toLocaleDateString("pt-BR");
}

function truncar(texto: string, max: number): string {
  if (texto.length <= max) return texto;
  return texto.slice(0, max - 1) + "...";
}

const FASE_LABEL: Record<string, string> = {
  analise: "Em analise",
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

  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [mensagens, setMensagens] = useState<Array<MensagemComCaso>>([]);
  const jaCarregouRef = useRef(false);

  const [busca, setBusca] = useState("");

  const carregar = useCallback(async () => {
    if (!jaCarregouRef.current) {
      setLoading(true);
    }
    setErro(null);
    try {
      const resp = await supabase
        .from("mensagens")
        .select(
          "id, caso_id, remetente_id, texto, lida, created_at, casos(id, tipo_beneficio, fase, status, parceiro_id, clientes(id, nome))",
        )
        .order("created_at", { ascending: false });
      if (resp.error) throw resp.error;
      const dados = (resp.data || []) as unknown as Array<MensagemComCaso>;
      setMensagens(dados);
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

  // Polling leve a cada 30s para refletir novas mensagens
  useEffect(() => {
    const id = setInterval(() => {
      carregar();
    }, 30000);
    return () => clearInterval(id);
  }, [carregar]);

  // Agrupa por caso, pega a ultima mensagem e conta nao-lidas
  const conversas = useMemo<Array<Conversa>>(() => {
    const mapa = new Map<string, Conversa>();
    // mensagens vem ordenadas desc por created_at, entao a primeira de cada caso eh a mais recente
    for (const m of mensagens) {
      if (!m.casos) continue;
      const existente = mapa.get(m.caso_id);
      const naoLida =
        m.lida === false && usuarioId !== null && m.remetente_id !== usuarioId;
      if (existente) {
        existente.totalMensagens = existente.totalMensagens + 1;
        if (naoLida) existente.totalNaoLidas = existente.totalNaoLidas + 1;
      } else {
        mapa.set(m.caso_id, {
          caso: m.casos,
          ultimaMensagem: m,
          totalMensagens: 1,
          totalNaoLidas: naoLida ? 1 : 0,
        });
      }
    }
    return Array.from(mapa.values());
  }, [mensagens, usuarioId]);

  // Filtragem por busca
  const conversasFiltradas = useMemo(() => {
    const q = busca.trim().toLowerCase();
    if (!q) return conversas;
    return conversas.filter((c) => {
      const nome = c.caso.clientes ? c.caso.clientes.nome.toLowerCase() : "";
      const benef = c.caso.tipo_beneficio.toLowerCase();
      const texto = c.ultimaMensagem.texto.toLowerCase();
      return nome.includes(q) || benef.includes(q) || texto.includes(q);
    });
  }, [conversas, busca]);

  const totalNaoLidas = conversas.reduce(
    (acc, c) => acc + c.totalNaoLidas,
    0,
  );

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
              {totalNaoLidas > 0 && (
                <Badge className="bg-red-600 hover:bg-red-600">
                  {totalNaoLidas} nao lida
                  {totalNaoLidas > 1 ? "s" : ""}
                </Badge>
              )}
            </h1>
            <p className="text-sm text-muted-foreground">
              Conversas de todos os casos.
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
                placeholder="Cliente, beneficio ou trecho da mensagem..."
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

        {!erro && conversasFiltradas.length === 0 ? (
          <Card>
            <CardContent className="py-12 text-center">
              <MessagesSquare className="h-10 w-10 mx-auto text-muted-foreground mb-2" />
              <p className="text-sm text-muted-foreground">
                {conversas.length === 0
                  ? "Nenhuma conversa iniciada ainda. Abra um caso e mande uma mensagem."
                  : "Nenhuma conversa encontrada com a busca aplicada."}
              </p>
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardContent className="p-0">
              <ul className="divide-y">
                {conversasFiltradas.map((c) => (
                  <ConversaItem key={c.caso.id} conversa={c} />
                ))}
              </ul>
            </CardContent>
          </Card>
        )}
      </div>
    </ClientOnly>
  );
}

// ===========================================================================
// Sub-componente: ConversaItem
// ===========================================================================

interface ConversaItemProps {
  conversa: Conversa;
}

function ConversaItem(props: ConversaItemProps) {
  const { conversa } = props;
  const { caso, ultimaMensagem, totalNaoLidas, totalMensagens } = conversa;
  const nomeCliente = caso.clientes ? caso.clientes.nome : "(cliente sem nome)";

  return (
    <li>
      <Link
        to="/casos/$id"
        params={{ id: caso.id }}
        className="block hover:bg-muted/40 transition-colors"
      >
        <div className="flex items-start gap-3 p-4">
          <div
            className={
              "flex h-10 w-10 shrink-0 items-center justify-center rounded-full " +
              (totalNaoLidas > 0
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
                {totalNaoLidas > 0 && (
                  <Badge className="bg-red-600 hover:bg-red-600 text-white">
                    {totalNaoLidas}
                  </Badge>
                )}
                <span className="text-xs text-muted-foreground">
                  {formatRelativo(ultimaMensagem.created_at)}
                </span>
              </div>
            </div>
            <p className="text-xs text-muted-foreground mt-0.5 truncate">
              {caso.tipo_beneficio}
            </p>
            <p
              className={
                "text-sm mt-1 line-clamp-2 " +
                (totalNaoLidas > 0
                  ? "text-foreground font-medium"
                  : "text-muted-foreground")
              }
              title={ultimaMensagem.texto}
            >
              {truncar(ultimaMensagem.texto, 200)}
            </p>
            <p className="text-[10px] text-muted-foreground mt-1">
              {totalMensagens} mensagem
              {totalMensagens > 1 ? "ns" : ""} - ultima em{" "}
              {formatDateTime(ultimaMensagem.created_at)}
            </p>
          </div>
        </div>
      </Link>
    </li>
  );
}

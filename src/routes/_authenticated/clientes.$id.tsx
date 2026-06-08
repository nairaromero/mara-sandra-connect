import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Loader2, ArrowLeft, UserCircle, ExternalLink } from "lucide-react";

import { useAuth } from "@/hooks/use-auth";
import { supabase } from "@/lib/supabase";
import { ClientOnly } from "@/components/client-only";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export const Route = createFileRoute("/_authenticated/clientes/$id")({
  component: ClienteDetalhePage,
});

// ===========================================================================
// Tipos
// ===========================================================================

interface ClienteRow {
  id: string;
  nome: string | null;
  cpf: string | null;
  telefone: string | null;
  email: string | null;
  endereco: string | null;
}

interface CasoRow {
  id: string;
  tipo_beneficio: string | null;
  status: string | null;
  fase: string | null;
  created_at: string | null;
}

interface AndamentoRow {
  id: string;
  caso_id: string;
  titulo: string | null;
  descricao: string | null;
  origem: string | null;
  data_evento: string | null;
  visivel_parceiro: boolean | null;
}

// ===========================================================================
// Helpers
// ===========================================================================

function onlyDigits(s: string): string {
  return (s || "").replace(/\D/g, "");
}

function formatCPF(cpf: string | null): string {
  const d = onlyDigits(cpf ?? "");
  if (d.length !== 11) return cpf ?? "-";
  return d.slice(0, 3) + "." + d.slice(3, 6) + "." + d.slice(6, 9) + "-" + d.slice(9);
}

function formatData(s: string | null): string {
  if (!s) return "-";
  const d = new Date(s);
  if (isNaN(d.getTime())) return "-";
  return d.toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

const STATUS_VARIANT: Record<string, { label: string; className: string }> = {
  aguardando_documentos: {
    label: "Aguardando documentos",
    className: "bg-warning text-warning-foreground hover:bg-warning",
  },
  em_analise: {
    label: "Em análise",
    className: "bg-secondary text-secondary-foreground hover:bg-secondary border border-border",
  },
  em_revisao: {
    label: "Em revisão",
    className: "bg-warning text-warning-foreground hover:bg-warning",
  },
  em_andamento: {
    label: "Em andamento",
    className: "bg-secondary text-secondary-foreground hover:bg-secondary border border-border",
  },
  concluido_exito: {
    label: "Concluído com êxito",
    className: "bg-success text-success-foreground hover:bg-success",
  },
  concluido_sem_exito: {
    label: "Sem êxito",
    className: "bg-destructive text-destructive-foreground hover:bg-destructive",
  },
  arquivado: {
    label: "Arquivado",
    className: "bg-muted text-muted-foreground hover:bg-muted",
  },
};

function StatusBadge({ status }: { status: string | null }) {
  if (!status) return <Badge variant="outline">-</Badge>;
  const cfg = STATUS_VARIANT[status];
  if (cfg) return <Badge className={cfg.className}>{cfg.label}</Badge>;
  return <Badge variant="secondary">{status}</Badge>;
}

const ORIGEM_LABEL: Record<string, string> = {
  interno: "Interno",
  tramitacao: "Tramitação",
  legalmail: "Legalmail",
  sistema: "Sistema",
  djen: "DJEN",
};

// ===========================================================================
// Page
// ===========================================================================

function ClienteDetalhePage() {
  const { id } = Route.useParams();
  const { usuario } = useAuth();
  const isInterno = usuario?.tipo === "interno";
  const navigate = useNavigate();

  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [cliente, setCliente] = useState<ClienteRow | null>(null);
  const [casos, setCasos] = useState<Array<CasoRow>>([]);
  const [andamentos, setAndamentos] = useState<Array<AndamentoRow>>([]);

  useEffect(() => {
    carregar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  async function carregar() {
    setLoading(true);
    setErro(null);
    try {
      const cliResp = await supabase
        .from("clientes")
        .select("id, nome, cpf, telefone, email, endereco")
        .eq("id", id)
        .maybeSingle();
      if (cliResp.error) throw cliResp.error;
      const cli = (cliResp.data || null) as ClienteRow | null;
      if (!cli) {
        setErro("Cliente não encontrado ou sem permissão para visualizar.");
        return;
      }
      setCliente(cli);

      // Casos do cliente (RLS filtra: parceiro so os dele).
      const casosResp = await supabase
        .from("casos")
        .select("id, tipo_beneficio, status, fase, created_at")
        .eq("cliente_id", id)
        .order("created_at", { ascending: true });
      if (casosResp.error) throw casosResp.error;
      const casosData = (casosResp.data || []) as Array<CasoRow>;
      setCasos(casosData);

      // Andamentos de todos os casos, de uma vez.
      const ids = casosData.map((c) => c.id);
      if (ids.length > 0) {
        const andResp = await supabase
          .from("andamentos")
          .select("id, caso_id, titulo, descricao, origem, data_evento, visivel_parceiro")
          .in("caso_id", ids)
          .order("data_evento", { ascending: false });
        if (andResp.error) throw andResp.error;
        setAndamentos((andResp.data || []) as Array<AndamentoRow>);
      } else {
        setAndamentos([]);
      }
    } catch (e) {
      const msg = e as { message?: string };
      setErro(msg.message || "Erro ao carregar o cliente");
    } finally {
      setLoading(false);
    }
  }

  // Parceiro so ve andamentos marcados como visiveis.
  const andamentosVisiveis = isInterno
    ? andamentos
    : andamentos.filter((a) => a.visivel_parceiro === true);

  if (loading) {
    return (
      <div className="flex h-96 items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (erro || !cliente) {
    return (
      <div className="max-w-3xl space-y-4">
        <Button variant="ghost" size="sm" onClick={() => navigate({ to: "/clientes" })}>
          <ArrowLeft className="mr-2 h-4 w-4" />
          Clientes
        </Button>
        <Card>
          <CardContent className="py-12 text-center text-sm text-destructive">
            {erro || "Cliente não encontrado"}
          </CardContent>
        </Card>
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
      <div className="max-w-4xl space-y-6">
        <Button variant="ghost" size="sm" onClick={() => navigate({ to: "/clientes" })}>
          <ArrowLeft className="mr-2 h-4 w-4" />
          Clientes
        </Button>

        {/* Cabecalho do cliente */}
        <div className="flex items-start gap-3">
          <UserCircle className="h-10 w-10 shrink-0 text-muted-foreground" />
          <div className="min-w-0">
            <h1 className="font-serif text-2xl font-semibold tracking-tight">
              {cliente.nome || "(sem nome)"}
            </h1>
            <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
              <span className="tabular-nums">CPF: {formatCPF(cliente.cpf)}</span>
              {cliente.telefone && <span>Tel: {cliente.telefone}</span>}
              {cliente.email && <span>{cliente.email}</span>}
            </div>
            {cliente.endereco && (
              <p className="mt-1 text-sm text-muted-foreground">{cliente.endereco}</p>
            )}
          </div>
        </div>

        {/* Um bloco por caso/beneficio, com seus andamentos */}
        {casos.length === 0 && (
          <Card>
            <CardContent className="py-10 text-center text-sm text-muted-foreground">
              Este cliente ainda não tem casos.
            </CardContent>
          </Card>
        )}

        {casos.map((caso) => {
          const ands = andamentosVisiveis.filter((a) => a.caso_id === caso.id);
          return (
            <Card key={caso.id}>
              <CardHeader>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <CardTitle className="text-base">
                      {caso.tipo_beneficio || "(sem benefício)"}
                    </CardTitle>
                    <CardDescription className="mt-1">
                      <StatusBadge status={caso.status} />
                    </CardDescription>
                  </div>
                  <Button variant="outline" size="sm" asChild>
                    <Link to="/casos/$id" params={{ id: caso.id }}>
                      <ExternalLink className="mr-2 h-3.5 w-3.5" />
                      Abrir caso
                    </Link>
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                {ands.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Sem andamentos.</p>
                ) : (
                  <ul className="space-y-3">
                    {ands.map((a) => (
                      <li key={a.id} className="border-l-2 border-muted pl-3">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-sm font-medium">{a.titulo || "(sem título)"}</span>
                          <Badge variant="outline" className="text-[10px]">
                            {ORIGEM_LABEL[a.origem ?? ""] ?? a.origem ?? "-"}
                          </Badge>
                          <span className="text-xs text-muted-foreground">
                            {formatData(a.data_evento)}
                          </span>
                        </div>
                        {a.descricao && (
                          <p className="mt-0.5 whitespace-pre-wrap text-sm text-muted-foreground">
                            {a.descricao}
                          </p>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>
    </ClientOnly>
  );
}

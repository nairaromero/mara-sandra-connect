import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Loader2, Search, UserCircle, ChevronRight } from "lucide-react";

import { useAuth } from "@/hooks/use-auth";
import { supabase } from "@/lib/supabase";
import { ClientOnly } from "@/components/client-only";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export const Route = createFileRoute("/_authenticated/clientes")({
  component: ClientesPage,
});

// ===========================================================================
// Tipos
// ===========================================================================

interface CasoRow {
  id: string;
  status: string | null;
  tipo_beneficio: string | null;
  created_at: string | null;
  cliente: { id: string; nome: string | null; cpf: string | null } | null;
  parceiro: { nome: string | null } | null;
  processos_admin: Array<{ numero_requerimento: string | null }>;
  processos_judiciais: Array<{ numero_processo: string | null }>;
}

interface ClienteAgrupado {
  id: string;
  nome: string;
  cpf: string;
  casos: Array<{
    id: string;
    status: string | null;
    tipo_beneficio: string | null;
    created_at: string | null;
    parceiroNome: string | null;
    numerosProcesso: Array<string>;
  }>;
  // Strings concatenadas pra busca rapida
  searchHaystack: string;
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
  return (
    d.slice(0, 3) + "." + d.slice(3, 6) + "." + d.slice(6, 9) + "-" + d.slice(9)
  );
}

const STATUS_VARIANT: Record<string, { label: string; className: string }> = {
  aguardando_documentos: {
    label: "Aguardando documentos",
    className: "bg-warning text-warning-foreground hover:bg-warning",
  },
  em_analise: {
    label: "Em analise",
    className:
      "bg-secondary text-secondary-foreground hover:bg-secondary border border-border",
  },
  em_revisao: {
    label: "Em revisao",
    className: "bg-warning text-warning-foreground hover:bg-warning",
  },
  em_andamento: {
    label: "Em andamento",
    className:
      "bg-secondary text-secondary-foreground hover:bg-secondary border border-border",
  },
  concluido_exito: {
    label: "Concluido com exito",
    className: "bg-success text-success-foreground hover:bg-success",
  },
  concluido_sem_exito: {
    label: "Sem exito",
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

// ===========================================================================
// Page
// ===========================================================================

function ClientesPage() {
  const { usuario } = useAuth();
  const navigate = useNavigate();
  const [casos, setCasos] = useState<Array<CasoRow>>([]);
  const [loading, setLoading] = useState(true);
  const [busca, setBusca] = useState("");

  useEffect(() => {
    if (!usuario) return;
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [usuario?.id]);

  async function loadData() {
    setLoading(true);
    try {
      // Carrega casos com cliente + parceiro + processos (admin e judicial).
      // RLS no `casos` ja filtra por parceiro automaticamente.
      const resp = await supabase
        .from("casos")
        .select(
          "id, status, tipo_beneficio, created_at, " +
            "cliente:cliente_id(id, nome, cpf), " +
            "parceiro:parceiro_id(nome), " +
            "processos_admin(numero_requerimento), " +
            "processos_judiciais(numero_processo)",
        )
        .order("created_at", { ascending: false });
      if (resp.error) {
        console.error("Erro ao carregar casos:", resp.error);
        setCasos([]);
        return;
      }
      setCasos((resp.data as unknown as Array<CasoRow>) ?? []);
    } finally {
      setLoading(false);
    }
  }

  // Agrupa casos por cliente_id pra ter 1 linha por cliente
  const clientes = useMemo<Array<ClienteAgrupado>>(() => {
    const map = new Map<string, ClienteAgrupado>();
    for (const c of casos) {
      if (!c.cliente) continue;
      const id = c.cliente.id;
      if (!map.has(id)) {
        map.set(id, {
          id,
          nome: c.cliente.nome ?? "(sem nome)",
          cpf: c.cliente.cpf ?? "",
          casos: [],
          searchHaystack: "",
        });
      }
      const entry = map.get(id)!;
      const numerosProcesso = [
        ...(c.processos_admin || [])
          .map((p) => p.numero_requerimento)
          .filter((n): n is string => !!n),
        ...(c.processos_judiciais || [])
          .map((p) => p.numero_processo)
          .filter((n): n is string => !!n),
      ];
      entry.casos.push({
        id: c.id,
        status: c.status,
        tipo_beneficio: c.tipo_beneficio,
        created_at: c.created_at,
        parceiroNome: c.parceiro?.nome ?? null,
        numerosProcesso,
      });
    }
    // Constroi haystack pra busca rapida (case-insensitive, accent-folded)
    for (const e of map.values()) {
      const nome = e.nome.toLowerCase();
      const cpfDigits = onlyDigits(e.cpf);
      const processos = e.casos
        .flatMap((c) => c.numerosProcesso)
        .map((n) => onlyDigits(n))
        .join(" ");
      e.searchHaystack =
        nome + " | " + cpfDigits + " | " + processos.toLowerCase();
    }
    return Array.from(map.values()).sort((a, b) =>
      a.nome.localeCompare(b.nome),
    );
  }, [casos]);

  const buscaNormalizada = busca.trim().toLowerCase();
  const buscaDigits = onlyDigits(busca);

  // Filtra clientes pela busca
  const clientesFiltrados = useMemo(() => {
    if (!buscaNormalizada) return clientes;
    return clientes.filter((c) => {
      // Match por nome (substring)
      if (c.nome.toLowerCase().includes(buscaNormalizada)) return true;
      // Match por CPF (so digitos, parcial)
      if (buscaDigits && onlyDigits(c.cpf).includes(buscaDigits)) return true;
      // Match por numero de processo (so digitos, parcial)
      if (buscaDigits) {
        for (const caso of c.casos) {
          for (const num of caso.numerosProcesso) {
            if (onlyDigits(num).includes(buscaDigits)) return true;
          }
        }
      }
      // Fallback: substring no haystack pra cobrir casos que nao caberam
      return c.searchHaystack.includes(buscaNormalizada);
    });
  }, [clientes, buscaNormalizada, buscaDigits]);

  function abrirCaso(id: string) {
    navigate({ to: "/casos/$id", params: { id } });
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-serif text-3xl font-semibold tracking-tight flex items-center gap-2">
          <UserCircle className="h-7 w-7 text-[var(--gold)]" />
          Clientes
        </h1>
        <p className="text-sm text-muted-foreground">
          Lista de todos os clientes com seus casos. Busque por nome, CPF ou
          numero de processo.
        </p>
      </div>

      <ClientOnly
        fallback={
          <div className="flex h-96 items-center justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        }
      >
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Busca</CardTitle>
            <CardDescription>
              Filtra por nome (parcial), CPF (so digitos) ou numero de processo
              (admin ou judicial).
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                value={busca}
                onChange={(e) => setBusca(e.target.value)}
                placeholder="Ex: Joao, 123.456.789-00, 0001234-56.2024.4.03.6100"
                className="pl-9"
              />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              {loading
                ? "Carregando..."
                : clientesFiltrados.length + " cliente" +
                    (clientesFiltrados.length === 1 ? "" : "s") +
                    (busca.trim()
                      ? " (filtrado de " + clientes.length + ")"
                      : "")}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="flex h-32 items-center justify-center">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            ) : clientesFiltrados.length === 0 ? (
              <p className="text-sm text-muted-foreground py-8 text-center">
                {busca.trim()
                  ? "Nenhum cliente encontrado para essa busca."
                  : "Nenhum cliente cadastrado ainda."}
              </p>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Cliente</TableHead>
                      <TableHead>CPF</TableHead>
                      <TableHead>Casos</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Processos</TableHead>
                      <TableHead className="w-8"></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {clientesFiltrados.map((c) => {
                      const totalCasos = c.casos.length;
                      const casoMaisRecente = c.casos[0]; // ja ordenado
                      const totalProcessos = c.casos.reduce(
                        (acc, ca) => acc + ca.numerosProcesso.length,
                        0,
                      );
                      return (
                        <TableRow
                          key={c.id}
                          className="cursor-pointer hover:bg-muted/40"
                          onClick={() =>
                            casoMaisRecente && abrirCaso(casoMaisRecente.id)
                          }
                        >
                          <TableCell className="font-medium">
                            <div>{c.nome}</div>
                            {casoMaisRecente?.tipo_beneficio && (
                              <div className="text-xs text-muted-foreground">
                                {casoMaisRecente.tipo_beneficio}
                              </div>
                            )}
                          </TableCell>
                          <TableCell className="tabular-nums text-sm">
                            {formatCPF(c.cpf)}
                          </TableCell>
                          <TableCell>
                            <Badge variant="outline" className="tabular-nums">
                              {totalCasos}
                            </Badge>
                          </TableCell>
                          <TableCell>
                            {casoMaisRecente && (
                              <StatusBadge status={casoMaisRecente.status} />
                            )}
                          </TableCell>
                          <TableCell className="text-xs text-muted-foreground">
                            {totalProcessos > 0 ? (
                              <div className="space-y-0.5">
                                {c.casos
                                  .flatMap((ca) => ca.numerosProcesso)
                                  .slice(0, 2)
                                  .map((n, i) => (
                                    <div
                                      key={i}
                                      className="font-mono tabular-nums"
                                    >
                                      {n}
                                    </div>
                                  ))}
                                {totalProcessos > 2 && (
                                  <div className="text-[10px] text-muted-foreground">
                                    +{totalProcessos - 2} mais
                                  </div>
                                )}
                              </div>
                            ) : (
                              "-"
                            )}
                          </TableCell>
                          <TableCell>
                            <ChevronRight className="h-4 w-4 text-muted-foreground" />
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
                <p className="text-xs text-muted-foreground mt-3">
                  Clique numa linha pra abrir o caso mais recente do cliente.
                </p>
              </div>
            )}
          </CardContent>
        </Card>
      </ClientOnly>
    </div>
  );
}

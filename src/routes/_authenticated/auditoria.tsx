import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Loader2, ShieldCheck, ShieldAlert, RefreshCw } from "lucide-react";

import { useAuth } from "@/hooks/use-auth";
import { supabase } from "@/lib/supabase";
import { ClientOnly } from "@/components/client-only";
import { Button } from "@/components/ui/button";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export const Route = createFileRoute("/_authenticated/auditoria")({
  component: AuditoriaPage,
});

// ===========================================================================
// Tipos
// ===========================================================================

type AcaoTipo = "leitura" | "escrita" | "escrita_remocao";

interface AcessoRow {
  id: string;
  cliente_id: string;
  usuario_id: string | null;
  acao: AcaoTipo | string | null;
  acessado_em: string;
  cliente: { nome: string | null } | null;
  usuario: { nome: string | null; email: string | null; tipo: string | null } | null;
}

// ===========================================================================
// Helpers
// ===========================================================================

function formatDataHora(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "-";
  return d.toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function acaoLabel(acao: string | null | undefined): string {
  switch (acao) {
    case "leitura":
      return "Leitura";
    case "escrita":
      return "Escrita";
    case "escrita_remocao":
      return "Remoção";
    default:
      return acao ?? "-";
  }
}

function AcaoBadge({ acao }: { acao: string | null | undefined }) {
  // Leitura = informativo (secondary). Escrita = ação positiva (success).
  // Remoção = destrutivo. Default = muted.
  if (acao === "leitura") {
    return <Badge variant="secondary">Leitura</Badge>;
  }
  if (acao === "escrita") {
    return (
      <Badge className="bg-emerald-100 text-emerald-900 border border-emerald-300 hover:bg-emerald-100">
        Escrita
      </Badge>
    );
  }
  if (acao === "escrita_remocao") {
    return <Badge variant="destructive">Remoção</Badge>;
  }
  return <Badge variant="outline">{acao ?? "-"}</Badge>;
}

function TipoUsuarioBadge({ tipo }: { tipo: string | null | undefined }) {
  if (tipo === "interno") {
    return (
      <Badge className="bg-gold-soft/40 border border-gold/40 text-foreground hover:bg-gold-soft/40">
        Interno
      </Badge>
    );
  }
  if (tipo === "parceiro") {
    return <Badge variant="outline">Parceiro</Badge>;
  }
  return <Badge variant="outline">{tipo ?? "?"}</Badge>;
}

// ===========================================================================
// Componente
// ===========================================================================

function AuditoriaPage() {
  const { usuario } = useAuth();
  const navigate = useNavigate();
  const isInterno = usuario?.tipo === "interno";

  const [rows, setRows] = useState<AcessoRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [filtroCliente, setFiltroCliente] = useState("");
  const [filtroAcao, setFiltroAcao] = useState<string>("todas");
  const [filtroDias, setFiltroDias] = useState<string>("30");

  useEffect(() => {
    if (usuario && !isInterno) {
      toast.error("Acesso restrito à equipe interna.");
      navigate({ to: "/casos" });
    }
  }, [usuario, isInterno, navigate]);

  async function load() {
    setLoading(true);
    try {
      // RLS na acessos_senha_inss já garante interno-only no SELECT.
      // O join com clientes/usuarios passa pelos próprios RLS deles.
      let query = supabase
        .from("acessos_senha_inss")
        .select(
          `
          id,
          cliente_id,
          usuario_id,
          acao,
          acessado_em,
          cliente:clientes(nome),
          usuario:usuarios(nome, email, tipo)
        `,
        )
        .order("acessado_em", { ascending: false })
        .limit(500);

      // Filtro de período
      if (filtroDias !== "todos") {
        const dias = Number(filtroDias);
        if (!isNaN(dias)) {
          const desde = new Date();
          desde.setDate(desde.getDate() - dias);
          query = query.gte("acessado_em", desde.toISOString());
        }
      }

      // Filtro de ação
      if (filtroAcao !== "todas") {
        query = query.eq("acao", filtroAcao);
      }

      const { data, error } = await query;
      if (error) throw error;
      setRows((data as unknown as AcessoRow[]) ?? []);
    } catch (err) {
      console.error(err);
      const msg =
        (err as { message?: string })?.message ??
        "Falha ao carregar log de auditoria.";
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (isInterno) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isInterno, filtroAcao, filtroDias]);

  // Filtro de cliente é client-side (pra evitar round-trip por digitação)
  const rowsFiltradas = useMemo(() => {
    if (!filtroCliente.trim()) return rows;
    const termo = filtroCliente.trim().toLowerCase();
    return rows.filter((r) =>
      (r.cliente?.nome ?? "").toLowerCase().includes(termo),
    );
  }, [rows, filtroCliente]);

  const totais = useMemo(() => {
    const t = { leitura: 0, escrita: 0, escrita_remocao: 0 };
    for (const r of rowsFiltradas) {
      if (r.acao === "leitura") t.leitura++;
      else if (r.acao === "escrita") t.escrita++;
      else if (r.acao === "escrita_remocao") t.escrita_remocao++;
    }
    return t;
  }, [rowsFiltradas]);

  if (!isInterno) {
    return (
      <div className="flex h-96 flex-col items-center justify-center gap-2 text-muted-foreground">
        <ShieldAlert className="h-8 w-8" />
        <p className="text-sm">Acesso restrito à equipe interna.</p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="font-serif text-3xl font-semibold tracking-tight flex items-center gap-2">
            <ShieldCheck className="h-7 w-7 text-[var(--gold)]" />
            Auditoria de senhas MEU INSS
          </h1>
          <p className="text-sm text-muted-foreground">
            Registro imutável de todo acesso (leitura, escrita ou remoção) à
            senha do MEU INSS dos clientes. Obrigatório para conformidade LGPD.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => load()}
          disabled={loading}
        >
          {loading ? (
            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
          ) : (
            <RefreshCw className="h-4 w-4 mr-2" />
          )}
          Atualizar
        </Button>
      </div>

      <ClientOnly
        fallback={
          <div className="flex h-96 items-center justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        }
      >
        {/* Cards de resumo */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>Leituras</CardDescription>
              <CardTitle className="text-3xl tabular-nums">
                {totais.leitura}
              </CardTitle>
            </CardHeader>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>Escritas</CardDescription>
              <CardTitle className="text-3xl tabular-nums">
                {totais.escrita}
              </CardTitle>
            </CardHeader>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>Remoções</CardDescription>
              <CardTitle className="text-3xl tabular-nums">
                {totais.escrita_remocao}
              </CardTitle>
            </CardHeader>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Filtros</CardTitle>
            <CardDescription>
              Refine o log por cliente, tipo de ação ou período.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid gap-4 sm:grid-cols-3">
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">
                  Cliente
                </label>
                <Input
                  placeholder="Buscar por nome..."
                  value={filtroCliente}
                  onChange={(e) => setFiltroCliente(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">
                  Ação
                </label>
                <Select value={filtroAcao} onValueChange={setFiltroAcao}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="todas">Todas as ações</SelectItem>
                    <SelectItem value="leitura">Leitura</SelectItem>
                    <SelectItem value="escrita">Escrita</SelectItem>
                    <SelectItem value="escrita_remocao">Remoção</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">
                  Período
                </label>
                <Select value={filtroDias} onValueChange={setFiltroDias}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="7">Últimos 7 dias</SelectItem>
                    <SelectItem value="30">Últimos 30 dias</SelectItem>
                    <SelectItem value="90">Últimos 90 dias</SelectItem>
                    <SelectItem value="365">Último ano</SelectItem>
                    <SelectItem value="todos">Todo o histórico</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Eventos</CardTitle>
            <CardDescription>
              {rowsFiltradas.length}{" "}
              {rowsFiltradas.length === 1 ? "evento" : "eventos"}
              {filtroDias !== "todos"
                ? ` nos últimos ${filtroDias} dias`
                : " no histórico completo"}
              {filtroAcao !== "todas" ? ` · ação: ${acaoLabel(filtroAcao)}` : ""}
              .
            </CardDescription>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="flex h-48 items-center justify-center">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            ) : rowsFiltradas.length === 0 ? (
              <p className="text-sm text-muted-foreground py-12 text-center">
                Nenhum acesso registrado para os filtros selecionados.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-44">Data e hora</TableHead>
                      <TableHead>Cliente</TableHead>
                      <TableHead>Usuário</TableHead>
                      <TableHead className="w-24">Tipo</TableHead>
                      <TableHead className="w-28">Ação</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rowsFiltradas.map((r) => (
                      <TableRow key={r.id}>
                        <TableCell className="tabular-nums text-sm">
                          {formatDataHora(r.acessado_em)}
                        </TableCell>
                        <TableCell className="font-medium">
                          {r.cliente?.nome ?? "—"}
                        </TableCell>
                        <TableCell>
                          <div className="flex flex-col">
                            <span className="text-sm">
                              {r.usuario?.nome ?? "—"}
                            </span>
                            {r.usuario?.email && (
                              <span className="text-xs text-muted-foreground">
                                {r.usuario.email}
                              </span>
                            )}
                          </div>
                        </TableCell>
                        <TableCell>
                          <TipoUsuarioBadge tipo={r.usuario?.tipo} />
                        </TableCell>
                        <TableCell>
                          <AcaoBadge acao={r.acao} />
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      </ClientOnly>
    </div>
  );
}

import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useAuth } from "@/hooks/use-auth";
import { supabase } from "@/lib/supabase";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Briefcase, Clock, FileSearch, TrendingUp, Wallet, CheckCircle2, Loader2 } from "lucide-react";

export const Route = createFileRoute("/_authenticated/")({
  component: DashboardPage,
});

interface CasoRow {
  id: string;
  tipo_beneficio: string | null;
  status: string | null;
  created_at: string | null;
  cliente_id: string | null;
  parceiro_id: string | null;
  clientes?: { nome: string | null } | null;
  parceiro?: { nome: string | null } | null;
}

const STATUS_VARIANT: Record<string, { label: string; className: string }> = {
  aguardando_documentos: { label: "Aguardando documentos", className: "bg-warning text-warning-foreground hover:bg-warning" },
  em_analise: { label: "Em analise", className: "bg-info text-info-foreground hover:bg-info" },
  em_revisao: { label: "Em revisao", className: "bg-warning text-warning-foreground hover:bg-warning" },
  em_andamento: { label: "Em andamento", className: "bg-info text-info-foreground hover:bg-info" },
  concluido_exito: { label: "Concluido com exito", className: "bg-success text-success-foreground hover:bg-success" },
  concluido_sem_exito: { label: "Concluido sem exito", className: "bg-destructive text-destructive-foreground hover:bg-destructive" },
  arquivado: { label: "Arquivado", className: "bg-secondary text-secondary-foreground hover:bg-secondary" },
};

function StatusBadge({ status }: { status: string | null }) {
  if (!status) return <Badge variant="outline">-</Badge>;
  const cfg = STATUS_VARIANT[status];
  if (cfg) return <Badge className={cfg.className}>{cfg.label}</Badge>;
  return <Badge variant="secondary">{status}</Badge>;
}

function MetricCard({
  title,
  value,
  icon: Icon,
  hint,
}: {
  title: string;
  value: string | number;
  icon: React.ComponentType<{ className?: string }>;
  hint?: string;
}) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">{title}</CardTitle>
        <Icon className="h-4 w-4 text-muted-foreground" />
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-semibold tracking-tight">{value}</div>
        {hint && <p className="text-xs text-muted-foreground mt-1">{hint}</p>}
      </CardContent>
    </Card>
  );
}

function formatDate(iso: string | null) {
  if (!iso) return "-";
  try {
    return new Date(iso).toLocaleDateString("pt-BR");
  } catch {
    return "-";
  }
}

function formatBRL(v: number) {
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function DashboardPage() {
  const { usuario } = useAuth();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [casos, setCasos] = useState<CasoRow[]>([]);
  const [metrics, setMetrics] = useState({
    total: 0,
    andamento: 1,
    aguardandoRevisao: 0,
    exitosMes: 0,
    ativos: 0,
    exitosAno: 0,
    repasseAcumulado: 0,
  });

  useEffect(() => {
    if (!usuario) return;
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [usuario?.id, usuario?.tipo]);

  async function loadData() {
    if (!usuario) return;
    setLoading(true);
    try {
      const casosQuery = supabase
        .from("casos")
        .select(
          "id, tipo_beneficio, status, created_at, cliente_id, parceiro_id, clientes(nome), parceiro:usuarios!casos_parceiro_id_fkey(nome)",
        )
        .order("created_at", { ascending: false })
        .limit(10);
      const { data: casosData, error: casosErr } = await casosQuery;
      if (casosErr) console.error(casosErr);
      setCasos((casosData as unknown as CasoRow[]) ?? []);
      if (usuario.tipo === "interno") {
        const [totalRes, andamentoRes, revisaoRes, exitosMesRes] = await Promise.all([
          supabase.from("casos").select("id", { count: "exact", head: true }),
          supabase.from("casos").select("id", { count: "exact", head: true }).eq("status", "em_andamento"),
          supabase.from("casos").select("id", { count: "exact", head: true }).eq("status", "em_revisao"),
          supabase
            .from("casos")
            .select("id", { count: "exact", head: true })
            .eq("status", "concluido_exito")
            .gte("created_at", startOfMonthISO()),
        ]);
        setMetrics((m) => ({
          ...m,
          total: totalRes.count ?? 0,
          andamento: andamentoRes.count ?? 0,
          aguardandoRevisao: revisaoRes.count ?? 0,
          exitosMes: exitosMesRes.count ?? 0,
        }));
      } else {
        const [ativosRes, exitosAnoRes, repassesRes] = await Promise.all([
          supabase.from("casos").select("id", { count: "exact", head: true }).in("status", ["em_andamento", "em_analise", "em_revisao", "aguardando_documentos"]),
          supabase
            .from("casos")
            .select("id", { count: "exact", head: true })
            .eq("status", "concluido_exito")
            .gte("created_at", startOfYearISO()),
          supabase.from("repasses").select("valor"),
        ]);
        const acumulado = (repassesRes.data ?? []).reduce(
          (acc: number, r: { valor: number | string | null }) => acc + Number(r.valor ?? 0),
          0,
        );
        setMetrics((m) => ({
          ...m,
          ativos: ativosRes.count ?? 0,
          exitosAno: exitosAnoRes.count ?? 0,
          repasseAcumulado: acumulado,
        }));
      }
    } finally {
      setLoading(false);
    }
  }

  function abrirCaso(id: string) {
    navigate({ to: "/casos/$id", params: { id: id } });
  }

  if (!usuario) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const isInterno = usuario.tipo === "interno";

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">
          Ola, {usuario.nome ?? "advogado(a)"}
        </h1>
        <p className="text-sm text-muted-foreground">
          {isInterno
            ? "Visao geral de todos os casos do escritorio."
            : "Acompanhe seus casos e repasses."}
        </p>
      </div>
      {isInterno ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <MetricCard title="Casos totais" value={metrics.total} icon={Briefcase} />
          <MetricCard title="Em andamento" value={metrics.andamento} icon={Clock} />
          <MetricCard title="Aguardando revisao" value={metrics.aguardandoRevisao} icon={FileSearch} />
          <MetricCard title="Exitos no mes" value={metrics.exitosMes} icon={TrendingUp} />
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <MetricCard title="Casos ativos" value={metrics.ativos} icon={Briefcase} />
          <MetricCard title="Exitos no ano" value={metrics.exitosAno} icon={CheckCircle2} />
          <MetricCard
            title="Repasse acumulado"
            value={formatBRL(metrics.repasseAcumulado)}
            icon={Wallet}
          />
        </div>
      )}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            {isInterno ? "10 casos mais recentes" : "Meus casos"}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex h-32 items-center justify-center">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : casos.length === 0 ? (
            <div className="flex h-32 items-center justify-center text-sm text-muted-foreground">
              Nenhum caso encontrado.
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Cliente</TableHead>
                  {isInterno && <TableHead>Parceiro</TableHead>}
                  <TableHead>Tipo de beneficio</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Criado em</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {casos.map((c) => (
                  <TableRow
                    key={c.id}
                    className="cursor-pointer hover:bg-muted/50"
                    onClick={() => abrirCaso(c.id)}
                  >
                    <TableCell className="font-medium">{c.clientes?.nome ?? "-"}</TableCell>
                    {isInterno && <TableCell>{c.parceiro?.nome ?? "-"}</TableCell>}
                    <TableCell>{c.tipo_beneficio ?? "-"}</TableCell>
                    <TableCell>
                      <StatusBadge status={c.status} />
                    </TableCell>
                    <TableCell className="text-right text-muted-foreground">
                      {formatDate(c.created_at)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function startOfMonthISO() {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), 1).toISOString();
}

function startOfYearISO() {
  const d = new Date();
  return new Date(d.getFullYear(), 0, 1).toISOString();
}

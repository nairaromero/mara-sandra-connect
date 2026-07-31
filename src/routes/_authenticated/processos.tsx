// Página /processos — planilha global de processos (admin + judiciais), interno.
// Fase 1 do planning/PROCESSOS_GLOBAL.md: só leitura dos dados que já temos;
// último andamento e tarefas pendentes agregados client-side (~centenas de
// processos, volume tranquilo pra uma carga única).

import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowRight, Briefcase, Copy, History, Loader2, Search } from "lucide-react";
import { toast } from "sonner";

import { cn } from "@/lib/utils";
import { useAuth } from "@/hooks/use-auth";
import { supabase } from "@/lib/supabase";
import { ClientOnly } from "@/components/client-only";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export const Route = createFileRoute("/_authenticated/processos")({
  component: ProcessosPage,
});

// Mesmas listas da aba Processos do caso (casos.$id.tsx). Se mudarem lá,
// mudar aqui junto — fase 2 extrai pra um módulo compartilhado.
const ETAPAS_ADMIN = [
  "Requerimento inicial",
  "Recurso ordinario",
  "Prorrogacao",
  "Pedido de revisao",
  "Cumprimento de exigencia",
  "Outro",
];
const ETAPAS_JUDICIAL = [
  "Acao inicial",
  "Recurso (apelacao)",
  "Embargos",
  "Cumprimento de sentenca",
  "Outro",
];

const ORIGEM_LABEL: Record<string, string> = {
  interno: "Interno",
  tramitacao: "Tramitação Inteligente",
  legalmail: "Legalmail",
  djen: "DJEN",
  sistema: "Sistema",
  inss_email: "E-mail INSS",
};

// Processo "parado": sem andamento registrado nos últimos N dias.
const DIAS_PARADO = 30;
const PAGINA = 100;

type ProcTipo = "admin" | "judicial";
type Ordenacao = "andamento" | "inicio" | "cliente";

interface CasoJoin {
  id: string;
  tipo_beneficio: string | null;
  status: string | null;
  clientes: { nome: string | null } | null;
  parceiro: { nome: string | null } | null;
}

interface UltimoAndamento {
  titulo: string | null;
  origem: string;
  data: string | null; // data_evento ?? created_at
}

interface ProcessoRow {
  key: string; // "admin:<id>" | "judicial:<id>"
  tipo: ProcTipo;
  id: string;
  casoId: string;
  numero: string | null;
  cliente: string;
  parceiro: string | null;
  beneficio: string | null;
  etapa: string | null;
  inicio: string | null; // data_protocolo | data_distribuicao
  local: string | null; // vara/comarca/UF (judicial) | decisão (admin)
  ultimo: UltimoAndamento | null;
  tarefasPendentes: number;
}

function fmtData(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso.length <= 10 ? iso + "T00:00:00" : iso);
  return d.toLocaleDateString("pt-BR");
}

function diasDesde(iso: string | null): number | null {
  if (!iso) return null;
  const d = new Date(iso.length <= 10 ? iso + "T00:00:00" : iso);
  return Math.floor((Date.now() - d.getTime()) / 86400000);
}

function ProcessosPage() {
  const { usuario } = useAuth();
  const isInterno = usuario?.tipo === "interno";
  const navigate = useNavigate();

  const [carregando, setCarregando] = useState(true);
  const [rows, setRows] = useState<ProcessoRow[]>([]);

  // Filtros
  const [busca, setBusca] = useState("");
  const [filtroTipo, setFiltroTipo] = useState<ProcTipo | "todos">("todos");
  const [filtroEtapa, setFiltroEtapa] = useState<string>("todas");
  const [filtroBeneficio, setFiltroBeneficio] = useState<string>("todos");
  const [somenteParados, setSomenteParados] = useState(false);
  const [ordenacao, setOrdenacao] = useState<Ordenacao>("andamento");
  const [limite, setLimite] = useState(PAGINA);

  // Parceiro não tem visão global — volta pra home dele.
  useEffect(() => {
    if (usuario && !isInterno) navigate({ to: "/casos" });
  }, [usuario, isInterno, navigate]);

  const carregar = useCallback(async () => {
    setCarregando(true);
    try {
      const casoJoin =
        "casos:caso_id(id, tipo_beneficio, status, clientes(nome), parceiro:usuarios!casos_parceiro_id_fkey(nome))";
      const [admins, juds, ands, tars] = await Promise.all([
        supabase
          .from("processos_admin")
          .select(
            `id, caso_id, numero_requerimento, data_protocolo, decisao, etapa_tipo, tipo_beneficio, ${casoJoin}`,
          )
          .limit(3000),
        supabase
          .from("processos_judiciais")
          .select(
            `id, caso_id, numero_processo, vara, comarca, uf, data_distribuicao, etapa_tipo, ${casoJoin}`,
          )
          .limit(3000),
        // Só andamentos vinculados a algum processo; o mais recente por
        // processo é reduzido abaixo. Colunas mínimas pra aliviar o payload.
        supabase
          .from("andamentos")
          .select(
            "processo_admin_id, processo_judicial_id, titulo, origem, data_evento, created_at",
          )
          .or("processo_admin_id.not.is.null,processo_judicial_id.not.is.null")
          .order("data_evento", { ascending: false, nullsFirst: false })
          .limit(10000),
        supabase
          .from("tarefas")
          .select("processo_admin_id, processo_judicial_id")
          .in("status", ["a_fazer", "fazendo"])
          .or("processo_admin_id.not.is.null,processo_judicial_id.not.is.null"),
      ]);

      const erro = admins.error || juds.error || ands.error || tars.error;
      if (erro) throw erro;

      // Reduções por processo: último andamento e tarefas pendentes.
      const ultimoPor = new Map<string, UltimoAndamento>();
      for (const a of (ands.data || []) as Array<Record<string, unknown>>) {
        const key = a.processo_admin_id
          ? `admin:${a.processo_admin_id}`
          : `judicial:${a.processo_judicial_id}`;
        const data = (a.data_evento as string | null) ?? (a.created_at as string | null);
        const atual = ultimoPor.get(key);
        if (!atual || (data && (!atual.data || data > atual.data))) {
          ultimoPor.set(key, {
            titulo: (a.titulo as string | null) ?? null,
            origem: String(a.origem ?? "interno"),
            data,
          });
        }
      }
      const pendentesPor = new Map<string, number>();
      for (const t of (tars.data || []) as Array<Record<string, unknown>>) {
        const key = t.processo_admin_id
          ? `admin:${t.processo_admin_id}`
          : `judicial:${t.processo_judicial_id}`;
        pendentesPor.set(key, (pendentesPor.get(key) || 0) + 1);
      }

      const linhas: ProcessoRow[] = [];
      for (const p of (admins.data || []) as Array<Record<string, unknown>>) {
        const caso = p.casos as CasoJoin | null;
        const key = `admin:${p.id}`;
        linhas.push({
          key,
          tipo: "admin",
          id: String(p.id),
          casoId: String(p.caso_id),
          numero: (p.numero_requerimento as string | null) ?? null,
          cliente: caso?.clientes?.nome ?? "Cliente",
          parceiro: caso?.parceiro?.nome ?? null,
          beneficio: (p.tipo_beneficio as string | null) ?? caso?.tipo_beneficio ?? null,
          etapa: (p.etapa_tipo as string | null) ?? null,
          inicio: (p.data_protocolo as string | null) ?? null,
          local: (p.decisao as string | null) ?? null,
          ultimo: ultimoPor.get(key) ?? null,
          tarefasPendentes: pendentesPor.get(key) ?? 0,
        });
      }
      for (const p of (juds.data || []) as Array<Record<string, unknown>>) {
        const caso = p.casos as CasoJoin | null;
        const key = `judicial:${p.id}`;
        const local = [p.vara, p.comarca, p.uf].filter(Boolean).join(" · ");
        linhas.push({
          key,
          tipo: "judicial",
          id: String(p.id),
          casoId: String(p.caso_id),
          numero: (p.numero_processo as string | null) ?? null,
          cliente: caso?.clientes?.nome ?? "Cliente",
          parceiro: caso?.parceiro?.nome ?? null,
          beneficio: caso?.tipo_beneficio ?? null,
          etapa: (p.etapa_tipo as string | null) ?? null,
          inicio: (p.data_distribuicao as string | null) ?? null,
          local: local || null,
          ultimo: ultimoPor.get(key) ?? null,
          tarefasPendentes: pendentesPor.get(key) ?? 0,
        });
      }
      setRows(linhas);
    } catch (err) {
      console.error(err);
      toast.error("Falha ao carregar os processos.");
    } finally {
      setCarregando(false);
    }
  }, []);

  useEffect(() => {
    if (isInterno) carregar();
  }, [isInterno, carregar]);

  const beneficios = useMemo(() => {
    const s = new Set<string>();
    for (const r of rows) if (r.beneficio) s.add(r.beneficio);
    return [...s].sort((a, b) => a.localeCompare(b, "pt-BR"));
  }, [rows]);

  const etapas =
    filtroTipo === "admin"
      ? ETAPAS_ADMIN
      : filtroTipo === "judicial"
        ? ETAPAS_JUDICIAL
        : [...ETAPAS_ADMIN, ...ETAPAS_JUDICIAL.filter((e) => e !== "Outro")];

  const paradoRow = useCallback((r: ProcessoRow) => {
    const dias = diasDesde(r.ultimo?.data ?? r.inicio);
    return dias === null || dias >= DIAS_PARADO;
  }, []);

  const filtradas = useMemo(() => {
    const q = busca.trim().toLowerCase();
    const dig = q.replace(/\D/g, "");
    let lista = rows.filter((r) => {
      if (filtroTipo !== "todos" && r.tipo !== filtroTipo) return false;
      if (filtroEtapa !== "todas" && r.etapa !== filtroEtapa) return false;
      if (filtroBeneficio !== "todos" && r.beneficio !== filtroBeneficio) {
        return false;
      }
      if (somenteParados && !paradoRow(r)) return false;
      if (!q) return true;
      if (r.cliente.toLowerCase().includes(q)) return true;
      if ((r.parceiro || "").toLowerCase().includes(q)) return true;
      if (dig.length >= 3 && (r.numero || "").replace(/\D/g, "").includes(dig)) {
        return true;
      }
      return (r.numero || "").toLowerCase().includes(q);
    });
    lista = [...lista].sort((a, b) => {
      if (ordenacao === "cliente") {
        return a.cliente.localeCompare(b.cliente, "pt-BR");
      }
      if (ordenacao === "inicio") {
        return (b.inicio || "").localeCompare(a.inicio || "");
      }
      // "andamento": mais recente primeiro; sem andamento vai pro fim.
      return (b.ultimo?.data || "").localeCompare(a.ultimo?.data || "");
    });
    return lista;
  }, [rows, busca, filtroTipo, filtroEtapa, filtroBeneficio, somenteParados, ordenacao, paradoRow]);

  const resumo = useMemo(() => {
    let admin = 0;
    let judicial = 0;
    let parados = 0;
    for (const r of rows) {
      if (r.tipo === "admin") admin++;
      else judicial++;
      if (paradoRow(r)) parados++;
    }
    return { total: rows.length, admin, judicial, parados };
  }, [rows, paradoRow]);

  const visiveis = filtradas.slice(0, limite);

  // Chips-filtro do cabeçalho.
  const filtrosAtivos =
    filtroTipo !== "todos" ||
    filtroEtapa !== "todas" ||
    filtroBeneficio !== "todos" ||
    somenteParados ||
    busca.trim() !== "";

  function alternarTipo(tipo: ProcTipo) {
    setFiltroTipo((atual) => (atual === tipo ? "todos" : tipo));
    setFiltroEtapa("todas");
    setLimite(PAGINA);
  }

  function limparFiltros() {
    setBusca("");
    setFiltroTipo("todos");
    setFiltroEtapa("todas");
    setFiltroBeneficio("todos");
    setSomenteParados(false);
    setLimite(PAGINA);
  }

  function copiarNumero(numero: string) {
    navigator.clipboard
      .writeText(numero)
      .then(() => toast.success("Número copiado."))
      .catch(() => toast.error("Não foi possível copiar."));
  }

  if (!isInterno) return null;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-serif text-3xl font-semibold tracking-tight flex items-center gap-2">
            <Briefcase className="h-7 w-7 text-[var(--gold)]" />
            Processos
          </h1>
          <p className="text-sm text-muted-foreground">
            Todos os processos administrativos e judiciais do escritório, com o último andamento e
            as tarefas pendentes de cada um.
          </p>
        </div>
        <Button variant="outline" size="sm" asChild>
          <Link to="/processos/movimentacoes">
            <History className="mr-1.5 h-4 w-4" />
            Movimentações
          </Link>
        </Button>
      </div>
      <div>
        {rows.length > 0 && (
          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
            {/* Chips-filtro: clicar filtra a tabela; clicar de novo desfaz. */}
            <button type="button" onClick={limparFiltros} title="Ver todos os processos">
              <Badge
                variant={filtrosAtivos ? "outline" : "default"}
                className={cn(
                  "cursor-pointer",
                  !filtrosAtivos && "bg-foreground text-background hover:bg-foreground",
                )}
              >
                {resumo.total} processos
              </Badge>
            </button>
            <button
              type="button"
              onClick={() => alternarTipo("admin")}
              title="Só processos administrativos"
            >
              <Badge
                variant={filtroTipo === "admin" ? "default" : "outline"}
                className={cn(
                  "cursor-pointer",
                  filtroTipo === "admin"
                    ? "bg-sky-600 text-white hover:bg-sky-600"
                    : "border-sky-500 text-sky-700 dark:text-sky-400",
                )}
              >
                {resumo.admin} administrativos
              </Badge>
            </button>
            <button
              type="button"
              onClick={() => alternarTipo("judicial")}
              title="Só processos judiciais"
            >
              <Badge
                variant={filtroTipo === "judicial" ? "default" : "outline"}
                className={cn(
                  "cursor-pointer",
                  filtroTipo === "judicial"
                    ? "bg-[var(--gold)] text-white hover:bg-[var(--gold)]"
                    : "border-[var(--gold)] text-amber-800 dark:text-amber-300",
                )}
              >
                {resumo.judicial} judiciais
              </Badge>
            </button>
            <button
              type="button"
              onClick={() => {
                setSomenteParados((v) => !v);
                setLimite(PAGINA);
              }}
              title={`Sem andamento há ${DIAS_PARADO}+ dias`}
            >
              <Badge
                variant={somenteParados ? "default" : "outline"}
                className={cn(
                  "cursor-pointer",
                  somenteParados
                    ? "bg-amber-600 text-white hover:bg-amber-600"
                    : "border-amber-500 text-amber-700 dark:text-amber-400",
                )}
              >
                {resumo.parados} parados ({DIAS_PARADO}+ dias)
              </Badge>
            </button>
          </div>
        )}
      </div>

      <ClientOnly
        fallback={
          <div className="flex h-64 items-center justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        }
      >
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-56 flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              placeholder="Buscar por número, cliente ou parceiro"
              className="pl-9"
            />
          </div>
          <Select
            value={filtroTipo}
            onValueChange={(v) => {
              setFiltroTipo(v as ProcTipo | "todos");
              setFiltroEtapa("todas");
            }}
          >
            <SelectTrigger className="w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="todos">Todos os tipos</SelectItem>
              <SelectItem value="admin">Administrativo</SelectItem>
              <SelectItem value="judicial">Judicial</SelectItem>
            </SelectContent>
          </Select>
          <Select value={filtroEtapa} onValueChange={setFiltroEtapa}>
            <SelectTrigger className="w-48">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="todas">Todas as etapas</SelectItem>
              {etapas.map((e) => (
                <SelectItem key={e} value={e}>
                  {e}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={filtroBeneficio} onValueChange={setFiltroBeneficio}>
            <SelectTrigger className="w-52">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="todos">Todos os benefícios</SelectItem>
              {beneficios.map((b) => (
                <SelectItem key={b} value={b}>
                  {b}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={ordenacao} onValueChange={(v) => setOrdenacao(v as Ordenacao)}>
            <SelectTrigger className="w-52">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="andamento">Último andamento</SelectItem>
              <SelectItem value="inicio">Início mais recente</SelectItem>
              <SelectItem value="cliente">Cliente (A–Z)</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {carregando ? (
          <div className="flex h-40 items-center justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : filtradas.length === 0 ? (
          <Card>
            <CardContent className="flex flex-col items-center justify-center gap-2 py-12 text-center">
              <Briefcase className="h-8 w-8 text-muted-foreground" />
              <p className="text-sm font-medium">Nenhum processo encontrado</p>
              <p className="text-xs text-muted-foreground">
                Ajuste a busca ou os filtros. Processos são cadastrados na aba Processos de cada
                caso.
              </p>
            </CardContent>
          </Card>
        ) : (
          <>
            <p className="text-xs text-muted-foreground">
              {filtradas.length} processo{filtradas.length === 1 ? "" : "s"}
              {filtradas.length > visiveis.length ? ` · mostrando ${visiveis.length}` : ""}
            </p>
            <div className="overflow-x-auto rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Processo</TableHead>
                    <TableHead>Tipo</TableHead>
                    <TableHead>Cliente</TableHead>
                    <TableHead>Benefício</TableHead>
                    <TableHead>Etapa</TableHead>
                    <TableHead>Início</TableHead>
                    <TableHead>Último andamento</TableHead>
                    <TableHead className="text-center">Tarefas</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {visiveis.map((r) => {
                    const parado = paradoRow(r);
                    return (
                      <TableRow key={r.key}>
                        <TableCell className="max-w-52">
                          <div className="flex items-center gap-1.5">
                            <span
                              className="truncate font-mono text-xs"
                              title={r.numero || undefined}
                            >
                              {r.numero || "Sem número"}
                            </span>
                            {r.numero && (
                              <button
                                type="button"
                                onClick={() => copiarNumero(r.numero!)}
                                className="shrink-0 text-muted-foreground hover:text-foreground"
                                title="Copiar número"
                              >
                                <Copy className="h-3 w-3" />
                              </button>
                            )}
                          </div>
                          {r.local && (
                            <p
                              className="mt-0.5 max-w-52 truncate text-[11px] text-muted-foreground"
                              title={r.local}
                            >
                              {r.local}
                            </p>
                          )}
                        </TableCell>
                        <TableCell>
                          <Badge
                            variant="outline"
                            className={cn(
                              "text-xs",
                              r.tipo === "admin"
                                ? "border-sky-500 text-sky-700 dark:text-sky-400"
                                : "border-[var(--gold)] text-amber-800 dark:text-amber-300",
                            )}
                          >
                            {r.tipo === "admin" ? "Admin" : "Judicial"}
                          </Badge>
                        </TableCell>
                        <TableCell className="max-w-48">
                          <p className="truncate text-sm font-medium" title={r.cliente}>
                            {r.cliente}
                          </p>
                          {r.parceiro && (
                            <p
                              className="truncate text-[11px] text-muted-foreground"
                              title={r.parceiro}
                            >
                              {r.parceiro}
                            </p>
                          )}
                        </TableCell>
                        <TableCell className="max-w-44">
                          <span className="block truncate text-sm" title={r.beneficio || undefined}>
                            {r.beneficio || "—"}
                          </span>
                        </TableCell>
                        <TableCell>
                          <span className="text-sm">{r.etapa || "—"}</span>
                        </TableCell>
                        <TableCell>
                          <span className="text-sm whitespace-nowrap">{fmtData(r.inicio)}</span>
                        </TableCell>
                        <TableCell className="max-w-64">
                          {r.ultimo ? (
                            <div>
                              <p className="text-sm whitespace-nowrap">
                                <span
                                  className={cn(
                                    parado && "text-amber-700 dark:text-amber-400 font-medium",
                                  )}
                                >
                                  {fmtData(r.ultimo.data)}
                                </span>{" "}
                                <span className="text-[11px] text-muted-foreground">
                                  · {ORIGEM_LABEL[r.ultimo.origem] || r.ultimo.origem}
                                </span>
                              </p>
                              <p
                                className="truncate text-[11px] text-muted-foreground"
                                title={r.ultimo.titulo || undefined}
                              >
                                {r.ultimo.titulo || ""}
                              </p>
                            </div>
                          ) : (
                            <span className="text-xs text-muted-foreground">Sem andamentos</span>
                          )}
                        </TableCell>
                        <TableCell className="text-center">
                          {r.tarefasPendentes > 0 ? (
                            <Badge className="bg-[var(--gold)] text-white hover:bg-[var(--gold)]">
                              {r.tarefasPendentes}
                            </Badge>
                          ) : (
                            <span className="text-xs text-muted-foreground">—</span>
                          )}
                        </TableCell>
                        <TableCell>
                          <Button size="sm" variant="outline" asChild>
                            <Link
                              to="/casos/$id"
                              params={{ id: r.casoId }}
                              search={{ tab: "processos" }}
                            >
                              Abrir
                              <ArrowRight className="ml-1 h-3.5 w-3.5" />
                            </Link>
                          </Button>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
            {filtradas.length > visiveis.length && (
              <div className="flex justify-center">
                <Button variant="outline" onClick={() => setLimite((l) => l + PAGINA)}>
                  Mostrar mais ({filtradas.length - visiveis.length} restantes)
                </Button>
              </div>
            )}
          </>
        )}
      </ClientOnly>
    </div>
  );
}

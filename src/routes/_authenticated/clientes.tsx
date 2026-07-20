import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import {
  CalendarPlus,
  Check,
  ChevronLeft,
  ChevronRight,
  ChevronsUpDown,
  FileDown,
  Loader2,
  Search,
  Tag,
  Upload,
  UserCircle,
} from "lucide-react";
import { toast } from "sonner";

import { useAuth } from "@/hooks/use-auth";
import { supabase } from "@/lib/supabase";
import { ClientOnly } from "@/components/client-only";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { ImportarTiDialog } from "@/components/importar-ti-dialog";
import { ImportarClientesExcelDialog } from "@/components/importar-clientes-excel-dialog";
import { exportarClientesExcel } from "@/lib/clientes-excel";
import { TarefaSheet, type TarefaSheetModo } from "@/components/tarefas/tarefa-sheet";

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

interface Etiqueta {
  id: string;
  nome: string;
  cor: string;
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
  etiquetas: Array<Etiqueta>;
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
  return d.slice(0, 3) + "." + d.slice(3, 6) + "." + d.slice(6, 9) + "-" + d.slice(9);
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

// ===========================================================================
// Page
// ===========================================================================

function ClientesPage() {
  const { usuario } = useAuth();
  const isInterno = usuario?.tipo === "interno";
  const navigate = useNavigate();
  const [casos, setCasos] = useState<Array<CasoRow>>([]);
  const [loading, setLoading] = useState(true);
  const [busca, setBusca] = useState("");
  // Filtro por parceiro (so interno usa). "" = todos. "__interno__" = casos sem parceiro.
  const [parceiroFiltro, setParceiroFiltro] = useState<string>("");
  // Filtro por etiqueta (id da etiqueta; "" = todas) e por status de caso.
  const [etiquetaFiltro, setEtiquetaFiltro] = useState<string>("");
  const [etiquetaPopOpen, setEtiquetaPopOpen] = useState(false);
  const [statusFiltro, setStatusFiltro] = useState<string>("");
  // Paginacao client-side (os dados ja estao todos carregados).
  const [pagina, setPagina] = useState(1);
  const [porPagina, setPorPagina] = useState(10);
  const [etiquetasPorCliente, setEtiquetasPorCliente] = useState<
    Map<string, Array<Etiqueta>>
  >(new Map());
  const [exportando, setExportando] = useState(false);
  const [importarDialogAberto, setImportarDialogAberto] = useState(false);
  // "+ Perícia" no cliente abre o TarefaSheet com o template
  // "pericia_parceiro" pré-selecionado. O TarefaSheet detecta destino=agenda
  // e cria o evento na agenda + 2 tarefas (lembrete antes + verificação).
  const [tarefaSheet, setTarefaSheet] = useState<TarefaSheetModo | null>(null);

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
      const [resp, etResp] = await Promise.all([
        supabase
          .from("casos")
          .select(
            "id, status, tipo_beneficio, created_at, " +
              "cliente:cliente_id(id, nome, cpf), " +
              "parceiro:parceiro_id(nome), " +
              "processos_admin(numero_requerimento), " +
              "processos_judiciais(numero_processo)",
          )
          .order("created_at", { ascending: false }),
        supabase
          .from("clientes_etiquetas")
          .select("cliente_id, etiqueta:etiquetas(id, nome, cor)"),
      ]);
      if (resp.error) {
        console.error("Erro ao carregar casos:", resp.error);
        setCasos([]);
        return;
      }
      setCasos((resp.data as unknown as Array<CasoRow>) ?? []);

      // Mapa cliente_id -> etiquetas. Parceiro nao ve tags internas "NOME/UF"
      // (mesma regra do componente EtiquetasCliente).
      if (!etResp.error) {
        type LinkRow = {
          cliente_id: string;
          etiqueta: Etiqueta | Array<Etiqueta> | null;
        };
        const mapa = new Map<string, Array<Etiqueta>>();
        for (const row of (etResp.data ?? []) as Array<LinkRow>) {
          const et = Array.isArray(row.etiqueta) ? row.etiqueta[0] : row.etiqueta;
          if (!et) continue;
          if (!isInterno && /^[A-Za-z_]+\/[A-Z]{2}$/.test(et.nome.trim())) continue;
          const lista = mapa.get(row.cliente_id) ?? [];
          lista.push(et);
          mapa.set(row.cliente_id, lista);
        }
        for (const lista of mapa.values()) {
          lista.sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
        }
        setEtiquetasPorCliente(mapa);
      }
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
          etiquetas: etiquetasPorCliente.get(id) ?? [],
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
      const etiquetasStr = e.etiquetas.map((t) => t.nome.toLowerCase()).join(" ");
      e.searchHaystack =
        nome + " | " + cpfDigits + " | " + processos.toLowerCase() + " | " + etiquetasStr;
    }
    return Array.from(map.values()).sort((a, b) => a.nome.localeCompare(b.nome));
  }, [casos, etiquetasPorCliente]);

  const buscaNormalizada = busca.trim().toLowerCase();
  const buscaDigits = onlyDigits(busca);

  // Lista distinta de parceiros derivada dos casos carregados.
  const parceirosDisponiveis = useMemo(() => {
    const set = new Set<string>();
    for (const c of clientes) {
      for (const ca of c.casos) {
        if (ca.parceiroNome) set.add(ca.parceiroNome);
      }
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [clientes]);

  // Etiquetas que aparecem em pelo menos um cliente carregado, com contagem —
  // e o que alimenta o combobox de filtro.
  const etiquetasDisponiveis = useMemo(() => {
    const mapa = new Map<string, Etiqueta & { qtd: number }>();
    for (const c of clientes) {
      for (const e of c.etiquetas) {
        const atual = mapa.get(e.id);
        if (atual) atual.qtd += 1;
        else mapa.set(e.id, { ...e, qtd: 1 });
      }
    }
    return Array.from(mapa.values()).sort((a, b) =>
      a.nome.localeCompare(b.nome, "pt-BR"),
    );
  }, [clientes]);

  const etiquetaSelecionada = etiquetaFiltro
    ? etiquetasDisponiveis.find((e) => e.id === etiquetaFiltro) ?? null
    : null;

  // Filtra clientes pela busca + parceiro + etiqueta + status
  const clientesFiltrados = useMemo(() => {
    let result = clientes;

    // Filtro por parceiro
    if (parceiroFiltro === "__interno__") {
      result = result.filter((c) => c.casos.every((ca) => !ca.parceiroNome));
    } else if (parceiroFiltro) {
      result = result.filter((c) => c.casos.some((ca) => ca.parceiroNome === parceiroFiltro));
    }

    // Filtro por etiqueta
    if (etiquetaFiltro) {
      result = result.filter((c) => c.etiquetas.some((e) => e.id === etiquetaFiltro));
    }

    // Filtro por status (algum caso do cliente com esse status)
    if (statusFiltro) {
      result = result.filter((c) => c.casos.some((ca) => ca.status === statusFiltro));
    }

    // Filtro por busca textual
    if (!buscaNormalizada) return result;
    return result.filter((c) => {
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
      // (inclui nomes de etiquetas)
      return c.searchHaystack.includes(buscaNormalizada);
    });
  }, [clientes, parceiroFiltro, etiquetaFiltro, statusFiltro, buscaNormalizada, buscaDigits]);

  const temFiltroAtivo =
    !!buscaNormalizada || !!parceiroFiltro || !!etiquetaFiltro || !!statusFiltro;

  // Paginacao: volta pra pagina 1 sempre que qualquer filtro (ou o tamanho da
  // pagina) muda, senao a pessoa fica presa numa pagina que nao existe mais.
  useEffect(() => {
    setPagina(1);
  }, [buscaNormalizada, parceiroFiltro, etiquetaFiltro, statusFiltro, porPagina]);

  const totalPaginas = Math.max(1, Math.ceil(clientesFiltrados.length / porPagina));
  const paginaAtual = Math.min(pagina, totalPaginas);
  const clientesPagina = useMemo(
    () =>
      clientesFiltrados.slice((paginaAtual - 1) * porPagina, paginaAtual * porPagina),
    [clientesFiltrados, paginaAtual, porPagina],
  );

  async function handleExportar() {
    setExportando(true);
    try {
      // Exporta o que esta filtrado (busca + parceiro). Mara escolhe o
      // recorte antes de baixar.
      const idsAlvo = new Set(clientesFiltrados.map((c) => c.id));
      await exportarClientesExcel(idsAlvo);
      toast.success(clientesFiltrados.length + " cliente(s) exportado(s)");
    } catch (err) {
      console.error(err);
      const errObj = err as { message?: string };
      toast.error(errObj.message || "Erro ao exportar");
    } finally {
      setExportando(false);
    }
  }

  function abrirCaso(id: string, tab?: string) {
    navigate({
      to: "/casos/$id",
      params: { id },
      search: tab ? { tab } : undefined,
    });
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="font-serif text-3xl font-semibold tracking-tight flex items-center gap-2">
            <UserCircle className="h-7 w-7 text-[var(--gold)]" />
            Clientes
          </h1>
          <p className="text-sm text-muted-foreground">
            Lista de todos os clientes com seus casos. Busque por nome, CPF ou número de processo.
          </p>
        </div>
        {usuario?.tipo === "interno" && (
          <div className="flex items-center gap-2 flex-wrap">
            <Button
              variant="outline"
              size="sm"
              onClick={handleExportar}
              disabled={exportando || clientesFiltrados.length === 0}
              title="Baixa um Excel com os clientes filtrados"
            >
              {exportando ? (
                <Loader2 className="h-4 w-4 mr-1 animate-spin" />
              ) : (
                <FileDown className="h-4 w-4 mr-1" />
              )}
              Exportar Excel
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setImportarDialogAberto(true)}
              title="Importa clientes de um Excel"
            >
              <Upload className="h-4 w-4 mr-1" />
              Importar Excel
            </Button>
            <ImportarTiDialog onImported={loadData} />
          </div>
        )}
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
              Filtra por nome (parcial), CPF (só dígitos), número de processo (admin ou judicial)
              ou etiqueta. Combine os filtros abaixo pra montar o recorte — o Exportar Excel baixa
              exatamente o que estiver filtrado.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                value={busca}
                onChange={(e) => setBusca(e.target.value)}
                placeholder="Ex: João, 123.456.789-00, 0001234-56.2024.4.03.6100"
                className="pl-9"
              />
            </div>
            <div className="flex items-center gap-x-4 gap-y-2 flex-wrap">
              {/* Filtro por parceiro - so faz sentido pra interno (parceiro
                ja so ve os clientes dele via RLS). */}
              {isInterno && (
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground shrink-0">Parceiro:</span>
                  <Select
                    value={parceiroFiltro || "__todos__"}
                    onValueChange={(v) => setParceiroFiltro(v === "__todos__" ? "" : v)}
                  >
                    <SelectTrigger className="w-auto min-w-[160px] h-8 text-sm">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__todos__">Todos</SelectItem>
                      <SelectItem value="__interno__">Sem parceiro (interno)</SelectItem>
                      {parceirosDisponiveis.map((nome) => (
                        <SelectItem key={nome} value={nome}>
                          {nome}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}

              {/* Filtro por etiqueta: combobox com busca (sao 100+ etiquetas) */}
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground shrink-0">Etiqueta:</span>
                <Popover open={etiquetaPopOpen} onOpenChange={setEtiquetaPopOpen}>
                  <PopoverTrigger asChild>
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-8 min-w-[180px] justify-between font-normal text-sm"
                    >
                      {etiquetaSelecionada ? (
                        <span className="flex items-center gap-1.5 min-w-0">
                          <span
                            className="h-2.5 w-2.5 rounded-full shrink-0"
                            style={{ backgroundColor: etiquetaSelecionada.cor }}
                          />
                          <span className="truncate">{etiquetaSelecionada.nome}</span>
                        </span>
                      ) : (
                        <span className="text-muted-foreground flex items-center gap-1.5">
                          <Tag className="h-3.5 w-3.5" />
                          Todas
                        </span>
                      )}
                      <ChevronsUpDown className="h-3.5 w-3.5 shrink-0 opacity-50" />
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-[280px] p-0" align="start">
                    <Command>
                      <CommandInput placeholder="Buscar etiqueta..." />
                      <CommandList>
                        <CommandEmpty>Nenhuma etiqueta encontrada.</CommandEmpty>
                        <CommandGroup>
                          <CommandItem
                            value="__todas__"
                            onSelect={() => {
                              setEtiquetaFiltro("");
                              setEtiquetaPopOpen(false);
                            }}
                          >
                            <Check
                              className={
                                "mr-2 h-3.5 w-3.5 " +
                                (etiquetaFiltro ? "opacity-0" : "opacity-100")
                              }
                            />
                            Todas
                          </CommandItem>
                          {etiquetasDisponiveis.map((e) => (
                            <CommandItem
                              key={e.id}
                              value={e.nome}
                              onSelect={() => {
                                setEtiquetaFiltro(e.id === etiquetaFiltro ? "" : e.id);
                                setEtiquetaPopOpen(false);
                              }}
                            >
                              <Check
                                className={
                                  "mr-2 h-3.5 w-3.5 " +
                                  (etiquetaFiltro === e.id ? "opacity-100" : "opacity-0")
                                }
                              />
                              <span
                                className="mr-1.5 h-2.5 w-2.5 rounded-full shrink-0"
                                style={{ backgroundColor: e.cor }}
                              />
                              <span className="truncate">{e.nome}</span>
                              <span className="ml-auto text-xs text-muted-foreground tabular-nums">
                                {e.qtd}
                              </span>
                            </CommandItem>
                          ))}
                        </CommandGroup>
                      </CommandList>
                    </Command>
                  </PopoverContent>
                </Popover>
              </div>

              {/* Filtro por status (algum caso do cliente nesse status) */}
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground shrink-0">Status:</span>
                <Select
                  value={statusFiltro || "__todos__"}
                  onValueChange={(v) => setStatusFiltro(v === "__todos__" ? "" : v)}
                >
                  <SelectTrigger className="w-auto min-w-[150px] h-8 text-sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__todos__">Todos</SelectItem>
                    {Object.entries(STATUS_VARIANT).map(([valor, cfg]) => (
                      <SelectItem key={valor} value={valor}>
                        {cfg.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {(parceiroFiltro || etiquetaFiltro || statusFiltro) && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setParceiroFiltro("");
                    setEtiquetaFiltro("");
                    setStatusFiltro("");
                  }}
                  className="h-8 px-2 text-xs"
                >
                  Limpar filtros
                </Button>
              )}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              {loading
                ? "Carregando..."
                : clientesFiltrados.length +
                  " cliente" +
                  (clientesFiltrados.length === 1 ? "" : "s") +
                  (temFiltroAtivo ? " (filtrado de " + clientes.length + ")" : "")}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="flex h-32 items-center justify-center">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            ) : clientesFiltrados.length === 0 ? (
              <p className="text-sm text-muted-foreground py-8 text-center">
                {temFiltroAtivo
                  ? "Nenhum cliente encontrado para esses filtros."
                  : "Nenhum cliente cadastrado ainda."}
              </p>
            ) : (
              <>
                {/* Mobile: lista em cards (tabela nao cabe em tela estreita) */}
                <div className="md:hidden space-y-3">
                  {clientesPagina.map((c) => {
                    const totalCasos = c.casos.length;
                    const casoMaisRecente = c.casos[0];
                    const numerosProcesso = c.casos.flatMap((ca) => ca.numerosProcesso);
                    return (
                      <button
                        key={c.id}
                        type="button"
                        onClick={() => casoMaisRecente && abrirCaso(casoMaisRecente.id)}
                        className="w-full text-left rounded-lg border border-border bg-card p-3 space-y-2 active:bg-muted/40"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="font-medium text-sm">{c.nome}</span>
                              {totalCasos > 1 && (
                                <Badge variant="outline" className="text-[10px] tabular-nums">
                                  {totalCasos} casos
                                </Badge>
                              )}
                            </div>
                            <div className="text-xs text-muted-foreground tabular-nums mt-0.5">
                              {formatCPF(c.cpf)}
                            </div>
                          </div>
                          <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0 mt-1" />
                        </div>
                        <div className="flex flex-wrap items-center gap-1.5">
                          {casoMaisRecente && <StatusBadge status={casoMaisRecente.status} />}
                          {c.casos.map((ca) => (
                            <span
                              key={ca.id}
                              role="link"
                              tabIndex={0}
                              onClick={(e) => {
                                e.stopPropagation();
                                abrirCaso(ca.id, "andamentos");
                              }}
                              onKeyDown={(e) => {
                                if (e.key === "Enter" || e.key === " ") {
                                  e.preventDefault();
                                  e.stopPropagation();
                                  abrirCaso(ca.id, "andamentos");
                                }
                              }}
                              className="rounded border border-border bg-muted/40 px-1.5 py-0.5 text-[11px] text-muted-foreground"
                            >
                              {ca.tipo_beneficio ?? "(sem benefício)"}
                            </span>
                          ))}
                        </div>
                        {c.etiquetas.length > 0 && (
                          <div className="flex flex-wrap gap-1">
                            {c.etiquetas.slice(0, 3).map((e) => (
                              <span
                                key={e.id}
                                className="rounded-full border px-1.5 py-0.5 text-[10px] leading-none"
                                style={{
                                  backgroundColor: e.cor,
                                  borderColor: e.cor,
                                  color: "#1f2937",
                                }}
                              >
                                {e.nome}
                              </span>
                            ))}
                            {c.etiquetas.length > 3 && (
                              <span className="text-[10px] text-muted-foreground">
                                +{c.etiquetas.length - 3}
                              </span>
                            )}
                          </div>
                        )}
                        {numerosProcesso.length > 0 && (
                          <div className="text-[11px] font-mono tabular-nums text-muted-foreground">
                            {numerosProcesso.slice(0, 2).join(" · ")}
                            {numerosProcesso.length > 2 && " +" + (numerosProcesso.length - 2)}
                          </div>
                        )}
                      </button>
                    );
                  })}
                  <p className="text-xs text-muted-foreground">
                    Toque num cliente pra abrir o caso mais recente.
                  </p>
                </div>
                {/* Desktop: tabela completa */}
                <div className="hidden md:block overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Cliente</TableHead>
                        <TableHead>CPF</TableHead>
                        <TableHead>{isInterno ? "Parceiro" : "Casos"}</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Processos</TableHead>
                        <TableHead className="w-8"></TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {clientesPagina.map((c) => {
                        const totalCasos = c.casos.length;
                        const casoMaisRecente = c.casos[0]; // ja ordenado
                        const totalProcessos = c.casos.reduce(
                          (acc, ca) => acc + ca.numerosProcesso.length,
                          0,
                        );
                        const parceirosNomes = Array.from(
                          new Set(
                            c.casos.map((ca) => ca.parceiroNome).filter((n): n is string => !!n),
                          ),
                        );
                        return (
                          <TableRow
                            key={c.id}
                            className="cursor-pointer hover:bg-muted/40"
                            onClick={() => casoMaisRecente && abrirCaso(casoMaisRecente.id)}
                          >
                            <TableCell className="font-medium">
                              <div className="flex items-center gap-2">
                                <span>{c.nome}</span>
                                {totalCasos > 1 && (
                                  <Badge variant="outline" className="text-[10px] tabular-nums">
                                    {totalCasos} casos
                                  </Badge>
                                )}
                              </div>
                              {/* Um chip por caso (beneficio). Clicar abre aquele
                                caso especifico — assim cliente com varios casos
                                nao esconde nenhum. */}
                              <div className="mt-1 flex flex-wrap gap-1">
                                {c.casos.map((ca) => (
                                  <button
                                    key={ca.id}
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      abrirCaso(ca.id, "andamentos");
                                    }}
                                    className="rounded border border-border bg-muted/40 px-1.5 py-0.5 text-[11px] font-normal text-muted-foreground hover:bg-muted hover:text-foreground"
                                    title={
                                      "Abrir caso: " + (ca.tipo_beneficio ?? "(sem beneficio)")
                                    }
                                  >
                                    {ca.tipo_beneficio ?? "(sem benefício)"}
                                  </button>
                                ))}
                              </div>
                              {c.etiquetas.length > 0 && (
                                <div className="mt-1 flex flex-wrap gap-1">
                                  {c.etiquetas.slice(0, 4).map((e) => (
                                    <span
                                      key={e.id}
                                      className="rounded-full border px-1.5 py-0.5 text-[10px] leading-none"
                                      style={{
                                        backgroundColor: e.cor,
                                        borderColor: e.cor,
                                        color: "#1f2937",
                                      }}
                                      title={"Etiqueta: " + e.nome}
                                    >
                                      {e.nome}
                                    </span>
                                  ))}
                                  {c.etiquetas.length > 4 && (
                                    <span className="text-[10px] text-muted-foreground">
                                      +{c.etiquetas.length - 4}
                                    </span>
                                  )}
                                </div>
                              )}
                            </TableCell>
                            <TableCell className="tabular-nums text-sm">
                              {formatCPF(c.cpf)}
                            </TableCell>
                            <TableCell>
                              {isInterno ? (
                                parceirosNomes.length > 0 ? (
                                  <span className="text-sm">{parceirosNomes.join(", ")}</span>
                                ) : (
                                  <span className="text-xs text-muted-foreground">Interno</span>
                                )
                              ) : (
                                <Badge variant="outline" className="tabular-nums">
                                  {totalCasos}
                                </Badge>
                              )}
                            </TableCell>
                            <TableCell>
                              {casoMaisRecente && <StatusBadge status={casoMaisRecente.status} />}
                            </TableCell>
                            <TableCell className="text-xs text-muted-foreground">
                              {totalProcessos > 0 ? (
                                <div className="space-y-0.5">
                                  {c.casos
                                    .flatMap((ca) => ca.numerosProcesso)
                                    .slice(0, 2)
                                    .map((n, i) => (
                                      <div key={i} className="font-mono tabular-nums">
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
                              <div className="flex items-center gap-1 justify-end">
                                {isInterno && casoMaisRecente && (
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    className="h-7 px-2 text-xs"
                                    title={`Agendar perícia para ${c.nome}`}
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setTarefaSheet({
                                        kind: "criar",
                                        casoIdInicial: casoMaisRecente.id,
                                        templateInicial: "pericia_parceiro",
                                      });
                                    }}
                                  >
                                    <CalendarPlus className="h-3.5 w-3.5" />
                                    <span className="hidden sm:inline ml-1">Perícia</span>
                                  </Button>
                                )}
                                <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
                              </div>
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

                {/* Paginacao (compartilhada mobile/desktop) */}
                <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-3">
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <span className="shrink-0">Por página:</span>
                    <Select
                      value={String(porPagina)}
                      onValueChange={(v) => setPorPagina(Number(v))}
                    >
                      <SelectTrigger className="h-7 w-[72px] text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {[10, 50, 100].map((n) => (
                          <SelectItem key={n} value={String(n)}>
                            {n}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <span className="tabular-nums">
                      {(paginaAtual - 1) * porPagina + 1}–
                      {Math.min(paginaAtual * porPagina, clientesFiltrados.length)} de{" "}
                      {clientesFiltrados.length}
                    </span>
                  </div>
                  <div className="flex items-center gap-1">
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 px-2 text-xs"
                      disabled={paginaAtual <= 1}
                      onClick={() => setPagina(paginaAtual - 1)}
                    >
                      <ChevronLeft className="h-3.5 w-3.5 mr-0.5" />
                      Anterior
                    </Button>
                    <span className="px-2 text-xs tabular-nums text-muted-foreground">
                      {paginaAtual} / {totalPaginas}
                    </span>
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 px-2 text-xs"
                      disabled={paginaAtual >= totalPaginas}
                      onClick={() => setPagina(paginaAtual + 1)}
                    >
                      Próxima
                      <ChevronRight className="h-3.5 w-3.5 ml-0.5" />
                    </Button>
                  </div>
                </div>
              </>
            )}
          </CardContent>
        </Card>
      </ClientOnly>

      <TarefaSheet
        modo={tarefaSheet}
        onClose={() => setTarefaSheet(null)}
        onSaved={() => {
          /* tarefas + perícia (agenda) criadas; aparecem em /agenda e /tarefas */
        }}
      />

      <ImportarClientesExcelDialog
        aberto={importarDialogAberto}
        onFechar={() => setImportarDialogAberto(false)}
        onImported={loadData}
      />
    </div>
  );
}

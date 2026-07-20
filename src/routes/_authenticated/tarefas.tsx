// Página /tarefas — kanban com 4 colunas (a fazer / fazendo / feito / cancelado),
// filtros (responsável, tipo, prioridade, busca), e atalho "minhas".
// Click em card abre Sheet de edição. Botão "Nova tarefa" abre Sheet vazia.

import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { ListTodo, Loader2, Plus, Search, X } from "lucide-react";

import { cn } from "@/lib/utils";
import {
  formatarDueAtCurto,
  URGENCIA_BADGE_CLASS,
  urgenciaDoDueAt,
} from "@/lib/tarefas/helpers";

import { useAuth } from "@/hooks/use-auth";
import { ClientOnly } from "@/components/client-only";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

import { TarefaCard } from "@/components/tarefas/tarefa-card";
import { TarefaSheet } from "@/components/tarefas/tarefa-sheet";
import {
  atualizarTarefa,
  excluirTarefa,
  listarInternosAtivos,
  listarTarefas,
} from "@/lib/tarefas/queries";
import {
  STATUS_LABEL,
  TIPO_LABEL,
  type TarefaComJoins,
  type TarefaStatus,
  type TarefaTipo,
} from "@/lib/tarefas/types";

export const Route = createFileRoute("/_authenticated/tarefas")({
  component: TarefasPage,
});

const TIPOS: TarefaTipo[] = ["interna", "prazo", "pericia", "pos_protocolo", "contato_cliente"];

// Default mostra só "A fazer" / "Fazendo". "Feito" e "Cancelado" ficam na
// aba "Arquivados", abre só quando a Naira pedir.
const STATUS_ATIVOS: TarefaStatus[] = ["a_fazer", "fazendo"];
const STATUS_ARQUIVADOS: TarefaStatus[] = ["feito", "cancelado"];

type Modo =
  | { kind: "criar"; casoIdInicial?: string | null }
  | { kind: "editar"; tarefa: TarefaComJoins };

function TarefasPage() {
  const { usuario } = useAuth();
  const [carregando, setCarregando] = useState(true);
  const [tarefas, setTarefas] = useState<TarefaComJoins[]>([]);
  const [internos, setInternos] = useState<Array<{ id: string; nome: string | null }>>([]);

  // Filtros
  const [busca, setBusca] = useState("");
  const [filtroResp, setFiltroResp] = useState<string>("todos");
  const [filtroTipo, setFiltroTipo] = useState<TarefaTipo | "todos">("todos");
  const [filtroPri, setFiltroPri] = useState<string>("todos");
  const [somenteMinhas, setSomenteMinhas] = useState(false);

  const [sheetModo, setSheetModo] = useState<Modo | null>(null);
  const [aba, setAba] = useState<"ativos" | "arquivados">("ativos");

  const carregar = useCallback(async () => {
    setCarregando(true);
    try {
      const data = await listarTarefas({});
      setTarefas(data);
    } catch (e) {
      console.error(e);
      toast.error("Falha ao carregar tarefas.");
    } finally {
      setCarregando(false);
    }
  }, []);

  useEffect(() => {
    carregar();
    listarInternosAtivos().then(setInternos).catch(() => {});
  }, [carregar]);

  const filtradas = useMemo(() => {
    return tarefas.filter((t) => {
      if (somenteMinhas && t.responsavel_id !== usuario?.id) return false;
      if (filtroResp !== "todos") {
        if (filtroResp === "sem") {
          if (t.responsavel_id !== null) return false;
        } else if (t.responsavel_id !== filtroResp) return false;
      }
      if (filtroTipo !== "todos" && t.tipo !== filtroTipo) return false;
      if (filtroPri !== "todos" && t.prioridade !== Number(filtroPri)) return false;
      if (busca.trim()) {
        const q = busca.trim().toLowerCase();
        const hayTitulo = t.titulo.toLowerCase().includes(q);
        const hayDesc = (t.descricao ?? "").toLowerCase().includes(q);
        const hayCliente = (t.caso?.cliente?.nome ?? "").toLowerCase().includes(q);
        if (!hayTitulo && !hayDesc && !hayCliente) return false;
      }
      return true;
    });
  }, [tarefas, busca, filtroResp, filtroTipo, filtroPri, somenteMinhas, usuario?.id]);

  const porStatus = useMemo(() => {
    const m: Record<TarefaStatus, TarefaComJoins[]> = {
      a_fazer: [],
      fazendo: [],
      feito: [],
      cancelado: [],
    };
    for (const t of filtradas) m[t.status].push(t);
    return m;
  }, [filtradas]);

  // "Meu dia": tarefas ativas MINHAS com prazo hoje ou atrasado. Independente
  // dos filtros — é o "o que eu tenho pra fazer agora" fixo no topo.
  const meuDia = useMemo(() => {
    if (!usuario?.id) return [];
    return tarefas.filter((t) => {
      if (t.responsavel_id !== usuario.id) return false;
      if (t.status !== "a_fazer" && t.status !== "fazendo") return false;
      const urg = urgenciaDoDueAt(t.due_at, t.status);
      return urg === "atrasado" || urg === "hoje";
    });
  }, [tarefas, usuario?.id]);
  const meuDiaAtrasadas = meuDia.filter(
    (t) => urgenciaDoDueAt(t.due_at, t.status) === "atrasado",
  ).length;
  const [meuDiaExpandido, setMeuDiaExpandido] = useState(false);
  const MEU_DIA_LIMITE = 6;

  // Resumo por pessoa (tarefas ativas): visão da equipe num relance.
  // Clicar num chip filtra o kanban pela pessoa.
  const resumoPorPessoa = useMemo(() => {
    const mapa = new Map<
      string,
      { id: string; nome: string; total: number; atrasadas: number }
    >();
    for (const t of tarefas) {
      if (t.status !== "a_fazer" && t.status !== "fazendo") continue;
      const id = t.responsavel_id ?? "sem";
      const nome = t.responsavel?.nome ?? "Sem responsável";
      const e = mapa.get(id) ?? { id, nome, total: 0, atrasadas: 0 };
      e.total += 1;
      if (urgenciaDoDueAt(t.due_at, t.status) === "atrasado") e.atrasadas += 1;
      mapa.set(id, e);
    }
    return Array.from(mapa.values()).sort((a, b) => {
      // Eu primeiro, depois por volume
      if (a.id === usuario?.id) return -1;
      if (b.id === usuario?.id) return 1;
      return b.total - a.total;
    });
  }, [tarefas, usuario?.id]);

  async function mudarStatus(id: string, status: TarefaStatus) {
    // Optimistic update
    const original = tarefas.find((t) => t.id === id);
    setTarefas((arr) => arr.map((t) => (t.id === id ? { ...t, status } : t)));
    try {
      await atualizarTarefa({ id, patch: { status } });
      toast.success(`Movida para ${STATUS_LABEL[status]}.`);
    } catch (e) {
      console.error(e);
      // Revert
      if (original) setTarefas((arr) => arr.map((t) => (t.id === id ? original : t)));
      toast.error("Falha ao mover.");
    }
  }

  async function excluir(id: string) {
    if (!window.confirm("Excluir esta tarefa?")) return;
    const snapshot = tarefas;
    setTarefas((arr) => arr.filter((t) => t.id !== id));
    try {
      await excluirTarefa(id);
      toast.success("Tarefa excluída.");
    } catch (e) {
      console.error(e);
      setTarefas(snapshot);
      toast.error("Falha ao excluir.");
    }
  }

  function abrirEditor(id: string) {
    const t = tarefas.find((x) => x.id === id);
    if (t) setSheetModo({ kind: "editar", tarefa: t });
  }

  const limparFiltros = () => {
    setBusca("");
    setFiltroResp("todos");
    setFiltroTipo("todos");
    setFiltroPri("todos");
    setSomenteMinhas(false);
  };

  return (
    <ClientOnly>
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="font-serif text-3xl font-semibold tracking-tight">
              Tarefas
            </h1>
            <p className="text-sm text-muted-foreground">
              Kanban do escritório. Clique numa tarefa pra editar; menu (⋮) muda status.
            </p>
          </div>
          <Button onClick={() => setSheetModo({ kind: "criar" })}>
            <Plus className="h-4 w-4" />
            Nova tarefa
          </Button>
        </div>

        {/* Meu dia: minhas tarefas de hoje + atrasadas, fixas no topo,
          independentes dos filtros do kanban. */}
        {!carregando && meuDia.length > 0 && (
          <div className="rounded-md border border-[var(--gold)]/40 bg-card">
            <div className="px-3 py-2 border-b flex items-center gap-2">
              <ListTodo className="h-4 w-4 text-[var(--gold)]" />
              <span className="font-medium text-sm">Meu dia</span>
              <Badge variant="outline" className="font-normal">
                {meuDia.length}
              </Badge>
              {meuDiaAtrasadas > 0 && (
                <span className="text-xs text-destructive">
                  {meuDiaAtrasadas} atrasada{meuDiaAtrasadas === 1 ? "" : "s"}
                </span>
              )}
            </div>
            <ul className="divide-y">
              {(meuDiaExpandido ? meuDia : meuDia.slice(0, MEU_DIA_LIMITE)).map((t) => {
                const urg = urgenciaDoDueAt(t.due_at, t.status);
                return (
                  <li key={t.id}>
                    <button
                      type="button"
                      onClick={() => abrirEditor(t.id)}
                      className="w-full flex items-center gap-2 px-3 py-1.5 text-left hover:bg-muted/40 min-w-0"
                    >
                      <Badge
                        variant="outline"
                        className={cn(
                          "font-normal px-1.5 py-0 text-[11px] shrink-0",
                          URGENCIA_BADGE_CLASS[urg],
                        )}
                      >
                        {formatarDueAtCurto(t.due_at)}
                      </Badge>
                      <span className="text-sm truncate flex-1 min-w-0">{t.titulo}</span>
                      {t.caso?.cliente?.nome && (
                        <span className="text-xs text-muted-foreground truncate max-w-[30%] shrink-0">
                          {t.caso.cliente.nome}
                        </span>
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
            {meuDia.length > MEU_DIA_LIMITE && (
              <button
                type="button"
                onClick={() => setMeuDiaExpandido((v) => !v)}
                className="w-full px-3 py-1.5 text-xs text-muted-foreground hover:bg-muted/40 border-t text-center"
              >
                {meuDiaExpandido
                  ? "Mostrar menos"
                  : `Mostrar mais ${meuDia.length - MEU_DIA_LIMITE}`}
              </button>
            )}
          </div>
        )}

        {/* Filtros */}
        <div className="flex flex-wrap items-center gap-2 rounded-md border p-3 bg-card">
          <div className="relative flex-1 min-w-48">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Buscar título, descrição, cliente..."
              className="pl-8"
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
            />
          </div>

          <Button
            variant={somenteMinhas ? "default" : "outline"}
            size="sm"
            onClick={() => setSomenteMinhas((v) => !v)}
            disabled={!usuario?.id}
          >
            Só minhas
          </Button>

          <Select value={filtroResp} onValueChange={setFiltroResp}>
            <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="todos">Todos responsáveis</SelectItem>
              <SelectItem value="sem">Sem responsável</SelectItem>
              {internos.map((u) => (
                <SelectItem key={u.id} value={u.id}>
                  {u.nome ?? "(sem nome)"}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={filtroTipo} onValueChange={(v) => setFiltroTipo(v as TarefaTipo | "todos")}>
            <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="todos">Todos tipos</SelectItem>
              {TIPOS.map((t) => (
                <SelectItem key={t} value={t}>{TIPO_LABEL[t]}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={filtroPri} onValueChange={setFiltroPri}>
            <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="todos">Toda prioridade</SelectItem>
              <SelectItem value="1">Urgente</SelectItem>
              <SelectItem value="2">Alta</SelectItem>
              <SelectItem value="3">Normal</SelectItem>
              <SelectItem value="4">Baixa</SelectItem>
            </SelectContent>
          </Select>

          {(busca || filtroResp !== "todos" || filtroTipo !== "todos" || filtroPri !== "todos" || somenteMinhas) && (
            <Button variant="ghost" size="sm" onClick={limparFiltros}>
              <X className="h-4 w-4" />
              Limpar
            </Button>
          )}

          {/* Visão da equipe num relance: um chip por pessoa com total de
            tarefas ativas (e atrasadas em vermelho). Clicar filtra o kanban. */}
          {resumoPorPessoa.length > 0 && (
            <div className="w-full flex items-center gap-1.5 flex-wrap pt-1 border-t mt-1">
              <span className="text-xs text-muted-foreground shrink-0">Equipe:</span>
              {resumoPorPessoa.map((p) => {
                const ativo = filtroResp === p.id;
                const primeiroNome =
                  p.id === usuario?.id ? "Eu" : p.nome.split(/\s+/)[0];
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => setFiltroResp(ativo ? "todos" : p.id)}
                    className={cn(
                      "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs transition-colors",
                      ativo
                        ? "bg-foreground text-background border-foreground"
                        : "bg-card hover:bg-muted/60",
                    )}
                    title={p.nome + " — " + p.total + " tarefa(s) ativa(s)"}
                  >
                    <span className="font-medium">{primeiroNome}</span>
                    <span className={cn("tabular-nums", !ativo && "text-muted-foreground")}>
                      {p.total}
                    </span>
                    {p.atrasadas > 0 && (
                      <span
                        className={cn(
                          "tabular-nums",
                          ativo ? "text-background/80" : "text-destructive",
                        )}
                      >
                        · {p.atrasadas} atras.
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Tabs Ativos / Arquivados */}
        <Tabs value={aba} onValueChange={(v) => setAba(v as "ativos" | "arquivados")}>
          <TabsList>
            <TabsTrigger value="ativos">
              Ativos
              <Badge variant="outline" className="ml-2 font-normal">
                {STATUS_ATIVOS.reduce((acc, s) => acc + porStatus[s].length, 0)}
              </Badge>
            </TabsTrigger>
            <TabsTrigger value="arquivados">
              Arquivados
              <Badge variant="outline" className="ml-2 font-normal">
                {STATUS_ARQUIVADOS.reduce((acc, s) => acc + porStatus[s].length, 0)}
              </Badge>
            </TabsTrigger>
          </TabsList>
        </Tabs>

        {/* Kanban */}
        {carregando ? (
          <div className="flex items-center justify-center h-64">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {(aba === "ativos" ? STATUS_ATIVOS : STATUS_ARQUIVADOS).map((s) => {
              const lista = porStatus[s];
              return (
                <div key={s} className="rounded-md bg-muted/40 border min-h-[60vh] flex flex-col">
                  <div className="px-3 py-2 border-b bg-background/60 flex items-center justify-between sticky top-0 z-10 rounded-t-md">
                    <div className="font-medium text-sm">{STATUS_LABEL[s]}</div>
                    <Badge variant="outline" className="font-normal">
                      {lista.length}
                    </Badge>
                  </div>
                  <div className="p-2 space-y-2 flex-1">
                    {lista.length === 0 ? (
                      <div className="text-xs text-muted-foreground text-center py-6">
                        — vazio —
                      </div>
                    ) : (
                      lista.map((t) => (
                        <TarefaCard
                          key={t.id}
                          tarefa={t}
                          compacto
                          onOpenSheet={abrirEditor}
                          onChangeStatus={mudarStatus}
                          onDelete={excluir}
                          onChanged={carregar}
                        />
                      ))
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        <TarefaSheet
          modo={sheetModo}
          onClose={() => setSheetModo(null)}
          onSaved={carregar}
        />
      </div>
    </ClientOnly>
  );
}

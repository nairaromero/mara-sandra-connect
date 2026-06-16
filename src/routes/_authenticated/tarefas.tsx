// Página /tarefas — kanban com 4 colunas (a fazer / fazendo / feito / cancelado),
// filtros (responsável, tipo, prioridade, busca), e atalho "minhas".
// Click em card abre Sheet de edição. Botão "Nova tarefa" abre Sheet vazia.

import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Loader2, Plus, Search, X } from "lucide-react";

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
              Kanban do escritório. Click em uma tarefa pra editar; menu (⋮) muda status.
            </p>
          </div>
          <Button onClick={() => setSheetModo({ kind: "criar" })}>
            <Plus className="h-4 w-4" />
            Nova tarefa
          </Button>
        </div>

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

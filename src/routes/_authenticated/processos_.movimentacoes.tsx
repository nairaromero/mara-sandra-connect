// Página /processos/movimentacoes — feed diário das movimentações processuais
// (andamentos origem='datajud'), agrupado por dia, estilo "Movimentações
// judiciais" do Tramitação Inteligente. Fase 2 do planning/PROCESSOS_GLOBAL.md.
//
// O botão "Buscar agora" invoca a edge sync-datajud-movimentacoes (janela de
// 7 dias) — mesmo trabalho do cron diário, sob demanda.

import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowLeft, History, Loader2, RefreshCw, Search, Sparkles } from "lucide-react";
import { toast } from "sonner";

import { useAuth } from "@/hooks/use-auth";
import { supabase } from "@/lib/supabase";
import { ClientOnly } from "@/components/client-only";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

export const Route = createFileRoute("/_authenticated/processos_/movimentacoes")({
  component: MovimentacoesPage,
});

const DIAS_JANELA = 30;

interface MovRow {
  id: string;
  titulo: string | null;
  descricao: string | null;
  data: string | null; // data_evento
  casoId: string;
  cliente: string;
  numero: string | null;
  tribunal: string | null;
  iaResumo: string | null;
  iaRelevancia: string | null; // rotina | atencao | urgente
}

const RELEVANCIA_BADGE: Record<string, { label: string; cls: string }> = {
  urgente: { label: "Urgente", cls: "bg-destructive text-destructive-foreground" },
  atencao: { label: "Atenção", cls: "bg-amber-500 text-white" },
};

function chaveDia(iso: string | null): string {
  if (!iso) return "";
  return iso.slice(0, 10);
}

function labelDia(dia: string): string {
  const hoje = new Date();
  const fmt = (d: Date) => d.toISOString().slice(0, 10);
  const ontem = new Date(hoje.getTime() - 86400000);
  const data = new Date(dia + "T00:00:00");
  const ddmm = data.toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
  const semana = data.toLocaleDateString("pt-BR", { weekday: "long" });
  let sufixo = "";
  if (dia === fmt(hoje)) sufixo = " · hoje";
  else if (dia === fmt(ontem)) sufixo = " · ontem";
  return `${ddmm} — ${semana}${sufixo}`;
}

function hora(iso: string | null): string {
  if (!iso || iso.length <= 10) return "";
  return new Date(iso).toLocaleTimeString("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function MovimentacoesPage() {
  const { usuario } = useAuth();
  const isInterno = usuario?.tipo === "interno";
  const navigate = useNavigate();

  const [carregando, setCarregando] = useState(true);
  const [movs, setMovs] = useState<MovRow[]>([]);
  const [busca, setBusca] = useState("");
  const [sincronizando, setSincronizando] = useState(false);
  const [analisando, setAnalisando] = useState(false);

  useEffect(() => {
    if (usuario && !isInterno) navigate({ to: "/casos" });
  }, [usuario, isInterno, navigate]);

  const carregar = useCallback(async () => {
    setCarregando(true);
    try {
      const desde = new Date(Date.now() - DIAS_JANELA * 86400000).toISOString().slice(0, 10);
      const { data, error } = await supabase
        .from("andamentos")
        .select(
          "id, titulo, descricao, data_evento, caso_id, metadata, casos:caso_id(clientes(nome))",
        )
        .eq("origem", "datajud")
        .gte("data_evento", desde)
        .order("data_evento", { ascending: false })
        .limit(1000);
      if (error) throw error;
      setMovs(
        ((data || []) as Array<Record<string, unknown>>).map((r) => {
          const m = (r.metadata as Record<string, unknown> | null) || {};
          return {
            id: String(r.id),
            titulo: (r.titulo as string | null) ?? null,
            descricao: (r.descricao as string | null) ?? null,
            data: (r.data_evento as string | null) ?? null,
            casoId: String(r.caso_id),
            cliente:
              (r.casos as { clientes?: { nome?: string | null } } | null)?.clientes?.nome ??
              "Cliente",
            numero: (m.numero_processo as string | null) ?? null,
            tribunal: (m.tribunal as string | null) ?? null,
            iaResumo: (m.ia_resumo as string | null) ?? null,
            iaRelevancia: (m.ia_relevancia as string | null) ?? null,
          };
        }),
      );
    } catch (err) {
      console.error(err);
      toast.error("Falha ao carregar as movimentações.");
    } finally {
      setCarregando(false);
    }
  }, []);

  useEffect(() => {
    if (isInterno) carregar();
  }, [isInterno, carregar]);

  async function sincronizar() {
    setSincronizando(true);
    toast.info("Buscando movimentações no DataJud… pode levar um minuto.");
    try {
      const { data, error } = await supabase.functions.invoke("sync-datajud-movimentacoes", {
        body: { dias: 7 },
        headers: { "x-region": "sa-east-1" },
      });
      if (error) throw error;
      const r = (data || {}) as {
        andamentos_criados?: number;
        processos_consultados?: number;
        erros?: unknown[];
      };
      const novos = r.andamentos_criados ?? 0;
      toast.success(
        `${r.processos_consultados ?? 0} processos consultados · ${novos} movimentação${novos === 1 ? "" : "s"} nova${novos === 1 ? "" : "s"}.`,
      );
      if ((r.erros?.length ?? 0) > 0) {
        toast.warning(`${r.erros!.length} processos com erro na consulta.`);
      }
      await carregar();
    } catch (err) {
      console.error(err);
      toast.error("Falha ao sincronizar com o DataJud.");
    } finally {
      setSincronizando(false);
    }
  }

  async function analisarComIA() {
    setAnalisando(true);
    try {
      const { data, error } = await supabase.functions.invoke("ia-triagem-andamentos", {
        body: { limite: 40 },
      });
      if (error) throw error;
      const r = (data || {}) as {
        processados?: number;
        tarefas_criadas?: number;
        motivo?: string;
        error?: string;
        code?: string;
      };
      if (r.error) {
        toast.error(
          r.code === "nao_configurado"
            ? "Configure o assistente de IA em Configurações antes de analisar."
            : r.error,
        );
        return;
      }
      if ((r.processados ?? 0) === 0) {
        toast.info("Nenhuma movimentação nova pra analisar.");
        return;
      }
      const tarefas = r.tarefas_criadas ?? 0;
      toast.success(
        `${r.processados} movimentação${r.processados === 1 ? "" : "s"} analisada${r.processados === 1 ? "" : "s"} · ${tarefas} tarefa${tarefas === 1 ? "" : "s"} sugerida${tarefas === 1 ? "" : "s"}.`,
      );
      await carregar();
    } catch (err) {
      console.error(err);
      toast.error("Falha na análise com IA.");
    } finally {
      setAnalisando(false);
    }
  }

  const filtradas = useMemo(() => {
    const q = busca.trim().toLowerCase();
    if (!q) return movs;
    const dig = q.replace(/\D/g, "");
    return movs.filter((m) => {
      if (m.cliente.toLowerCase().includes(q)) return true;
      if ((m.titulo || "").toLowerCase().includes(q)) return true;
      if (dig.length >= 3 && (m.numero || "").replace(/\D/g, "").includes(dig)) {
        return true;
      }
      return (m.tribunal || "").toLowerCase().includes(q);
    });
  }, [movs, busca]);

  // Agrupamento por dia (a lista já vem ordenada desc).
  const grupos = useMemo(() => {
    const g: Array<{ dia: string; itens: MovRow[] }> = [];
    for (const m of filtradas) {
      const dia = chaveDia(m.data);
      const ultimo = g[g.length - 1];
      if (ultimo && ultimo.dia === dia) ultimo.itens.push(m);
      else g.push({ dia, itens: [m] });
    }
    return g;
  }, [filtradas]);

  if (!isInterno) return null;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-serif text-3xl font-semibold tracking-tight flex items-center gap-2">
            <History className="h-7 w-7 text-[var(--gold)]" />
            Movimentações
          </h1>
          <p className="text-sm text-muted-foreground">
            Movimentações processuais dos últimos {DIAS_JANELA} dias, coletadas automaticamente do
            DataJud/CNJ. Cada uma também aparece na timeline do caso.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" asChild>
            <Link to="/processos">
              <ArrowLeft className="mr-1.5 h-4 w-4" />
              Processos
            </Link>
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={analisarComIA}
            disabled={analisando}
            title="Resumo em linguagem simples + sugestão de tarefas para as movimentações novas"
          >
            {analisando ? (
              <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
            ) : (
              <Sparkles className="mr-1.5 h-4 w-4 text-[var(--gold)]" />
            )}
            Analisar com IA
          </Button>
          <Button size="sm" onClick={sincronizar} disabled={sincronizando}>
            {sincronizando ? (
              <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="mr-1.5 h-4 w-4" />
            )}
            Buscar agora
          </Button>
        </div>
      </div>

      <ClientOnly
        fallback={
          <div className="flex h-64 items-center justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        }
      >
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Filtrar por cliente, número, tribunal ou tipo de movimentação"
            className="pl-9"
          />
        </div>

        {carregando ? (
          <div className="flex h-40 items-center justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : grupos.length === 0 ? (
          <Card>
            <CardContent className="flex flex-col items-center justify-center gap-2 py-12 text-center">
              <History className="h-8 w-8 text-muted-foreground" />
              <p className="text-sm font-medium">Nenhuma movimentação</p>
              <p className="text-xs text-muted-foreground">
                Use "Buscar agora" pra consultar o DataJud, ou aguarde a coleta automática diária.
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-6">
            {grupos.map((grupo) => (
              <div key={grupo.dia} className="space-y-2">
                <h2 className="text-sm font-semibold capitalize text-muted-foreground">
                  {labelDia(grupo.dia)}
                </h2>
                {grupo.itens.map((m) => (
                  <Card key={m.id}>
                    <CardContent className="flex flex-wrap items-start justify-between gap-3 py-3">
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium">
                          {m.titulo || "Movimentação"}
                          {hora(m.data) && (
                            <span className="ml-2 text-xs font-normal text-muted-foreground">
                              {hora(m.data)}
                            </span>
                          )}
                        </p>
                        {m.descricao && (
                          <p className="mt-0.5 text-xs text-muted-foreground">{m.descricao}</p>
                        )}
                        {m.iaResumo && (
                          <p className="mt-1 flex items-start gap-1.5 text-xs">
                            <Sparkles className="mt-0.5 h-3 w-3 shrink-0 text-[var(--gold)]" />
                            <span className="italic text-foreground/80">
                              {m.iaResumo}
                              {m.iaRelevancia && RELEVANCIA_BADGE[m.iaRelevancia] && (
                                <Badge
                                  className={`ml-1.5 align-middle text-[10px] ${RELEVANCIA_BADGE[m.iaRelevancia].cls}`}
                                >
                                  {RELEVANCIA_BADGE[m.iaRelevancia].label}
                                </Badge>
                              )}
                            </span>
                          </p>
                        )}
                        <p className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                          <span className="font-medium text-foreground">{m.cliente}</span>
                          {m.numero && <span className="font-mono">{m.numero}</span>}
                          {m.tribunal && (
                            <Badge variant="outline" className="text-[10px]">
                              {m.tribunal}
                            </Badge>
                          )}
                        </p>
                      </div>
                      <Button size="sm" variant="outline" asChild>
                        <Link
                          to="/casos/$id"
                          params={{ id: m.casoId }}
                          search={{ tab: "andamentos", foco: m.id }}
                        >
                          Ver caso
                        </Link>
                      </Button>
                    </CardContent>
                  </Card>
                ))}
              </div>
            ))}
          </div>
        )}
      </ClientOnly>
    </div>
  );
}

import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { LifeBuoy, Loader2, ShieldCheck, ShieldAlert, RefreshCw } from "lucide-react";

import { useAuth } from "@/hooks/use-auth";
import { supabase } from "@/lib/supabase";
import { Paginador } from "@/components/paginador";
import { useListaPaginada, usePorPagina } from "@/hooks/use-lista-paginada";
import { ROTULO_TIPO_ATOR, rotuloAcao } from "@/lib/suporte/rotulos";
import { dataHoraBR, formatarBR } from "@/lib/fuso";
import { ClientOnly } from "@/components/client-only";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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

const POR_PAGINA_PADRAO = 25;

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
  return formatarBR(d, {
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
  const { usuario, isAdmin, pode } = useAuth();
  const navigate = useNavigate();
  // Só admin (Naira/Mara) entra aqui. Os demais internos nem veem o item
  // na sidebar; se caírem pela URL, levam aviso + redirect.
  // a trilha é de quem pode ler auditoria (auditoria:ler)
  const isInterno = isAdmin && pode("auditoria:ler");

  const [rows, setRows] = useState<AcessoRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [pagina, setPagina] = useState(1);
  const [porPagina, setPorPagina] = usePorPagina("auditoria", POR_PAGINA_PADRAO);
  const [total, setTotal] = useState<number | null>(null);
  const [carregandoPagina, setCarregandoPagina] = useState(false);
  const jaCarregouRef = useRef(false);
  // Totais por ação vêm do banco (count), não das linhas carregadas — senão
  // o card diria "100 leituras" só porque a primeira página tem 100.
  const [totaisBanco, setTotaisBanco] = useState<{ leitura: number; escrita: number; escrita_remocao: number } | null>(null);
  const [filtroCliente, setFiltroCliente] = useState("");
  const [filtroAcao, setFiltroAcao] = useState<string>("todas");
  const [filtroDias, setFiltroDias] = useState<string>("30");

  useEffect(() => {
    if (usuario && !isInterno) {
      toast.error("Acesso restrito a administradores.");
      navigate({ to: "/casos" });
    }
  }, [usuario, isInterno, navigate]);

  // Recorte comum (período + ação) da lista e das contagens.
  function desdeISO(): string | null {
    if (filtroDias === "todos") return null;
    const dias = Number(filtroDias);
    if (isNaN(dias)) return null;
    const desde = new Date();
    desde.setDate(desde.getDate() - dias);
    return desde.toISOString();
  }

  async function contar(acao: "leitura" | "escrita" | "escrita_remocao"): Promise<number> {
    let q = supabase.from("acessos_senha_inss").select("id", { count: "exact", head: true }).eq("acao", acao);
    const desde = desdeISO();
    if (desde) q = q.gte("acessado_em", desde);
    const { count, error } = await q;
    if (error) throw error;
    return count ?? 0;
  }

  async function load() {
    if (jaCarregouRef.current) setCarregandoPagina(true);
    else setLoading(true);
    try {
      // RLS na acessos_senha_inss já garante interno-only no SELECT.
      // O join com clientes/usuarios passa pelos próprios RLS deles.
      // Uma página por vez, da mais recente pra mais antiga, com o total.
      // Antes era `.limit(500)` sem aviso do que ficava fora.
      const inicio = (pagina - 1) * porPagina;
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
          { count: "exact" },
        )
        .order("acessado_em", { ascending: false })
        .order("id")
        .range(inicio, inicio + porPagina - 1);

      const desde = desdeISO();
      if (desde) query = query.gte("acessado_em", desde);
      if (filtroAcao !== "todas") query = query.eq("acao", filtroAcao);

      const [{ data, error, count }, leitura, escrita, escrita_remocao] = await Promise.all([
        query,
        filtroAcao === "todas" || filtroAcao === "leitura" ? contar("leitura") : Promise.resolve(0),
        filtroAcao === "todas" || filtroAcao === "escrita" ? contar("escrita") : Promise.resolve(0),
        filtroAcao === "todas" || filtroAcao === "escrita_remocao" ? contar("escrita_remocao") : Promise.resolve(0),
      ]);
      if (error) throw error;
      setRows((data as unknown as AcessoRow[]) ?? []);
      setTotal(count ?? null);
      setTotaisBanco({ leitura, escrita, escrita_remocao });
    } catch (err) {
      console.error(err);
      const msg = (err as { message?: string })?.message ?? "Falha ao carregar log de auditoria.";
      toast.error(msg);
    } finally {
      setLoading(false);
      setCarregandoPagina(false);
      jaCarregouRef.current = true;
    }
  }

  // filtro ou tamanho mudou -> pagina 1
  useEffect(() => {
    setPagina(1);
  }, [filtroAcao, filtroDias, porPagina]);

  useEffect(() => {
    if (isInterno) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isInterno, filtroAcao, filtroDias, pagina, porPagina]);

  // Filtro de cliente é client-side (pra evitar round-trip por digitação)
  const rowsFiltradas = useMemo(() => {
    if (!filtroCliente.trim()) return rows;
    const termo = filtroCliente.trim().toLowerCase();
    return rows.filter((r) => (r.cliente?.nome ?? "").toLowerCase().includes(termo));
  }, [rows, filtroCliente]);

  const totais = useMemo(() => {
    // Com filtro de cliente (client-side), conta o que está na tela; sem ele,
    // o total real do banco para o período/ação.
    if (!filtroCliente.trim() && totaisBanco) return totaisBanco;
    const t = { leitura: 0, escrita: 0, escrita_remocao: 0 };
    for (const r of rowsFiltradas) {
      if (r.acao === "leitura") t.leitura++;
      else if (r.acao === "escrita") t.escrita++;
      else if (r.acao === "escrita_remocao") t.escrita_remocao++;
    }
    return t;
  }, [rowsFiltradas, filtroCliente, totaisBanco]);

  if (!isInterno) {
    return (
      <div className="flex h-96 flex-col items-center justify-center gap-2 text-muted-foreground">
        <ShieldAlert className="h-8 w-8" />
        <p className="text-sm">Acesso restrito a administradores.</p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="font-serif text-3xl font-semibold tracking-tight flex items-center gap-2">
            <ShieldCheck className="h-7 w-7 text-[var(--gold)]" />
            Auditoria
          </h1>
          <p className="text-sm text-muted-foreground">
            Registro imutável de quem fez o quê neste escritório: acessos à senha do MEU INSS dos clientes
            (leitura, escrita ou remoção) e tudo que a plataforma ou uma sessão de suporte fez aqui.
            Obrigatório para conformidade LGPD.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => load()} disabled={loading}>
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
              <CardTitle className="text-3xl tabular-nums">{totais.leitura}</CardTitle>
            </CardHeader>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>Escritas</CardDescription>
              <CardTitle className="text-3xl tabular-nums">{totais.escrita}</CardTitle>
            </CardHeader>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>Remoções</CardDescription>
              <CardTitle className="text-3xl tabular-nums">{totais.escrita_remocao}</CardTitle>
            </CardHeader>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Filtros</CardTitle>
            <CardDescription>Refine o log por cliente, tipo de ação ou período.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid gap-4 sm:grid-cols-3">
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">Cliente</label>
                <Input
                  placeholder="Buscar por nome..."
                  value={filtroCliente}
                  onChange={(e) => setFiltroCliente(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">Ação</label>
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
                <label className="text-xs font-medium text-muted-foreground">Período</label>
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
              {rowsFiltradas.length} {rowsFiltradas.length === 1 ? "evento" : "eventos"}
              {filtroDias !== "todos"
                ? ` nos últimos ${filtroDias} dias`
                : " no histórico completo"}
              {filtroAcao !== "todas" ? ` · ação: ${acaoLabel(filtroAcao)}` : ""}.
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
              <>
                {/* Mobile: cards */}
                <div className="md:hidden space-y-3">
                  {rowsFiltradas.map((r) => (
                    <div
                      key={r.id}
                      className="rounded-lg border border-border bg-card p-3 space-y-1.5"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <span className="font-medium text-sm">{r.cliente?.nome ?? "—"}</span>
                        <span className="text-xs text-muted-foreground tabular-nums shrink-0">
                          {formatDataHora(r.acessado_em)}
                        </span>
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {r.usuario?.nome ?? "—"}
                        {r.usuario?.email ? " · " + r.usuario.email : ""}
                      </div>
                      <div className="flex items-center gap-1.5">
                        <TipoUsuarioBadge tipo={r.usuario?.tipo} />
                        <AcaoBadge acao={r.acao} />
                      </div>
                    </div>
                  ))}
                </div>
                {/* Desktop: tabela */}
                <div className="hidden md:block overflow-x-auto">
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
                          <TableCell className="font-medium">{r.cliente?.nome ?? "—"}</TableCell>
                          <TableCell>
                            <div className="flex flex-col">
                              <span className="text-sm">{r.usuario?.nome ?? "—"}</span>
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
              </>
            )}
          </CardContent>
        </Card>
        <Paginador
          pagina={pagina}
          porPagina={porPagina}
          total={total}
          carregando={carregandoPagina}
          onPagina={setPagina}
          onPorPagina={setPorPagina}
          nome="acessos"
        />

        <TrilhaPlataforma />
      </ClientOnly>
    </div>
  );
}

// O que a plataforma, o suporte e os administradores fizeram NESTE escritorio
// (tabela auditoria, via RPC que resolve o nome de quem fez). So metadado.
interface LinhaTrilha {
  id: number;
  quando: string;
  tipo_ator: string;
  ator_nome: string | null;
  acao: string;
  recurso: string | null;
  recurso_id: string | null;
  detalhes: Record<string, unknown>;
  total: number;
}

function TrilhaPlataforma() {
  const lista = useListaPaginada<LinhaTrilha>(
    (offset, limite) => supabase.rpc("auditoria_plataforma", { p_limite: limite, p_offset: offset }),
    "trilha",
    { porPagina: 25, persistencia: "auditoria-plataforma" },
  );
  return (
    <Card data-trilha-plataforma>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <LifeBuoy className="h-5 w-5 text-[var(--gold)]" />
          Plataforma e suporte neste escritório
        </CardTitle>
        <CardDescription>
          Cada pedido, aprovação e encerramento de acesso de suporte, cada tela que uma sessão de suporte abriu e
          cada ação da equipe da plataforma sobre o escritório. Nada disso acontece sem ficar aqui.
        </CardDescription>
      </CardHeader>
      <CardContent className="p-0">
        {lista.erro && <p className="px-6 py-4 text-sm text-red-700">Não consegui carregar a trilha: {lista.erro}</p>}
        {!lista.erro && !lista.carregando && lista.itens.length === 0 && (
          <p className="px-6 py-8 text-center text-sm text-muted-foreground">Nenhuma ação da plataforma registrada.</p>
        )}
        {lista.itens.length > 0 && (
          <ul className="divide-y">
            {lista.itens.map((l) => (
              <li key={l.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-6 py-3 text-sm">
                <span className="w-36 shrink-0 tabular-nums text-muted-foreground">{dataHoraBR(l.quando)}</span>
                <span className="min-w-0 flex-1">
                  <span className="font-medium">{l.ator_nome ?? ROTULO_TIPO_ATOR[l.tipo_ator] ?? l.tipo_ator}</span>
                  <span className="text-muted-foreground"> · {ROTULO_TIPO_ATOR[l.tipo_ator] ?? l.tipo_ator}</span>
                  <span className="block">
                    {rotuloAcao(l.acao)}
                    {l.acao === "suporte.abrir" && l.recurso ? (
                      <code className="ml-1 rounded bg-muted px-1 text-xs">{l.recurso}</code>
                    ) : null}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        )}
        <Paginador
          pagina={lista.pagina}
          porPagina={lista.porPagina}
          total={lista.total}
          temMais={lista.temMais}
          carregando={lista.carregando && lista.itens.length > 0}
          onPagina={lista.irPara}
          onPorPagina={lista.setPorPagina}
          nome="registros"
          className="border-t"
        />
      </CardContent>
    </Card>
  );
}

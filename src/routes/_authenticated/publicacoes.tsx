import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { CheckCircle2, Loader2, Newspaper, Search, AlertCircle } from "lucide-react";

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

export const Route = createFileRoute("/_authenticated/publicacoes")({
  component: PublicacoesPage,
});

// Marcador de "visto" (badge no sidebar) — por dispositivo.
const VISTO_KEY = "msc:publicacoes_visto";
// Janela da aba: publicações da última semana.
const DIAS_JANELA = 7;
const PREVIEW_CHARS = 600;

type PubStatus = "vinculada" | "sem_processo";

// Shape comum renderizado, vindo de publicacoes_dje (interno) ou andamentos (parceiro).
interface PubView {
  id: string;
  cliente_nome: string | null;
  numero_processo: string | null;
  tribunal: string | null;
  orgao: string | null;
  tipo: string | null;
  data: string | null;
  texto: string | null;
  status: PubStatus;
  caso_id: string | null;
  foco_id: string | null; // andamento p/ destacar na timeline do caso
}

function fmt(iso: string | null): string {
  if (!iso) return "-";
  const d = new Date(iso.length <= 10 ? iso + "T00:00:00" : iso);
  return d.toLocaleDateString("pt-BR");
}

function PublicacoesPage() {
  const { usuario } = useAuth();
  const isInterno = usuario?.tipo === "interno";
  const [pubs, setPubs] = useState<Array<PubView>>([]);
  const [loading, setLoading] = useState(true);
  const [busca, setBusca] = useState("");
  const [expandido, setExpandido] = useState<Record<string, boolean>>({});

  const carregar = useCallback(async () => {
    setLoading(true);

    if (isInterno) {
      // Interno: fonte da verdade = publicacoes_dje (vinculadas + órfãs), semana.
      const desde = new Date(Date.now() - DIAS_JANELA * 86400000)
        .toISOString()
        .slice(0, 10);
      const { data, error } = await supabase
        .from("publicacoes_dje")
        .select(
          "id, numero_processo, sigla_tribunal, nome_orgao, tipo_comunicacao, data_disponibilizacao, texto, status, caso_id, andamento_id, casos:caso_id(cliente:cliente_id(nome))",
        )
        .gte("data_disponibilizacao", desde)
        .order("data_disponibilizacao", { ascending: false, nullsFirst: false })
        .limit(500);
      if (!error) {
        setPubs(
          ((data || []) as Array<Record<string, unknown>>).map((r) => ({
            id: String(r.id),
            cliente_nome:
              (r.casos as { cliente?: { nome?: string | null } } | null)
                ?.cliente?.nome ?? null,
            numero_processo: (r.numero_processo as string | null) ?? null,
            tribunal: (r.sigla_tribunal as string | null) ?? null,
            orgao: (r.nome_orgao as string | null) ?? null,
            tipo: (r.tipo_comunicacao as string | null) ?? null,
            data: (r.data_disponibilizacao as string | null) ?? null,
            texto: (r.texto as string | null) ?? null,
            status: (r.status as PubStatus) ?? "sem_processo",
            caso_id: (r.caso_id as string | null) ?? null,
            foco_id: (r.andamento_id as string | null) ?? null,
          })),
        );
      }
    } else {
      // Parceiro: vê só as vinculadas dos casos dele (via andamentos). RLS restringe.
      const { data, error } = await supabase
        .from("andamentos")
        .select(
          "id, titulo, descricao, data_evento, caso_id, metadata, casos:caso_id(cliente:cliente_id(nome))",
        )
        .eq("origem", "djen")
        .eq("visivel_parceiro", true)
        .order("data_evento", { ascending: false, nullsFirst: false })
        .limit(200);
      if (!error) {
        setPubs(
          ((data || []) as Array<Record<string, unknown>>).map((r) => {
            const m = (r.metadata as Record<string, unknown> | null) || {};
            return {
              id: String(r.id),
              cliente_nome:
                (r.casos as { cliente?: { nome?: string | null } } | null)
                  ?.cliente?.nome ?? null,
              numero_processo: (m.numero_processo as string | null) ?? null,
              tribunal: (m.sigla_tribunal as string | null) ?? null,
              orgao: (m.nome_orgao as string | null) ?? null,
              tipo: (m.tipo_comunicacao as string | null) ?? null,
              data: (r.data_evento as string | null) ?? null,
              texto: (r.descricao as string | null) ?? null,
              status: "vinculada" as PubStatus,
              caso_id: (r.caso_id as string | null) ?? null,
              foco_id: String(r.id),
            };
          }),
        );
      }
    }

    setLoading(false);
  }, [isInterno]);

  useEffect(() => {
    carregar();
    // Marca publicacoes como vistas -> zera o badge do sidebar.
    if (typeof window !== "undefined") {
      window.localStorage.setItem(VISTO_KEY, new Date().toISOString());
      window.dispatchEvent(new CustomEvent("msc:publicacoes-vistas"));
    }
  }, [carregar]);

  const filtradas = useMemo(() => {
    const q = busca.trim().toLowerCase();
    if (!q) return pubs;
    const d = q.replace(/\D/g, "");
    return pubs.filter((p) => {
      const nome = (p.cliente_nome || "").toLowerCase();
      const num = (p.numero_processo || "").replace(/\D/g, "");
      const trib = (p.tribunal || "").toLowerCase();
      const txt = (p.texto || "").toLowerCase();
      if (nome.includes(q)) return true;
      if (d && num.includes(d)) return true;
      if (trib.includes(q)) return true;
      return txt.includes(q);
    });
  }, [pubs, busca]);

  const resumo = useMemo(() => {
    let vinc = 0;
    let orfa = 0;
    for (const p of pubs) {
      if (p.status === "vinculada") vinc++;
      else orfa++;
    }
    return { total: pubs.length, vinc, orfa };
  }, [pubs]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-serif text-3xl font-semibold tracking-tight flex items-center gap-2">
          <Newspaper className="h-7 w-7 text-[var(--gold)]" />
          Publicacoes
        </h1>
        <p className="text-sm text-muted-foreground">
          {isInterno
            ? `Publicacoes do Diario de Justica (DJEN) dos ultimos ${DIAS_JANELA} dias. As vinculadas viram andamento no caso; as sem processo cadastrado ficam aqui para triagem.`
            : "Publicacoes do Diario de Justica (DJEN) vinculadas aos processos dos seus clientes."}
        </p>
        {isInterno && pubs.length > 0 && (
          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
            <Badge variant="secondary">{resumo.total} na semana</Badge>
            <Badge className="bg-emerald-600 text-white hover:bg-emerald-600">
              {resumo.vinc} vinculada{resumo.vinc === 1 ? "" : "s"}
            </Badge>
            <Badge
              variant="outline"
              className="border-amber-500 text-amber-700 dark:text-amber-400"
            >
              {resumo.orfa} sem processo
            </Badge>
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
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Filtrar por cliente, numero do processo ou tribunal"
            className="pl-9"
          />
        </div>

        {loading
          ? (
            <div className="flex h-40 items-center justify-center">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          )
          : filtradas.length === 0
          ? (
            <Card>
              <CardContent className="flex flex-col items-center justify-center gap-2 py-12 text-center">
                <Newspaper className="h-8 w-8 text-muted-foreground" />
                <p className="text-sm font-medium">Nenhuma publicacao</p>
                <p className="text-xs text-muted-foreground">
                  Publicacoes do DJEN dos seus processos aparecerao aqui.
                </p>
              </CardContent>
            </Card>
          )
          : (
            <div className="space-y-3">
              {filtradas.map((p) => {
                const vinculada = p.status === "vinculada";
                const texto = p.texto || "";
                const longo = texto.length > PREVIEW_CHARS;
                const aberto = expandido[p.id];
                const exibir = !longo || aberto
                  ? texto
                  : texto.slice(0, PREVIEW_CHARS) + "…";
                return (
                  <Card key={p.id}>
                    <CardHeader className="pb-2">
                      <div className="flex items-start justify-between gap-2 flex-wrap">
                        <div className="min-w-0">
                          <CardTitle className="text-base flex items-center gap-2">
                            {vinculada
                              ? (p.cliente_nome || "Cliente")
                              : (
                                <span className="font-mono text-sm">
                                  {p.numero_processo || "Processo"}
                                </span>
                              )}
                          </CardTitle>
                          <CardDescription className="flex flex-wrap items-center gap-1.5 mt-1">
                            {vinculada
                              ? (
                                <Badge className="bg-emerald-600 text-white hover:bg-emerald-600 gap-1">
                                  <CheckCircle2 className="h-3 w-3" />
                                  Vinculada
                                </Badge>
                              )
                              : (
                                <Badge
                                  variant="outline"
                                  className="border-amber-500 text-amber-700 dark:text-amber-400 gap-1"
                                >
                                  <AlertCircle className="h-3 w-3" />
                                  Sem processo
                                </Badge>
                              )}
                            {p.tipo && (
                              <Badge variant="secondary" className="text-xs">
                                {p.tipo}
                              </Badge>
                            )}
                            {p.tribunal && (
                              <Badge variant="outline" className="text-xs">
                                {p.tribunal}
                              </Badge>
                            )}
                            <span className="text-xs">{fmt(p.data)}</span>
                          </CardDescription>
                        </div>
                        {vinculada && p.caso_id && (
                          <Button size="sm" variant="outline" asChild>
                            <Link
                              to="/casos/$id"
                              params={{ id: p.caso_id }}
                              search={{
                                tab: "andamentos",
                                foco: p.foco_id || undefined,
                              }}
                            >
                              Ver no caso
                            </Link>
                          </Button>
                        )}
                      </div>
                    </CardHeader>
                    <CardContent className="space-y-2">
                      {vinculada && p.numero_processo && (
                        <p className="text-xs text-muted-foreground font-mono">
                          {p.numero_processo}
                          {p.orgao ? " · " + p.orgao : ""}
                        </p>
                      )}
                      {!vinculada && p.orgao && (
                        <p className="text-xs text-muted-foreground">
                          {p.orgao}
                        </p>
                      )}
                      {texto && (
                        <>
                          <p className="text-sm whitespace-pre-wrap text-muted-foreground">
                            {exibir}
                          </p>
                          {longo && (
                            <button
                              type="button"
                              className="text-xs font-medium text-[var(--gold)] hover:underline"
                              onClick={() =>
                                setExpandido((s) => ({ ...s, [p.id]: !aberto }))}
                            >
                              {aberto ? "ver menos" : "ver publicacao completa"}
                            </button>
                          )}
                        </>
                      )}
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
      </ClientOnly>
    </div>
  );
}

import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2, Newspaper, Search } from "lucide-react";

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

interface PubMeta {
  tipo_comunicacao?: string;
  tipo_documento?: string;
  nome_orgao?: string;
  sigla_tribunal?: string;
  numero_processo?: string;
  certidao_url?: string;
  link?: string;
  djen_id?: number | string;
}

interface Pub {
  id: string;
  titulo: string | null;
  descricao: string | null;
  data_evento: string | null;
  created_at: string;
  caso_id: string;
  metadata: PubMeta | null;
  casos: { cliente: { nome: string | null } | null } | null;
}

function fmt(iso: string | null): string {
  if (!iso) return "-";
  return new Date(iso).toLocaleDateString("pt-BR");
}

function PublicacoesPage() {
  const { usuario } = useAuth();
  const isInterno = usuario?.tipo === "interno";
  const [pubs, setPubs] = useState<Array<Pub>>([]);
  const [loading, setLoading] = useState(true);
  const [busca, setBusca] = useState("");

  const carregar = useCallback(async () => {
    setLoading(true);
    let q = supabase
      .from("andamentos")
      .select(
        "id, titulo, descricao, data_evento, created_at, caso_id, metadata, casos:caso_id(cliente:cliente_id(nome))",
      )
      .eq("origem", "djen")
      .order("data_evento", { ascending: false, nullsFirst: false })
      .limit(200);
    // Parceiro so ve publicacoes marcadas visiveis (RLS ja restringe aos casos
    // dele); interno ve todas.
    if (!isInterno) q = q.eq("visivel_parceiro", true);
    const { data, error } = await q;
    if (!error) setPubs((data || []) as unknown as Array<Pub>);
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
      const nome = (p.casos?.cliente?.nome || "").toLowerCase();
      const num = (p.metadata?.numero_processo || "").replace(/\D/g, "");
      const trib = (p.metadata?.sigla_tribunal || "").toLowerCase();
      const txt = (p.descricao || "").toLowerCase();
      if (nome.includes(q)) return true;
      if (d && num.includes(d)) return true;
      if (trib.includes(q)) return true;
      return txt.includes(q);
    });
  }, [pubs, busca]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-serif text-3xl font-semibold tracking-tight flex items-center gap-2">
          <Newspaper className="h-7 w-7 text-[var(--gold)]" />
          Publicacoes
        </h1>
        <p className="text-sm text-muted-foreground">
          Publicacoes do Diario de Justica (DJEN) vinculadas aos processos dos
          seus clientes.
        </p>
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
                const m = p.metadata || {};
                return (
                  <Card key={p.id}>
                    <CardHeader className="pb-2">
                      <div className="flex items-start justify-between gap-2 flex-wrap">
                        <div className="min-w-0">
                          <CardTitle className="text-base">
                            {p.casos?.cliente?.nome || "Cliente"}
                          </CardTitle>
                          <CardDescription className="flex flex-wrap items-center gap-1.5 mt-1">
                            {m.tipo_comunicacao && (
                              <Badge variant="secondary" className="text-xs">
                                {m.tipo_comunicacao}
                              </Badge>
                            )}
                            {m.sigla_tribunal && (
                              <Badge variant="outline" className="text-xs">
                                {m.sigla_tribunal}
                              </Badge>
                            )}
                            <span className="text-xs">{fmt(p.data_evento)}</span>
                          </CardDescription>
                        </div>
                        <Button size="sm" variant="outline" asChild>
                          <Link
                            to="/casos/$id"
                            params={{ id: p.caso_id }}
                            search={{ tab: "andamentos", foco: p.id }}
                          >
                            Ver no caso
                          </Link>
                        </Button>
                      </div>
                    </CardHeader>
                    <CardContent className="space-y-2">
                      {m.numero_processo && (
                        <p className="text-xs text-muted-foreground font-mono">
                          {m.numero_processo}
                          {m.nome_orgao ? " · " + m.nome_orgao : ""}
                        </p>
                      )}
                      {p.descricao && (
                        <p className="text-sm whitespace-pre-wrap text-muted-foreground">
                          {p.descricao}
                        </p>
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

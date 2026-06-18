// Pílulas de etiquetas do cliente. Interno pode adicionar/remover; parceiro
// só visualiza. Substitui a leitura legada de clientes.tags (JSON do TI) pela
// nova fonte de verdade: tabelas public.etiquetas + clientes_etiquetas.

import { useCallback, useEffect, useState } from "react";
import { Loader2, Plus, X } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Input } from "@/components/ui/input";
import { supabase } from "@/lib/supabase";

interface Etiqueta {
  id: string;
  nome: string;
  cor: string;
}

interface Props {
  clienteId: string;
  isInterno: boolean;
}

export function EtiquetasCliente({ clienteId, isInterno }: Props) {
  const [vinculadas, setVinculadas] = useState<Array<Etiqueta>>([]);
  const [todas, setTodas] = useState<Array<Etiqueta>>([]);
  const [carregando, setCarregando] = useState(true);
  const [salvando, setSalvando] = useState<string | null>(null);
  const [popOpen, setPopOpen] = useState(false);
  const [filtro, setFiltro] = useState("");

  const carregar = useCallback(async () => {
    setCarregando(true);
    try {
      const vincResp = await supabase
        .from("clientes_etiquetas")
        .select("etiqueta:etiquetas(id, nome, cor)")
        .eq("cliente_id", clienteId);
      type LinkRow = { etiqueta: Etiqueta | Etiqueta[] | null };
      const vincRows = (vincResp.data ?? []) as Array<LinkRow>;
      const vincs = vincRows
        .map((r) => (Array.isArray(r.etiqueta) ? r.etiqueta[0] : r.etiqueta))
        .filter((e): e is Etiqueta => !!e);
      setVinculadas(
        vincs.sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR")),
      );

      if (isInterno) {
        const todasResp = await supabase
          .from("etiquetas")
          .select("id, nome, cor")
          .order("nome");
        if (!todasResp.error) {
          setTodas((todasResp.data ?? []) as Array<Etiqueta>);
        }
      }
    } finally {
      setCarregando(false);
    }
  }, [clienteId, isInterno]);

  useEffect(() => {
    carregar();
  }, [carregar]);

  async function adicionar(e: Etiqueta) {
    setSalvando(e.id);
    try {
      const { error } = await supabase
        .from("clientes_etiquetas")
        .insert({ cliente_id: clienteId, etiqueta_id: e.id });
      if (error) throw error;
      setVinculadas((prev) =>
        [...prev, e].sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR")),
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Falha ao adicionar.";
      toast.error(msg);
    } finally {
      setSalvando(null);
    }
  }

  async function remover(e: Etiqueta) {
    setSalvando(e.id);
    try {
      const { error } = await supabase
        .from("clientes_etiquetas")
        .delete()
        .eq("cliente_id", clienteId)
        .eq("etiqueta_id", e.id);
      if (error) throw error;
      setVinculadas((prev) => prev.filter((x) => x.id !== e.id));
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Falha ao remover.";
      toast.error(msg);
    } finally {
      setSalvando(null);
    }
  }

  const vinculadasIds = new Set(vinculadas.map((e) => e.id));
  const disponiveis = todas
    .filter((e) => !vinculadasIds.has(e.id))
    .filter((e) =>
      filtro
        ? e.nome.toLowerCase().includes(filtro.toLowerCase())
        : true,
    );

  // Esconder "NOME/UF" do parceiro (tags internas).
  const tagsExibidas = isInterno
    ? vinculadas
    : vinculadas.filter((t) => !/^[A-Za-z_]+\/[A-Z]{2}$/.test(t.nome.trim()));

  if (carregando) {
    return (
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Loader2 className="h-3 w-3 animate-spin" />
        carregando etiquetas...
      </div>
    );
  }

  if (tagsExibidas.length === 0 && !isInterno) return null;

  return (
    <div className="flex flex-wrap items-center gap-2">
      {tagsExibidas.map((e) => (
        <Badge
          key={e.id}
          variant="outline"
          className="font-normal text-xs gap-1 pl-2 pr-1"
          style={{
            backgroundColor: e.cor,
            borderColor: e.cor,
            color: "#1f2937",
          }}
        >
          {e.nome}
          {isInterno && (
            <button
              type="button"
              onClick={() => remover(e)}
              disabled={salvando === e.id}
              className="rounded p-0.5 hover:bg-black/10"
              title="Remover etiqueta"
            >
              {salvando === e.id ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <X className="h-3 w-3" />
              )}
            </button>
          )}
        </Badge>
      ))}
      {isInterno && (
        <Popover open={popOpen} onOpenChange={setPopOpen}>
          <PopoverTrigger asChild>
            <Button size="sm" variant="outline" className="h-6 px-2 text-xs">
              <Plus className="h-3 w-3 mr-1" />
              Etiqueta
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-64 p-2" align="start">
            <Input
              autoFocus
              value={filtro}
              onChange={(e) => setFiltro(e.target.value)}
              placeholder="Buscar..."
              className="h-8 text-xs mb-2"
            />
            <div className="max-h-60 overflow-auto space-y-1">
              {disponiveis.length === 0 ? (
                <p className="text-xs text-muted-foreground text-center py-3">
                  {todas.length === 0
                    ? "Nenhuma etiqueta cadastrada. Crie em /etiquetas."
                    : "Sem etiquetas disponíveis."}
                </p>
              ) : (
                disponiveis.map((e) => (
                  <button
                    key={e.id}
                    type="button"
                    onClick={() => {
                      adicionar(e);
                      setFiltro("");
                    }}
                    disabled={salvando === e.id}
                    className="flex items-center gap-2 w-full text-left rounded px-2 py-1 hover:bg-muted text-xs"
                  >
                    <span
                      className="inline-block h-3 w-3 rounded-sm shrink-0"
                      style={{ backgroundColor: e.cor }}
                    />
                    <span className="truncate">{e.nome}</span>
                    {salvando === e.id && (
                      <Loader2 className="h-3 w-3 animate-spin ml-auto" />
                    )}
                  </button>
                ))
              )}
            </div>
          </PopoverContent>
        </Popover>
      )}
    </div>
  );
}

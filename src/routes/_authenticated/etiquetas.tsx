import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Loader2, Plus, Pencil, Trash2, Tag, ShieldAlert } from "lucide-react";

import { useAuth } from "@/hooks/use-auth";
import { supabase } from "@/lib/supabase";
import { ClientOnly } from "@/components/client-only";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export const Route = createFileRoute("/_authenticated/etiquetas")({
  component: EtiquetasPage,
});

interface Etiqueta {
  id: string;
  nome: string;
  cor: string;
  ti_id: number | null;
}

const CORES_SUGERIDAS = [
  "#e6f5e6", // verde claro
  "#f5e8d3", // bege
  "#ffaaaa", // rosa
  "#e3d0e5", // lavanda
  "#cfe5ff", // azul claro
  "#fff3b0", // amarelo
  "#ffd6b0", // laranja claro
  "#d0e5d0", // verde sage
  "#e5d0d0", // rosa nude
];

function EtiquetasPage() {
  const { usuario } = useAuth();
  const isInterno = usuario?.tipo === "interno";

  const [lista, setLista] = useState<Array<Etiqueta>>([]);
  const [carregando, setCarregando] = useState(true);
  const [editando, setEditando] = useState<Etiqueta | null>(null);
  const [criando, setCriando] = useState(false);
  const [nome, setNome] = useState("");
  const [cor, setCor] = useState(CORES_SUGERIDAS[3]);
  const [salvando, setSalvando] = useState(false);

  const carregar = useCallback(async () => {
    setCarregando(true);
    const { data, error } = await supabase
      .from("etiquetas")
      .select("id, nome, cor, ti_id")
      .order("nome", { ascending: true });
    if (!error) setLista((data || []) as Array<Etiqueta>);
    setCarregando(false);
  }, []);

  useEffect(() => {
    if (isInterno) carregar();
  }, [isInterno, carregar]);

  function abrirCriar() {
    setEditando(null);
    setNome("");
    setCor(CORES_SUGERIDAS[3]);
    setCriando(true);
  }

  function abrirEditar(e: Etiqueta) {
    setEditando(e);
    setNome(e.nome);
    setCor(e.cor);
    setCriando(true);
  }

  function fechar() {
    setCriando(false);
    setEditando(null);
    setNome("");
    setCor(CORES_SUGERIDAS[3]);
  }

  async function salvar() {
    const nomeNorm = nome.trim();
    if (nomeNorm.length < 2) {
      toast.error("Informe um nome (mín. 2 caracteres).");
      return;
    }
    if (!/^#[0-9a-fA-F]{6}$/.test(cor)) {
      toast.error("Cor inválida. Use formato #rrggbb.");
      return;
    }
    setSalvando(true);
    try {
      if (editando) {
        const { error } = await supabase
          .from("etiquetas")
          .update({ nome: nomeNorm, cor })
          .eq("id", editando.id);
        if (error) throw error;
        toast.success("Etiqueta atualizada.");
      } else {
        const { error } = await supabase
          .from("etiquetas")
          .insert({ nome: nomeNorm, cor });
        if (error) throw error;
        toast.success("Etiqueta criada.");
      }
      fechar();
      carregar();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Falha ao salvar.";
      toast.error(msg);
    } finally {
      setSalvando(false);
    }
  }

  async function excluir(e: Etiqueta) {
    if (
      !window.confirm(
        `Excluir etiqueta "${e.nome}"? Será removida de todos os clientes vinculados.`,
      )
    ) {
      return;
    }
    try {
      const { error } = await supabase.from("etiquetas").delete().eq("id", e.id);
      if (error) throw error;
      toast.success("Etiqueta excluída.");
      carregar();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Falha ao excluir.";
      toast.error(msg);
    }
  }

  if (!isInterno) {
    return (
      <div className="flex h-64 flex-col items-center justify-center gap-2 text-center">
        <ShieldAlert className="h-8 w-8 text-muted-foreground" />
        <p className="text-sm text-muted-foreground">
          Área restrita a usuários internos.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="font-serif text-3xl font-semibold tracking-tight flex items-center gap-2">
            <Tag className="h-7 w-7 text-[var(--gold)]" />
            Etiquetas
          </h1>
          <p className="text-sm text-muted-foreground">
            Crie, edite e organize as etiquetas usadas nos clientes.
          </p>
        </div>
        <Button onClick={abrirCriar}>
          <Plus className="h-4 w-4 mr-1" />
          Nova etiqueta
        </Button>
      </div>

      <ClientOnly
        fallback={
          <div className="flex h-64 items-center justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        }
      >
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              Lista ({lista.length})
            </CardTitle>
            <CardDescription>
              Etiquetas importadas do Tramitação Inteligente vêm marcadas com origem TI; podem ser editadas livremente.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {carregando ? (
              <div className="flex items-center justify-center py-6">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            ) : lista.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-6">
                Nenhuma etiqueta. Crie a primeira.
              </p>
            ) : (
              <ul className="divide-y">
                {lista.map((e) => (
                  <li
                    key={e.id}
                    className="flex items-center justify-between gap-2 py-3"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <span
                        className="inline-block rounded px-2 py-0.5 text-xs font-medium border"
                        style={{ backgroundColor: e.cor, borderColor: e.cor }}
                      >
                        {e.nome}
                      </span>
                      {e.ti_id !== null && (
                        <span className="text-[10px] text-muted-foreground">
                          origem TI #{e.ti_id}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-8 w-8"
                        onClick={() => abrirEditar(e)}
                        title="Editar"
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-8 w-8 text-destructive"
                        onClick={() => excluir(e)}
                        title="Excluir"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </ClientOnly>

      <Dialog open={criando} onOpenChange={(o) => !o && fechar()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {editando ? "Editar etiqueta" : "Nova etiqueta"}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label className="text-xs">Nome</Label>
              <Input
                value={nome}
                onChange={(ev) => setNome(ev.target.value)}
                placeholder="Ex: URGENTE"
              />
            </div>
            <div>
              <Label className="text-xs">Cor</Label>
              <div className="flex items-center gap-2 mt-1">
                <input
                  type="color"
                  value={cor}
                  onChange={(ev) => setCor(ev.target.value)}
                  className="h-9 w-12 rounded border cursor-pointer"
                />
                <Input
                  value={cor}
                  onChange={(ev) => setCor(ev.target.value)}
                  className="flex-1 font-mono text-xs"
                  placeholder="#rrggbb"
                />
              </div>
              <div className="flex flex-wrap gap-1 mt-2">
                {CORES_SUGERIDAS.map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setCor(c)}
                    className={`h-6 w-6 rounded border ${cor === c ? "ring-2 ring-offset-1" : ""}`}
                    style={{ backgroundColor: c, borderColor: c }}
                    title={c}
                  />
                ))}
              </div>
            </div>
            <div className="rounded border bg-muted/30 p-3">
              <div className="text-xs text-muted-foreground mb-1">Preview</div>
              <span
                className="inline-block rounded px-2 py-0.5 text-xs font-medium border"
                style={{ backgroundColor: cor, borderColor: cor }}
              >
                {nome || "Etiqueta"}
              </span>
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={fechar} disabled={salvando}>
              Cancelar
            </Button>
            <Button onClick={salvar} disabled={salvando}>
              {salvando && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Salvar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

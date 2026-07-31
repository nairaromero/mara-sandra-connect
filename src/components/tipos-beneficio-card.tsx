import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Loader2, Plus, Scale, Trash2 } from "lucide-react";

import { supabase } from "@/lib/supabase";
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

interface TipoBeneficio {
  id: string;
  nome: string;
  ativo: boolean;
  ordem: number;
}

/**
 * Card de Configuracoes (interno only): gerencia a tabela tipos_beneficio,
 * que alimenta os dropdowns de caso novo / editar caso / processos.
 *
 * Excluir so quando nenhum caso usa o nome; senao a acao vira desativar
 * (some do dropdown, casos existentes mantem o valor e mostram "(atual)").
 */
export function TiposBeneficioCard() {
  const [tipos, setTipos] = useState<Array<TipoBeneficio>>([]);
  const [carregando, setCarregando] = useState(true);
  const [novoNome, setNovoNome] = useState("");
  const [salvando, setSalvando] = useState(false);
  // id com acao (toggle/delete) em andamento, pra desabilitar so aquela linha
  const [ocupadoId, setOcupadoId] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    try {
      const resp = await supabase
        .from("tipos_beneficio")
        .select("id, nome, ativo, ordem")
        .order("ordem");
      if (resp.error) throw resp.error;
      setTipos((resp.data as Array<TipoBeneficio>) || []);
    } catch (err) {
      console.error(err);
      const errObj = err as { message?: string };
      toast.error(errObj.message || "Erro ao carregar tipos de benefício");
    } finally {
      setCarregando(false);
    }
  }, []);

  useEffect(() => {
    carregar();
  }, [carregar]);

  async function incluir() {
    const nome = novoNome.trim();
    if (!nome) {
      toast.error("Digite o nome do benefício");
      return;
    }
    if (tipos.some((t) => t.nome.toLowerCase() === nome.toLowerCase())) {
      toast.error("Esse benefício já existe na lista");
      return;
    }
    setSalvando(true);
    try {
      const ordemMax = tipos.reduce((m, t) => Math.max(m, t.ordem), 0);
      const resp = await supabase
        .from("tipos_beneficio")
        .insert({ nome, ordem: ordemMax + 1 });
      if (resp.error) throw resp.error;
      toast.success("Benefício incluído: " + nome);
      setNovoNome("");
      await carregar();
    } catch (err) {
      console.error(err);
      const errObj = err as { message?: string };
      toast.error(errObj.message || "Erro ao incluir benefício");
    } finally {
      setSalvando(false);
    }
  }

  async function toggleAtivo(t: TipoBeneficio) {
    setOcupadoId(t.id);
    try {
      const resp = await supabase
        .from("tipos_beneficio")
        .update({ ativo: !t.ativo })
        .eq("id", t.id);
      if (resp.error) throw resp.error;
      toast.success(
        t.ativo ? "Desativado: some dos dropdowns" : "Reativado: volta aos dropdowns",
      );
      await carregar();
    } catch (err) {
      console.error(err);
      const errObj = err as { message?: string };
      toast.error(errObj.message || "Erro ao atualizar benefício");
    } finally {
      setOcupadoId(null);
    }
  }

  async function excluir(t: TipoBeneficio) {
    setOcupadoId(t.id);
    try {
      // Em uso por algum caso? Entao nao exclui - orienta desativar.
      const usoResp = await supabase
        .from("casos")
        .select("id", { count: "exact", head: true })
        .eq("tipo_beneficio", t.nome);
      if (usoResp.error) throw usoResp.error;
      const emUso = usoResp.count || 0;
      if (emUso > 0) {
        toast.error(
          "Em uso em " +
            emUso +
            (emUso === 1 ? " caso" : " casos") +
            ". Desative em vez de excluir.",
        );
        return;
      }
      if (!confirm('Excluir "' + t.nome + '" da lista de benefícios?')) return;
      const resp = await supabase.from("tipos_beneficio").delete().eq("id", t.id);
      if (resp.error) throw resp.error;
      toast.success("Benefício excluído");
      await carregar();
    } catch (err) {
      console.error(err);
      const errObj = err as { message?: string };
      toast.error(errObj.message || "Erro ao excluir benefício");
    } finally {
      setOcupadoId(null);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <Scale className="h-4 w-4" />
          Tipos de benefício
        </CardTitle>
        <CardDescription>
          Lista que aparece nos dropdowns de caso novo, editar caso e processos. Desativar
          esconde dos dropdowns sem mexer nos casos existentes; excluir só é possível quando
          nenhum caso usa o tipo.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex gap-2">
          <Input
            value={novoNome}
            onChange={(e) => setNovoNome(e.target.value)}
            placeholder="Novo tipo de benefício"
            onKeyDown={(e) => {
              if (e.key === "Enter") incluir();
            }}
          />
          <Button onClick={incluir} disabled={salvando}>
            {salvando ? (
              <Loader2 className="h-4 w-4 mr-1 animate-spin" />
            ) : (
              <Plus className="h-4 w-4 mr-1" />
            )}
            Incluir
          </Button>
        </div>
        {carregando ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground py-4">
            <Loader2 className="h-4 w-4 animate-spin" />
            Carregando...
          </div>
        ) : (
          <ul className="space-y-1">
            {tipos.map((t) => (
              <li
                key={t.id}
                className="flex items-center justify-between gap-2 border rounded-md px-3 py-2"
              >
                <div className="flex items-center gap-2 min-w-0">
                  <span
                    className={
                      "text-sm truncate " + (t.ativo ? "" : "text-muted-foreground line-through")
                    }
                  >
                    {t.nome}
                  </span>
                  {!t.ativo && (
                    <Badge variant="outline" className="shrink-0 text-xs">
                      desativado
                    </Badge>
                  )}
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 text-xs"
                    onClick={() => toggleAtivo(t)}
                    disabled={ocupadoId === t.id}
                  >
                    {ocupadoId === t.id ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : t.ativo ? (
                      "Desativar"
                    ) : (
                      "Reativar"
                    )}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 w-7 p-0 text-destructive hover:text-destructive"
                    title="Excluir (só se nenhum caso usar)"
                    onClick={() => excluir(t)}
                    disabled={ocupadoId === t.id}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

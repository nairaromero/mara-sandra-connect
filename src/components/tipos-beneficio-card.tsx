import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { ClipboardCheck, Loader2, Plus, Scale, Trash2 } from "lucide-react";

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
import { AcaoProtegida, usePodeAcao } from "@/components/acao-protegida";
import { ChecklistDocumentosEditor } from "@/components/configuracoes/checklist-documentos";
import type { ItemChecklist } from "@/lib/documentos/checklist";

interface TipoBeneficio {
  id: string;
  nome: string;
  ativo: boolean;
  ordem: number;
  /** O que o caso deste benefício precisa ter além da lista base (#434). */
  documentos_exigidos: ItemChecklist[];
}

/**
 * Card de Configuracoes (interno only): gerencia a tabela tipos_beneficio,
 * que alimenta os dropdowns de caso novo / editar caso / processos.
 *
 * Excluir so quando nenhum caso usa o nome; senao a acao vira desativar
 * (some do dropdown, casos existentes mantem o valor e mostram "(atual)").
 */
export function TiposBeneficioCard() {
  // `tipos_beneficio` exige templates:gerenciar (admin e advogado). A aba só
  // conferia se a pessoa era interna, então assistente e financeiro viam os
  // três botões e o banco recusava o clique.
  const podeMexer = usePodeAcao({ escrever: "tipos_beneficio" });
  const [tipos, setTipos] = useState<Array<TipoBeneficio>>([]);
  const [carregando, setCarregando] = useState(true);
  const [novoNome, setNovoNome] = useState("");
  const [salvando, setSalvando] = useState(false);
  // id com acao (toggle/delete) em andamento, pra desabilitar so aquela linha
  const [ocupadoId, setOcupadoId] = useState<string | null>(null);
  // Benefício com a lista de documentos aberta.
  const [documentosDe, setDocumentosDe] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    try {
      const resp = await supabase
        .from("tipos_beneficio")
        .select("id, nome, ativo, ordem, documentos_exigidos")
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

  async function salvarDocumentos(t: TipoBeneficio, itens: ItemChecklist[]) {
    const resp = await supabase
      .from("tipos_beneficio")
      .update({ documentos_exigidos: itens })
      .eq("id", t.id)
      .select("id");
    if (resp.error || (resp.data ?? []).length === 0) {
      console.error(resp.error);
      toast.error(resp.error?.message || "Não consegui salvar a lista deste benefício.");
      return false;
    }
    toast.success(`Documentos de "${t.nome}" salvos.`);
    await carregar();
    return true;
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
        <AcaoProtegida escrever="tipos_beneficio">
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
        </AcaoProtegida>
        {carregando ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground py-4">
            <Loader2 className="h-4 w-4 animate-spin" />
            Carregando...
          </div>
        ) : (
          <ul className="space-y-1">
            {tipos.map((t) => (
              <li key={t.id} className="border rounded-md">
              <div className="flex items-center justify-between gap-2 px-3 py-2">
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
                    variant="ghost"
                    className="h-7 text-xs"
                    title="O que o caso deste benefício precisa ter, além da lista base"
                    onClick={() => setDocumentosDe((atual) => (atual === t.id ? null : t.id))}
                    data-beneficio-documentos={t.nome}
                  >
                    <ClipboardCheck className="h-3.5 w-3.5 mr-1" />
                    Documentos ({t.documentos_exigidos?.length ?? 0})
                  </Button>
                  {podeMexer && (
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
                  )}
                  {podeMexer && (
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
                  )}
                </div>
              </div>
              {documentosDe === t.id && (
                <div className="border-t px-3 py-2">
                  <ChecklistDocumentosEditor
                    itens={t.documentos_exigidos ?? []}
                    podeEditar={podeMexer}
                    onSalvar={(itens) => salvarDocumentos(t, itens)}
                    vazio="Só a lista base vale para este benefício."
                  />
                </div>
              )}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

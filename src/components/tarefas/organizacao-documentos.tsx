// Checklist da tarefa "Organizar documentos" (card #434).
//
// Todo caso de parceiro nasce aqui antes de ir para a análise: hoje ele caía
// direto na Mara, e caía com a pasta bagunçada — a análise começava pela
// arrumação, que não é trabalho de análise.
//
// A tela não pede digitação: o que já está anexado ao caso vem marcado como
// recebido (todo documento é salvo com o tipo), e quem organiza só resolve o
// resto — falta ou não se aplica. Ao concluir, a RPC
// `concluir_organizacao_documentos` fecha esta tarefa, abre a análise no nome
// de quem analisa e deixa o rastro no caso.
//
// Documento faltando NÃO segura o caso (decisão da Naira, 2026-09-29): a
// solicitação ao parceiro é feita por quem organiza, na aba Documentos, e a
// análise nasce sabendo o que falta e que já foi pedido.

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { CheckCircle2, FileQuestion, Loader2 } from "lucide-react";

import { supabase } from "@/lib/supabase";
import { TIPOS_DOCUMENTO_LABEL } from "@/lib/documentos/tipos";
import { CHECKLIST_BASE } from "@/lib/documentos/checklist";
import { useDestaque } from "@/lib/destaque/destaque-context";
import type { TarefaComJoins } from "@/lib/tarefas/types";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

type Marca = "recebido" | "falta" | "nao_se_aplica";

interface DocDoCaso {
  tipo: string | null;
  nome_arquivo: string | null;
}

interface Props {
  tarefa: TarefaComJoins;
  onUpdated: () => void;
  compacto?: boolean;
  stopPropagation?: boolean;
}

export function OrganizacaoDocumentos({
  tarefa,
  onUpdated,
  compacto = false,
  stopPropagation = false,
}: Props) {
  const [docs, setDocs] = useState<DocDoCaso[] | null>(null);
  const [erro, setErro] = useState(false);
  const [marcas, setMarcas] = useState<Record<string, Marca>>({});
  const [observacao, setObservacao] = useState("");
  const [concluindo, setConcluindo] = useState(false);
  const { marcar: marcarDestaque } = useDestaque();

  const concluida = tarefa.status === "feito";

  const carregar = useCallback(() => {
    if (!tarefa.caso_id) return;
    let vivo = true;
    supabase
      .from("documentos")
      .select("tipo, nome_arquivo")
      .eq("caso_id", tarefa.caso_id)
      .then(({ data, error }) => {
        if (!vivo) return;
        // Erro de leitura não é "não tem documento": com [] a tela diria que
        // falta tudo, e quem organiza sairia pedindo o que já chegou.
        if (error) {
          console.error("documentos do caso:", error);
          setErro(true);
          return;
        }
        setErro(false);
        setDocs((data ?? []) as DocDoCaso[]);
      });
    return () => {
      vivo = false;
    };
  }, [tarefa.caso_id]);

  useEffect(() => carregar(), [carregar]);

  const tiposRecebidos = new Set(
    (docs ?? []).map((d) => d.tipo).filter((t): t is string => !!t && t !== "outro"),
  );
  const semTipo = (docs ?? []).filter((d) => !d.tipo || d.tipo === "outro");

  function marcaDe(tipo: string): Marca {
    if (tiposRecebidos.has(tipo)) return "recebido";
    return marcas[tipo] ?? "falta";
  }

  const faltantes = CHECKLIST_BASE.filter((t) => marcaDe(t) === "falta");

  async function concluir() {
    if (concluindo) return;
    setConcluindo(true);
    try {
      const { data, error } = await supabase.rpc("concluir_organizacao_documentos", {
        p_tarefa_id: tarefa.id,
        p_faltantes: faltantes.map((t) => TIPOS_DOCUMENTO_LABEL[t] ?? t),
        p_observacao: observacao.trim() || null,
      });
      if (error) throw error;
      const r = (data ?? {}) as { tarefa_analise_id?: string; ja_concluida?: boolean };
      if (r.ja_concluida) {
        toast.info("Esta organização já tinha sido concluída.");
      } else {
        if (r.tarefa_analise_id) marcarDestaque(r.tarefa_analise_id);
        toast.success("Documentos organizados — a análise do caso já está com quem analisa.");
      }
      onUpdated();
    } catch (e) {
      console.error(e);
      toast.error((e as { message?: string })?.message || "Não consegui concluir a organização.");
    } finally {
      setConcluindo(false);
    }
  }

  if (concluida) {
    return (
      <div
        className="rounded-md border border-emerald-500/40 bg-emerald-50 p-3 text-sm text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200"
        onClick={stopPropagation ? (e) => e.stopPropagation() : undefined}
      >
        <CheckCircle2 className="mr-2 inline h-4 w-4" />
        Documentos organizados — a análise do caso seguiu para quem analisa.
      </div>
    );
  }

  return (
    <div
      className="space-y-3 rounded-md border p-3"
      onClick={stopPropagation ? (e) => e.stopPropagation() : undefined}
    >
      <div>
        <p className="text-sm font-medium">Conferência dos documentos</p>
        <p className="text-xs text-muted-foreground">
          O que já está anexado ao caso vem marcado. Diga o que falta e conclua — o que estiver
          faltando você pede ao parceiro na aba Documentos, e a análise já nasce sabendo.
        </p>
      </div>

      {erro && (
        <p className="rounded-md border border-amber-400/50 bg-amber-50 p-2 text-xs text-amber-900">
          Não consegui ler os documentos do caso. Recarregue antes de concluir — senão você pede o
          que já chegou.
        </p>
      )}

      {docs === null && !erro ? (
        <p className="flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="h-3 w-3 animate-spin" /> Conferindo o que já chegou…
        </p>
      ) : (
        <ul className="space-y-1">
          {CHECKLIST_BASE.map((tipo) => {
            const marca = marcaDe(tipo);
            const recebido = marca === "recebido";
            return (
              <li key={tipo} className="flex items-center justify-between gap-2 text-sm">
                <span className={recebido ? "" : "text-muted-foreground"}>
                  {recebido ? "✓ " : "• "}
                  {TIPOS_DOCUMENTO_LABEL[tipo] ?? tipo}
                </span>
                {recebido ? (
                  <span className="text-xs text-emerald-700">recebido</span>
                ) : (
                  <div className="flex gap-1">
                    <Button
                      size="sm"
                      variant={marca === "falta" ? "default" : "outline"}
                      className="h-6 px-2 text-[11px]"
                      onClick={() => setMarcas((m) => ({ ...m, [tipo]: "falta" }))}
                    >
                      falta
                    </Button>
                    <Button
                      size="sm"
                      variant={marca === "nao_se_aplica" ? "default" : "outline"}
                      className="h-6 px-2 text-[11px]"
                      onClick={() => setMarcas((m) => ({ ...m, [tipo]: "nao_se_aplica" }))}
                    >
                      não se aplica
                    </Button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {semTipo.length > 0 && (
        <p className="flex items-start gap-2 rounded-md bg-muted/50 p-2 text-xs text-muted-foreground">
          <FileQuestion className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>
            {semTipo.length} arquivo{semTipo.length === 1 ? "" : "s"} ainda sem tipo definido. Na
            aba Documentos dá para dizer o que {semTipo.length === 1 ? "é" : "são"} — aí{" "}
            {semTipo.length === 1 ? "ele entra" : "eles entram"} sozinho{semTipo.length === 1 ? "" : "s"} nesta lista.
          </span>
        </p>
      )}

      {!compacto && (
        <div>
          <Label className="text-xs">Recado para quem vai analisar (opcional)</Label>
          <Textarea
            rows={2}
            placeholder="Ex.: procuração veio sem assinatura, pedi a via correta ao parceiro"
            value={observacao}
            onChange={(e) => setObservacao(e.target.value)}
          />
        </div>
      )}

      <Button size="sm" onClick={concluir} disabled={concluindo || docs === null || erro}>
        {concluindo && <Loader2 className="mr-2 h-3 w-3 animate-spin" />}
        Concluir organização e enviar para análise
      </Button>
      {faltantes.length > 0 && (
        <p className="text-xs text-muted-foreground">
          Vai junto para a análise: falta{faltantes.length === 1 ? "" : "m"}{" "}
          {faltantes.map((t) => TIPOS_DOCUMENTO_LABEL[t] ?? t).join(", ")}.
        </p>
      )}
    </div>
  );
}

// O que o caso precisa ter — configuração do escritório (card #434).
//
// Pedido da Naira (05/10): o checklist da conferência de documentos é do
// ESCRITÓRIO, não do código. Duas camadas, somadas para cada caso pela RPC
// `checklist_documentos_do_caso`:
//   · a lista base (todo caso), em `escritorio_config.checklist_documentos`,
//     gravada pela RPC `escritorio_definir_checklist` (auditada);
//   · a lista de cada benefício, em `tipos_beneficio.documentos_exigidos`,
//     editada na linha do benefício (TiposBeneficioCard).
// Um item aceita mais de um tipo: "CNIS ou CNIS resumido" resolvem o mesmo.

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { ClipboardCheck, Loader2, Plus, X } from "lucide-react";

import { supabase } from "@/lib/supabase";
import { lerUm } from "@/lib/leitura";
import { useAuth } from "@/hooks/use-auth";
import { nomeDoItem, type ItemChecklist } from "@/lib/documentos/checklist";
import { TIPOS_DOCUMENTO_OPTIONS } from "@/lib/documentos/tipos";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Selecao } from "@/components/ui/selecao";

// "Outro" não é tipo que se exija: é a saída para o que não está na lista.
const OPCOES = TIPOS_DOCUMENTO_OPTIONS.filter((o) => o.value !== "outro");

/**
 * Edita uma lista de itens. Não grava: devolve a lista para quem chamou
 * (`onSalvar`), que sabe onde ela mora.
 */
export function ChecklistDocumentosEditor({
  itens,
  podeEditar,
  onSalvar,
  vazio = "Nenhum documento nesta lista.",
}: {
  itens: ItemChecklist[];
  podeEditar: boolean;
  onSalvar: (itens: ItemChecklist[]) => Promise<boolean>;
  vazio?: string;
}) {
  const [rascunho, setRascunho] = useState<ItemChecklist[]>(itens);
  const [salvando, setSalvando] = useState(false);
  useEffect(() => setRascunho(itens), [itens]);

  const mudou = JSON.stringify(rascunho) !== JSON.stringify(itens);
  const jaNaLista = new Set(rascunho.flat());
  const livres = OPCOES.filter((o) => !jaNaLista.has(o.value));

  async function salvar() {
    setSalvando(true);
    try {
      await onSalvar(rascunho);
    } finally {
      setSalvando(false);
    }
  }

  return (
    <div className="space-y-2" data-checklist-editor>
      {rascunho.length === 0 && <p className="text-xs text-muted-foreground">{vazio}</p>}
      <ul className="space-y-1">
        {rascunho.map((item, i) => (
          <li
            key={item.join("|")}
            className="flex items-center justify-between gap-2 rounded-md border px-2 py-1"
          >
            <span className="text-sm">{nomeDoItem(item, true)}</span>
            {podeEditar && (
              <div className="flex shrink-0 items-center gap-1">
                <div className="w-40">
                  <Selecao
                    opcoes={livres}
                    value=""
                    placeholder="aceita também…"
                    onChange={(t) =>
                      setRascunho((r) => r.map((it, j) => (j === i ? [...it, t] : it)))
                    }
                  />
                </div>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive"
                  title="Tirar da lista"
                  aria-label={`Tirar ${nomeDoItem(item)} da lista`}
                  onClick={() => setRascunho((r) => r.filter((_, j) => j !== i))}
                >
                  <X className="h-3.5 w-3.5" />
                </Button>
              </div>
            )}
          </li>
        ))}
      </ul>
      {podeEditar && (
        <div className="flex flex-wrap items-center gap-2">
          <div className="w-64">
            <Selecao
              opcoes={livres}
              value=""
              placeholder="Adicionar documento…"
              onChange={(t) => setRascunho((r) => [...r, [t]])}
            />
          </div>
          {mudou && (
            <>
              <Button size="sm" onClick={salvar} disabled={salvando}>
                {salvando ? (
                  <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Plus className="mr-1 h-3.5 w-3.5" />
                )}
                Salvar lista
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setRascunho(itens)} disabled={salvando}>
                Desfazer
              </Button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

/** A lista base do escritório: o que TODO caso precisa ter. */
export function ChecklistBaseCard() {
  const { escritorio, podeChamar } = useAuth();
  const [itens, setItens] = useState<ItemChecklist[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const escritorioId = escritorio?.escritorio_id ?? null;

  useEffect(() => {
    if (!escritorioId) return;
    let vivo = true;
    lerUm<{ checklist_documentos: ItemChecklist[] }>(
      supabase
        .from("escritorio_config")
        .select("checklist_documentos")
        .eq("escritorio_id", escritorioId)
        .maybeSingle(),
      "checklist do escritório",
    )
      .then((linha) => {
        if (!vivo) return;
        setErro(null);
        setItens(linha?.checklist_documentos ?? []);
      })
      .catch((e: Error) => {
        if (!vivo) return;
        console.error(e);
        setErro(e.message);
      });
    return () => {
      vivo = false;
    };
  }, [escritorioId]);

  async function salvar(novos: ItemChecklist[]) {
    const { data, error } = await supabase.rpc("escritorio_definir_checklist", { p_itens: novos });
    if (error) {
      toast.error(error.message || "Não consegui salvar a lista.");
      return false;
    }
    setItens((data ?? novos) as ItemChecklist[]);
    toast.success("Lista salva — vale para as próximas conferências.");
    return true;
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <ClipboardCheck className="h-4 w-4" />
          Documentos que todo caso precisa ter
        </CardTitle>
        <CardDescription>
          A conferência de documentos (tarefa "Organizar documentos") cobra esta lista em todo
          caso, mais a do benefício do caso — configurada em cada benefício abaixo. Um item pode
          aceitar mais de um documento (ex.: CNIS ou CNIS resumido).
        </CardDescription>
      </CardHeader>
      <CardContent>
        {erro ? (
          <p className="text-xs text-destructive">Não consegui ler a lista: {erro}</p>
        ) : itens === null ? (
          <p className="flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> Carregando…
          </p>
        ) : (
          <ChecklistDocumentosEditor
            itens={itens}
            podeEditar={podeChamar("escritorio_definir_checklist")}
            onSalvar={salvar}
          />
        )}
      </CardContent>
    </Card>
  );
}

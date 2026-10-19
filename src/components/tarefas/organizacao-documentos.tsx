// Conferência da tarefa "Organizar documentos" (card #434).
//
// A IA lê a pasta quando os documentos chegam e grava o que cada arquivo é.
// Esta tela NÃO é formulário: ela mostra o que foi identificado para a pessoa
// CONFERIR (a IA erra, decisão da Naira em 18/10), e destaca só as exceções —
// o que não deu para identificar e o que falta chegar.
//
// Ao concluir, a RPC `concluir_organizacao_documentos` fecha esta tarefa, abre
// a análise no nome de quem analisa e deixa o rastro no caso. Documento
// faltando não segura o caso: vai junto, anotado.

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import {
  CheckCircle2,
  ExternalLink,
  FileQuestion,
  FolderOpen,
  Loader2,
  Sparkles,
} from "lucide-react";

import { supabase } from "@/lib/supabase";
import { TIPOS_DOCUMENTO_LABEL, TIPOS_DOCUMENTO_OPTIONS } from "@/lib/documentos/tipos";
import { CHECKLIST_BASE } from "@/lib/documentos/checklist";
import { provedorDaPasta, type PastaExterna } from "@/lib/documentos/pasta-externa";
import { useDestaque } from "@/lib/destaque/destaque-context";
import type { TarefaComJoins } from "@/lib/tarefas/types";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Selecao } from "@/components/ui/selecao";

interface DocDoCaso {
  id: string;
  nome_arquivo: string | null;
  tipo: string | null;
  ia_tipo: string | null;
  ia_confianca: "alta" | "media" | "baixa" | null;
  ia_resumo: string | null;
  ia_lido_em: string | null;
}

interface Props {
  tarefa: TarefaComJoins;
  onUpdated: () => void;
  compacto?: boolean;
  stopPropagation?: boolean;
}

const ROTULO_CONFIANCA: Record<string, string> = {
  alta: "reconheceu",
  media: "provável",
  baixa: "em dúvida",
};

export function OrganizacaoDocumentos({
  tarefa,
  onUpdated,
  compacto = false,
  stopPropagation = false,
}: Props) {
  const [docs, setDocs] = useState<DocDoCaso[] | null>(null);
  // Pasta por link (#434): quando o parceiro não anexa nada, é aqui que os
  // arquivos estão — a tarefa não pode parecer um caso vazio.
  const [pastas, setPastas] = useState<PastaExterna[]>([]);
  const [erro, setErro] = useState(false);
  const [lendo, setLendo] = useState(false);
  const [observacao, setObservacao] = useState("");
  const [concluindo, setConcluindo] = useState(false);
  const { marcar: marcarDestaque } = useDestaque();

  const carregar = useCallback(() => {
    if (!tarefa.caso_id) return;
    let vivo = true;
    supabase
      .from("documentos")
      .select("id, nome_arquivo, tipo, ia_tipo, ia_confianca, ia_resumo, ia_lido_em")
      .eq("caso_id", tarefa.caso_id)
      .order("created_at")
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
    supabase
      .from("caso_pastas_externas")
      .select("id, caso_id, url, rotulo, criado_por, created_at, atualizado_em")
      .eq("caso_id", tarefa.caso_id)
      .order("created_at")
      .then(({ data, error }) => {
        if (!vivo) return;
        // Falhar aqui não pode virar "não tem pasta": a tela diria que o
        // parceiro não mandou nada quando mandou.
        if (error) {
          console.error("pastas por link do caso:", error);
          setErro(true);
          return;
        }
        setPastas((data ?? []) as PastaExterna[]);
      });
    return () => {
      vivo = false;
    };
  }, [tarefa.caso_id]);

  useEffect(() => carregar(), [carregar]);

  const concluida = tarefa.status === "feito";
  const lista = docs ?? [];
  const semLeitura = lista.filter((d) => !d.ia_lido_em);
  const lidos = lista.filter((d) => d.ia_lido_em);
  // Exceção: a IA leu e não soube dizer, ou ficou em dúvida.
  const duvidosos = lidos.filter((d) => d.ia_tipo === "outro" || d.ia_confianca !== "alta");
  const reconhecidos = lidos.filter((d) => d.ia_tipo !== "outro" && d.ia_confianca === "alta");

  const tiposPresentes = new Set(
    lista.map((d) => d.tipo).filter((t): t is string => !!t && t !== "outro"),
  );
  const faltantes = CHECKLIST_BASE.filter((t) => !tiposPresentes.has(t));

  async function lerAgora() {
    if (lendo || !tarefa.caso_id) return;
    setLendo(true);
    try {
      const { data, error } = await supabase.functions.invoke("identificar-documentos", {
        body: { caso_id: tarefa.caso_id },
      });
      if (error) throw error;
      const r = (data ?? {}) as { lidos?: unknown[]; pulados?: unknown[] };
      const n = r.lidos?.length ?? 0;
      toast.success(
        n === 0 ? "Nada novo para ler." : `${n} arquivo${n > 1 ? "s" : ""} identificado${n > 1 ? "s" : ""}.`,
      );
      carregar();
      // O card da lista lê os documentos por conta própria: sem avisar o pai,
      // ele segue dizendo "0 de 3 identificados" depois que a IA já leu.
      onUpdated();
    } catch (e) {
      console.error(e);
      toast.error((e as { message?: string })?.message || "Não consegui ler os documentos agora.");
    } finally {
      setLendo(false);
    }
  }

  async function corrigirTipo(doc: DocDoCaso, tipo: string) {
    const { error } = await supabase.from("documentos").update({ tipo }).eq("id", doc.id);
    if (error) {
      toast.error("Não consegui salvar a correção.");
      return;
    }
    setDocs((atual) => (atual ?? []).map((d) => (d.id === doc.id ? { ...d, tipo } : d)));
  }

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
        toast.success("Documentos conferidos — a análise já está com quem analisa.");
      }
      onUpdated();
    } catch (e) {
      console.error(e);
      toast.error((e as { message?: string })?.message || "Não consegui concluir a conferência.");
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
        Documentos conferidos — a análise do caso seguiu para quem analisa.
      </div>
    );
  }

  // No card da lista: o resumo e o botão. Corrigir tipo é dentro da tarefa.
  if (compacto) {
    return (
      <div
        className="space-y-2 rounded-md border p-3 text-sm"
        onClick={stopPropagation ? (e) => e.stopPropagation() : undefined}
      >
        <p className="flex items-center gap-2 text-xs text-muted-foreground">
          <Sparkles className="h-3.5 w-3.5" />
          {docs === null
            ? "conferindo o que chegou…"
            : `${reconhecidos.length} de ${lista.length} identificados` +
              (duvidosos.length > 0 ? ` · ${duvidosos.length} em dúvida` : "") +
              (semLeitura.length > 0 ? ` · ${semLeitura.length} por ler` : "")}
        </p>
        {docs !== null && pastas.length > 0 && (
          <p className="flex items-center gap-1 text-xs text-muted-foreground">
            <FolderOpen className="h-3.5 w-3.5 text-[var(--gold)]" />
            {lista.length === 0
              ? "sem arquivos aqui — o parceiro deixou uma pasta por link"
              : "há também uma pasta por link"}
          </p>
        )}
        {faltantes.length > 0 && docs !== null && (
          <p className="text-xs text-muted-foreground">
            Falta: {faltantes.map((t) => TIPOS_DOCUMENTO_LABEL[t] ?? t).join(", ")}
          </p>
        )}
        <Button
          size="sm"
          onClick={(e) => {
            if (stopPropagation) e.stopPropagation();
            void concluir();
          }}
          disabled={concluindo || docs === null || erro}
        >
          {concluindo && <Loader2 className="mr-2 h-3 w-3 animate-spin" />}
          Conferido — enviar para análise
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-4 rounded-md border p-3">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="flex items-center gap-2 text-sm font-medium">
            <Sparkles className="h-4 w-4 text-[var(--gold)]" />
            Conferência dos documentos
          </p>
          <p className="text-xs text-muted-foreground">
            {docs === null
              ? "Carregando…"
              : `A IA leu ${lidos.length} de ${lista.length} arquivos. Confira o que ela disse e` +
                " corrija o que estiver errado."}
          </p>
        </div>
        {semLeitura.length > 0 && (
          <Button size="sm" variant="outline" onClick={lerAgora} disabled={lendo}>
            {lendo ? <Loader2 className="mr-2 h-3 w-3 animate-spin" /> : null}
            Ler {semLeitura.length} novo{semLeitura.length > 1 ? "s" : ""}
          </Button>
        )}
      </div>

      {erro && (
        <p className="rounded-md border border-amber-400/50 bg-amber-50 p-2 text-xs text-amber-900">
          Não consegui ler o que já chegou neste caso (arquivos ou pasta por link). Recarregue antes
          de concluir — senão você pede o que já chegou.
        </p>
      )}

      {docs !== null && pastas.length > 0 && (
        <div className="rounded-md border border-[var(--gold)]/40 bg-[var(--gold)]/5 p-2">
          <p className="flex items-center gap-2 text-xs font-medium">
            <FolderOpen className="h-3.5 w-3.5 text-[var(--gold)]" />
            {lista.length === 0
              ? "O parceiro não juntou arquivos — deixou uma pasta por link"
              : "Também há uma pasta por link neste caso"}
          </p>
          <p className="mt-1 text-[11px] text-muted-foreground">
            Baixe de lá e suba na aba Documentos do caso; depois a IA lê o que subiu.
          </p>
          <ul className="mt-1 space-y-0.5">
            {pastas.map((p) => (
              <li key={p.id}>
                <a
                  href={p.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-xs font-medium hover:underline"
                >
                  {p.rotulo?.trim() || `Pasta no ${provedorDaPasta(p.url)}`}
                  <ExternalLink className="h-3 w-3" />
                </a>
              </li>
            ))}
          </ul>
        </div>
      )}

      {docs !== null && !erro && lista.length === 0 && pastas.length === 0 && (
        <p className="rounded-md border border-amber-400/50 bg-amber-50 p-2 text-xs text-amber-900 dark:bg-amber-950 dark:text-amber-200">
          Nenhum arquivo e nenhuma pasta por link neste caso. Peça os documentos ao parceiro na aba
          Documentos antes de mandar para análise.
        </p>
      )}

      {docs === null && !erro && (
        <p className="flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="h-3 w-3 animate-spin" /> Conferindo o que já chegou…
        </p>
      )}

      {duvidosos.length > 0 && (
        <section className="space-y-2">
          <p className="flex items-center gap-2 text-xs font-medium">
            <FileQuestion className="h-3.5 w-3.5 text-amber-600" />
            Preciso da sua ajuda nestes
          </p>
          {duvidosos.map((d) => (
            <LinhaDoc key={d.id} doc={d} onTipo={(t) => corrigirTipo(d, t)} destaque />
          ))}
        </section>
      )}

      {reconhecidos.length > 0 && (
        <section className="space-y-2">
          <p className="text-xs font-medium text-muted-foreground">
            Identificados pela IA ({reconhecidos.length})
          </p>
          {reconhecidos.map((d) => (
            <LinhaDoc key={d.id} doc={d} onTipo={(t) => corrigirTipo(d, t)} />
          ))}
        </section>
      )}

      {docs !== null && faltantes.length > 0 && (
        <p className="rounded-md bg-muted/50 p-2 text-xs">
          <strong>Falta:</strong>{" "}
          {faltantes.map((t) => TIPOS_DOCUMENTO_LABEL[t] ?? t).join(", ")} — peça ao parceiro na
          aba Documentos. O caso segue para análise com essa anotação.
        </p>
      )}

      <div>
        <Label className="text-xs">Recado para quem vai analisar (opcional)</Label>
        <Textarea
          rows={2}
          placeholder="Ex.: procuração veio sem assinatura, pedi a via correta ao parceiro"
          value={observacao}
          onChange={(e) => setObservacao(e.target.value)}
        />
      </div>

      <Button size="sm" onClick={concluir} disabled={concluindo || docs === null || erro}>
        {concluindo && <Loader2 className="mr-2 h-3 w-3 animate-spin" />}
        Conferido — enviar para análise
      </Button>
    </div>
  );
}

function LinhaDoc({
  doc,
  onTipo,
  destaque = false,
}: {
  doc: DocDoCaso;
  onTipo: (tipo: string) => void;
  destaque?: boolean;
}) {
  const corrigido = doc.ia_tipo && doc.tipo && doc.tipo !== doc.ia_tipo;
  return (
    <div
      className={
        "rounded-md border p-2 " + (destaque ? "border-amber-400/60 bg-amber-50/50" : "bg-muted/20")
      }
    >
      <div className="flex items-baseline justify-between gap-2">
        <span className="truncate text-xs font-medium">{doc.nome_arquivo}</span>
        {doc.ia_confianca && (
          <span className="shrink-0 text-[11px] text-muted-foreground">
            {ROTULO_CONFIANCA[doc.ia_confianca] ?? doc.ia_confianca}
          </span>
        )}
      </div>
      {doc.ia_resumo && (
        <p className="mb-1 text-[11px] text-muted-foreground line-clamp-2">{doc.ia_resumo}</p>
      )}
      <Selecao
        opcoes={TIPOS_DOCUMENTO_OPTIONS}
        value={doc.tipo ?? ""}
        onChange={onTipo}
        placeholder="O que é este documento?"
      />
      {corrigido && (
        <p className="mt-1 text-[11px] text-muted-foreground">
          Você corrigiu: a IA tinha dito {TIPOS_DOCUMENTO_LABEL[doc.ia_tipo!] ?? doc.ia_tipo}.
        </p>
      )}
    </div>
  );
}

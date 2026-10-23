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
  ChevronDown,
  Download,
  Eye,
  FileQuestion,
  FolderOpen,
  Loader2,
  Sparkles,
} from "lucide-react";

import { supabase } from "@/lib/supabase";
import { lerLista } from "@/lib/leitura";
import { mensagemDeErroEdge } from "@/lib/edge-function-error";
import { TIPOS_DOCUMENTO_LABEL, TIPOS_DOCUMENTO_OPTIONS } from "@/lib/documentos/tipos";
import { checklistDoCaso, itensFaltantes, nomeDoItem, type ItemChecklist } from "@/lib/documentos/checklist";
import { lerPastasDoCaso, type PastaExterna } from "@/lib/documentos/pasta-externa";
import { abreNoNavegador, iaConsegueLer, rotuloDaExtensao } from "@/lib/documentos/arquivo";
import { LinkDaPasta } from "@/components/documentos/pastas-externas";
import { quemJuntou, type AutorDocumento } from "@/lib/documentos/autor";
import { useVisualizadorDocumento } from "@/hooks/use-visualizador-documento";
import { VisualizadorDocumento } from "@/components/documentos/visualizador-documento";
import { useDestaque } from "@/lib/destaque/destaque-context";
import { useAuth } from "@/hooks/use-auth";
import type { TarefaComJoins } from "@/lib/tarefas/types";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Selecao } from "@/components/ui/selecao";

interface DocDoCaso {
  id: string;
  nome_arquivo: string | null;
  storage_path: string;
  /** Quem juntou (join por `uploaded_by`) — parceiro ou equipe. */
  autor?: AutorDocumento | null;
  tipo: string | null;
  ia_tipo: string | null;
  ia_confianca: "alta" | "media" | "baixa" | null;
  ia_resumo: string | null;
  ia_lido_em: string | null;
  /** A IA desistiu deste arquivo (3 falhas, ou grande demais): o porquê. */
  ia_falha: string | null;
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
  // O que este caso precisa ter: lista do escritório + a do benefício (banco).
  const [checklist, setChecklist] = useState<ItemChecklist[]>([]);
  const [erro, setErro] = useState(false);
  const [lendo, setLendo] = useState(false);
  const [observacao, setObservacao] = useState("");
  // Lista do que a IA já resolveu: fechada por padrão.
  const [verIdentificados, setVerIdentificados] = useState(false);
  const [concluindo, setConcluindo] = useState(false);
  const { marcar: marcarDestaque } = useDestaque();
  // Concluir segue a regra da tarefa (escopo `atribuidos` só na tarefa da
  // própria pessoa) — a mesma que a RPC confere no banco.
  const { podeEscreverLinha } = useAuth();
  const podeConcluir = podeEscreverLinha("tarefas", { responsavel_id: tarefa.responsavel_id }, "atualizar");
  // Ver o arquivo sem sair da conferência (pedido da Naira, 2026-10-19): é
  // olhando que se escolhe o tipo certo quando a IA ficou em dúvida.
  const visualizador = useVisualizadorDocumento();

  const carregar = useCallback(() => {
    const casoId = tarefa.caso_id;
    if (!casoId) return;
    let vivo = true;
    // As três leituras chegam JUNTAS: separadas, a que respondia por último
    // apagava o aviso de falha da outra e o "Conferido" voltava a ficar ativo
    // com a tela dizendo que não chegou nada. Qualquer falha: aviso, e nada de
    // "falta tudo" — quem organiza sairia pedindo o que já chegou.
    Promise.all([
      lerLista<DocDoCaso>(
        supabase
          .from("documentos")
          // Uma string só: partida em duas, o supabase-js não consegue inferir o
          // tipo do retorno e o `as DocDoCaso[]` passa a mentir.
          .select("id, nome_arquivo, storage_path, tipo, ia_tipo, ia_confianca, ia_resumo, ia_lido_em, ia_falha, autor:usuarios!documentos_uploaded_by_fkey(nome, email, tipo)")
          .eq("caso_id", casoId)
          .order("created_at")
          .order("id") as PromiseLike<{ data: DocDoCaso[] | null; error: { message: string } | null }>,
        "documentos do caso",
      ),
      lerPastasDoCaso(casoId),
      checklistDoCaso(casoId),
    ])
      .then(([documentos, links, itens]) => {
        if (!vivo) return;
        setErro(false);
        setDocs(documentos);
        setPastas(links);
        setChecklist(itens);
      })
      .catch((e: Error) => {
        if (!vivo) return;
        console.error(e);
        setErro(true);
      });
    return () => {
      vivo = false;
    };
  }, [tarefa.caso_id]);

  useEffect(() => carregar(), [carregar]);

  const concluida = tarefa.status === "feito";
  const lista = docs ?? [];
  // "Por ler" é só o que a IA CONSEGUE ler e ainda não desistiu: um .docx
  // nunca vai ser lido, e oferecer "Ler 1 novo" para ele (ou para o arquivo
  // que já falhou 3 vezes) é um botão que não faz nada, para sempre. A régua
  // é a mesma do banco (`private.ia_documento_pendente`).
  const semLeitura = lista.filter((d) => !d.ia_lido_em && !d.ia_falha && iaConsegueLer(d.nome_arquivo));
  // Dois motivos diferentes de a IA não ter lido, e a tela diz qual: o
  // formato que ela nunca lê (.docx, HEIC…) e o arquivo que ela TENTOU e
  // desistiu (3 falhas, ou grande demais). Juntos, um PDF que falhou aparecia
  // como "formato que ela não lê".
  const formatoQueNaoLe = lista.filter(
    (d) => !d.ia_lido_em && !d.ia_falha && !iaConsegueLer(d.nome_arquivo),
  );
  const desistidos = lista.filter((d) => !d.ia_lido_em && !!d.ia_falha);
  const lidos = lista.filter((d) => d.ia_lido_em);
  // Exceção: a IA leu e não soube dizer, ficou em dúvida — ou nem leu ainda
  // (sem chave, falha, acabou de chegar). Arquivo que a IA não resolveu é
  // trabalho da pessoa, e por isso ele PRECISA aparecer: antes, o não lido
  // não entrava em lista nenhuma e só existia como número no cabeçalho.
  const emDuvida = lidos.filter((d) => d.ia_tipo === "outro" || d.ia_confianca !== "alta");
  const duvidosos = [...semLeitura, ...desistidos, ...formatoQueNaoLe, ...emDuvida];
  // O porquê dos não lidos, para o resumo: "1 em formato que ela não lê; 1 que
  // ela não conseguiu ler".
  const naoLidos = [
    formatoQueNaoLe.length > 0 ? `${formatoQueNaoLe.length} em formato que ela não lê` : "",
    desistidos.length > 0 ? `${desistidos.length} que ela não conseguiu ler` : "",
  ].filter(Boolean);
  const reconhecidos = lidos.filter((d) => d.ia_tipo !== "outro" && d.ia_confianca === "alta");

  const tiposPresentes = new Set(
    lista.map((d) => d.tipo).filter((t): t is string => !!t && t !== "outro"),
  );
  // Nome de cada item que falta — o item aceita mais de um tipo (CNIS completo
  // ou resumido resolvem o mesmo item), e o primeiro da família dá o nome.
  const faltantes = itensFaltantes(checklist, tiposPresentes).map((item) => nomeDoItem(item));

  async function lerAgora() {
    if (lendo || !tarefa.caso_id) return;
    setLendo(true);
    try {
      const { data, error } = await supabase.functions.invoke("identificar-documentos", {
        body: { caso_id: tarefa.caso_id },
      });
      if (error) throw error;
      const r = (data ?? {}) as { lidos?: unknown[]; pulados?: Array<{ motivo?: string }> };
      const n = r.lidos?.length ?? 0;
      const p = r.pulados?.length ?? 0;
      if (n > 0) {
        toast.success(`${n} arquivo${n > 1 ? "s" : ""} identificado${n > 1 ? "s" : ""}.`);
      }
      if (p > 0) {
        // Falha não é "nada novo": antes a chave recusada aparecia assim.
        toast.warning(
          `${p} arquivo${p > 1 ? "s" : ""} sem leitura: ${r.pulados![0].motivo ?? "tente de novo"}`,
        );
      }
      if (n === 0 && p === 0) toast.success("Nada novo para ler.");
      carregar();
      // O card da lista lê os documentos por conta própria: sem avisar o pai,
      // ele segue dizendo "0 de 3 identificados" depois que a IA já leu.
      onUpdated();
    } catch (e) {
      // A frase de verdade (chave recusada, IA não configurada) vem no corpo
      // da resposta; a `message` do supabase-js é sempre "non-2xx status code".
      toast.error(await mensagemDeErroEdge(e, "Não consegui ler os documentos agora."));
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
        p_faltantes: faltantes,
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
              (emDuvida.length > 0 ? ` · ${emDuvida.length} em dúvida` : "") +
              (semLeitura.length > 0 ? ` · ${semLeitura.length} por ler` : "") +
              (formatoQueNaoLe.length > 0 ? ` · ${formatoQueNaoLe.length} a IA não lê` : "") +
              (desistidos.length > 0 ? ` · ${desistidos.length} a IA não conseguiu ler` : "")}
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
            Falta: {faltantes.join(", ")}
          </p>
        )}
        <Button
          size="sm"
          onClick={(e) => {
            if (stopPropagation) e.stopPropagation();
            void concluir();
          }}
          disabled={concluindo || docs === null || erro || !podeConcluir}
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
              : duvidosos.length === 0 && lista.length > 0
                ? `A IA identificou ${reconhecidos.length === 1 ? "o arquivo" : `os ${reconhecidos.length} arquivos`}. Nada pendente.`
                : `A IA leu ${lidos.length} de ${lista.length} arquivo${lista.length === 1 ? "" : "s"}` +
                  (naoLidos.length > 0 ? ` (${naoLidos.join("; ")})` : "") +
                  ". Abaixo, só o que ela não resolveu."}
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
          <ul className="mt-1 space-y-1">
            {pastas.map((p) => (
              <li key={p.id}>
                <LinkDaPasta pasta={p} />
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
            <LinhaDoc
              key={d.id}
              doc={d}
              onTipo={(t) => corrigirTipo(d, t)}
              visualizador={visualizador}
              destaque
            />
          ))}
        </section>
      )}

      {/* O que a IA resolveu fica FORA da lista (Naira, 20/10): numa pasta de
          30 arquivos, a tarefa viraria uma lista enorme de coisas prontas. Vale
          a contagem — e um clique para quem quiser conferir mesmo assim. */}
      {reconhecidos.length > 0 && (
        <section className="space-y-2">
          <button
            type="button"
            onClick={() => setVerIdentificados((v) => !v)}
            className="flex w-full items-center gap-2 text-xs text-muted-foreground hover:text-foreground"
          >
            <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
            <span>
              {reconhecidos.length} identificado{reconhecidos.length > 1 ? "s" : ""} pela IA — nada
              a fazer
            </span>
            <ChevronDown
              className={"h-3.5 w-3.5 transition-transform " + (verIdentificados ? "rotate-180" : "")}
            />
          </button>
          {verIdentificados &&
            reconhecidos.map((d) => (
              <LinhaDoc
                key={d.id}
                doc={d}
                onTipo={(t) => corrigirTipo(d, t)}
                visualizador={visualizador}
              />
            ))}
        </section>
      )}

      {docs !== null && faltantes.length > 0 && (
        <p className="rounded-md bg-muted/50 p-2 text-xs">
          <strong>Falta:</strong>{" "}
          {faltantes.join(", ")} — peça ao parceiro na
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

      <Button size="sm" onClick={concluir} disabled={concluindo || docs === null || erro || !podeConcluir}>
        {concluindo && <Loader2 className="mr-2 h-3 w-3 animate-spin" />}
        Conferido — enviar para análise
      </Button>

      <VisualizadorDocumento aberto={visualizador.aberto} onFechar={visualizador.fechar} />
    </div>
  );
}

function LinhaDoc({
  doc,
  onTipo,
  visualizador,
  destaque = false,
}: {
  doc: DocDoCaso;
  onTipo: (tipo: string) => void;
  visualizador: ReturnType<typeof useVisualizadorDocumento>;
  destaque?: boolean;
}) {
  const corrigido = doc.ia_tipo && doc.tipo && doc.tipo !== doc.ia_tipo;
  // A extensão decide: PDF e imagem abrem na tela; DOCX, XLSX e companhia o
  // navegador não renderiza — para esses o botão baixa, em vez de abrir um
  // quadro vazio.
  const abreNaTela = abreNoNavegador(doc.nome_arquivo);
  // Quem juntou (Naira, 20/10): na conferência isso muda a leitura do arquivo
  // — documento do parceiro é o que chegou de fora, não o que a equipe subiu.
  const quem = quemJuntou(doc.autor);
  return (
    <div
      className={
        "rounded-md border p-2 " + (destaque ? "border-amber-400/60 bg-amber-50/50" : "bg-muted/20")
      }
    >
      <div className="flex items-center justify-between gap-2">
        <span className="truncate text-xs font-medium">{doc.nome_arquivo}</span>
        <div className="flex shrink-0 items-center gap-1">
          <span className="text-[11px] text-muted-foreground">
            {doc.ia_lido_em
              ? (doc.ia_confianca && (ROTULO_CONFIANCA[doc.ia_confianca] ?? doc.ia_confianca)) || ""
              : doc.ia_falha
                ? "a IA não conseguiu ler"
                : iaConsegueLer(doc.nome_arquivo)
                  ? "por ler"
                  : "a IA não lê"}
          </span>
          <Button
            size="sm"
            variant="ghost"
            className="h-6 px-1.5"
            disabled={visualizador.carregando}
            title={
              abreNaTela
                ? "Ver o documento"
                : `Prévia não abre ${rotuloDaExtensao(doc.nome_arquivo)} — baixar para ver`
            }
            aria-label={abreNaTela ? "Ver o documento" : "Baixar o documento"}
            onClick={() => (abreNaTela ? visualizador.abrir(doc) : visualizador.baixar(doc))}
          >
            {abreNaTela ? <Eye className="h-3.5 w-3.5" /> : <Download className="h-3.5 w-3.5" />}
          </Button>
        </div>
      </div>
      {quem && (
        <p className="text-[11px] text-muted-foreground">
          juntado por {quem.nome}
          {quem.ehParceiro && (
            <span className="ml-1 rounded bg-[var(--gold)]/15 px-1 text-[10px] text-foreground">
              parceiro
            </span>
          )}
        </p>
      )}
      {doc.ia_resumo && (
        <p className="mb-1 text-[11px] text-muted-foreground line-clamp-2">{doc.ia_resumo}</p>
      )}
      {!doc.ia_lido_em && doc.ia_falha && (
        <p className="mb-1 text-[11px] text-amber-800 dark:text-amber-300" data-ia-falha>
          {doc.ia_falha}
        </p>
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

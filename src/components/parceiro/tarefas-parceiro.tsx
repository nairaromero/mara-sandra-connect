// Tarefas do PARCEIRO — kanban por FASE do caso (Em análise / Administrativo
// / Judiciais), com cards ordenados por prazo. Feedback de parceiro
// (2026-08-31): "quero ver como tarefas em kanban, por prazos".
//
// Regras de produto (Naira, 2026-08-31):
//   * Só entra o que precisa de ação ou presença: solicitações de documento
//     pendentes (avulsas e de exigência) + perícias/audiências futuras.
//     Caso sem pendência não gera card; fase "finalizado" fica fora.
//   * O prazo mostrado é o prazo_at ("enviar até" = fatal − 3); o fatal real
//     nunca chega aqui.
//   * Perícia/audiência é card informativo (sem botão); solicitação tem o
//     "Cumprir", mesmo fluxo do hub /documentos (anexo obrigatório).
//   * Card recém-chegado (<72h) ganha selo "Novo" — senão pendência com prazo
//     longe fica invisível no fundo da coluna até virar incêndio.
//
// Dados: solicitacoes_documento + casos via RLS (o parceiro só enxerga os
// casos dele); perícias/audiências via RPC agenda_do_parceiro() (SECURITY
// DEFINER, sanitizada — a RLS de agenda_eventos/tarefas é só-interno).

import { Link, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  AlertTriangle,
  CalendarDays,
  CheckCircle2,
  Clock,
  FileText,
  Gavel,
  ListTodo,
  Loader2,
  MapPin,
  Scale,
  Stethoscope,
} from "lucide-react";

import { supabase } from "@/lib/supabase";
import { buscarPaginado } from "@/lib/supabase-paginado";
import { notificarEquipe } from "@/lib/notificar";
import { useAuth } from "@/hooks/use-auth";
import { ClientOnly } from "@/components/client-only";
import { cn } from "@/lib/utils";
import { diasCorridosBR, formatarBR, horaBR } from "@/lib/fuso";
import {
  rotuloSolicitacao,
  subirArquivosCumprimento,
  tiposDaSolicitacao,
  type ArquivoCumprimento,
  type ItemSolicitacao,
} from "@/lib/documentos/cumprimento";
import { validateFileSize } from "@/lib/upload-limits";
import { ArquivosCumprimento } from "@/components/documentos/arquivos-cumprimento";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

// ---------------------------------------------------------------------------
// Tipos
// ---------------------------------------------------------------------------

interface SolicPendente {
  id: string;
  caso_id: string;
  tipo: string;
  tipos: ItemSolicitacao[] | null;
  descricao: string | null;
  origem: string;
  prazo_at: string | null;
  data_solicitacao: string;
  documento_id: string | null;
  casos: {
    id: string;
    fase: string;
    clientes: { id: string; nome: string } | null;
  } | null;
}

interface EventoParceiro {
  fonte: "evento" | "tarefa";
  id: string;
  caso_id: string | null;
  tipo: "pericia" | "audiencia";
  cliente_nome: string | null;
  titulo: string;
  start_at: string;
  end_at: string;
  local: string | null;
  natureza: "admin" | "judicial" | null;
}

type CardKanban =
  | { kind: "solicitacao"; key: string; casoId: string; quando: string | null; s: SolicPendente }
  | { kind: "evento"; key: string; casoId: string; quando: string; e: EventoParceiro };

const FASES: Array<{ fase: string; titulo: string }> = [
  { fase: "analise", titulo: "Em análise" },
  { fase: "admin", titulo: "Administrativo" },
  { fase: "judicial", titulo: "Judiciais" },
];

// ---------------------------------------------------------------------------
// Helpers de apresentação
// ---------------------------------------------------------------------------

// Urgência na escala combinada com a Naira: vermelho até 3 dias do "enviar
// até", âmbar até 7, neutro no resto. (Escala própria do parceiro — a da
// equipe, em tarefas/helpers, corta em 0/2 dias.)
type UrgenciaParceiro = "vencido" | "urgente" | "atencao" | "tranquilo";

function urgenciaDoPrazo(iso: string | null): UrgenciaParceiro {
  if (!iso) return "tranquilo";
  const dias = diasCorridosBR(iso);
  if (dias < 0) return "vencido";
  if (dias <= 3) return "urgente";
  if (dias <= 7) return "atencao";
  return "tranquilo";
}

const URGENCIA_TEXTO_CLASS: Record<UrgenciaParceiro, string> = {
  vencido: "text-destructive font-medium",
  urgente: "text-destructive font-medium",
  atencao: "text-amber-700 dark:text-amber-400 font-medium",
  tranquilo: "text-muted-foreground",
};

const URGENCIA_BORDA_CLASS: Record<UrgenciaParceiro, string> = {
  vencido: "border-destructive/50",
  urgente: "border-destructive/50",
  atencao: "border-amber-400/60",
  tranquilo: "",
};

function textoPrazo(iso: string): string {
  const data = formatarBR(iso, { day: "2-digit", month: "2-digit" });
  const dias = diasCorridosBR(iso);
  if (dias < 0) return `Venceu ${data} — fale com o escritório`;
  if (dias === 0) return `Enviar até ${data} · é hoje`;
  if (dias === 1) return `Enviar até ${data} · amanhã`;
  return `Enviar até ${data} · em ${dias} dias`;
}

function textoDataEvento(iso: string): string {
  const data = formatarBR(iso, { weekday: "short", day: "2-digit", month: "2-digit" });
  const hora = horaBR(iso);
  return hora === "00:00" ? data : `${data} · ${hora}`;
}

// Categoria do card de solicitação a partir da origem.
function categoriaSolic(origem: string): { label: string; exigencia: boolean } {
  if (origem === "template:exigencia") return { label: "Exigência INSS", exigencia: true };
  if (origem === "template:exigencia_judicial") {
    return { label: "Exigência judicial", exigencia: true };
  }
  return { label: "Documentos", exigencia: false };
}

function ehNovo(dataSolicitacao: string): boolean {
  return Date.now() - new Date(dataSolicitacao).getTime() <= 72 * 60 * 60 * 1000;
}

// ---------------------------------------------------------------------------
// Componente
// ---------------------------------------------------------------------------

export function TarefasParceiro() {
  const { usuario } = useAuth();
  const navigate = useNavigate();

  const [carregando, setCarregando] = useState(true);
  const [solicitacoes, setSolicitacoes] = useState<SolicPendente[]>([]);
  const [eventos, setEventos] = useState<EventoParceiro[]>([]);
  const [fasePorCaso, setFasePorCaso] = useState<Map<string, string>>(new Map());

  // Modal "Cumprir" — mesmo fluxo do hub /documentos, versão só-parceiro
  // (anexo sempre obrigatório).
  const [cumprindo, setCumprindo] = useState<SolicPendente | null>(null);
  const [arquivos, setArquivos] = useState<ArquivoCumprimento[]>([]);
  const [comentario, setComentario] = useState("");
  const [salvando, setSalvando] = useState(false);

  const carregar = useCallback(async () => {
    setCarregando(true);
    try {
      const [solics, casos, evs] = await Promise.all([
        // Pendências do parceiro: tudo que não é interna (externa + exigências
        // de template). Ordem estável pro paginado.
        buscarPaginado<SolicPendente>((ini, fim) =>
          supabase
            .from("solicitacoes_documento")
            .select(
              "id, caso_id, tipo, tipos, descricao, origem, prazo_at, data_solicitacao, documento_id, casos(id, fase, clientes(id, nome))",
            )
            .eq("status", "pendente")
            .neq("origem", "interna")
            .order("data_solicitacao", { ascending: false })
            .order("id")
            .range(ini, fim) as unknown as PromiseLike<{
            data: SolicPendente[] | null;
            error: { message: string } | null;
          }>,
        ),
        // Fase de todos os casos do parceiro (pra posicionar os eventos, que
        // vêm da RPC sem a fase).
        buscarPaginado<{ id: string; fase: string }>((ini, fim) =>
          supabase.from("casos").select("id, fase").order("id").range(ini, fim),
        ),
        supabase.rpc("agenda_do_parceiro"),
      ]);
      if (evs.error) throw evs.error;
      setSolicitacoes(solics);
      setFasePorCaso(new Map(casos.map((c) => [c.id, c.fase])));
      // Só o futuro entra no board (compromisso de hoje conta o dia inteiro).
      setEventos(
        ((evs.data ?? []) as EventoParceiro[]).filter(
          (e) => diasCorridosBR(e.end_at || e.start_at) >= 0,
        ),
      );
    } catch (e) {
      console.error(e);
      toast.error("Falha ao carregar suas tarefas.");
    } finally {
      setCarregando(false);
    }
  }, []);

  useEffect(() => {
    carregar();
  }, [carregar]);

  // Monta as colunas: card de solicitação + card de evento, na coluna da FASE
  // do caso, ordenados pelo prazo/data mais próximo (sem prazo vai pro fim).
  const colunas = useMemo(() => {
    const porFase = new Map<string, CardKanban[]>(FASES.map((f) => [f.fase, []]));
    for (const s of solicitacoes) {
      const fase = s.casos?.fase;
      const alvo = fase ? porFase.get(fase) : undefined;
      if (!alvo) continue; // finalizado (ou fase desconhecida) fica fora
      alvo.push({ kind: "solicitacao", key: `s:${s.id}`, casoId: s.caso_id, quando: s.prazo_at, s });
    }
    for (const e of eventos) {
      if (!e.caso_id) continue;
      const fase = fasePorCaso.get(e.caso_id);
      const alvo = fase ? porFase.get(fase) : undefined;
      if (!alvo) continue;
      alvo.push({
        kind: "evento",
        key: `e:${e.fonte}:${e.id}`,
        casoId: e.caso_id,
        quando: e.start_at,
        e,
      });
    }
    for (const cards of porFase.values()) {
      cards.sort((a, b) => {
        if (a.quando && b.quando) return a.quando.localeCompare(b.quando);
        if (a.quando) return -1;
        if (b.quando) return 1;
        return a.key.localeCompare(b.key);
      });
    }
    return porFase;
  }, [solicitacoes, eventos, fasePorCaso]);

  const totalCards = useMemo(
    () => Array.from(colunas.values()).reduce((n, c) => n + c.length, 0),
    [colunas],
  );
  const totalUrgentes = useMemo(
    () =>
      solicitacoes.filter((s) => {
        const u = urgenciaDoPrazo(s.prazo_at);
        return (u === "urgente" || u === "vencido") && s.casos?.fase !== "finalizado";
      }).length,
    [solicitacoes],
  );

  function abrirCumprir(s: SolicPendente) {
    setCumprindo(s);
    setArquivos([]);
    setComentario("");
  }

  function fecharCumprir() {
    setCumprindo(null);
    setArquivos([]);
    setComentario("");
    setSalvando(false);
  }

  async function confirmarCumprir() {
    if (!cumprindo || !usuario) return;
    if (arquivos.length === 0) {
      toast.error("Selecione pelo menos um arquivo para anexar");
      return;
    }
    if (arquivos.some((a) => !a.nome.trim())) {
      toast.error("Informe o nome de todos os arquivos");
      return;
    }
    for (const a of arquivos) {
      const erroTamanho = validateFileSize(a.file);
      if (erroTamanho) {
        toast.error(a.file.name + ": " + erroTamanho);
        return;
      }
    }
    setSalvando(true);
    try {
      const r = await subirArquivosCumprimento({
        arquivos,
        casoId: cumprindo.caso_id,
        solicitacaoId: cumprindo.id,
        usuarioId: usuario.id,
        isInterno: false,
      });
      if (r.falhas.length > 0) {
        // Não marca atendido com arquivo faltando — os que falharam voltam
        // pra lista, os enviados já ficaram vinculados.
        setArquivos(r.falhas);
        toast.error(
          r.enviados +
            " de " +
            (r.enviados + r.falhas.length) +
            " arquivo(s) enviados — os que falharam continuam na lista, tente de novo.",
        );
        return;
      }
      const update: {
        status: string;
        data_atendimento: string;
        comentario: string | null;
        documento_id?: string;
      } = {
        status: "atendido",
        data_atendimento: new Date().toISOString(),
        comentario: comentario.trim() || null,
      };
      if (r.primeiroDocId && !cumprindo.documento_id) {
        update.documento_id = r.primeiroDocId;
      }
      const resp = await supabase
        .from("solicitacoes_documento")
        .update(update)
        .eq("id", cumprindo.id);
      if (resp.error) throw resp.error;
      window.dispatchEvent(new Event("msc:solicitacoes-mudou"));
      notificarEquipe({
        tipo: r.enviados > 0 ? "documento" : "solicitacao",
        titulo:
          r.enviados > 1
            ? `${r.enviados} documentos enviados por ${usuario.nome || "parceiro"}`
            : `Documento enviado por ${usuario.nome || "parceiro"}`,
        descricao: cumprindo.tipo,
        caso_id: cumprindo.caso_id,
        foco_id: r.primeiroDocId || cumprindo.id,
      });
      toast.success(
        "Solicitação cumprida — " +
          r.enviados +
          " documento" +
          (r.enviados > 1 ? "s" : "") +
          " anexado" +
          (r.enviados > 1 ? "s" : ""),
      );
      fecharCumprir();
      await carregar();
    } catch (err) {
      console.error(err);
      toast.error((err as { message?: string })?.message || "Erro ao cumprir a solicitação");
    } finally {
      setSalvando(false);
    }
  }

  if (carregando) {
    return (
      <div className="flex h-96 items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <ClientOnly
      fallback={
        <div className="flex h-96 items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      }
    >
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="font-serif text-3xl font-semibold tracking-tight flex items-center gap-2">
              <ListTodo className="h-6 w-6" />
              Tarefas
            </h1>
            <p className="text-sm text-muted-foreground">
              O que precisa da sua ação, por fase do caso, ordenado pelo prazo. Perícias e
              audiências aparecem como lembrete de compromisso.
            </p>
          </div>
          {totalUrgentes > 0 && (
            <Badge variant="outline" className="border-destructive/50 text-destructive">
              <AlertTriangle className="h-3 w-3 mr-1" />
              {totalUrgentes} com prazo perto do fim
            </Badge>
          )}
        </div>

        {/* Legenda das cores de prazo */}
        <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
          <span className="flex items-center gap-1">
            <span className="h-2 w-2 rounded-full bg-destructive" />
            vence em até 3 dias
          </span>
          <span className="flex items-center gap-1">
            <span className="h-2 w-2 rounded-full bg-amber-500" />
            até 7 dias
          </span>
          <span className="flex items-center gap-1">
            <span className="h-2 w-2 rounded-full bg-muted-foreground/40" />
            sem pressa
          </span>
        </div>

        {totalCards === 0 ? (
          <div className="rounded-lg border bg-card py-16 text-center">
            <CheckCircle2 className="h-10 w-10 mx-auto text-muted-foreground mb-3" />
            <p className="font-medium">Tudo em dia!</p>
            <p className="text-sm text-muted-foreground mt-1">
              Nenhuma pendência aberta nos seus casos. Quando o escritório solicitar um documento
              ou agendar uma perícia/audiência, aparece aqui.
            </p>
          </div>
        ) : (
          <div className="grid gap-3 md:grid-cols-3">
            {FASES.map((f) => {
              const cards = colunas.get(f.fase) ?? [];
              return (
                <div key={f.fase} className="rounded-lg bg-muted/40 p-2 min-w-0">
                  <p className="text-sm font-medium text-muted-foreground px-2 py-1.5">
                    {f.titulo}
                    <span className="ml-1.5 text-xs text-muted-foreground/70">
                      {cards.length}
                    </span>
                  </p>
                  <div className="space-y-2">
                    {cards.length === 0 && (
                      <p className="text-xs text-muted-foreground/70 text-center py-6">
                        Nada por aqui.
                      </p>
                    )}
                    {cards.map((c) =>
                      c.kind === "solicitacao" ? (
                        <CardSolicitacao
                          key={c.key}
                          s={c.s}
                          onCumprir={() => abrirCumprir(c.s)}
                          onAbrirCaso={() =>
                            navigate({
                              to: "/casos/$id",
                              params: { id: c.casoId },
                              search: { tab: "documentos" },
                            })
                          }
                        />
                      ) : (
                        <CardEvento key={c.key} e={c.e} />
                      ),
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Modal Cumprir — anexo obrigatório (parceiro sempre cumpre com arquivo) */}
        <Dialog open={cumprindo !== null} onOpenChange={(o) => !o && fecharCumprir()}>
          <DialogContent className="max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Cumprir solicitação</DialogTitle>
              <DialogDescription>
                Anexe um ou mais arquivos do documento solicitado (ex.: frente e verso). Serão
                renomeados automaticamente.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-3">
              {cumprindo && (
                <p className="text-sm">
                  <span className="text-muted-foreground">Solicitado: </span>
                  <span className="font-medium">
                    {rotuloSolicitacao(cumprindo.tipo, cumprindo.tipos)}
                  </span>
                </p>
              )}
              {cumprindo && (
                <ArquivosCumprimento
                  tiposSolicitacao={tiposDaSolicitacao(cumprindo.tipo, cumprindo.tipos)}
                  arquivos={arquivos}
                  onChange={setArquivos}
                  obrigatorio
                />
              )}
              <div>
                <Label className="text-xs">Observação (opcional)</Label>
                <Textarea
                  rows={3}
                  placeholder="Ex.: documento já consta no CNIS"
                  value={comentario}
                  onChange={(e) => setComentario(e.target.value)}
                />
              </div>
            </div>
            <DialogFooter>
              <Button variant="ghost" onClick={fecharCumprir} disabled={salvando}>
                Cancelar
              </Button>
              <Button onClick={confirmarCumprir} disabled={salvando}>
                {salvando && <Loader2 className="h-3 w-3 mr-2 animate-spin" />}
                Confirmar
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </ClientOnly>
  );
}

// ---------------------------------------------------------------------------
// Cards
// ---------------------------------------------------------------------------

function CardSolicitacao(props: {
  s: SolicPendente;
  onCumprir: () => void;
  onAbrirCaso: () => void;
}) {
  const { s, onCumprir, onAbrirCaso } = props;
  const cat = categoriaSolic(s.origem);
  const urg = urgenciaDoPrazo(s.prazo_at);
  const cliente = s.casos?.clientes?.nome ?? "(cliente sem nome)";

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={`Abrir caso de ${cliente}`}
      onClick={onAbrirCaso}
      onKeyDown={(ev) => {
        if (ev.key === "Enter" || ev.key === " ") onAbrirCaso();
      }}
      className={cn(
        "rounded-md border bg-card p-3 text-left cursor-pointer hover:shadow transition-shadow",
        URGENCIA_BORDA_CLASS[urg],
      )}
    >
      <div className="flex items-center justify-between gap-2 mb-1">
        <span
          className={cn(
            "flex items-center gap-1 text-xs",
            cat.exigencia ? "text-destructive" : "text-muted-foreground",
          )}
        >
          {cat.exigencia ? (
            s.origem === "template:exigencia_judicial" ? (
              <Gavel className="h-3.5 w-3.5" />
            ) : (
              <AlertTriangle className="h-3.5 w-3.5" />
            )
          ) : (
            <FileText className="h-3.5 w-3.5" />
          )}
          {cat.label}
        </span>
        {ehNovo(s.data_solicitacao) && (
          <Badge className="bg-success hover:bg-success text-success-foreground text-[10px] px-1.5">
            Novo
          </Badge>
        )}
      </div>
      <p className="text-sm font-medium break-words">{cliente}</p>
      <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">
        {rotuloSolicitacao(s.tipo, s.tipos)}
      </p>
      <p className={cn("text-xs mt-2 flex items-center gap-1", URGENCIA_TEXTO_CLASS[urg])}>
        <Clock className="h-3 w-3 shrink-0" />
        {s.prazo_at ? textoPrazo(s.prazo_at) : "Sem prazo definido — quanto antes"}
      </p>
      <Button
        size="sm"
        variant="outline"
        className="w-full mt-2"
        onClick={(ev) => {
          ev.stopPropagation();
          onCumprir();
        }}
      >
        <CheckCircle2 className="h-3 w-3 mr-1" />
        Cumprir
      </Button>
    </div>
  );
}

function CardEvento(props: { e: EventoParceiro }) {
  const { e } = props;
  const ehAudiencia = e.tipo === "audiencia";
  const rotulo = ehAudiencia
    ? "Audiência"
    : e.natureza === "judicial"
      ? "Perícia judicial"
      : "Perícia INSS";

  return (
    <Link
      to="/casos/$id"
      params={{ id: e.caso_id! }}
      className="block rounded-md border bg-card p-3 hover:shadow transition-shadow"
    >
      <span
        className={cn(
          "flex items-center gap-1 text-xs mb-1",
          ehAudiencia
            ? "text-blue-700 dark:text-blue-400"
            : "text-amber-700 dark:text-amber-400",
        )}
      >
        {ehAudiencia ? <Scale className="h-3.5 w-3.5" /> : <Stethoscope className="h-3.5 w-3.5" />}
        {rotulo}
      </span>
      <p className="text-sm font-medium break-words">{e.cliente_nome ?? e.titulo}</p>
      <p className="text-xs mt-1.5 flex items-center gap-1 font-medium">
        <CalendarDays className="h-3 w-3 shrink-0" />
        {textoDataEvento(e.start_at)}
      </p>
      {e.local && (
        <p className="text-xs text-muted-foreground mt-0.5 flex items-center gap-1">
          <MapPin className="h-3 w-3 shrink-0" />
          <span className="truncate">{e.local}</span>
        </p>
      )}
    </Link>
  );
}

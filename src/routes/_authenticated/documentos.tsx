import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import {
  Loader2,
  ClipboardList,
  CheckCircle2,
  XCircle,
  Search,
  ExternalLink,
  AlertCircle,
  ChevronDown,
  ChevronRight,
  Pencil,
  Trash2,
  User as UserIcon,
  X,
} from "lucide-react";

import { useAuth } from "@/hooks/use-auth";
import {
  TIPOS_DOCUMENTO_LABEL,
  nomeArquivoPorTipo,
} from "@/lib/documentos/tipos";
import { descreverSolicitante } from "@/lib/documentos/solicitante";
import { listarInternosAtivos } from "@/lib/tarefas/queries";
import { supabase } from "@/lib/supabase";
import { notificarEquipe } from "@/lib/notificar";
import { MAX_FILE_SIZE_MB, validateFileSize } from "@/lib/upload-limits";
import { ClientOnly } from "@/components/client-only";
import { EditarSolicitacaoDialog } from "@/components/documentos/editar-solicitacao-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export const Route = createFileRoute("/_authenticated/documentos")({
  component: DocumentosPendentesPage,
});

// ===========================================================================
// Tipos
// ===========================================================================

interface ClienteLite {
  id: string;
  nome: string;
}

interface CasoLite {
  id: string;
  tipo_beneficio: string;
  fase: string;
  status: string;
  parceiro_id: string | null;
  clientes: ClienteLite | null;
}

interface SolicitacaoComCaso {
  id: string;
  caso_id: string;
  tipo: string;
  descricao: string | null;
  status: string;
  origem: string;
  comentario: string | null;
  documento_id: string | null;
  solicitado_por: string | null;
  solicitante?: { id: string; nome: string | null } | null;
  data_solicitacao: string;
  data_atendimento: string | null;
  casos: CasoLite | null;
}

// ===========================================================================
// Constantes
// ===========================================================================


const ORIGEM_SOLICITACAO_LABEL: Record<string, string> = {
  interna: "Interna (escritório)",
  externa: "Externa (parceiro/cliente)",
};

const STATUS_FASE_CASO_LABEL: Record<string, string> = {
  analise: "Em análise",
  admin: "Administrativo",
  judicial: "Judicial",
  finalizado: "Finalizado",
};

// ===========================================================================
// Helpers
// ===========================================================================

function formatDate(iso: string | null): string {
  if (!iso) return "-";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "-";
  return d.toLocaleDateString("pt-BR");
}

function diasDesde(iso: string | null): number | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (isNaN(d.getTime())) return null;
  const ms = Date.now() - d.getTime();
  return Math.floor(ms / (1000 * 60 * 60 * 24));
}

// ===========================================================================
// Componente principal
// ===========================================================================

function DocumentosPendentesPage() {
  const { usuario } = useAuth();
  const isInterno = usuario?.tipo === "interno";

  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [solicitacoes, setSolicitacoes] = useState<Array<SolicitacaoComCaso>>(
    [],
  );
  const jaCarregouRef = useRef(false);

  // Filtros
  const [filtroStatus, setFiltroStatus] = useState<string>("pendente");
  const [filtroOrigem, setFiltroOrigem] = useState<string>("todas");
  // Filtro por pessoa. Abre em mim mesma (cada um vê o que pediu, sem a fila
  // inteira do escritório), mas dá pra escolher qualquer colega ou "Todos" —
  // serve tanto pra reduzir ruído quanto pra acompanhar o time.
  // Não é confidencialidade: interno já abre qualquer caso.
  const [filtroPessoa, setFiltroPessoa] = useState<string>("__eu__");
  const [internos, setInternos] = useState<Array<{ id: string; nome: string | null }>>([]);
  useEffect(() => {
    if (!isInterno) return;
    listarInternosAtivos().then(setInternos).catch(() => {});
  }, [isInterno]);
  // "__eu__" só vira o id de verdade depois que o usuário carrega.
  const pessoaAlvo = filtroPessoa === "__eu__" ? usuario?.id ?? null : filtroPessoa;
  const [busca, setBusca] = useState("");

  // Modal de acao (atendido/dispensado)
  const [acaoAlvo, setAcaoAlvo] = useState<{
    solic: SolicitacaoComCaso;
    novoStatus: string;
  } | null>(null);
  const [comentarioModal, setComentarioModal] = useState("");
  const [salvandoModal, setSalvandoModal] = useState(false);
  // Solicitação pendente sendo editada (só interno).
  const [solicEditando, setSolicEditando] = useState<SolicitacaoComCaso | null>(null);
  // Upload de arquivo no atendimento
  // Cumprimento aceita VÁRIOS arquivos (pedido dos parceiros, 2026-08-26).
  const [arquivosUpload, setArquivosUpload] = useState<Array<{ file: File; nome: string }>>([]);
  const [comAnexo, setComAnexo] = useState(false);
  // Nome editavel pelo usuario (pre-preenchido com auto-rename)

  const carregar = useCallback(async () => {
    if (!jaCarregouRef.current) {
      setLoading(true);
    }
    setErro(null);
    try {
      const resp = await supabase
        .from("solicitacoes_documento")
        .select(
          "id, caso_id, tipo, descricao, status, origem, comentario, documento_id, solicitado_por, data_solicitacao, data_atendimento, solicitante:usuarios!solicitacoes_documento_solicitado_por_fkey(id, nome), casos(id, tipo_beneficio, fase, status, parceiro_id, clientes(id, nome))",
        )
        .order("data_solicitacao", { ascending: false });
      if (resp.error) throw resp.error;
      const dados = (resp.data || []) as unknown as Array<SolicitacaoComCaso>;
      setSolicitacoes(dados);
    } catch (err) {
      console.error(err);
      const errObj = err as { message?: string };
      setErro(errObj.message || "Erro ao carregar solicitações");
    } finally {
      setLoading(false);
      jaCarregouRef.current = true;
    }
  }, []);

  useEffect(() => {
    carregar();
  }, [carregar]);

  // Filtragem
  const solicitacoesFiltradas = useMemo(() => {
    const buscaLower = busca.trim().toLowerCase();
    return solicitacoes.filter((s) => {
      // Status
      if (filtroStatus !== "todos" && s.status !== filtroStatus) return false;
      // Origem
      if (filtroOrigem !== "todas" && s.origem !== filtroOrigem) return false;
      // Por pessoa. Parceiro não filtra — o que ele enxerga já é só dos
      // casos dele (RLS).
      if (isInterno && filtroPessoa !== "__todos__" && s.solicitado_por !== pessoaAlvo) {
        return false;
      }
      // Busca por cliente ou tipo doc
      if (buscaLower) {
        const nomeCliente =
          s.casos && s.casos.clientes ? s.casos.clientes.nome.toLowerCase() : "";
        const tipoLabel = (TIPOS_DOCUMENTO_LABEL[s.tipo] || s.tipo).toLowerCase();
        const tipoBeneficio = s.casos
          ? s.casos.tipo_beneficio.toLowerCase()
          : "";
        if (
          !nomeCliente.includes(buscaLower) &&
          !tipoLabel.includes(buscaLower) &&
          !tipoBeneficio.includes(buscaLower)
        ) {
          return false;
        }
      }
      return true;
    });
  }, [solicitacoes, filtroStatus, filtroOrigem, busca, filtroPessoa, pessoaAlvo, isInterno]);

  // Agrupar por caso
  const gruposPorCaso = useMemo(() => {
    const mapa = new Map<
      string,
      { caso: CasoLite; solicitacoes: Array<SolicitacaoComCaso> }
    >();
    for (const s of solicitacoesFiltradas) {
      if (!s.casos) continue;
      const ja = mapa.get(s.caso_id);
      if (ja) {
        ja.solicitacoes.push(s);
      } else {
        mapa.set(s.caso_id, { caso: s.casos, solicitacoes: [s] });
      }
    }
    return Array.from(mapa.values());
  }, [solicitacoesFiltradas]);


  function abrirAcaoModal(s: SolicitacaoComCaso, novoStatus: string) {
    setAcaoAlvo({ solic: s, novoStatus: novoStatus });
    setComentarioModal(s.comentario || "");
    setArquivosUpload([]);
    // Parceiro SEMPRE cumpre com arquivo. Interno por default sem arquivo.
    setComAnexo(!isInterno && novoStatus === "atendido");
  }

  function fecharAcaoModal() {
    setAcaoAlvo(null);
    setComentarioModal("");
    setSalvandoModal(false);
    setArquivosUpload([]);
    setComAnexo(false);
  }

  // Mesma sanitizacao usada nos uploads avulsos (casos.$id.tsx): Storage
  // rejeita chave com acento ("Invalid key").
  function sanitizeFileName(name: string): string {
    return name
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-zA-Z0-9._-]/g, "_");
  }

  // Renomeia arquivo para o nome do tipo solicitado (ex.: CNIS.pdf)
  function nomearArquivo(tipoSolic: string, arquivoOriginal: File): string {
    return nomeArquivoPorTipo(tipoSolic, null, arquivoOriginal.name);
  }

  // Vários arquivos do mesmo tipo: o 2º em diante ganha sufixo _(n) antes da
  // extensão, senão os nomes (e paths no Storage) colidiriam.
  function nomearArquivoMulti(tipoSolic: string, arquivo: File, indice: number): string {
    const nome = nomearArquivo(tipoSolic, arquivo);
    if (indice === 0) return nome;
    const ponto = nome.lastIndexOf(".");
    return ponto > 0
      ? nome.slice(0, ponto) + "_(" + (indice + 1) + ")" + nome.slice(ponto)
      : nome + "_(" + (indice + 1) + ")";
  }

  // Excluir de vez a solicitacao. Diferente de "Dispensar", que mantem o
  // registro com status dispensado (fica no historico): aqui o pedido some.
  // Serve pra pedido criado por engano, que nao deveria ter existido.
  async function excluirSolicitacao(s: SolicitacaoComCaso) {
    const nome = s.casos?.clientes?.nome;
    const ok = window.confirm(
      `Excluir definitivamente esta solicitacao${nome ? " de " + nome : ""}?\n\n` +
        `"${s.tipo}"\n\n` +
        "Some do historico e nao da pra desfazer. Se a ideia e so encerrar o " +
        "pedido, use Dispensar — ele fica registrado.",
    );
    if (!ok) return;
    try {
      const del = await supabase
        .from("solicitacoes_documento")
        .delete()
        .eq("id", s.id);
      if (del.error) throw del.error;
      setSolicitacoes((atual) => atual.filter((x) => x.id !== s.id));
      window.dispatchEvent(new Event("msc:solicitacoes-mudou"));
      toast.success("Solicitacao excluida.");
    } catch (err) {
      const e = err as { message?: string };
      toast.error(e.message || "Nao foi possivel excluir.");
    }
  }

  async function confirmarAcaoModal() {
    if (!acaoAlvo) return;
    if (acaoAlvo.novoStatus === "atendido" && comAnexo && arquivosUpload.length === 0) {
      toast.error("Selecione pelo menos um arquivo para anexar");
      return;
    }
    // Nome obrigatorio em todos os arquivos quando ha upload.
    if (
      acaoAlvo.novoStatus === "atendido" &&
      comAnexo &&
      arquivosUpload.some((a) => !a.nome.trim())
    ) {
      toast.error("Informe o nome de todos os arquivos");
      return;
    }
    // Valida tamanho antes de subir pra evitar erro generico do Storage.
    for (const a of arquivosUpload) {
      const erroTamanho = validateFileSize(a.file);
      if (erroTamanho) {
        toast.error(a.file.name + ": " + erroTamanho);
        return;
      }
    }
    setSalvandoModal(true);
    try {
      let primeiroDocId: string | null = null;
      let enviados = 0;
      const falhas: Array<{ file: File; nome: string }> = [];

      // Upload + criacao de documento, um por arquivo (frente/verso, varias
      // paginas). Falha num arquivo NAO derruba os demais: os que subiram
      // ficam vinculados (solicitacao_id) e os que falharam voltam pra lista.
      if (acaoAlvo.novoStatus === "atendido" && comAnexo && usuario) {
        for (const a of arquivosUpload) {
          try {
            const nomeArq = a.nome.trim();
            // Path sempre sanitizado; nome_arquivo mantém acento pra exibição.
            // upsert só pra interno: a RLS de UPDATE em storage.objects exige
            // is_interno(), e supabase-js com upsert=true dispara INSERT ON
            // CONFLICT DO UPDATE — que tropeça na policy mesmo sem conflito
            // real. Parceiro leva prefixo de timestamp no path (nome
            // auto-gerado é fixo por tipo, então re-solicitação do mesmo tipo
            // colidiria).
            const path =
              acaoAlvo.solic.caso_id +
              "/" +
              (isInterno ? "" : Date.now() + "_") +
              sanitizeFileName(nomeArq);
            const upResp = await supabase.storage
              .from("documentos")
              .upload(path, a.file, { upsert: isInterno });
            if (upResp.error) throw upResp.error;
            const docInsert = await supabase
              .from("documentos")
              .insert({
                caso_id: acaoAlvo.solic.caso_id,
                tipo: acaoAlvo.solic.tipo,
                nome_arquivo: nomeArq,
                storage_path: path,
                tamanho_bytes: a.file.size,
                uploaded_by: usuario.id,
                visivel_parceiro: true,
                solicitacao_id: acaoAlvo.solic.id,
              })
              .select("id")
              .single();
            if (docInsert.error) throw docInsert.error;
            if (!primeiroDocId) primeiroDocId = (docInsert.data as { id: string }).id;
            enviados++;
          } catch (err) {
            console.error("[solicitacao] upload falhou:", a.nome, err);
            falhas.push(a);
          }
        }

        if (falhas.length > 0) {
          // Não marca atendido com arquivo faltando: os que falharam ficam na
          // lista pra nova tentativa; os enviados já estão vinculados.
          setArquivosUpload(falhas);
          toast.error(
            enviados +
              " de " +
              (enviados + falhas.length) +
              " arquivo(s) enviados — os que falharam continuam na lista, tente de novo.",
          );
          return;
        }
      }

      // Atualiza a solicitacao
      const update: {
        status: string;
        data_atendimento?: string | null;
        comentario?: string | null;
        documento_id?: string | null;
      } = { status: acaoAlvo.novoStatus };
      if (acaoAlvo.novoStatus === "atendido") {
        update.data_atendimento = new Date().toISOString();
      }
      update.comentario = comentarioModal.trim() || null;
      // documento_id (legado, 1:1) aponta pro primeiro arquivo; se uma
      // tentativa anterior já gravou um, mantém.
      if (primeiroDocId && !acaoAlvo.solic.documento_id) {
        update.documento_id = primeiroDocId;
      }
      const resp = await supabase
        .from("solicitacoes_documento")
        .update(update)
        .eq("id", acaoAlvo.solic.id);
      if (resp.error) throw resp.error;
      // Atualiza o badge de pendentes na sidebar sem esperar o poll.
      window.dispatchEvent(new Event("msc:solicitacoes-mudou"));
      // Se quem cumpriu foi o PARCEIRO, avisa o sino da equipe (interno) —
      // mesmo padrão da tela do caso (casos.$id.tsx).
      if (usuario?.tipo === "parceiro") {
        notificarEquipe({
          tipo: enviados > 0 ? "documento" : "solicitacao",
          titulo:
            enviados > 1
              ? `${enviados} documentos enviados por ${usuario.nome || "parceiro"}`
              : enviados === 1
                ? `Documento enviado por ${usuario.nome || "parceiro"}`
                : `Solicitação atualizada por ${usuario.nome || "parceiro"}`,
          descricao: acaoAlvo.solic.tipo,
          caso_id: acaoAlvo.solic.caso_id,
          foco_id: primeiroDocId || acaoAlvo.solic.id,
        });
      }
      toast.success(
        enviados > 0
          ? "Solicitação cumprida — " +
              enviados +
              " documento" +
              (enviados > 1 ? "s" : "") +
              " anexado" +
              (enviados > 1 ? "s" : "")
          : "Solicitação atualizada",
      );
      await carregar();
      fecharAcaoModal();
    } catch (err) {
      // Erro no update da solicitação: modal fica aberto pra tentar de novo
      // (os documentos já enviados permanecem vinculados).
      console.error(err);
      const errObj = err as { message?: string };
      toast.error(errObj.message || "Erro ao atualizar solicitação");
    } finally {
      setSalvandoModal(false);
    }
  }

  if (loading) {
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
      <div className="space-y-6">
        <div>
          <h1 className="font-serif text-3xl font-semibold tracking-tight flex items-center gap-2">
            <ClipboardList className="h-6 w-6" />
            Documentos pendentes
          </h1>
          <p className="text-sm text-muted-foreground">
            {isInterno
              ? "Visão consolidada de todas as solicitações do escritório."
              : "Documentos que você precisa providenciar para os casos."}
          </p>
        </div>

        {/* Filtros */}
        <Card>
          <CardContent className="pt-4 grid gap-3 sm:grid-cols-4">
            <div className="sm:col-span-2">
              <Label className="text-xs">Buscar</Label>
              <div className="relative">
                <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  className="pl-8"
                  placeholder="Cliente, tipo de documento, benefício..."
                  value={busca}
                  onChange={(e) => setBusca(e.target.value)}
                />
              </div>
            </div>
            <div>
              <Label className="text-xs">Status</Label>
              <Select value={filtroStatus} onValueChange={setFiltroStatus}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="pendente">Pendentes</SelectItem>
                  <SelectItem value="atendido">Atendidas</SelectItem>
                  <SelectItem value="dispensado">Dispensadas</SelectItem>
                  <SelectItem value="todos">Todas</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Origem</Label>
              <Select value={filtroOrigem} onValueChange={setFiltroOrigem}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="todas">Todas</SelectItem>
                  <SelectItem value="interna">Interna</SelectItem>
                  <SelectItem value="externa">Externa</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {isInterno && (
              <div>
                <Label className="text-xs">Solicitado por</Label>
                <Select value={filtroPessoa} onValueChange={setFiltroPessoa}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__eu__">Eu</SelectItem>
                    <SelectItem value="__todos__">Todos do escritório</SelectItem>
                    {internos
                      // Fora os usuários de teste ([E2E], [TESTE]) — existem
                      // em produção e não são gente do escritório.
                      .filter((u) => u.id !== usuario?.id && !(u.nome ?? "").startsWith("["))
                      .map((u) => (
                        <SelectItem key={u.id} value={u.id}>
                          {u.nome ?? "(sem nome)"}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Erro */}
        {erro && (
          <Card>
            <CardContent className="py-6 text-center">
              <AlertCircle className="h-8 w-8 mx-auto text-destructive mb-2" />
              <p className="text-sm text-destructive">{erro}</p>
            </CardContent>
          </Card>
        )}

        {/* Lista agrupada por caso */}
        {!erro && gruposPorCaso.length === 0 ? (
          <Card>
            <CardContent className="py-12 text-center">
              <ClipboardList className="h-10 w-10 mx-auto text-muted-foreground mb-2" />
              <p className="text-sm text-muted-foreground">
                Nenhuma solicitação encontrada com os filtros aplicados.
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-4">
            {gruposPorCaso.map((grupo) => (
              <GrupoCaso
                key={grupo.caso.id}
                grupo={grupo}
                isInterno={isInterno}
                onAtendido={(s) => abrirAcaoModal(s, "atendido")}
                onDispensar={(s) => abrirAcaoModal(s, "dispensado")}
                onEditar={setSolicEditando}
                onExcluir={excluirSolicitacao}
              />
            ))}
          </div>
        )}

        {/* Modal de acao */}
        <Dialog
          open={acaoAlvo !== null}
          onOpenChange={(o) => {
            if (!o) fecharAcaoModal();
          }}
        >
          <DialogContent className="max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>
                {acaoAlvo && acaoAlvo.novoStatus === "atendido"
                  ? isInterno
                    ? "Marcar como atendido"
                    : "Cumprir solicitação"
                  : "Dispensar solicitação"}
              </DialogTitle>
              <DialogDescription>
                {acaoAlvo && acaoAlvo.novoStatus === "atendido"
                  ? isInterno
                    ? "Marque sem arquivo (recebeu pessoalmente) ou anexe o documento."
                    : "Anexe um ou mais arquivos do documento solicitado (ex.: frente e verso). Serão renomeados automaticamente."
                  : "Informe o motivo da dispensa (recomendado)."}
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-3">
              {/* Radio "como atender" - so para interno + atendido */}
              {isInterno &&
                acaoAlvo &&
                acaoAlvo.novoStatus === "atendido" && (
                  <div className="space-y-2">
                    <Label className="text-xs">Como atender</Label>
                    <div className="flex flex-col gap-2">
                      <label className="flex items-start gap-2 cursor-pointer">
                        <input
                          type="radio"
                          name="comAnexo"
                          checked={!comAnexo}
                          onChange={() => {
                            setComAnexo(false);
                            setArquivosUpload([]);
                          }}
                          className="h-4 w-4 mt-0.5"
                        />
                        <span className="text-sm">
                          Sem arquivo (recebi pessoalmente)
                        </span>
                      </label>
                      <label className="flex items-start gap-2 cursor-pointer">
                        <input
                          type="radio"
                          name="comAnexo"
                          checked={comAnexo}
                          onChange={() => setComAnexo(true)}
                          className="h-4 w-4 mt-0.5"
                        />
                        <span className="text-sm">
                          Anexar arquivo(s) (serão renomeados para o tipo
                          solicitado)
                        </span>
                      </label>
                    </div>
                  </div>
                )}

              {/* File input - aparece quando comAnexo=true */}
              {acaoAlvo &&
                acaoAlvo.novoStatus === "atendido" &&
                comAnexo && (
                  <div>
                    <Label className="text-xs">
                      Arquivos {!isInterno && "(pelo menos um)"}
                    </Label>
                    <input
                      type="file"
                      multiple
                      onChange={(e) => {
                        const files = Array.from(e.target.files ?? []);
                        if (files.length === 0 || !acaoAlvo) return;
                        // Pre-preenche cada nome com a auto-renomeacao (o 2º
                        // em diante com sufixo). Usuario edita item a item.
                        setArquivosUpload((atual) => [
                          ...atual,
                          ...files.map((f, i) => ({
                            file: f,
                            nome: nomearArquivoMulti(acaoAlvo.solic.tipo, f, atual.length + i),
                          })),
                        ]);
                        // Limpa o input: permite adicionar mais depois.
                        e.target.value = "";
                      }}
                      className="block w-full text-sm border rounded-md p-2"
                      accept=".pdf,.jpg,.jpeg,.png,.doc,.docx,.xls,.xlsx"
                    />
                    <p className="text-xs text-muted-foreground mt-1">
                      Pode escolher vários de uma vez (ou adicionar aos poucos).
                      Tamanho máximo: {MAX_FILE_SIZE_MB} MB por arquivo.
                    </p>
                    {arquivosUpload.length > 0 && (
                      <div className="mt-2 space-y-2">
                        <Label className="text-xs">
                          Nome dos arquivos (obrigatório) — mantenha a extensão
                          (.pdf, .jpg, etc.)
                        </Label>
                        {arquivosUpload.map((a, i) => (
                          <div key={i} className="flex items-center gap-2">
                            <div className="min-w-0 flex-1">
                              <Input
                                value={a.nome}
                                onChange={(e) =>
                                  setArquivosUpload((atual) =>
                                    atual.map((x, j) =>
                                      j === i ? { ...x, nome: e.target.value } : x,
                                    ),
                                  )
                                }
                                placeholder="Ex: RG_e_CPF_Joao.pdf"
                                className="text-sm"
                                aria-label={"Nome do arquivo " + (i + 1)}
                              />
                              <p className="text-xs text-muted-foreground truncate mt-0.5">
                                {a.file.name}
                              </p>
                            </div>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() =>
                                setArquivosUpload((atual) =>
                                  atual.filter((_, j) => j !== i),
                                )
                              }
                              title="Remover arquivo"
                              aria-label={"Remover arquivo " + (i + 1)}
                            >
                              <X className="h-4 w-4" />
                            </Button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}

              <div>
                <Label className="text-xs">
                  {acaoAlvo && acaoAlvo.novoStatus === "atendido"
                    ? "Observação (opcional)"
                    : "Motivo"}
                </Label>
                <Textarea
                  rows={3}
                  placeholder={
                    acaoAlvo && acaoAlvo.novoStatus === "atendido"
                      ? "Ex.: documento já consta no CNIS"
                      : "Ex.: cliente não consegue obter; não necessário para o benefício"
                  }
                  value={comentarioModal}
                  onChange={(e) => setComentarioModal(e.target.value)}
                />
              </div>
            </div>
            <DialogFooter>
              <Button
                variant="ghost"
                onClick={fecharAcaoModal}
                disabled={salvandoModal}
              >
                Cancelar
              </Button>
              <Button onClick={confirmarAcaoModal} disabled={salvandoModal}>
                {salvandoModal && (
                  <Loader2 className="h-3 w-3 mr-2 animate-spin" />
                )}
                Confirmar
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
        {/* Edição de solicitação pendente (interno only). */}
        {isInterno && (
          <EditarSolicitacaoDialog
            solic={solicEditando}
            onFechar={() => setSolicEditando(null)}
            onSalvo={() => {
              setSolicEditando(null);
              carregar();
            }}
          />
        )}
      </div>
    </ClientOnly>
  );
}

// ===========================================================================
// Sub-componente: GrupoCaso
// ===========================================================================

interface GrupoCasoProps {
  grupo: { caso: CasoLite; solicitacoes: Array<SolicitacaoComCaso> };
  isInterno: boolean;
  onAtendido: (s: SolicitacaoComCaso) => void;
  onDispensar: (s: SolicitacaoComCaso) => void;
  onEditar: (s: SolicitacaoComCaso) => void;
  onExcluir: (s: SolicitacaoComCaso) => void;
}

function GrupoCaso(props: GrupoCasoProps) {
  const { grupo, isInterno, onAtendido, onDispensar, onEditar, onExcluir } = props;
  const { caso, solicitacoes } = grupo;
  const nomeCliente = caso.clientes ? caso.clientes.nome : "(cliente sem nome)";
  const [cumpridosAberto, setCumpridosAberto] = useState(false);

  const pendentes = solicitacoes.filter((s) => s.status === "pendente");
  const cumpridos = solicitacoes.filter((s) => s.status !== "pendente");

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-2 flex-wrap">
          <div>
            <CardTitle className="text-base">{nomeCliente}</CardTitle>
            <CardDescription className="flex items-center gap-2 flex-wrap">
              <span>{caso.tipo_beneficio}</span>
              <Badge variant="outline" className="text-xs">
                Fase: {STATUS_FASE_CASO_LABEL[caso.fase] || caso.fase}
              </Badge>
            </CardDescription>
          </div>
          <Button size="sm" variant="outline" asChild>
            <Link to="/casos/$id" params={{ id: caso.id }}>
              <ExternalLink className="h-3 w-3 mr-1" />
              Abrir caso
            </Link>
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {pendentes.length > 0 && (
          <ul className="space-y-2">
            {pendentes.map((s) => (
              <SolicitacaoItem
                key={s.id}
                s={s}
                isInterno={isInterno}
                onAtendido={onAtendido}
                onDispensar={onDispensar}
                onEditar={onEditar}
                onExcluir={onExcluir}
              />
            ))}
          </ul>
        )}
        {pendentes.length === 0 && cumpridos.length > 0 && (
          <p className="text-sm text-muted-foreground text-center py-3">
            Nenhuma solicitação pendente.
          </p>
        )}
        {cumpridos.length > 0 && (
          <div className="border rounded-md overflow-hidden border-dashed">
            <button
              type="button"
              onClick={() => setCumpridosAberto(!cumpridosAberto)}
              className="w-full flex items-center justify-between p-3 hover:bg-muted/50 transition-colors text-left"
            >
              <div className="flex items-center gap-2 min-w-0">
                {cumpridosAberto ? (
                  <ChevronDown className="h-4 w-4 shrink-0" />
                ) : (
                  <ChevronRight className="h-4 w-4 shrink-0" />
                )}
                <span className="text-sm font-medium truncate">
                  Solicitações cumpridas
                </span>
              </div>
              <span className="text-xs text-muted-foreground shrink-0">
                {cumpridos.length}{" "}
                {cumpridos.length === 1 ? "solicitação" : "solicitações"}
              </span>
            </button>
            {cumpridosAberto && (
              <ul className="space-y-2 p-3 border-t">
                {cumpridos.map((s) => (
                  <SolicitacaoItem
                    key={s.id}
                    s={s}
                    isInterno={isInterno}
                    onAtendido={onAtendido}
                    onDispensar={onDispensar}
                    onEditar={onEditar}
                    onExcluir={onExcluir}
                  />
                ))}
              </ul>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ===========================================================================
// Sub-componente: SolicitacaoItem
// ===========================================================================

interface SolicitacaoItemProps {
  s: SolicitacaoComCaso;
  isInterno: boolean;
  onAtendido: (s: SolicitacaoComCaso) => void;
  onDispensar: (s: SolicitacaoComCaso) => void;
  onEditar: (s: SolicitacaoComCaso) => void;
  onExcluir: (s: SolicitacaoComCaso) => void;
}

function SolicitacaoItem(props: SolicitacaoItemProps) {
  const { s, isInterno, onAtendido, onDispensar, onEditar, onExcluir } = props;
  const isPendente = s.status === "pendente";
  const isAtendido = s.status === "atendido";
  const isDispensado = s.status === "dispensado";
  const dias = diasDesde(s.data_solicitacao);

  return (
    <li
      className={
        "border rounded-md p-3 " +
        (isAtendido || isDispensado ? "bg-muted/30" : "")
      }
    >
      <div className="flex items-start justify-between gap-2 flex-wrap">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-sm font-medium">
              {TIPOS_DOCUMENTO_LABEL[s.tipo] || s.tipo}
            </p>
            {isPendente && (
              <Badge className="bg-warning hover:bg-warning text-warning-foreground">
                Pendente
              </Badge>
            )}
            {isAtendido && (
              <Badge className="bg-success hover:bg-success text-success-foreground">
                <CheckCircle2 className="h-3 w-3 mr-1" />
                Atendido
              </Badge>
            )}
            {isDispensado && (
              <Badge variant="outline">
                <XCircle className="h-3 w-3 mr-1" />
                Dispensado
              </Badge>
            )}
            <Badge variant="outline" className="font-normal">
              {ORIGEM_SOLICITACAO_LABEL[s.origem] || s.origem}
            </Badge>
            {isPendente && dias !== null && dias > 7 && (
              <Badge
                variant="outline"
                className="border-destructive text-destructive"
              >
                {dias}d em aberto
              </Badge>
            )}
          </div>
          {s.descricao && (
            <p className="text-xs text-muted-foreground mt-1 whitespace-pre-wrap">
              {s.descricao}
            </p>
          )}
          {/* Quem abriu o pedido. Fica sempre visível: no modo "todas do
              escritório" é a informação que faltava pra saber de quem é
              cada um; no modo filtrado, confirma que o recorte está certo.
              Pedido do robô do INSS (solicitado_por nulo) é dito como tal. */}
          <p className="text-xs mt-1.5 flex items-center gap-1">
            <UserIcon className="h-3 w-3 shrink-0 text-muted-foreground" />
            <span className="text-muted-foreground">Solicitado por</span>{" "}
            <span className="font-medium">{descreverSolicitante(s.solicitante, s.origem)}</span>
          </p>
          <p className="text-xs text-muted-foreground mt-0.5">
            Solicitado em {formatDate(s.data_solicitacao)}
            {s.data_atendimento
              ? " - Atendido em " + formatDate(s.data_atendimento)
              : ""}
          </p>
          {s.comentario && (
            <div className="mt-2 pt-2 border-t border-dashed">
              <p className="text-xs text-muted-foreground mb-1">
                {isAtendido
                  ? "Observação do atendimento"
                  : isDispensado
                  ? "Motivo da dispensa"
                  : "Comentário"}
              </p>
              <p className="text-sm whitespace-pre-wrap italic">
                {s.comentario}
              </p>
            </div>
          )}
        </div>
        {isInterno && isPendente && (
          <div className="flex gap-1">
            <Button
              size="sm"
              variant="outline"
              onClick={() => onAtendido(s)}
            >
              <CheckCircle2 className="h-3 w-3 mr-1" />
              Atendido
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => onDispensar(s)}
            >
              Dispensar
            </Button>
            {/* Editar tipo/observação — só interno. Útil sobretudo nas de
                template (texto bruto do despacho do INSS). */}
            <Button
              size="sm"
              variant="ghost"
              onClick={() => onEditar(s)}
              title="Editar solicitação"
            >
              <Pencil className="h-3 w-3" />
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="text-muted-foreground hover:text-destructive"
              onClick={() => onExcluir(s)}
              title="Excluir de vez (Dispensar mantem no historico)"
            >
              <Trash2 className="h-3 w-3" />
            </Button>
          </div>
        )}
        {/* Ja cumprida/dispensada: continua dando pra excluir de vez, senao
            pedido criado por engano fica preso no historico pra sempre. */}
        {isInterno && !isPendente && (
          <Button
            size="sm"
            variant="ghost"
            className="text-muted-foreground hover:text-destructive"
            onClick={() => onExcluir(s)}
            title="Excluir do histórico"
          >
            <Trash2 className="h-3 w-3" />
          </Button>
        )}
        {!isInterno && isPendente && (
          <div className="flex gap-1">
            <Button
              size="sm"
              variant="outline"
              onClick={() => onAtendido(s)}
            >
              <CheckCircle2 className="h-3 w-3 mr-1" />
              Cumprir
            </Button>
          </div>
        )}
      </div>
    </li>
  );
}

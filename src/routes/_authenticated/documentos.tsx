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
} from "lucide-react";

import { useAuth } from "@/hooks/use-auth";
import { supabase } from "@/lib/supabase";
import { ClientOnly } from "@/components/client-only";
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
  data_solicitacao: string;
  data_atendimento: string | null;
  casos: CasoLite | null;
}

// ===========================================================================
// Constantes
// ===========================================================================

const TIPOS_DOCUMENTO_LABEL: Record<string, string> = {
  cnis: "CNIS",
  rg_cpf: "RG / CPF",
  comprovante_residencia: "Comprovante de residencia",
  ctps: "CTPS",
  holerite: "Holerite / contracheque",
  ppp: "PPP",
  laudo_medico: "Laudo medico",
  ltcat: "LTCAT",
  atestado_medico: "Atestado medico",
  cat: "CAT",
  carne_gps: "Carne de contribuicao (GPS)",
  ctc: "CTC",
  carta_concessao_inss: "Carta de concessao/indeferimento INSS",
  hiscre: "HISCRE",
  certidao_casamento: "Certidao de casamento",
  certidao_obito: "Certidao de obito",
  certidao_nascimento: "Certidao de nascimento",
  declaracao_uniao_estavel: "Declaracao de uniao estavel",
  declaracao_atividade_rural: "Declaracao de atividade rural",
  procuracao: "Procuracao",
  contrato_honorarios: "Contrato de honorarios",
  outro: "Outro",
};

const ORIGEM_SOLICITACAO_LABEL: Record<string, string> = {
  interna: "Interna (escritorio)",
  externa: "Externa (parceiro/cliente)",
};

const STATUS_FASE_CASO_LABEL: Record<string, string> = {
  analise: "Em analise",
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
  const [busca, setBusca] = useState("");

  // Modal de acao (atendido/dispensado)
  const [acaoAlvo, setAcaoAlvo] = useState<{
    solic: SolicitacaoComCaso;
    novoStatus: string;
  } | null>(null);
  const [comentarioModal, setComentarioModal] = useState("");
  const [salvandoModal, setSalvandoModal] = useState(false);
  // Upload de arquivo no atendimento
  const [arquivoUpload, setArquivoUpload] = useState<File | null>(null);
  const [comAnexo, setComAnexo] = useState(false);

  const carregar = useCallback(async () => {
    if (!jaCarregouRef.current) {
      setLoading(true);
    }
    setErro(null);
    try {
      const resp = await supabase
        .from("solicitacoes_documento")
        .select(
          "id, caso_id, tipo, descricao, status, origem, comentario, documento_id, solicitado_por, data_solicitacao, data_atendimento, casos(id, tipo_beneficio, fase, status, parceiro_id, clientes(id, nome))",
        )
        .order("data_solicitacao", { ascending: false });
      if (resp.error) throw resp.error;
      const dados = (resp.data || []) as unknown as Array<SolicitacaoComCaso>;
      setSolicitacoes(dados);
    } catch (err) {
      console.error(err);
      const errObj = err as { message?: string };
      setErro(errObj.message || "Erro ao carregar solicitacoes");
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
  }, [solicitacoes, filtroStatus, filtroOrigem, busca]);

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

  const totalPendentes = solicitacoes.filter((s) => s.status === "pendente").length;
  const totalInterna = solicitacoes.filter(
    (s) => s.status === "pendente" && s.origem === "interna",
  ).length;
  const totalExterna = solicitacoes.filter(
    (s) => s.status === "pendente" && s.origem === "externa",
  ).length;

  function abrirAcaoModal(s: SolicitacaoComCaso, novoStatus: string) {
    setAcaoAlvo({ solic: s, novoStatus: novoStatus });
    setComentarioModal(s.comentario || "");
    setArquivoUpload(null);
    // Parceiro SEMPRE cumpre com arquivo. Interno por default sem arquivo.
    setComAnexo(!isInterno && novoStatus === "atendido");
  }

  function fecharAcaoModal() {
    setAcaoAlvo(null);
    setComentarioModal("");
    setSalvandoModal(false);
    setArquivoUpload(null);
    setComAnexo(false);
  }

  // Renomeia arquivo para o nome do tipo solicitado (ex.: CNIS.pdf)
  function nomearArquivo(tipoSolic: string, arquivoOriginal: File): string {
    const ext = arquivoOriginal.name.includes(".")
      ? arquivoOriginal.name.split(".").pop() || "pdf"
      : "pdf";
    const label = TIPOS_DOCUMENTO_LABEL[tipoSolic] || tipoSolic;
    // Sanitiza label: troca caracteres problematicos por _
    const labelSanit = label
      .replace(/[\/\\?*:|"<>]/g, "_")
      .replace(/\s+/g, "_")
      .trim();
    return labelSanit + "." + ext.toLowerCase();
  }

  async function confirmarAcaoModal() {
    if (!acaoAlvo) return;
    // Se for atendido com anexo, valida arquivo
    if (acaoAlvo.novoStatus === "atendido" && comAnexo && !arquivoUpload) {
      toast.error("Selecione um arquivo para anexar");
      return;
    }
    setSalvandoModal(true);
    try {
      let documentoId: string | null = null;

      // Upload + criacao de documento (se houver arquivo)
      if (
        acaoAlvo.novoStatus === "atendido" &&
        comAnexo &&
        arquivoUpload &&
        usuario
      ) {
        const nomeArq = nomearArquivo(acaoAlvo.solic.tipo, arquivoUpload);
        const path = acaoAlvo.solic.caso_id + "/" + nomeArq;
        // upsert=true permite re-enviar mesmo nome (sobrescreve)
        const upResp = await supabase.storage
          .from("documentos")
          .upload(path, arquivoUpload, { upsert: true });
        if (upResp.error) throw upResp.error;
        const docInsert = await supabase
          .from("documentos")
          .insert({
            caso_id: acaoAlvo.solic.caso_id,
            tipo: acaoAlvo.solic.tipo,
            nome_arquivo: nomeArq,
            storage_path: path,
            tamanho_bytes: arquivoUpload.size,
            uploaded_by: usuario.id,
            visivel_parceiro: true,
          })
          .select("id")
          .single();
        if (docInsert.error) throw docInsert.error;
        documentoId = (docInsert.data as { id: string }).id;
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
      if (documentoId) {
        update.documento_id = documentoId;
      }
      const resp = await supabase
        .from("solicitacoes_documento")
        .update(update)
        .eq("id", acaoAlvo.solic.id);
      if (resp.error) throw resp.error;
      toast.success(
        documentoId
          ? "Solicitacao cumprida e documento anexado"
          : "Solicitacao atualizada",
      );
      await carregar();
    } catch (err) {
      console.error(err);
      const errObj = err as { message?: string };
      toast.error(errObj.message || "Erro ao atualizar solicitacao");
    } finally {
      setSalvandoModal(false);
      setAcaoAlvo(null);
      setComentarioModal("");
      setArquivoUpload(null);
      setComAnexo(false);
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
          <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2">
            <ClipboardList className="h-6 w-6" />
            Documentos pendentes
          </h1>
          <p className="text-sm text-muted-foreground">
            {isInterno
              ? "Visao consolidada de todas as solicitacoes do escritorio."
              : "Documentos que voce precisa providenciar para os casos."}
          </p>
        </div>

        {/* Metricas */}
        <div className="grid gap-3 grid-cols-2 sm:grid-cols-3">
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>Pendentes</CardDescription>
              <CardTitle className="text-3xl">{totalPendentes}</CardTitle>
            </CardHeader>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>Interna (escritorio)</CardDescription>
              <CardTitle className="text-3xl text-blue-700">
                {totalInterna}
              </CardTitle>
            </CardHeader>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>Externa (parceiro/cliente)</CardDescription>
              <CardTitle className="text-3xl text-purple-700">
                {totalExterna}
              </CardTitle>
            </CardHeader>
          </Card>
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
                  placeholder="Cliente, tipo de documento, beneficio..."
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
                Nenhuma solicitacao encontrada com os filtros aplicados.
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
                    : "Cumprir solicitacao"
                  : "Dispensar solicitacao"}
              </DialogTitle>
              <DialogDescription>
                {acaoAlvo && acaoAlvo.novoStatus === "atendido"
                  ? isInterno
                    ? "Marque sem arquivo (recebeu pessoalmente) ou anexe o documento."
                    : "Anexe o documento solicitado. Sera renomeado automaticamente."
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
                            setArquivoUpload(null);
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
                          Anexar arquivo (sera renomeado para o tipo
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
                      Arquivo {!isInterno && "(obrigatorio)"}
                    </Label>
                    <input
                      type="file"
                      onChange={(e) =>
                        setArquivoUpload(e.target.files?.[0] || null)
                      }
                      className="block w-full text-sm border rounded-md p-2"
                      accept=".pdf,.jpg,.jpeg,.png,.doc,.docx,.xls,.xlsx"
                    />
                    {arquivoUpload && acaoAlvo && (
                      <p className="text-xs text-muted-foreground mt-1">
                        Sera salvo como:{" "}
                        <code className="bg-muted px-1 rounded">
                          {nomearArquivo(acaoAlvo.solic.tipo, arquivoUpload)}
                        </code>
                      </p>
                    )}
                  </div>
                )}

              <div>
                <Label className="text-xs">
                  {acaoAlvo && acaoAlvo.novoStatus === "atendido"
                    ? "Observacao (opcional)"
                    : "Motivo"}
                </Label>
                <Textarea
                  rows={3}
                  placeholder={
                    acaoAlvo && acaoAlvo.novoStatus === "atendido"
                      ? "Ex.: documento ja consta no CNIS"
                      : "Ex.: cliente nao consegue obter; nao necessario para o beneficio"
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
}

function GrupoCaso(props: GrupoCasoProps) {
  const { grupo, isInterno, onAtendido, onDispensar } = props;
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
}

function SolicitacaoItem(props: SolicitacaoItemProps) {
  const { s, isInterno, onAtendido, onDispensar } = props;
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
              <Badge className="bg-amber-500 hover:bg-amber-500 text-white">
                Pendente
              </Badge>
            )}
            {isAtendido && (
              <Badge className="bg-green-600 hover:bg-green-600 text-white">
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
            <Badge
              variant="outline"
              className={
                s.origem === "interna"
                  ? "border-blue-500 text-blue-700"
                  : "border-purple-500 text-purple-700"
              }
            >
              {ORIGEM_SOLICITACAO_LABEL[s.origem] || s.origem}
            </Badge>
            {isPendente && dias !== null && dias > 7 && (
              <Badge
                variant="outline"
                className="border-red-500 text-red-700"
              >
                {dias}d em aberto
              </Badge>
            )}
          </div>
          {s.descricao && (
            <p className="text-xs text-muted-foreground mt-1">
              {s.descricao}
            </p>
          )}
          <p className="text-xs text-muted-foreground mt-1">
            Solicitado em {formatDate(s.data_solicitacao)}
            {s.data_atendimento
              ? " - Atendido em " + formatDate(s.data_atendimento)
              : ""}
          </p>
          {s.comentario && (
            <div className="mt-2 pt-2 border-t border-dashed">
              <p className="text-xs text-muted-foreground mb-1">
                {isAtendido
                  ? "Observacao do atendimento"
                  : isDispensado
                  ? "Motivo da dispensa"
                  : "Comentario"}
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
          </div>
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

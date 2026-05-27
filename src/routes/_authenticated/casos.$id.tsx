import { createFileRoute, useParams, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import {
  ArrowLeft,
  Loader2,
  FileText,
  Plus,
  Send,
  Download,
  Eye,
  EyeOff,
  ClipboardList,
  MessageSquare,
  DollarSign,
  Scale,
  Activity,
  FileCheck,
  AlertCircle,
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
  DialogTrigger,
} from "@/components/ui/dialog";

export const Route = createFileRoute("/_authenticated/casos/$id")({
  component: CasoDetalhePage,
});

// ===========================================================================
// Tipos
// ===========================================================================

interface Cliente {
  id: string;
  nome: string;
  cpf: string;
  data_nascimento: string | null;
  telefone: string | null;
  email: string | null;
  observacoes: string | null;
}

interface ParceiroLite {
  id: string;
  nome: string | null;
  email: string | null;
}

interface Caso {
  id: string;
  cliente_id: string;
  parceiro_id: string | null;
  tipo_beneficio: string;
  fase: string;
  status: string;
  observacoes: string | null;
  created_at: string;
  updated_at: string | null;
}

interface Andamento {
  id: string;
  caso_id: string;
  origem: string;
  conteudo: string;
  autor_id: string | null;
  visivel_parceiro: boolean;
  created_at: string;
}

interface Documento {
  id: string;
  caso_id: string;
  tipo: string;
  nome_arquivo: string;
  storage_path: string;
  tamanho_bytes: number | null;
  uploaded_by: string | null;
  visivel_parceiro: boolean;
  created_at: string;
}

interface SolicitacaoDocumento {
  id: string;
  caso_id: string;
  tipo: string;
  descricao: string | null;
  status: string;
  solicitado_por: string | null;
  created_at: string;
}

interface AnaliseTecnica {
  id: string;
  caso_id: string;
  versao: number;
  conteudo: string;
  resumo_parceiro: string | null;
  autor_id: string | null;
  created_at: string;
}

interface Mensagem {
  id: string;
  caso_id: string;
  autor_id: string;
  conteudo: string;
  created_at: string;
}

interface Repasse {
  id: string;
  caso_id: string;
  parceiro_id: string;
  valor: number;
  status: string;
  data_pagamento: string | null;
  created_at: string;
}

interface ProcessoAdmin {
  id: string;
  caso_id: string;
  numero_protocolo: string | null;
  status: string | null;
  data_protocolo: string | null;
  created_at: string;
}

interface ProcessoJudicial {
  id: string;
  caso_id: string;
  numero_processo: string | null;
  vara: string | null;
  status: string | null;
  data_distribuicao: string | null;
  created_at: string;
}

// ===========================================================================
// Constantes
// ===========================================================================

const FASES_CASO = [
  { value: "analise", label: "Em analise" },
  { value: "documentacao", label: "Coleta de documentos" },
  { value: "protocolo", label: "Aguardando protocolo" },
  { value: "administrativo", label: "Fase administrativa" },
  { value: "recurso_administrativo", label: "Recurso administrativo" },
  { value: "judicial", label: "Fase judicial" },
  { value: "concluido", label: "Concluido" },
  { value: "arquivado", label: "Arquivado" },
];

const STATUS_CASO = [
  { value: "em_analise", label: "Em analise" },
  { value: "ativo", label: "Ativo" },
  { value: "aguardando_cliente", label: "Aguardando cliente" },
  { value: "aguardando_inss", label: "Aguardando INSS" },
  { value: "deferido", label: "Deferido" },
  { value: "indeferido", label: "Indeferido" },
  { value: "concluido", label: "Concluido" },
];

const ORIGEM_LABEL: Record<string, string> = {
  interno: "Interno",
  tramitacao: "Tramitacao Inteligente",
  legalmail: "Legalmail",
  sistema: "Sistema",
};

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

const STATUS_REPASSE: Record<string, string> = {
  pendente: "Pendente",
  pago: "Pago",
  cancelado: "Cancelado",
};

// ===========================================================================
// Helpers
// ===========================================================================

function maskCPF(cpf: string): string {
  const c = cpf.replace(/\D/g, "");
  if (c.length !== 11) return cpf;
  return c.slice(0, 3) + "." + c.slice(3, 6) + "." + c.slice(6, 9) + "-" + c.slice(9);
}

function maskCPFParceiro(cpf: string): string {
  const c = cpf.replace(/\D/g, "");
  if (c.length !== 11) return cpf;
  return "***." + c.slice(3, 6) + "." + c.slice(6, 9) + "-**";
}

function formatDate(iso: string | null): string {
  if (!iso) return "-";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "-";
  return d.toLocaleDateString("pt-BR");
}

function formatDateTime(iso: string | null): string {
  if (!iso) return "-";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "-";
  return (
    d.toLocaleDateString("pt-BR") +
    " " +
    d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })
  );
}

function formatBytes(bytes: number | null): string {
  if (!bytes || bytes < 0) return "-";
  if (bytes < 1024) return bytes + " B";
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(0) + " KB";
  return (bytes / (1024 * 1024)).toFixed(1) + " MB";
}

function formatMoney(v: number | null): string {
  if (v === null || v === undefined) return "-";
  return v.toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  });
}

function sanitizeFileName(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9._-]/g, "_");
}

function labelFromList(
  list: Array<{ value: string; label: string }>,
  value: string,
): string {
  for (const item of list) {
    if (item.value === value) return item.label;
  }
  return value;
}

// ===========================================================================
// Componente principal
// ===========================================================================

function CasoDetalhePage() {
  const params = useParams({ from: "/_authenticated/casos/$id" });
  const casoId = params.id;
  const { usuario } = useAuth();
  const isInterno = usuario?.tipo === "interno";

  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState<string | null>(null);

  const [caso, setCaso] = useState<Caso | null>(null);
  const [cliente, setCliente] = useState<Cliente | null>(null);
  const [parceiro, setParceiro] = useState<ParceiroLite | null>(null);
  const [andamentos, setAndamentos] = useState<Array<Andamento>>([]);
  const [documentos, setDocumentos] = useState<Array<Documento>>([]);
  const [solicitacoes, setSolicitacoes] = useState<Array<SolicitacaoDocumento>>([]);
  const [analises, setAnalises] = useState<Array<AnaliseTecnica>>([]);
  const [mensagens, setMensagens] = useState<Array<Mensagem>>([]);
  const [repasses, setRepasses] = useState<Array<Repasse>>([]);
  const [processosAdmin, setProcessosAdmin] = useState<Array<ProcessoAdmin>>([]);
  const [processosJudiciais, setProcessosJudiciais] = useState<Array<ProcessoJudicial>>([]);

  const carregar = useCallback(async () => {
    setLoading(true);
    setErro(null);
    try {
      const casoResp = await supabase
        .from("casos")
        .select("*")
        .eq("id", casoId)
        .maybeSingle();
      if (casoResp.error) throw casoResp.error;
      const casoData = casoResp.data as Caso | null;
      if (!casoData) {
        setErro("Caso nao encontrado ou voce nao tem permissao para visualiza-lo.");
        setLoading(false);
        return;
      }
      setCaso(casoData);

      const clienteResp = await supabase
        .from("clientes")
        .select("id, nome, cpf, data_nascimento, telefone, email, observacoes")
        .eq("id", casoData.cliente_id)
        .maybeSingle();
      if (clienteResp.error) throw clienteResp.error;
      setCliente((clienteResp.data || null) as Cliente | null);

      if (casoData.parceiro_id) {
        const parceiroResp = await supabase
          .from("usuarios")
          .select("id, nome, email")
          .eq("id", casoData.parceiro_id)
          .maybeSingle();
        if (parceiroResp.error) throw parceiroResp.error;
        setParceiro((parceiroResp.data || null) as ParceiroLite | null);
      } else {
        setParceiro(null);
      }

      const andamentosResp = await supabase
        .from("andamentos")
        .select("*")
        .eq("caso_id", casoId)
        .order("created_at", { ascending: false });
      if (andamentosResp.error) throw andamentosResp.error;
      setAndamentos((andamentosResp.data || []) as Array<Andamento>);

      const documentosResp = await supabase
        .from("documentos")
        .select("*")
        .eq("caso_id", casoId)
        .order("created_at", { ascending: false });
      if (documentosResp.error) throw documentosResp.error;
      setDocumentos((documentosResp.data || []) as Array<Documento>);

      const solicResp = await supabase
        .from("solicitacoes_documento")
        .select("*")
        .eq("caso_id", casoId)
        .order("created_at", { ascending: false });
      if (!solicResp.error) {
        setSolicitacoes((solicResp.data || []) as Array<SolicitacaoDocumento>);
      }

      if (isInterno) {
        const analisesResp = await supabase
          .from("analises_tecnicas")
          .select("*")
          .eq("caso_id", casoId)
          .order("versao", { ascending: false });
        if (!analisesResp.error) {
          setAnalises((analisesResp.data || []) as Array<AnaliseTecnica>);
        }
      }

      const mensagensResp = await supabase
        .from("mensagens")
        .select("*")
        .eq("caso_id", casoId)
        .order("created_at", { ascending: true });
      if (!mensagensResp.error) {
        setMensagens((mensagensResp.data || []) as Array<Mensagem>);
      }

      const repassesResp = await supabase
        .from("repasses")
        .select("*")
        .eq("caso_id", casoId)
        .order("created_at", { ascending: false });
      if (!repassesResp.error) {
        setRepasses((repassesResp.data || []) as Array<Repasse>);
      }

      if (isInterno) {
        const procAdminResp = await supabase
          .from("processos_admin")
          .select("*")
          .eq("caso_id", casoId)
          .order("created_at", { ascending: false });
        if (!procAdminResp.error) {
          setProcessosAdmin((procAdminResp.data || []) as Array<ProcessoAdmin>);
        }

        const procJudResp = await supabase
          .from("processos_judiciais")
          .select("*")
          .eq("caso_id", casoId)
          .order("created_at", { ascending: false });
        if (!procJudResp.error) {
          setProcessosJudiciais((procJudResp.data || []) as Array<ProcessoJudicial>);
        }
      }
    } catch (err) {
      console.error(err);
      const errObj = err as { message?: string };
      setErro(errObj.message || "Erro ao carregar o caso");
    } finally {
      setLoading(false);
    }
  }, [casoId, isInterno]);

  useEffect(() => {
    carregar();
  }, [carregar]);

  if (loading) {
    return (
      <div className="flex h-96 items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (erro || !caso || !cliente) {
    return (
      <div className="mx-auto max-w-3xl space-y-4">
        <Button variant="ghost" size="sm" asChild>
          <Link to="/">
            <ArrowLeft className="h-4 w-4 mr-2" />
            Voltar
          </Link>
        </Button>
        <Card>
          <CardContent className="py-12 text-center">
            <AlertCircle className="h-10 w-10 mx-auto text-muted-foreground mb-2" />
            <p className="text-sm text-muted-foreground">
              {erro || "Caso nao encontrado"}
            </p>
          </CardContent>
        </Card>
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
      <div className="mx-auto max-w-6xl space-y-6">
        <div className="flex items-center justify-between">
          <Button variant="ghost" size="sm" asChild>
            <Link to="/">
              <ArrowLeft className="h-4 w-4 mr-2" />
              Voltar
            </Link>
          </Button>
        </div>

        <CasoHeader
          caso={caso}
          cliente={cliente}
          parceiro={parceiro}
          isInterno={isInterno}
          onChange={carregar}
        />

        <Tabs defaultValue="visao_geral" className="w-full">
          <TabsList className="grid w-full grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 h-auto">
            <TabsTrigger value="visao_geral" className="flex items-center gap-1">
              <Activity className="h-4 w-4" />
              <span>Visao geral</span>
            </TabsTrigger>
            <TabsTrigger value="andamentos" className="flex items-center gap-1">
              <ClipboardList className="h-4 w-4" />
              <span>Andamentos</span>
            </TabsTrigger>
            <TabsTrigger value="documentos" className="flex items-center gap-1">
              <FileCheck className="h-4 w-4" />
              <span>Documentos</span>
            </TabsTrigger>
            {isInterno && (
              <TabsTrigger value="analise" className="flex items-center gap-1">
                <FileText className="h-4 w-4" />
                <span>Analise</span>
              </TabsTrigger>
            )}
            <TabsTrigger value="chat" className="flex items-center gap-1">
              <MessageSquare className="h-4 w-4" />
              <span>Chat</span>
            </TabsTrigger>
            <TabsTrigger value="repasses" className="flex items-center gap-1">
              <DollarSign className="h-4 w-4" />
              <span>Repasses</span>
            </TabsTrigger>
            {isInterno && (
              <TabsTrigger value="processos" className="flex items-center gap-1">
                <Scale className="h-4 w-4" />
                <span>Processos</span>
              </TabsTrigger>
            )}
          </TabsList>

          <TabsContent value="visao_geral" className="mt-4">
            <TabVisaoGeral
              caso={caso}
              cliente={cliente}
              isInterno={isInterno}
            />
          </TabsContent>

          <TabsContent value="andamentos" className="mt-4">
            <TabAndamentos
              casoId={casoId}
              andamentos={andamentos}
              isInterno={isInterno}
              usuarioId={usuario ? usuario.id : null}
              onChange={carregar}
            />
          </TabsContent>

          <TabsContent value="documentos" className="mt-4">
            <TabDocumentos
              casoId={casoId}
              documentos={documentos}
              solicitacoes={solicitacoes}
              isInterno={isInterno}
              usuarioId={usuario ? usuario.id : null}
              onChange={carregar}
            />
          </TabsContent>

          {isInterno && (
            <TabsContent value="analise" className="mt-4">
              <TabAnaliseTecnica
                casoId={casoId}
                analises={analises}
                usuarioId={usuario ? usuario.id : null}
                onChange={carregar}
              />
            </TabsContent>
          )}

          <TabsContent value="chat" className="mt-4">
            <TabChat
              casoId={casoId}
              mensagens={mensagens}
              setMensagens={setMensagens}
              usuarioId={usuario ? usuario.id : null}
            />
          </TabsContent>

          <TabsContent value="repasses" className="mt-4">
            <TabRepasses
              casoId={casoId}
              repasses={repasses}
              parceiroId={parceiro ? parceiro.id : null}
              isInterno={isInterno}
              onChange={carregar}
            />
          </TabsContent>

          {isInterno && (
            <TabsContent value="processos" className="mt-4">
              <TabProcessos
                casoId={casoId}
                processosAdmin={processosAdmin}
                processosJudiciais={processosJudiciais}
                onChange={carregar}
              />
            </TabsContent>
          )}
        </Tabs>
      </div>
    </ClientOnly>
  );
}

// ===========================================================================
// Cabecalho do caso
// ===========================================================================

interface CasoHeaderProps {
  caso: Caso;
  cliente: Cliente;
  parceiro: ParceiroLite | null;
  isInterno: boolean;
  onChange: () => void;
}

function CasoHeader(props: CasoHeaderProps) {
  const { caso, cliente, parceiro, isInterno, onChange } = props;
  const [editing, setEditing] = useState(false);
  const [fase, setFase] = useState(caso.fase);
  const [status, setStatus] = useState(caso.status);
  const [saving, setSaving] = useState(false);

  async function salvar() {
    setSaving(true);
    try {
      const resp = await supabase
        .from("casos")
        .update({ fase: fase, status: status })
        .eq("id", caso.id);
      if (resp.error) throw resp.error;
      toast.success("Caso atualizado");
      setEditing(false);
      onChange();
    } catch (err) {
      console.error(err);
      const errObj = err as { message?: string };
      toast.error(errObj.message || "Erro ao atualizar caso");
    } finally {
      setSaving(false);
    }
  }

  const nomeCliente = cliente.nome;
  const cpfFormatado = isInterno
    ? maskCPF(cliente.cpf)
    : maskCPFParceiro(cliente.cpf);

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
          <div>
            <CardTitle className="text-xl">{nomeCliente}</CardTitle>
            <CardDescription>
              CPF: {cpfFormatado} - {caso.tipo_beneficio}
            </CardDescription>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline">
              Fase: {labelFromList(FASES_CASO, caso.fase)}
            </Badge>
            <Badge variant="secondary">
              Status: {labelFromList(STATUS_CASO, caso.status)}
            </Badge>
            {isInterno && !editing && (
              <Button size="sm" variant="outline" onClick={() => setEditing(true)}>
                Editar
              </Button>
            )}
          </div>
        </div>
      </CardHeader>
      {editing && isInterno && (
        <CardContent>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label className="text-xs">Fase</Label>
              <Select value={fase} onValueChange={setFase}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {FASES_CASO.map((f) => (
                    <SelectItem key={f.value} value={f.value}>
                      {f.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Status</Label>
              <Select value={status} onValueChange={setStatus}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {STATUS_CASO.map((s) => (
                    <SelectItem key={s.value} value={s.value}>
                      {s.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="flex gap-2 mt-3">
            <Button size="sm" onClick={salvar} disabled={saving}>
              {saving && <Loader2 className="h-3 w-3 mr-2 animate-spin" />}
              Salvar
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setEditing(false);
                setFase(caso.fase);
                setStatus(caso.status);
              }}
              disabled={saving}
            >
              Cancelar
            </Button>
          </div>
        </CardContent>
      )}
      {isInterno && parceiro && (
        <CardContent className="pt-0 text-xs text-muted-foreground">
          Parceiro indicador: {parceiro.nome || parceiro.email || parceiro.id}
        </CardContent>
      )}
    </Card>
  );
}

// ===========================================================================
// Tab: Visao geral
// ===========================================================================

interface TabVisaoGeralProps {
  caso: Caso;
  cliente: Cliente;
  isInterno: boolean;
}

function TabVisaoGeral(props: TabVisaoGeralProps) {
  const { caso, cliente, isInterno } = props;
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Dados do cliente</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <Linha label="Nome" valor={cliente.nome} />
          <Linha
            label="CPF"
            valor={
              isInterno
                ? maskCPF(cliente.cpf)
                : maskCPFParceiro(cliente.cpf)
            }
          />
          <Linha
            label="Nascimento"
            valor={formatDate(cliente.data_nascimento)}
          />
          {isInterno && (
            <>
              <Linha label="Telefone" valor={cliente.telefone || "-"} />
              <Linha label="E-mail" valor={cliente.email || "-"} />
            </>
          )}
          {cliente.observacoes && (
            <div className="pt-2 border-t">
              <p className="text-xs text-muted-foreground mb-1">Observacoes</p>
              <p className="text-sm whitespace-pre-wrap">{cliente.observacoes}</p>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Dados do caso</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <Linha label="Tipo de beneficio" valor={caso.tipo_beneficio} />
          <Linha label="Fase" valor={labelFromList(FASES_CASO, caso.fase)} />
          <Linha label="Status" valor={labelFromList(STATUS_CASO, caso.status)} />
          <Linha
            label="Criado em"
            valor={formatDateTime(caso.created_at)}
          />
          {caso.updated_at && (
            <Linha
              label="Atualizado em"
              valor={formatDateTime(caso.updated_at)}
            />
          )}
          {caso.observacoes && (
            <div className="pt-2 border-t">
              <p className="text-xs text-muted-foreground mb-1">Observacoes</p>
              <p className="text-sm whitespace-pre-wrap">{caso.observacoes}</p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function Linha(props: { label: string; valor: string }) {
  return (
    <div className="flex items-baseline gap-2">
      <span className="text-xs text-muted-foreground min-w-[7rem]">
        {props.label}:
      </span>
      <span className="text-sm">{props.valor}</span>
    </div>
  );
}

// ===========================================================================
// Tab: Andamentos
// ===========================================================================

interface TabAndamentosProps {
  casoId: string;
  andamentos: Array<Andamento>;
  isInterno: boolean;
  usuarioId: string | null;
  onChange: () => void;
}

function TabAndamentos(props: TabAndamentosProps) {
  const { casoId, andamentos, isInterno, usuarioId, onChange } = props;
  const [novoConteudo, setNovoConteudo] = useState("");
  const [visivelParceiro, setVisivelParceiro] = useState(true);
  const [salvando, setSalvando] = useState(false);
  const [abrirNovo, setAbrirNovo] = useState(false);

  const lista = isInterno
    ? andamentos
    : andamentos.filter((a) => a.visivel_parceiro === true);

  async function adicionar() {
    if (!novoConteudo.trim() || !usuarioId) return;
    setSalvando(true);
    try {
      const resp = await supabase.from("andamentos").insert({
        caso_id: casoId,
        origem: "interno",
        conteudo: novoConteudo.trim(),
        autor_id: usuarioId,
        visivel_parceiro: visivelParceiro,
      });
      if (resp.error) throw resp.error;
      toast.success("Andamento adicionado");
      setNovoConteudo("");
      setAbrirNovo(false);
      onChange();
    } catch (err) {
      console.error(err);
      const errObj = err as { message?: string };
      toast.error(errObj.message || "Erro ao adicionar andamento");
    } finally {
      setSalvando(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="text-base">Andamentos</CardTitle>
            <CardDescription>
              Linha do tempo das movimentacoes do caso.
            </CardDescription>
          </div>
          {isInterno && (
            <Dialog open={abrirNovo} onOpenChange={setAbrirNovo}>
              <DialogTrigger asChild>
                <Button size="sm">
                  <Plus className="h-4 w-4 mr-2" />
                  Novo andamento
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Novo andamento</DialogTitle>
                  <DialogDescription>
                    Registre uma movimentacao manual no caso.
                  </DialogDescription>
                </DialogHeader>
                <div className="space-y-3">
                  <div>
                    <Label className="text-xs">Conteudo</Label>
                    <Textarea
                      rows={4}
                      placeholder="Descreva a movimentacao..."
                      value={novoConteudo}
                      onChange={(e) => setNovoConteudo(e.target.value)}
                    />
                  </div>
                  <div className="flex items-center gap-2">
                    <input
                      id="visivel-parceiro"
                      type="checkbox"
                      checked={visivelParceiro}
                      onChange={(e) => setVisivelParceiro(e.target.checked)}
                      className="h-4 w-4"
                    />
                    <Label htmlFor="visivel-parceiro" className="text-sm">
                      Visivel para o parceiro indicador
                    </Label>
                  </div>
                </div>
                <DialogFooter>
                  <Button
                    variant="ghost"
                    onClick={() => setAbrirNovo(false)}
                    disabled={salvando}
                  >
                    Cancelar
                  </Button>
                  <Button onClick={adicionar} disabled={salvando}>
                    {salvando && (
                      <Loader2 className="h-3 w-3 mr-2 animate-spin" />
                    )}
                    Adicionar
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          )}
        </div>
      </CardHeader>
      <CardContent>
        {lista.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-6">
            Nenhum andamento registrado ainda.
          </p>
        ) : (
          <ul className="space-y-3">
            {lista.map((a) => (
              <li
                key={a.id}
                className="border-l-2 border-muted pl-3 py-1"
              >
                <div className="flex items-center gap-2 flex-wrap">
                  <Badge variant="outline" className="text-xs">
                    {ORIGEM_LABEL[a.origem] || a.origem}
                  </Badge>
                  <span className="text-xs text-muted-foreground">
                    {formatDateTime(a.created_at)}
                  </span>
                  {isInterno && a.visivel_parceiro && (
                    <Badge variant="secondary" className="text-xs">
                      <Eye className="h-3 w-3 mr-1" />
                      visivel parceiro
                    </Badge>
                  )}
                  {isInterno && !a.visivel_parceiro && (
                    <Badge variant="outline" className="text-xs">
                      <EyeOff className="h-3 w-3 mr-1" />
                      interno
                    </Badge>
                  )}
                </div>
                <p className="text-sm mt-1 whitespace-pre-wrap">{a.conteudo}</p>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

// ===========================================================================
// Tab: Documentos
// ===========================================================================

interface TabDocumentosProps {
  casoId: string;
  documentos: Array<Documento>;
  solicitacoes: Array<SolicitacaoDocumento>;
  isInterno: boolean;
  usuarioId: string | null;
  onChange: () => void;
}

function TabDocumentos(props: TabDocumentosProps) {
  const { casoId, documentos, solicitacoes, isInterno, usuarioId, onChange } = props;

  const lista = isInterno
    ? documentos
    : documentos.filter((d) => d.visivel_parceiro === true);

  const solicitacoesPendentes = solicitacoes.filter(
    (s) => s.status !== "recebido" && s.status !== "concluido",
  );

  async function baixar(doc: Documento) {
    try {
      const resp = await supabase.storage
        .from("documentos")
        .createSignedUrl(doc.storage_path, 60);
      if (resp.error) throw resp.error;
      const url = resp.data ? resp.data.signedUrl : null;
      if (url) {
        window.open(url, "_blank");
      }
    } catch (err) {
      console.error(err);
      const errObj = err as { message?: string };
      toast.error(errObj.message || "Erro ao gerar link do documento");
    }
  }

  return (
    <div className="space-y-4">
      {solicitacoesPendentes.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <AlertCircle className="h-4 w-4 text-amber-500" />
              Documentos solicitados
            </CardTitle>
            <CardDescription>
              {isInterno
                ? "Pedidos abertos pelo escritorio."
                : "Documentos que o escritorio precisa que voce envie."}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="space-y-2">
              {solicitacoesPendentes.map((s) => (
                <li
                  key={s.id}
                  className="flex items-center justify-between gap-2 border rounded-md p-3"
                >
                  <div>
                    <p className="text-sm font-medium">
                      {TIPOS_DOCUMENTO_LABEL[s.tipo] || s.tipo}
                    </p>
                    {s.descricao && (
                      <p className="text-xs text-muted-foreground">
                        {s.descricao}
                      </p>
                    )}
                    <p className="text-xs text-muted-foreground mt-1">
                      Solicitado em {formatDate(s.created_at)}
                    </p>
                  </div>
                  <Badge variant="outline">{s.status}</Badge>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-base">Documentos do caso</CardTitle>
              <CardDescription>
                Arquivos anexados a este caso.
              </CardDescription>
            </div>
            <UploadDoc casoId={casoId} usuarioId={usuarioId} onChange={onChange} />
          </div>
        </CardHeader>
        <CardContent>
          {lista.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-6">
              Nenhum documento anexado ainda.
            </p>
          ) : (
            <ul className="space-y-2">
              {lista.map((d) => (
                <li
                  key={d.id}
                  className="flex items-center justify-between gap-2 border rounded-md p-3"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <FileText className="h-5 w-5 text-muted-foreground flex-shrink-0" />
                    <div className="min-w-0">
                      <p className="text-sm font-medium truncate">
                        {d.nome_arquivo}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {TIPOS_DOCUMENTO_LABEL[d.tipo] || d.tipo} -{" "}
                        {formatBytes(d.tamanho_bytes)} -{" "}
                        {formatDate(d.created_at)}
                      </p>
                    </div>
                  </div>
                  <Button size="sm" variant="outline" onClick={() => baixar(d)}>
                    <Download className="h-4 w-4 mr-2" />
                    Baixar
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {isInterno && (
        <SolicitarDocCard casoId={casoId} usuarioId={usuarioId} onChange={onChange} />
      )}
    </div>
  );
}

function UploadDoc(props: {
  casoId: string;
  usuarioId: string | null;
  onChange: () => void;
}) {
  const { casoId, usuarioId, onChange } = props;
  const [aberto, setAberto] = useState(false);
  const [arquivo, setArquivo] = useState<File | null>(null);
  const [tipo, setTipo] = useState("cnis");
  const [visivelParceiro, setVisivelParceiro] = useState(true);
  const [enviando, setEnviando] = useState(false);

  async function enviar() {
    if (!arquivo || !usuarioId) return;
    setEnviando(true);
    try {
      const fileName = Date.now() + "_" + sanitizeFileName(arquivo.name);
      const storagePath = casoId + "/" + fileName;
      const uploadResp = await supabase.storage
        .from("documentos")
        .upload(storagePath, arquivo, { cacheControl: "3600", upsert: false });
      if (uploadResp.error) throw uploadResp.error;

      const insertResp = await supabase.from("documentos").insert({
        caso_id: casoId,
        tipo: tipo,
        nome_arquivo: arquivo.name,
        storage_path: storagePath,
        tamanho_bytes: arquivo.size,
        uploaded_by: usuarioId,
        visivel_parceiro: visivelParceiro,
      });
      if (insertResp.error) throw insertResp.error;

      toast.success("Documento adicionado");
      setArquivo(null);
      setAberto(false);
      onChange();
    } catch (err) {
      console.error(err);
      const errObj = err as { message?: string };
      toast.error(errObj.message || "Erro ao enviar documento");
    } finally {
      setEnviando(false);
    }
  }

  return (
    <Dialog open={aberto} onOpenChange={setAberto}>
      <DialogTrigger asChild>
        <Button size="sm">
          <Plus className="h-4 w-4 mr-2" />
          Adicionar
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Adicionar documento</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label className="text-xs">Arquivo</Label>
            <Input
              type="file"
              accept="application/pdf,image/jpeg,image/png,image/jpg"
              onChange={(e) => {
                const files = e.target.files;
                setArquivo(files && files.length > 0 ? files[0] : null);
              }}
            />
          </div>
          <div>
            <Label className="text-xs">Tipo</Label>
            <Select value={tipo} onValueChange={setTipo}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.keys(TIPOS_DOCUMENTO_LABEL).map((k) => (
                  <SelectItem key={k} value={k}>
                    {TIPOS_DOCUMENTO_LABEL[k]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center gap-2">
            <input
              id="doc-visivel-parceiro"
              type="checkbox"
              checked={visivelParceiro}
              onChange={(e) => setVisivelParceiro(e.target.checked)}
              className="h-4 w-4"
            />
            <Label htmlFor="doc-visivel-parceiro" className="text-sm">
              Visivel para o parceiro indicador
            </Label>
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => setAberto(false)} disabled={enviando}>
            Cancelar
          </Button>
          <Button onClick={enviar} disabled={!arquivo || enviando}>
            {enviando && <Loader2 className="h-3 w-3 mr-2 animate-spin" />}
            Enviar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function SolicitarDocCard(props: {
  casoId: string;
  usuarioId: string | null;
  onChange: () => void;
}) {
  const { casoId, usuarioId, onChange } = props;
  const [aberto, setAberto] = useState(false);
  const [tipo, setTipo] = useState("cnis");
  const [descricao, setDescricao] = useState("");
  const [enviando, setEnviando] = useState(false);

  async function criar() {
    if (!usuarioId) return;
    setEnviando(true);
    try {
      const resp = await supabase.from("solicitacoes_documento").insert({
        caso_id: casoId,
        tipo: tipo,
        descricao: descricao.trim() || null,
        status: "pendente",
        solicitado_por: usuarioId,
      });
      if (resp.error) throw resp.error;
      toast.success("Solicitacao criada");
      setDescricao("");
      setAberto(false);
      onChange();
    } catch (err) {
      console.error(err);
      const errObj = err as { message?: string };
      toast.error(errObj.message || "Erro ao criar solicitacao");
    } finally {
      setEnviando(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="text-base">Solicitar documento</CardTitle>
            <CardDescription>
              Abra um pedido de documento que falta para o caso.
            </CardDescription>
          </div>
          <Dialog open={aberto} onOpenChange={setAberto}>
            <DialogTrigger asChild>
              <Button size="sm" variant="outline">
                <Plus className="h-4 w-4 mr-2" />
                Nova solicitacao
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Solicitar documento</DialogTitle>
              </DialogHeader>
              <div className="space-y-3">
                <div>
                  <Label className="text-xs">Tipo</Label>
                  <Select value={tipo} onValueChange={setTipo}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {Object.keys(TIPOS_DOCUMENTO_LABEL).map((k) => (
                        <SelectItem key={k} value={k}>
                          {TIPOS_DOCUMENTO_LABEL[k]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-xs">Observacao</Label>
                  <Textarea
                    rows={3}
                    placeholder="Detalhes sobre o documento necessario..."
                    value={descricao}
                    onChange={(e) => setDescricao(e.target.value)}
                  />
                </div>
              </div>
              <DialogFooter>
                <Button
                  variant="ghost"
                  onClick={() => setAberto(false)}
                  disabled={enviando}
                >
                  Cancelar
                </Button>
                <Button onClick={criar} disabled={enviando}>
                  {enviando && <Loader2 className="h-3 w-3 mr-2 animate-spin" />}
                  Criar solicitacao
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </CardHeader>
    </Card>
  );
}

// ===========================================================================
// Tab: Analise tecnica (so interno)
// ===========================================================================

interface TabAnaliseTecnicaProps {
  casoId: string;
  analises: Array<AnaliseTecnica>;
  usuarioId: string | null;
  onChange: () => void;
}

function TabAnaliseTecnica(props: TabAnaliseTecnicaProps) {
  const { casoId, analises, usuarioId, onChange } = props;
  const [aberto, setAberto] = useState(false);
  const [conteudo, setConteudo] = useState("");
  const [resumoParceiro, setResumoParceiro] = useState("");
  const [salvando, setSalvando] = useState(false);

  const proximaVersao =
    analises.length > 0 ? Math.max.apply(null, analises.map((a) => a.versao)) + 1 : 1;

  async function salvar() {
    if (!conteudo.trim() || !usuarioId) return;
    setSalvando(true);
    try {
      const resp = await supabase.from("analises_tecnicas").insert({
        caso_id: casoId,
        versao: proximaVersao,
        conteudo: conteudo.trim(),
        resumo_parceiro: resumoParceiro.trim() || null,
        autor_id: usuarioId,
      });
      if (resp.error) throw resp.error;
      toast.success("Analise tecnica versao " + proximaVersao + " salva");
      setConteudo("");
      setResumoParceiro("");
      setAberto(false);
      onChange();
    } catch (err) {
      console.error(err);
      const errObj = err as { message?: string };
      toast.error(errObj.message || "Erro ao salvar analise");
    } finally {
      setSalvando(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="text-base">Analise tecnica</CardTitle>
            <CardDescription>
              Historico versionado de analises do caso. Nao visivel ao parceiro.
            </CardDescription>
          </div>
          <Dialog open={aberto} onOpenChange={setAberto}>
            <DialogTrigger asChild>
              <Button size="sm">
                <Plus className="h-4 w-4 mr-2" />
                Nova versao
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-2xl">
              <DialogHeader>
                <DialogTitle>Nova analise tecnica (versao {proximaVersao})</DialogTitle>
              </DialogHeader>
              <div className="space-y-3">
                <div>
                  <Label className="text-xs">Conteudo (interno)</Label>
                  <Textarea
                    rows={10}
                    placeholder="Analise tecnica completa, raciocinio juridico, calculos..."
                    value={conteudo}
                    onChange={(e) => setConteudo(e.target.value)}
                  />
                </div>
                <div>
                  <Label className="text-xs">
                    Resumo para o parceiro (opcional)
                  </Label>
                  <Textarea
                    rows={3}
                    placeholder="Versao simplificada que pode ser exibida ao parceiro..."
                    value={resumoParceiro}
                    onChange={(e) => setResumoParceiro(e.target.value)}
                  />
                </div>
              </div>
              <DialogFooter>
                <Button
                  variant="ghost"
                  onClick={() => setAberto(false)}
                  disabled={salvando}
                >
                  Cancelar
                </Button>
                <Button onClick={salvar} disabled={salvando}>
                  {salvando && <Loader2 className="h-3 w-3 mr-2 animate-spin" />}
                  Salvar versao
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </CardHeader>
      <CardContent>
        {analises.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-6">
            Nenhuma analise registrada. Crie a primeira versao.
          </p>
        ) : (
          <div className="space-y-3">
            {analises.map((a) => (
              <div key={a.id} className="border rounded-md p-3">
                <div className="flex items-center gap-2 mb-2 flex-wrap">
                  <Badge>v{a.versao}</Badge>
                  <span className="text-xs text-muted-foreground">
                    {formatDateTime(a.created_at)}
                  </span>
                </div>
                <p className="text-sm whitespace-pre-wrap">{a.conteudo}</p>
                {a.resumo_parceiro && (
                  <div className="mt-2 pt-2 border-t">
                    <p className="text-xs text-muted-foreground mb-1">
                      Resumo para o parceiro
                    </p>
                    <p className="text-sm whitespace-pre-wrap">
                      {a.resumo_parceiro}
                    </p>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ===========================================================================
// Tab: Chat (polling)
// ===========================================================================

interface TabChatProps {
  casoId: string;
  mensagens: Array<Mensagem>;
  setMensagens: (m: Array<Mensagem>) => void;
  usuarioId: string | null;
}

function TabChat(props: TabChatProps) {
  const { casoId, mensagens, setMensagens, usuarioId } = props;
  const [texto, setTexto] = useState("");
  const [enviando, setEnviando] = useState(false);
  const bottomRef = useRef<HTMLDivElement | null>(null);

  // Polling a cada 10s
  useEffect(() => {
    let cancelado = false;
    async function poll() {
      const resp = await supabase
        .from("mensagens")
        .select("*")
        .eq("caso_id", casoId)
        .order("created_at", { ascending: true });
      if (!cancelado && !resp.error) {
        setMensagens((resp.data || []) as Array<Mensagem>);
      }
    }
    const id = setInterval(poll, 10000);
    return () => {
      cancelado = true;
      clearInterval(id);
    };
  }, [casoId, setMensagens]);

  useEffect(() => {
    if (bottomRef.current) {
      bottomRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [mensagens.length]);

  async function enviar() {
    if (!texto.trim() || !usuarioId) return;
    setEnviando(true);
    try {
      const resp = await supabase.from("mensagens").insert({
        caso_id: casoId,
        autor_id: usuarioId,
        conteudo: texto.trim(),
      });
      if (resp.error) throw resp.error;
      setTexto("");
      const refetch = await supabase
        .from("mensagens")
        .select("*")
        .eq("caso_id", casoId)
        .order("created_at", { ascending: true });
      if (!refetch.error) {
        setMensagens((refetch.data || []) as Array<Mensagem>);
      }
    } catch (err) {
      console.error(err);
      const errObj = err as { message?: string };
      toast.error(errObj.message || "Erro ao enviar mensagem");
    } finally {
      setEnviando(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Conversa do caso</CardTitle>
        <CardDescription>
          Mensagens entre escritorio e parceiro indicador.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="border rounded-md h-96 overflow-y-auto p-3 bg-muted/20 space-y-2">
          {mensagens.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-12">
              Nenhuma mensagem ainda. Comece a conversa.
            </p>
          ) : (
            mensagens.map((m) => {
              const eu = m.autor_id === usuarioId;
              return (
                <div
                  key={m.id}
                  className={
                    "flex " + (eu ? "justify-end" : "justify-start")
                  }
                >
                  <div
                    className={
                      "max-w-[75%] rounded-md px-3 py-2 text-sm " +
                      (eu
                        ? "bg-primary text-primary-foreground"
                        : "bg-background border")
                    }
                  >
                    <p className="whitespace-pre-wrap">{m.conteudo}</p>
                    <p
                      className={
                        "text-[10px] mt-1 " +
                        (eu
                          ? "text-primary-foreground/70"
                          : "text-muted-foreground")
                      }
                    >
                      {formatDateTime(m.created_at)}
                    </p>
                  </div>
                </div>
              );
            })
          )}
          <div ref={bottomRef} />
        </div>
        <div className="flex gap-2 mt-3">
          <Textarea
            rows={2}
            placeholder="Escreva uma mensagem..."
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                enviar();
              }
            }}
          />
          <Button onClick={enviar} disabled={enviando || !texto.trim()}>
            {enviando ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Send className="h-4 w-4" />
            )}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

// ===========================================================================
// Tab: Repasses
// ===========================================================================

interface TabRepassesProps {
  casoId: string;
  repasses: Array<Repasse>;
  parceiroId: string | null;
  isInterno: boolean;
  onChange: () => void;
}

function TabRepasses(props: TabRepassesProps) {
  const { casoId, repasses, parceiroId, isInterno, onChange } = props;
  const [aberto, setAberto] = useState(false);
  const [valor, setValor] = useState("");
  const [salvando, setSalvando] = useState(false);

  const lista = isInterno
    ? repasses
    : repasses.filter((r) => r.parceiro_id === parceiroId);

  const total = lista.reduce((acc, r) => acc + (r.valor || 0), 0);
  const pago = lista
    .filter((r) => r.status === "pago")
    .reduce((acc, r) => acc + (r.valor || 0), 0);
  const pendente = total - pago;

  async function adicionar() {
    if (!parceiroId) {
      toast.error("Caso sem parceiro indicador. Nao ha repasse a registrar.");
      return;
    }
    const valorNumero = parseFloat(valor.replace(",", "."));
    if (isNaN(valorNumero) || valorNumero <= 0) {
      toast.error("Informe um valor valido");
      return;
    }
    setSalvando(true);
    try {
      const resp = await supabase.from("repasses").insert({
        caso_id: casoId,
        parceiro_id: parceiroId,
        valor: valorNumero,
        status: "pendente",
      });
      if (resp.error) throw resp.error;
      toast.success("Repasse registrado");
      setValor("");
      setAberto(false);
      onChange();
    } catch (err) {
      console.error(err);
      const errObj = err as { message?: string };
      toast.error(errObj.message || "Erro ao registrar repasse");
    } finally {
      setSalvando(false);
    }
  }

  async function marcarPago(r: Repasse) {
    try {
      const resp = await supabase
        .from("repasses")
        .update({
          status: "pago",
          data_pagamento: new Date().toISOString().slice(0, 10),
        })
        .eq("id", r.id);
      if (resp.error) throw resp.error;
      toast.success("Repasse marcado como pago");
      onChange();
    } catch (err) {
      console.error(err);
      const errObj = err as { message?: string };
      toast.error(errObj.message || "Erro ao atualizar repasse");
    }
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="text-base">Repasses</CardTitle>
            <CardDescription>
              Honorarios do parceiro indicador (30%).
            </CardDescription>
          </div>
          {isInterno && parceiroId && (
            <Dialog open={aberto} onOpenChange={setAberto}>
              <DialogTrigger asChild>
                <Button size="sm">
                  <Plus className="h-4 w-4 mr-2" />
                  Novo repasse
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Registrar repasse</DialogTitle>
                </DialogHeader>
                <div className="space-y-3">
                  <div>
                    <Label className="text-xs">Valor (R$)</Label>
                    <Input
                      type="text"
                      inputMode="decimal"
                      placeholder="0,00"
                      value={valor}
                      onChange={(e) => setValor(e.target.value)}
                    />
                  </div>
                </div>
                <DialogFooter>
                  <Button
                    variant="ghost"
                    onClick={() => setAberto(false)}
                    disabled={salvando}
                  >
                    Cancelar
                  </Button>
                  <Button onClick={adicionar} disabled={salvando}>
                    {salvando && (
                      <Loader2 className="h-3 w-3 mr-2 animate-spin" />
                    )}
                    Registrar
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          )}
        </div>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-3 gap-3 mb-4">
          <div className="border rounded-md p-3">
            <p className="text-xs text-muted-foreground">Total</p>
            <p className="text-base font-medium">{formatMoney(total)}</p>
          </div>
          <div className="border rounded-md p-3">
            <p className="text-xs text-muted-foreground">Pago</p>
            <p className="text-base font-medium text-green-700">
              {formatMoney(pago)}
            </p>
          </div>
          <div className="border rounded-md p-3">
            <p className="text-xs text-muted-foreground">Pendente</p>
            <p className="text-base font-medium text-amber-700">
              {formatMoney(pendente)}
            </p>
          </div>
        </div>

        {lista.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-6">
            Nenhum repasse registrado.
          </p>
        ) : (
          <ul className="space-y-2">
            {lista.map((r) => (
              <li
                key={r.id}
                className="flex items-center justify-between gap-2 border rounded-md p-3"
              >
                <div>
                  <p className="text-sm font-medium">
                    {formatMoney(r.valor)}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Criado em {formatDate(r.created_at)}
                    {r.data_pagamento
                      ? " - Pago em " + formatDate(r.data_pagamento)
                      : ""}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Badge
                    variant={r.status === "pago" ? "default" : "outline"}
                  >
                    {STATUS_REPASSE[r.status] || r.status}
                  </Badge>
                  {isInterno && r.status === "pendente" && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => marcarPago(r)}
                    >
                      Marcar pago
                    </Button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

// ===========================================================================
// Tab: Processos (so interno)
// ===========================================================================

interface TabProcessosProps {
  casoId: string;
  processosAdmin: Array<ProcessoAdmin>;
  processosJudiciais: Array<ProcessoJudicial>;
  onChange: () => void;
}

function TabProcessos(props: TabProcessosProps) {
  const { casoId, processosAdmin, processosJudiciais, onChange } = props;
  const [abrirAdmin, setAbrirAdmin] = useState(false);
  const [protocolo, setProtocolo] = useState("");
  const [statusAdmin, setStatusAdmin] = useState("aguardando");
  const [dataProtocolo, setDataProtocolo] = useState("");
  const [salvandoAdmin, setSalvandoAdmin] = useState(false);

  const [abrirJud, setAbrirJud] = useState(false);
  const [numProcesso, setNumProcesso] = useState("");
  const [vara, setVara] = useState("");
  const [statusJud, setStatusJud] = useState("em_andamento");
  const [dataDist, setDataDist] = useState("");
  const [salvandoJud, setSalvandoJud] = useState(false);

  async function salvarAdmin() {
    setSalvandoAdmin(true);
    try {
      const resp = await supabase.from("processos_admin").insert({
        caso_id: casoId,
        numero_protocolo: protocolo.trim() || null,
        status: statusAdmin,
        data_protocolo: dataProtocolo || null,
      });
      if (resp.error) throw resp.error;
      toast.success("Processo administrativo registrado");
      setProtocolo("");
      setDataProtocolo("");
      setAbrirAdmin(false);
      onChange();
    } catch (err) {
      console.error(err);
      const errObj = err as { message?: string };
      toast.error(errObj.message || "Erro ao registrar processo");
    } finally {
      setSalvandoAdmin(false);
    }
  }

  async function salvarJud() {
    setSalvandoJud(true);
    try {
      const resp = await supabase.from("processos_judiciais").insert({
        caso_id: casoId,
        numero_processo: numProcesso.trim() || null,
        vara: vara.trim() || null,
        status: statusJud,
        data_distribuicao: dataDist || null,
      });
      if (resp.error) throw resp.error;
      toast.success("Processo judicial registrado");
      setNumProcesso("");
      setVara("");
      setDataDist("");
      setAbrirJud(false);
      onChange();
    } catch (err) {
      console.error(err);
      const errObj = err as { message?: string };
      toast.error(errObj.message || "Erro ao registrar processo");
    } finally {
      setSalvandoJud(false);
    }
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-base">Processos administrativos</CardTitle>
              <CardDescription>
                Pedidos protocolados no INSS.
              </CardDescription>
            </div>
            <Dialog open={abrirAdmin} onOpenChange={setAbrirAdmin}>
              <DialogTrigger asChild>
                <Button size="sm">
                  <Plus className="h-4 w-4 mr-2" />
                  Novo
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Novo processo administrativo</DialogTitle>
                </DialogHeader>
                <div className="space-y-3">
                  <div>
                    <Label className="text-xs">Numero do protocolo</Label>
                    <Input
                      value={protocolo}
                      onChange={(e) => setProtocolo(e.target.value)}
                      placeholder="0000000000000000"
                    />
                  </div>
                  <div>
                    <Label className="text-xs">Data do protocolo</Label>
                    <Input
                      type="date"
                      value={dataProtocolo}
                      onChange={(e) => setDataProtocolo(e.target.value)}
                    />
                  </div>
                  <div>
                    <Label className="text-xs">Status</Label>
                    <Input
                      value={statusAdmin}
                      onChange={(e) => setStatusAdmin(e.target.value)}
                      placeholder="aguardando, em_exigencia, deferido, indeferido..."
                    />
                  </div>
                </div>
                <DialogFooter>
                  <Button
                    variant="ghost"
                    onClick={() => setAbrirAdmin(false)}
                    disabled={salvandoAdmin}
                  >
                    Cancelar
                  </Button>
                  <Button onClick={salvarAdmin} disabled={salvandoAdmin}>
                    {salvandoAdmin && (
                      <Loader2 className="h-3 w-3 mr-2 animate-spin" />
                    )}
                    Salvar
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
        </CardHeader>
        <CardContent>
          {processosAdmin.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-6">
              Nenhum processo administrativo registrado.
            </p>
          ) : (
            <ul className="space-y-2">
              {processosAdmin.map((p) => (
                <li key={p.id} className="border rounded-md p-3">
                  <div className="flex items-center justify-between flex-wrap gap-2">
                    <div>
                      <p className="text-sm font-medium">
                        Protocolo: {p.numero_protocolo || "-"}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        Protocolado em {formatDate(p.data_protocolo)}
                      </p>
                    </div>
                    <Badge variant="outline">{p.status || "-"}</Badge>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-base">Processos judiciais</CardTitle>
              <CardDescription>
                Acoes ajuizadas relacionadas ao caso.
              </CardDescription>
            </div>
            <Dialog open={abrirJud} onOpenChange={setAbrirJud}>
              <DialogTrigger asChild>
                <Button size="sm">
                  <Plus className="h-4 w-4 mr-2" />
                  Novo
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Novo processo judicial</DialogTitle>
                </DialogHeader>
                <div className="space-y-3">
                  <div>
                    <Label className="text-xs">Numero do processo</Label>
                    <Input
                      value={numProcesso}
                      onChange={(e) => setNumProcesso(e.target.value)}
                      placeholder="0000000-00.0000.0.00.0000"
                    />
                  </div>
                  <div>
                    <Label className="text-xs">Vara/Juizo</Label>
                    <Input
                      value={vara}
                      onChange={(e) => setVara(e.target.value)}
                      placeholder="Ex.: 1a Vara Federal de ..."
                    />
                  </div>
                  <div>
                    <Label className="text-xs">Data da distribuicao</Label>
                    <Input
                      type="date"
                      value={dataDist}
                      onChange={(e) => setDataDist(e.target.value)}
                    />
                  </div>
                  <div>
                    <Label className="text-xs">Status</Label>
                    <Input
                      value={statusJud}
                      onChange={(e) => setStatusJud(e.target.value)}
                      placeholder="em_andamento, sentenciado, transitado..."
                    />
                  </div>
                </div>
                <DialogFooter>
                  <Button
                    variant="ghost"
                    onClick={() => setAbrirJud(false)}
                    disabled={salvandoJud}
                  >
                    Cancelar
                  </Button>
                  <Button onClick={salvarJud} disabled={salvandoJud}>
                    {salvandoJud && (
                      <Loader2 className="h-3 w-3 mr-2 animate-spin" />
                    )}
                    Salvar
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
        </CardHeader>
        <CardContent>
          {processosJudiciais.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-6">
              Nenhum processo judicial registrado.
            </p>
          ) : (
            <ul className="space-y-2">
              {processosJudiciais.map((p) => (
                <li key={p.id} className="border rounded-md p-3">
                  <div className="flex items-center justify-between flex-wrap gap-2">
                    <div>
                      <p className="text-sm font-medium">
                        Processo: {p.numero_processo || "-"}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {p.vara ? p.vara + " - " : ""}
                        Distribuido em {formatDate(p.data_distribuicao)}
                      </p>
                    </div>
                    <Badge variant="outline">{p.status || "-"}</Badge>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

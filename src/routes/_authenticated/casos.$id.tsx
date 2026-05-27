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
  Trash2,
  CheckCircle2,
  XCircle,
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
// Tipos (alinhados ao schema real)
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
  rmi_estimada: number | null;
  atrasados_estimados: number | null;
  tramitacao_id: string | null;
  observacoes: string | null;
  created_at: string;
  updated_at: string;
}

interface Andamento {
  id: string;
  caso_id: string;
  origem: string;
  titulo: string | null;
  descricao: string | null;
  data_evento: string | null;
  criado_por: string | null;
  metadata: Record<string, unknown> | null;
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
  origem: string;
  comentario: string | null;
  documento_id: string | null;
  solicitado_por: string | null;
  data_solicitacao: string;
  data_atendimento: string | null;
}

interface AnaliseTecnica {
  id: string;
  caso_id: string;
  versao: number;
  resultado_json: Record<string, unknown> | null;
  beneficio_recomendado: string | null;
  revisoes_aplicaveis: Array<string> | null;
  rmi_estimada: number | null;
  valor_estimado_acao: number | null;
  modelo_ia: string | null;
  tokens_input: number | null;
  tokens_output: number | null;
  custo_brl: number | null;
  resumo_parceiro: string | null;
  criado_por: string | null;
  created_at: string;
}

interface Mensagem {
  id: string;
  caso_id: string;
  remetente_id: string;
  texto: string;
  lida: boolean;
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
  numero_requerimento: string | null;
  data_protocolo: string | null;
  decisao: string | null;
  data_decisao: string | null;
  tramitacao_id: string | null;
  ultima_sync: string | null;
  created_at: string;
}

interface ProcessoJudicial {
  id: string;
  caso_id: string;
  numero_processo: string | null;
  vara: string | null;
  comarca: string | null;
  uf: string | null;
  data_distribuicao: string | null;
  legalmail_id: string | null;
  ultima_sync: string | null;
  created_at: string;
}

// ===========================================================================
// Constantes (alinhadas aos enums reais)
// ===========================================================================

const FASES_CASO = [
  { value: "analise", label: "Em analise" },
  { value: "admin", label: "Administrativo" },
  { value: "judicial", label: "Judicial" },
  { value: "finalizado", label: "Finalizado" },
];

const STATUS_CASO = [
  { value: "aguardando_documentos", label: "Aguardando documentos" },
  { value: "em_analise", label: "Em analise" },
  { value: "em_revisao", label: "Em revisao" },
  { value: "em_andamento", label: "Em andamento" },
  { value: "concluido_exito", label: "Concluido com exito" },
  { value: "concluido_sem_exito", label: "Concluido sem exito" },
  { value: "arquivado", label: "Arquivado" },
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

const STATUS_REPASSE_LABEL: Record<string, string> = {
  previsto: "Previsto",
  a_pagar: "A pagar",
  pago: "Pago",
};

const STATUS_SOLICITACAO_LABEL: Record<string, string> = {
  pendente: "Pendente",
  atendido: "Atendido",
  dispensado: "Dispensado",
};

const ORIGEM_SOLICITACAO_LABEL: Record<string, string> = {
  interna: "Interna (escritorio)",
  externa: "Externa (parceiro/cliente)",
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
  const jaCarregouRef = useRef(false);

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
  const [processosJudiciais, setProcessosJudiciais] = useState<
    Array<ProcessoJudicial>
  >([]);

  const carregar = useCallback(async () => {
    // So mostra loading global na primeira carga, depois recarregamentos sao silenciosos
    if (!jaCarregouRef.current) {
      setLoading(true);
    }
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
        .order("data_evento", { ascending: false });
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
        .order("data_solicitacao", { ascending: false });
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
          setProcessosJudiciais(
            (procJudResp.data || []) as Array<ProcessoJudicial>,
          );
        }
      }
    } catch (err) {
      console.error(err);
      const errObj = err as { message?: string };
      setErro(errObj.message || "Erro ao carregar o caso");
    } finally {
      setLoading(false);
      jaCarregouRef.current = true;
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
            {caso.parceiro_id && (
              <TabsTrigger value="chat" className="flex items-center gap-1">
                <MessageSquare className="h-4 w-4" />
                <span>Chat</span>
              </TabsTrigger>
            )}
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
              parceiro={parceiro}
              isInterno={isInterno}
            />
          </TabsContent>

          <TabsContent value="andamentos" className="mt-4">
            <TabAndamentos
              casoId={casoId}
              andamentos={andamentos}
              isInterno={isInterno}
              temParceiro={caso.parceiro_id !== null}
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

          {caso.parceiro_id && (
            <TabsContent value="chat" className="mt-4">
              <TabChat
                casoId={casoId}
                mensagens={mensagens}
                setMensagens={setMensagens}
                usuarioId={usuario ? usuario.id : null}
              />
            </TabsContent>
          )}

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

  const cpfFormatado = isInterno
    ? maskCPF(cliente.cpf)
    : maskCPFParceiro(cliente.cpf);

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
          <div>
            <CardTitle className="text-xl">{cliente.nome}</CardTitle>
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
            {parceiro && (
              <Badge className="bg-purple-600 hover:bg-purple-600 text-white">
                Parceiro: {parceiro.nome || parceiro.email || "Sem nome"}
              </Badge>
            )}
            {!parceiro && (
              <Badge variant="outline" className="border-blue-500 text-blue-700">
                Cliente interno
              </Badge>
            )}
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
    </Card>
  );
}

// ===========================================================================
// Tab: Visao geral
// ===========================================================================

interface TabVisaoGeralProps {
  caso: Caso;
  cliente: Cliente;
  parceiro: ParceiroLite | null;
  isInterno: boolean;
}

function TabVisaoGeral(props: TabVisaoGeralProps) {
  const { caso, cliente, parceiro, isInterno } = props;
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
          <Linha
            label="Parceiro"
            valor={
              parceiro
                ? parceiro.nome || parceiro.email || "Parceiro sem nome"
                : "Cliente interno do escritorio"
            }
          />
          <Linha label="Fase" valor={labelFromList(FASES_CASO, caso.fase)} />
          <Linha
            label="Status"
            valor={labelFromList(STATUS_CASO, caso.status)}
          />
          {caso.rmi_estimada !== null && (
            <Linha label="RMI estimada" valor={formatMoney(caso.rmi_estimada)} />
          )}
          {caso.atrasados_estimados !== null && (
            <Linha
              label="Atrasados estimados"
              valor={formatMoney(caso.atrasados_estimados)}
            />
          )}
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
  temParceiro: boolean;
  usuarioId: string | null;
  onChange: () => void;
}

function TabAndamentos(props: TabAndamentosProps) {
  const { casoId, andamentos, isInterno, temParceiro, usuarioId, onChange } = props;
  const [titulo, setTitulo] = useState("");
  const [descricao, setDescricao] = useState("");
  const [visivelParceiro, setVisivelParceiro] = useState(true);
  const [salvando, setSalvando] = useState(false);
  const [abrirNovo, setAbrirNovo] = useState(false);

  const lista = isInterno
    ? andamentos
    : andamentos.filter((a) => a.visivel_parceiro === true);

  async function adicionar() {
    if (!titulo.trim() || !usuarioId) return;
    setSalvando(true);
    try {
      const resp = await supabase.from("andamentos").insert({
        caso_id: casoId,
        origem: "interno",
        titulo: titulo.trim(),
        descricao: descricao.trim() || null,
        data_evento: new Date().toISOString(),
        criado_por: usuarioId,
        visivel_parceiro: temParceiro ? visivelParceiro : false,
      });
      if (resp.error) throw resp.error;
      toast.success("Andamento adicionado");
      setTitulo("");
      setDescricao("");
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
                    <Label className="text-xs">Titulo</Label>
                    <Input
                      placeholder="Ex.: Documentos recebidos"
                      value={titulo}
                      onChange={(e) => setTitulo(e.target.value)}
                    />
                  </div>
                  <div>
                    <Label className="text-xs">Descricao (opcional)</Label>
                    <Textarea
                      rows={4}
                      placeholder="Detalhe da movimentacao..."
                      value={descricao}
                      onChange={(e) => setDescricao(e.target.value)}
                    />
                  </div>
                  {temParceiro && (
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
                  )}
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
                    {formatDateTime(a.data_evento || a.created_at)}
                  </span>
                  {isInterno && temParceiro && a.visivel_parceiro && (
                    <Badge variant="secondary" className="text-xs">
                      <Eye className="h-3 w-3 mr-1" />
                      visivel parceiro
                    </Badge>
                  )}
                  {isInterno && temParceiro && !a.visivel_parceiro && (
                    <Badge variant="outline" className="text-xs">
                      <EyeOff className="h-3 w-3 mr-1" />
                      interno
                    </Badge>
                  )}
                </div>
                {a.titulo && (
                  <p className="text-sm font-medium mt-1">{a.titulo}</p>
                )}
                {a.descricao && (
                  <p className="text-sm mt-1 whitespace-pre-wrap text-muted-foreground">
                    {a.descricao}
                  </p>
                )}
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

  // Modal para coletar motivo (dispensa ou atendimento)
  const [acaoAlvo, setAcaoAlvo] = useState<{
    solic: SolicitacaoDocumento;
    novoStatus: string;
  } | null>(null);
  const [comentarioModal, setComentarioModal] = useState("");
  const [salvandoModal, setSalvandoModal] = useState(false);

  const lista = isInterno
    ? documentos
    : documentos.filter((d) => d.visivel_parceiro === true);

  // Solicitacoes ordenadas: pendentes primeiro, depois atendidas, depois dispensadas
  const ordemStatus: Record<string, number> = {
    pendente: 0,
    atendido: 1,
    dispensado: 2,
  };
  const solicitacoesOrdenadas = solicitacoes.slice().sort((a, b) => {
    const oa = ordemStatus[a.status] !== undefined ? ordemStatus[a.status] : 99;
    const ob = ordemStatus[b.status] !== undefined ? ordemStatus[b.status] : 99;
    if (oa !== ob) return oa - ob;
    return b.data_solicitacao.localeCompare(a.data_solicitacao);
  });

  const totalPendentes = solicitacoes.filter((s) => s.status === "pendente").length;

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

  async function deletarDoc(d: Documento) {
    const ok = window.confirm(
      "Tem certeza que deseja deletar o documento '" + d.nome_arquivo + "'?\n\nEssa acao remove o arquivo do storage e o registro do banco, e nao pode ser desfeita.",
    );
    if (!ok) return;
    try {
      // 1) Remove arquivo do storage (best effort)
      const storageResp = await supabase.storage
        .from("documentos")
        .remove([d.storage_path]);
      if (storageResp.error) {
        console.error("Erro ao remover do storage", storageResp.error);
        // segue para deletar o registro mesmo assim
      }
      // 2) Remove registro
      const delResp = await supabase.from("documentos").delete().eq("id", d.id);
      if (delResp.error) throw delResp.error;
      toast.success("Documento deletado");
      onChange();
    } catch (err) {
      console.error(err);
      const errObj = err as { message?: string };
      toast.error(errObj.message || "Erro ao deletar documento");
    }
  }

  async function atualizarStatusSolic(
    s: SolicitacaoDocumento,
    novoStatus: string,
    comentario?: string,
  ) {
    try {
      const update: {
        status: string;
        data_atendimento?: string | null;
        comentario?: string | null;
      } = { status: novoStatus };
      if (novoStatus === "atendido") {
        update.data_atendimento = new Date().toISOString();
      } else if (novoStatus === "pendente") {
        update.data_atendimento = null;
      }
      if (comentario !== undefined) {
        update.comentario = comentario.trim() || null;
      }
      const resp = await supabase
        .from("solicitacoes_documento")
        .update(update)
        .eq("id", s.id);
      if (resp.error) throw resp.error;
      toast.success("Solicitacao atualizada");
      onChange();
    } catch (err) {
      console.error(err);
      const errObj = err as { message?: string };
      toast.error(errObj.message || "Erro ao atualizar solicitacao");
    }
  }

  function abrirAcaoModal(s: SolicitacaoDocumento, novoStatus: string) {
    setAcaoAlvo({ solic: s, novoStatus: novoStatus });
    setComentarioModal(s.comentario || "");
  }

  function fecharAcaoModal() {
    setAcaoAlvo(null);
    setComentarioModal("");
    setSalvandoModal(false);
  }

  async function confirmarAcaoModal() {
    if (!acaoAlvo) return;
    setSalvandoModal(true);
    try {
      await atualizarStatusSolic(
        acaoAlvo.solic,
        acaoAlvo.novoStatus,
        comentarioModal,
      );
    } finally {
      setSalvandoModal(false);
      setAcaoAlvo(null);
      setComentarioModal("");
    }
  }

  return (
    <div className="space-y-4">
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
                  <div className="flex items-center gap-2">
                    <Button size="sm" variant="outline" onClick={() => baixar(d)}>
                      <Download className="h-4 w-4 mr-2" />
                      Baixar
                    </Button>
                    {isInterno && (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => deletarDoc(d)}
                        title="Deletar documento"
                        aria-label="Deletar documento"
                      >
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
          {!isInterno && lista.length > 0 && (
            <p className="text-xs text-muted-foreground mt-3">
              Precisa que um documento seja removido? Avise o escritorio pelo
              chat do caso.
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div>
              <CardTitle className="text-base flex items-center gap-2">
                <ClipboardList className="h-4 w-4" />
                Documentos solicitados
                {totalPendentes > 0 && (
                  <Badge variant="secondary" className="ml-1">
                    {totalPendentes} pendente
                    {totalPendentes > 1 ? "s" : ""}
                  </Badge>
                )}
              </CardTitle>
              <CardDescription>
                {isInterno
                  ? "Historico de pedidos abertos pelo escritorio."
                  : "Documentos que o escritorio precisa. Envie por 'Adicionar' abaixo."}
              </CardDescription>
            </div>
            {isInterno && (
              <SolicitarDocBotao
                casoId={casoId}
                usuarioId={usuarioId}
                onChange={onChange}
              />
            )}
          </div>
        </CardHeader>
        <CardContent>
          {solicitacoesOrdenadas.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-6">
              Nenhuma solicitacao registrada.
            </p>
          ) : (
            <ul className="space-y-2">
              {solicitacoesOrdenadas.map((s) => {
                const isPendente = s.status === "pendente";
                const isAtendido = s.status === "atendido";
                const isDispensado = s.status === "dispensado";
                return (
                  <li
                    key={s.id}
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
                            onClick={() => abrirAcaoModal(s, "atendido")}
                          >
                            <CheckCircle2 className="h-3 w-3 mr-1" />
                            Atendido
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => abrirAcaoModal(s, "dispensado")}
                          >
                            Dispensar
                          </Button>
                        </div>
                      )}
                      {isInterno && !isPendente && (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => atualizarStatusSolic(s, "pendente")}
                        >
                          Reabrir
                        </Button>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>

      <Dialog
        open={acaoAlvo !== null}
        onOpenChange={(o) => {
          if (!o) fecharAcaoModal();
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {acaoAlvo && acaoAlvo.novoStatus === "atendido"
                ? "Marcar como atendido"
                : "Dispensar solicitacao"}
            </DialogTitle>
            <DialogDescription>
              {acaoAlvo && acaoAlvo.novoStatus === "atendido"
                ? "Adicione uma observacao opcional (ex.: substituido pelo CNIS X)."
                : "Informe o motivo da dispensa (recomendado)."}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label className="text-xs">
                {acaoAlvo && acaoAlvo.novoStatus === "atendido"
                  ? "Observacao"
                  : "Motivo"}
              </Label>
              <Textarea
                rows={4}
                placeholder={
                  acaoAlvo && acaoAlvo.novoStatus === "atendido"
                    ? "Ex.: documento ja consta no CNIS"
                    : "Ex.: cliente nao consegue obter; documento nao necessario para esse beneficio"
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

function SolicitarDocBotao(props: {
  casoId: string;
  usuarioId: string | null;
  onChange: () => void;
}) {
  const { casoId, usuarioId, onChange } = props;
  const [aberto, setAberto] = useState(false);
  const [tipo, setTipo] = useState("cnis");
  const [descricao, setDescricao] = useState("");
  const [origem, setOrigem] = useState("externa");
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
        origem: origem,
        solicitado_por: usuarioId,
      });
      if (resp.error) throw resp.error;
      toast.success("Solicitacao criada");
      setDescricao("");
      setOrigem("externa");
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
            <Label className="text-xs">Quem vai providenciar?</Label>
            <Select value={origem} onValueChange={setOrigem}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="externa">
                  Externa - parceiro ou cliente envia
                </SelectItem>
                <SelectItem value="interna">
                  Interna - escritorio providencia
                </SelectItem>
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
  const [beneficio, setBeneficio] = useState("");
  const [rmi, setRmi] = useState("");
  const [valorAcao, setValorAcao] = useState("");
  const [observacoes, setObservacoes] = useState("");
  const [resumoParceiro, setResumoParceiro] = useState("");
  const [salvando, setSalvando] = useState(false);

  const proximaVersao =
    analises.length > 0
      ? Math.max.apply(
          null,
          analises.map((a) => a.versao),
        ) + 1
      : 1;

  async function salvar() {
    if (!beneficio.trim() || !usuarioId) return;
    setSalvando(true);
    try {
      const rmiNum = rmi ? parseFloat(rmi.replace(",", ".")) : null;
      const valorNum = valorAcao ? parseFloat(valorAcao.replace(",", ".")) : null;
      const resp = await supabase.from("analises_tecnicas").insert({
        caso_id: casoId,
        versao: proximaVersao,
        beneficio_recomendado: beneficio.trim(),
        rmi_estimada: rmiNum,
        valor_estimado_acao: valorNum,
        resultado_json: { observacoes: observacoes.trim() || null },
        resumo_parceiro: resumoParceiro.trim() || null,
        criado_por: usuarioId,
      });
      if (resp.error) throw resp.error;
      toast.success("Analise tecnica versao " + proximaVersao + " salva");
      setBeneficio("");
      setRmi("");
      setValorAcao("");
      setObservacoes("");
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

  function obsDaAnalise(a: AnaliseTecnica): string | null {
    if (!a.resultado_json) return null;
    const json = a.resultado_json;
    const obs = json["observacoes"];
    if (typeof obs === "string") return obs;
    return null;
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="text-base">Analise tecnica</CardTitle>
            <CardDescription>
              Historico versionado. Nao visivel ao parceiro (exceto o resumo).
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
                <DialogTitle>
                  Nova analise tecnica (versao {proximaVersao})
                </DialogTitle>
              </DialogHeader>
              <div className="space-y-3">
                <div>
                  <Label className="text-xs">Beneficio recomendado *</Label>
                  <Input
                    placeholder="Ex.: Aposentadoria por tempo de contribuicao"
                    value={beneficio}
                    onChange={(e) => setBeneficio(e.target.value)}
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label className="text-xs">RMI estimada (R$)</Label>
                    <Input
                      type="text"
                      inputMode="decimal"
                      placeholder="0,00"
                      value={rmi}
                      onChange={(e) => setRmi(e.target.value)}
                    />
                  </div>
                  <div>
                    <Label className="text-xs">
                      Valor estimado da acao (R$)
                    </Label>
                    <Input
                      type="text"
                      inputMode="decimal"
                      placeholder="0,00"
                      value={valorAcao}
                      onChange={(e) => setValorAcao(e.target.value)}
                    />
                  </div>
                </div>
                <div>
                  <Label className="text-xs">Observacoes (interno)</Label>
                  <Textarea
                    rows={6}
                    placeholder="Raciocinio juridico, calculos, fundamentacao..."
                    value={observacoes}
                    onChange={(e) => setObservacoes(e.target.value)}
                  />
                </div>
                <div>
                  <Label className="text-xs">
                    Resumo para o parceiro (opcional)
                  </Label>
                  <Textarea
                    rows={3}
                    placeholder="Versao simplificada exibida ao parceiro..."
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
            {analises.map((a) => {
              const obs = obsDaAnalise(a);
              return (
                <div key={a.id} className="border rounded-md p-3">
                  <div className="flex items-center gap-2 mb-2 flex-wrap">
                    <Badge>v{a.versao}</Badge>
                    <span className="text-xs text-muted-foreground">
                      {formatDateTime(a.created_at)}
                    </span>
                    {a.modelo_ia && (
                      <Badge variant="outline" className="text-xs">
                        IA: {a.modelo_ia}
                      </Badge>
                    )}
                  </div>
                  {a.beneficio_recomendado && (
                    <p className="text-sm font-medium">
                      {a.beneficio_recomendado}
                    </p>
                  )}
                  <div className="grid grid-cols-2 gap-2 mt-2 text-xs">
                    {a.rmi_estimada !== null && (
                      <div>
                        <span className="text-muted-foreground">RMI: </span>
                        <span>{formatMoney(a.rmi_estimada)}</span>
                      </div>
                    )}
                    {a.valor_estimado_acao !== null && (
                      <div>
                        <span className="text-muted-foreground">
                          Valor da acao:{" "}
                        </span>
                        <span>{formatMoney(a.valor_estimado_acao)}</span>
                      </div>
                    )}
                  </div>
                  {obs && (
                    <div className="mt-2 pt-2 border-t">
                      <p className="text-xs text-muted-foreground mb-1">
                        Observacoes
                      </p>
                      <p className="text-sm whitespace-pre-wrap">{obs}</p>
                    </div>
                  )}
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
              );
            })}
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
        remetente_id: usuarioId,
        texto: texto.trim(),
        lida: false,
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
              const eu = m.remetente_id === usuarioId;
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
                    <p className="whitespace-pre-wrap">{m.texto}</p>
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
  const [statusInicial, setStatusInicial] = useState("previsto");
  const [salvando, setSalvando] = useState(false);

  const lista = isInterno
    ? repasses
    : repasses.filter((r) => r.parceiro_id === parceiroId);

  const total = lista.reduce((acc, r) => acc + (r.valor || 0), 0);
  const pago = lista
    .filter((r) => r.status === "pago")
    .reduce((acc, r) => acc + (r.valor || 0), 0);
  const aPagar = lista
    .filter((r) => r.status === "a_pagar")
    .reduce((acc, r) => acc + (r.valor || 0), 0);
  const previsto = lista
    .filter((r) => r.status === "previsto")
    .reduce((acc, r) => acc + (r.valor || 0), 0);

  async function adicionar() {
    if (!parceiroId) {
      toast.error("Caso sem parceiro indicador.");
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
        status: statusInicial,
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

  async function atualizarStatus(r: Repasse, novoStatus: string) {
    try {
      const update: { status: string; data_pagamento?: string | null } = {
        status: novoStatus,
      };
      if (novoStatus === "pago") {
        update.data_pagamento = new Date().toISOString().slice(0, 10);
      }
      const resp = await supabase
        .from("repasses")
        .update(update)
        .eq("id", r.id);
      if (resp.error) throw resp.error;
      toast.success("Repasse atualizado");
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
                  <div>
                    <Label className="text-xs">Status inicial</Label>
                    <Select
                      value={statusInicial}
                      onValueChange={setStatusInicial}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="previsto">Previsto</SelectItem>
                        <SelectItem value="a_pagar">A pagar</SelectItem>
                        <SelectItem value="pago">Pago</SelectItem>
                      </SelectContent>
                    </Select>
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
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
          <div className="border rounded-md p-3">
            <p className="text-xs text-muted-foreground">Total</p>
            <p className="text-base font-medium">{formatMoney(total)}</p>
          </div>
          <div className="border rounded-md p-3">
            <p className="text-xs text-muted-foreground">Previsto</p>
            <p className="text-base font-medium text-muted-foreground">
              {formatMoney(previsto)}
            </p>
          </div>
          <div className="border rounded-md p-3">
            <p className="text-xs text-muted-foreground">A pagar</p>
            <p className="text-base font-medium text-amber-700">
              {formatMoney(aPagar)}
            </p>
          </div>
          <div className="border rounded-md p-3">
            <p className="text-xs text-muted-foreground">Pago</p>
            <p className="text-base font-medium text-green-700">
              {formatMoney(pago)}
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
                className="flex items-center justify-between gap-2 border rounded-md p-3 flex-wrap"
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
                    {STATUS_REPASSE_LABEL[r.status] || r.status}
                  </Badge>
                  {isInterno && r.status !== "pago" && (
                    <Select
                      value={r.status}
                      onValueChange={(v) => atualizarStatus(r, v)}
                    >
                      <SelectTrigger className="h-8 w-32 text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="previsto">Previsto</SelectItem>
                        <SelectItem value="a_pagar">A pagar</SelectItem>
                        <SelectItem value="pago">Pago</SelectItem>
                      </SelectContent>
                    </Select>
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
  const [numReq, setNumReq] = useState("");
  const [dataProtocolo, setDataProtocolo] = useState("");
  const [decisao, setDecisao] = useState("");
  const [dataDecisao, setDataDecisao] = useState("");
  const [salvandoAdmin, setSalvandoAdmin] = useState(false);

  const [abrirJud, setAbrirJud] = useState(false);
  const [numProcesso, setNumProcesso] = useState("");
  const [vara, setVara] = useState("");
  const [comarca, setComarca] = useState("");
  const [uf, setUf] = useState("");
  const [dataDist, setDataDist] = useState("");
  const [salvandoJud, setSalvandoJud] = useState(false);

  async function salvarAdmin() {
    setSalvandoAdmin(true);
    try {
      const resp = await supabase.from("processos_admin").insert({
        caso_id: casoId,
        numero_requerimento: numReq.trim() || null,
        data_protocolo: dataProtocolo || null,
        decisao: decisao.trim() || null,
        data_decisao: dataDecisao || null,
      });
      if (resp.error) throw resp.error;
      toast.success("Processo administrativo registrado");
      setNumReq("");
      setDataProtocolo("");
      setDecisao("");
      setDataDecisao("");
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
        comarca: comarca.trim() || null,
        uf: uf.trim() || null,
        data_distribuicao: dataDist || null,
      });
      if (resp.error) throw resp.error;
      toast.success("Processo judicial registrado");
      setNumProcesso("");
      setVara("");
      setComarca("");
      setUf("");
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
              <CardTitle className="text-base">
                Processos administrativos
              </CardTitle>
              <CardDescription>
                Requerimentos protocolados no INSS.
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
                    <Label className="text-xs">Numero do requerimento</Label>
                    <Input
                      value={numReq}
                      onChange={(e) => setNumReq(e.target.value)}
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
                    <Label className="text-xs">Decisao (se houver)</Label>
                    <Input
                      value={decisao}
                      onChange={(e) => setDecisao(e.target.value)}
                      placeholder="Ex.: deferido, indeferido, em exigencia..."
                    />
                  </div>
                  <div>
                    <Label className="text-xs">Data da decisao</Label>
                    <Input
                      type="date"
                      value={dataDecisao}
                      onChange={(e) => setDataDecisao(e.target.value)}
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
                        Req.: {p.numero_requerimento || "-"}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        Protocolado em {formatDate(p.data_protocolo)}
                        {p.data_decisao
                          ? " - Decidido em " + formatDate(p.data_decisao)
                          : ""}
                      </p>
                    </div>
                    {p.decisao && <Badge variant="outline">{p.decisao}</Badge>}
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
                    <Label className="text-xs">Vara</Label>
                    <Input
                      value={vara}
                      onChange={(e) => setVara(e.target.value)}
                      placeholder="Ex.: 1a Vara Federal"
                    />
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    <div className="col-span-2">
                      <Label className="text-xs">Comarca</Label>
                      <Input
                        value={comarca}
                        onChange={(e) => setComarca(e.target.value)}
                        placeholder="Ex.: Sao Paulo"
                      />
                    </div>
                    <div>
                      <Label className="text-xs">UF</Label>
                      <Input
                        value={uf}
                        onChange={(e) =>
                          setUf(e.target.value.toUpperCase().slice(0, 2))
                        }
                        placeholder="SP"
                        maxLength={2}
                      />
                    </div>
                  </div>
                  <div>
                    <Label className="text-xs">Data da distribuicao</Label>
                    <Input
                      type="date"
                      value={dataDist}
                      onChange={(e) => setDataDist(e.target.value)}
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

import {
  createFileRoute,
  useParams,
  useNavigate,
  Link,
} from "@tanstack/react-router";
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
  Pencil,
  Search,
  ChevronDown,
  ChevronRight,
  MoreVertical,
  Copy,
  KeyRound,
} from "lucide-react";

import { useAuth } from "@/hooks/use-auth";
import { supabase } from "@/lib/supabase";
import {
  MAX_FILE_SIZE_MB,
  validateFileSize,
  validateFileSizes,
} from "@/lib/upload-limits";
import { ClientOnly } from "@/components/client-only";
import { DocTypeCombobox } from "@/components/doc-type-combobox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

export const Route = createFileRoute("/_authenticated/casos/$id")({
  component: CasoDetalhePage,
});

// ===========================================================================
// Tipos (alinhados ao schema real)
// ===========================================================================

interface TagTI {
  id: number;
  name: string;
  color: string;
}

interface Cliente {
  id: string;
  nome: string;
  cpf: string;
  data_nascimento: string | null;
  telefone: string | null;
  email: string | null;
  observacoes: string | null;
  tags: Array<TagTI> | null;
  ti_customer_id: number | null;
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
  processo_admin_id: string | null;
  processo_judicial_id: string | null;
  created_at: string;
}

interface Documento {
  id: string;
  caso_id: string;
  tipo: string;
  tipo_personalizado: string | null;
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

const TIPOS_BENEFICIO = [
  "Aposentadoria por idade",
  "Aposentadoria por tempo de contribuicao",
  "Aposentadoria especial",
  "Aposentadoria da PCD (LC 142/2013)",
  "Aposentadoria por incapacidade permanente",
  "Auxilio por incapacidade temporaria",
  "Auxilio-acidente",
  "Pensao por morte",
  "Salario-maternidade",
  "BPC/LOAS",
  "Revisao da vida toda",
  "Revisao de aposentadoria",
  "Outro",
];

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
  substabelecimento: "Substabelecimento",
  contrato_honorarios: "Contrato de honorarios",
  declaracao_hipossuficiencia: "Declaracao de hipossuficiencia",
  declaracao_ausencia_duplicidade:
    "Declaracao de ausencia de duplicidade de acao",
  outro: "Outro",
};

// Ordem de exibicao dos documentos na aba Documentos do caso.
// Cada tipo recebe um indice de grupo (1-9). A lista de documentos eh
// ordenada por esse indice (depois por nome dentro do mesmo grupo).
// Grupos:
//   1. Documentos pessoais
//   2. Comprovantes de endereco
//   3. Procuracao/Substabelecimento/Declaracoes
//   4. CNIS
//   5. Documentos profissionais (CTPS, PPP, LTCAT)
//   6. Laudos medicos
//   7. Laudos do INSS
//   8. Holerites e comprovantes de pagamento
//   9. Outros (default)
const DOC_TYPE_GROUP: Record<string, number> = {
  // 1. Documentos pessoais
  rg_cpf: 1,
  certidao_nascimento: 1,
  certidao_casamento: 1,
  certidao_obito: 1,
  // 2. Comprovantes de endereco
  comprovante_residencia: 2,
  // 3. Procuracao / Substabelecimento / Declaracoes
  procuracao: 3,
  substabelecimento: 3,
  contrato_honorarios: 3,
  declaracao_uniao_estavel: 3,
  declaracao_atividade_rural: 3,
  declaracao_hipossuficiencia: 3,
  declaracao_ausencia_duplicidade: 3,
  // 4. CNIS
  cnis: 4,
  // 5. Documentos profissionais
  ctps: 5,
  ppp: 5,
  ltcat: 5,
  // 6. Laudos medicos
  laudo_medico: 6,
  atestado_medico: 6,
  cat: 6,
  // 7. Laudos do INSS
  hiscre: 7,
  carta_concessao_inss: 7,
  ctc: 7,
  // 8. Holerites e comprovantes de pagamento
  holerite: 8,
  carne_gps: 8,
  // 9. Outros (default para qualquer tipo nao listado, inclusive "outro")
  outro: 9,
};

function getDocGroup(tipo: string): number {
  return DOC_TYPE_GROUP[tipo] !== undefined ? DOC_TYPE_GROUP[tipo] : 9;
}

// Grupos exibidos como accordion (recolhem por padrao porque tendem a ter
// muitos arquivos do mesmo tipo). Os demais grupos seguem como lista plana.
const GRUPOS_ACCORDION = new Set<number>([6, 7, 8]);

const GRUPO_LABELS: Record<number, string> = {
  6: "Laudos medicos",
  7: "Laudos do INSS",
  8: "Holerites e comprovantes de pagamento",
};

// Remove prefixo numerico do nome do arquivo na exibicao.
// Ex.: "01 - RG e CPF.pdf" -> "RG e CPF.pdf"
//      "08 - Relatorio.pdf" -> "Relatorio.pdf"
// O arquivo original no Storage NAO e renomeado, so o que aparece na UI.
function displayNomeArquivo(nome: string | null | undefined): string {
  if (!nome) return "";
  return nome.replace(/^\d+\s*[-_.]\s*/, "").trim();
}

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
  const [parceirosDisponiveis, setParceirosDisponiveis] = useState<
    Array<ParceiroLite>
  >([]);
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
        .select(
          "id, nome, cpf, data_nascimento, telefone, email, observacoes, tags, ti_customer_id",
        )
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

      // Lista de parceiros disponiveis (para edicao do caso). So interno usa.
      const parceirosResp = await supabase
        .from("usuarios")
        .select("id, nome, email")
        .eq("tipo", "parceiro")
        .order("nome", { ascending: true });
      if (parceirosResp.error) {
        console.error("erro listar parceiros", parceirosResp.error);
      } else {
        setParceirosDisponiveis(
          (parceirosResp.data || []) as Array<ParceiroLite>,
        );
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

      // Processos sao carregados tambem para o parceiro porque a aba Andamentos
      // depende disso pra renderizar os cards "Administrativos" e "Judiciais"
      // (a separacao de andamentos por processo). RLS ja restringe parceiro
      // aos processos dos casos dele.
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
          usuarioId={usuario ? usuario.id : null}
          processosJudiciais={processosJudiciais}
          onChange={carregar}
        />

        <Tabs defaultValue="visao_geral" className="w-full">
          {/* Tabs em uma unica linha com scroll horizontal em telas estreitas.
              Evita o efeito de "linhas quebradas" desorganizadas. */}
          <TabsList className="w-full flex justify-start overflow-x-auto">
            <TabsTrigger value="visao_geral" className="flex items-center gap-1 shrink-0">
              <Activity className="h-4 w-4" />
              <span>Visao geral</span>
            </TabsTrigger>
            <TabsTrigger value="andamentos" className="flex items-center gap-1 shrink-0">
              <ClipboardList className="h-4 w-4" />
              <span>Andamentos</span>
            </TabsTrigger>
            <TabsTrigger value="documentos" className="flex items-center gap-1 shrink-0">
              <FileCheck className="h-4 w-4" />
              <span>Documentos</span>
            </TabsTrigger>
            {isInterno && (
              <TabsTrigger value="analise" className="flex items-center gap-1 shrink-0">
                <FileText className="h-4 w-4" />
                <span>Analise</span>
              </TabsTrigger>
            )}
            {caso.parceiro_id && (
              <TabsTrigger value="chat" className="flex items-center gap-1 shrink-0">
                <MessageSquare className="h-4 w-4" />
                <span>Chat</span>
              </TabsTrigger>
            )}
            <TabsTrigger value="repasses" className="flex items-center gap-1 shrink-0">
              <DollarSign className="h-4 w-4" />
              <span>Repasses</span>
            </TabsTrigger>
            {isInterno && (
              <TabsTrigger value="processos" className="flex items-center gap-1 shrink-0">
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
              parceirosDisponiveis={parceirosDisponiveis}
              isInterno={isInterno}
              onChange={carregar}
            />
          </TabsContent>

          <TabsContent value="andamentos" className="mt-4">
            <TabAndamentos
              casoId={casoId}
              andamentos={andamentos}
              processosAdmin={processosAdmin}
              processosJudiciais={processosJudiciais}
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
                cliente={cliente}
                usuarioId={usuario ? usuario.id : null}
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
  usuarioId: string | null;
  processosJudiciais: Array<ProcessoJudicial>;
  onChange: () => void;
}

function CasoHeader(props: CasoHeaderProps) {
  const { caso, cliente, isInterno, usuarioId, processosJudiciais, onChange } =
    props;
  const [syncing, setSyncing] = useState(false);
  const [syncingLM, setSyncingLM] = useState(false);

  async function syncTI() {
    setSyncing(true);
    try {
      const resp = await supabase.functions.invoke("sync-ti-cliente", {
        body: { cpf: cliente.cpf, caso_id: caso.id, usuario_id: usuarioId },
      });
      if (resp.error) throw resp.error;
      const r = resp.data as {
        achou_no_ti?: boolean;
        atualizado?: boolean;
        tags_aplicadas?: number;
        notas_importadas?: number;
        notas_ja_existentes?: number;
        motivo?: string;
      };
      if (!r.achou_no_ti) {
        toast.error("Cliente nao encontrado no Tramitacao Inteligente");
      } else if (r.atualizado) {
        const tags = r.tags_aplicadas || 0;
        const notasNovas = r.notas_importadas || 0;
        const notasJa = r.notas_ja_existentes || 0;
        let msg =
          "Sincronizado com TI. " + tags + " tag" + (tags === 1 ? "" : "s") +
          " aplicada" + (tags === 1 ? "" : "s") + ".";
        if (notasNovas > 0) {
          msg += " " + notasNovas + " nota" + (notasNovas === 1 ? "" : "s") +
            " do TI importada" + (notasNovas === 1 ? "" : "s") +
            " como andamento" + (notasNovas === 1 ? "" : "s") + ".";
        }
        if (notasJa > 0) {
          msg += " " + notasJa + " ja existia" + (notasJa === 1 ? "" : "m") +
            " (dedup).";
        }
        toast.success(msg);
        onChange();
      } else {
        toast.error(r.motivo || "Nao foi possivel sincronizar");
      }
    } catch (err) {
      console.error(err);
      const errObj = err as { message?: string };
      toast.error(errObj.message || "Erro ao sincronizar com TI");
    } finally {
      setSyncing(false);
    }
  }

  async function syncLegalmail() {
    // So processos judiciais que ja foram importados do Legalmail
    // (tem legalmail_id populado) sao atualizados.
    const procsComLM = processosJudiciais.filter((p) => !!p.legalmail_id);
    if (procsComLM.length === 0) {
      toast.error(
        "Nenhum processo Legalmail vinculado a este caso. Use 'Buscar no Legalmail' na aba Processos primeiro.",
      );
      return;
    }
    const idprocessos = procsComLM
      .map((p) => Number(p.legalmail_id))
      .filter((n) => !isNaN(n));
    if (idprocessos.length === 0) {
      toast.error("Erro ao ler ids do Legalmail dos processos vinculados.");
      return;
    }
    setSyncingLM(true);
    try {
      const resp = await supabase.functions.invoke("sync-legalmail-caso", {
        body: {
          caso_id: caso.id,
          usuario_id: usuarioId,
          idprocessos: idprocessos,
        },
      });
      if (resp.error) throw resp.error;
      const r = resp.data as {
        processos_criados?: number;
        processos_atualizados?: number;
        movimentacoes_importadas?: number;
        movimentacoes_ja_existentes?: number;
        movimentacoes_ignoradas?: number;
        erros?: Array<{ idprocesso: number; motivo: string }>;
      };
      const pa = r.processos_atualizados || 0;
      const mi = r.movimentacoes_importadas || 0;
      const mj = r.movimentacoes_ja_existentes || 0;
      const mig = r.movimentacoes_ignoradas || 0;
      let msg =
        pa + " processo" + (pa === 1 ? "" : "s") + " atualizado" +
        (pa === 1 ? "" : "s") + ". " +
        mi + " movimentaca" + (mi === 1 ? "o" : "oes") + " nova" +
        (mi === 1 ? "" : "s");
      if (mj > 0) {
        msg += " (" + mj + " ja existia" + (mj === 1 ? "" : "m") + ")";
      }
      if (mig > 0) {
        msg += ". " + mig + " mov" + (mig === 1 ? "" : "s") +
          " ignorada" + (mig === 1 ? "" : "s") + " pela whitelist";
      }
      msg += ".";
      toast.success(msg);
      if (r.erros && r.erros.length > 0) {
        console.warn("erros no sync Legalmail:", r.erros);
        toast.warning(
          r.erros.length + " erro(s) durante sync. Ver console.",
        );
      }
      onChange();
    } catch (err) {
      console.error(err);
      const errObj = err as { message?: string };
      toast.error(errObj.message || "Erro ao sincronizar com Legalmail");
    } finally {
      setSyncingLM(false);
    }
  }

  const tagsTodas = (cliente.tags || []) as Array<TagTI>;
  // Tags TI com formato "NOME/UF" sao internas (responsaveis do escritorio),
  // ex.: LUCAS/MT, BEATRIZ/SP, MARA/MT. Esconder pro parceiro.
  const tags = isInterno
    ? tagsTodas
    : tagsTodas.filter((t) => !/^[A-Za-z_]+\/[A-Z]{2}$/.test(t.name.trim()));

  const cpfFormatado = isInterno
    ? maskCPF(cliente.cpf)
    : maskCPFParceiro(cliente.cpf);

  return (
    <Card>
      <CardHeader className="space-y-3">
        {/* Linha 1: nome + CPF do cliente, com menu "..." de acoes a direita.
            Mantem o header limpo - tags ficam isoladas na linha de baixo. */}
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <CardTitle className="text-xl">{cliente.nome}</CardTitle>
            <CardDescription>
              CPF: {cpfFormatado} - {caso.tipo_beneficio}
            </CardDescription>
          </div>
          {isInterno && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 shrink-0"
                  aria-label="Acoes do caso"
                  disabled={syncing || syncingLM}
                >
                  {syncing || syncingLM ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <MoreVertical className="h-4 w-4" />
                  )}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem
                  onClick={syncTI}
                  disabled={syncing}
                  title="Sincronizar tags e dados com Tramitacao Inteligente"
                >
                  {syncing && (
                    <Loader2 className="h-3 w-3 mr-2 animate-spin" />
                  )}
                  Sync TI
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={syncLegalmail}
                  disabled={syncingLM}
                  title="Atualizar movimentacoes dos processos Legalmail vinculados"
                >
                  {syncingLM && (
                    <Loader2 className="h-3 w-3 mr-2 animate-spin" />
                  )}
                  Sync Legal
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
        {/* Linha 2: somente tags TI (com bolinha colorida + outline neutro). */}
        {tags.length > 0 && (
          <div className="flex flex-wrap items-center gap-2">
            {tags.map((t) => (
              // Tag TI usa a cor original do sistema TI - facilita o
              // reconhecimento cruzado entre o app e o TI.
              <Badge
                key={t.id}
                variant="outline"
                className="font-normal text-xs"
                style={{
                  backgroundColor: t.color,
                  borderColor: t.color,
                  color: "#1f2937",
                }}
                title={"Tag do Tramitacao Inteligente"}
              >
                {t.name}
              </Badge>
            ))}
          </div>
        )}
      </CardHeader>
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
  parceirosDisponiveis: Array<ParceiroLite>;
  isInterno: boolean;
  onChange: () => void;
}

function TabVisaoGeral(props: TabVisaoGeralProps) {
  const { caso, cliente, parceiro, parceirosDisponiveis, isInterno, onChange } =
    props;
  const navigate = useNavigate();

  // ---- AlertDialog: confirmar excluir cliente ----
  // Acao destrutiva: apaga cliente + todos os casos vinculados + documentos.
  // RPC backend valida que e interno e cuida do cascade. Frontend apaga
  // tambem o storage depois pra nao deixar lixo.
  const [confExcluirCliente, setConfExcluirCliente] = useState(false);
  const [excluindoCliente, setExcluindoCliente] = useState(false);

  // ---- Dialog: Editar cliente ----
  const [abrirEditCliente, setAbrirEditCliente] = useState(false);
  const [clNome, setClNome] = useState("");
  const [clDataNascimento, setClDataNascimento] = useState("");
  const [clTelefone, setClTelefone] = useState("");
  const [clEmail, setClEmail] = useState("");
  const [clObservacoes, setClObservacoes] = useState("");
  // Campo senha no modal de editar cliente. Sempre comeca vazio - se ficar
  // vazio na submissao, NAO mexe na senha atual. Se preenchido, substitui
  // via set_senha_meu_inss (criptografando no banco).
  const [clSenhaMeuInss, setClSenhaMeuInss] = useState("");
  const [clTemSenha, setClTemSenha] = useState(false);
  const [clSalvando, setClSalvando] = useState(false);

  async function abrirDialogCliente() {
    setClNome(cliente.nome);
    setClDataNascimento(cliente.data_nascimento || "");
    setClTelefone(cliente.telefone || "");
    setClEmail(cliente.email || "");
    setClObservacoes(cliente.observacoes || "");
    setClSenhaMeuInss("");
    // Checa se ja tem senha MEU INSS cadastrada (sem revelar a senha).
    try {
      const resp = await supabase.rpc("tem_senha_meu_inss", {
        p_cliente_id: cliente.id,
      });
      setClTemSenha(resp.data === true);
    } catch {
      setClTemSenha(false);
    }
    setAbrirEditCliente(true);
  }

  async function salvarCliente() {
    if (!clNome.trim()) {
      toast.error("Nome obrigatorio");
      return;
    }
    setClSalvando(true);
    try {
      const resp = await supabase
        .from("clientes")
        .update({
          nome: clNome.trim(),
          data_nascimento: clDataNascimento || null,
          telefone: clTelefone.trim() || null,
          email: clEmail.trim() || null,
          observacoes: clObservacoes.trim() || null,
        })
        .eq("id", cliente.id)
        .select();
      if (resp.error) throw resp.error;
      if (!resp.data || resp.data.length === 0) {
        toast.error("Atualizacao nao foi aplicada. Possivel bloqueio de RLS.");
        return;
      }
      // Se preencheu campo de senha, atualiza via RPC criptografada.
      // Campo vazio = manter senha atual intacta (nao mexe).
      const senhaNova = clSenhaMeuInss.trim();
      if (senhaNova.length > 0) {
        const senhaResp = await supabase.rpc("set_senha_meu_inss", {
          p_cliente_id: cliente.id,
          p_senha: senhaNova,
        });
        if (senhaResp.error) {
          toast.warning(
            "Cliente atualizado, mas a senha MEU INSS nao foi salva: " +
              (senhaResp.error.message || "erro desconhecido"),
          );
        } else {
          toast.success(clTemSenha ? "Senha MEU INSS substituida" : "Senha MEU INSS cadastrada");
        }
      }
      toast.success("Cliente atualizado");
      setAbrirEditCliente(false);
      onChange();
    } catch (err) {
      console.error(err);
      const errObj = err as { message?: string };
      toast.error(errObj.message || "Erro ao atualizar cliente");
    } finally {
      setClSalvando(false);
    }
  }

  // ---- Excluir cliente (interno only, destrutivo) ----
  // Fluxo:
  //   1) Chama RPC excluir_cliente -> retorna lista de storage_paths.
  //   2) Apaga arquivos do bucket Storage (pra nao deixar lixo).
  //   3) Toast + navega pra home (/casos).
  // Nao da rollback do storage se RPC falhar (passo 1 acontece em transacao
  // no banco). Se passo 2 falhar, no banco ja sumiu, so deixa arquivo orfao.
  async function excluirCliente() {
    if (!isInterno) return;
    setExcluindoCliente(true);
    try {
      const rpcResp = await supabase.rpc("excluir_cliente", {
        p_cliente_id: cliente.id,
      });
      if (rpcResp.error) throw rpcResp.error;

      // RPC retorna array de paths. Apaga do storage.
      const paths = (rpcResp.data as string[] | null) ?? [];
      if (paths.length > 0) {
        const remResp = await supabase.storage
          .from("documentos")
          .remove(paths);
        if (remResp.error) {
          // Banco ja apagado - so deixa warning sobre lixo no storage.
          console.warn("Cliente excluido, mas arquivos do storage falharam:",
            remResp.error);
        }
      }

      toast.success("Cliente e dados vinculados excluidos.");
      setConfExcluirCliente(false);
      setAbrirEditCliente(false);
      navigate({ to: "/" });
    } catch (err) {
      console.error(err);
      const errObj = err as { message?: string };
      toast.error(errObj.message || "Erro ao excluir cliente");
    } finally {
      setExcluindoCliente(false);
    }
  }

  // ---- Dialog: Ver senha MEU INSS (interno) ----
  // Chama RPC get_senha_meu_inss que decripta + registra audit.
  const [abrirSenha, setAbrirSenha] = useState(false);
  const [carregandoSenha, setCarregandoSenha] = useState(false);
  const [senhaValor, setSenhaValor] = useState<string | null>(null);
  const [erroSenha, setErroSenha] = useState<string | null>(null);

  // ---- Dialog: Alterar senha MEU INSS (parceiro, write-only) ----
  // Parceiro escreve mas nao le. Mesmo fluxo do interno usaria, mas
  // parceiro tem UI separada e simplificada (sem opcao de visualizar).
  const [abrirSenhaParc, setAbrirSenhaParc] = useState(false);
  const [senhaParcValor, setSenhaParcValor] = useState("");
  const [senhaParcSalvando, setSenhaParcSalvando] = useState(false);
  const [senhaParcTemSenha, setSenhaParcTemSenha] = useState(false);

  async function abrirAlterarSenhaParceiro() {
    setSenhaParcValor("");
    try {
      const resp = await supabase.rpc("tem_senha_meu_inss", {
        p_cliente_id: cliente.id,
      });
      setSenhaParcTemSenha(resp.data === true);
    } catch {
      setSenhaParcTemSenha(false);
    }
    setAbrirSenhaParc(true);
  }

  async function salvarSenhaParceiro() {
    const senhaNova = senhaParcValor.trim();
    if (senhaNova.length === 0) {
      toast.error("Digite a senha pra salvar");
      return;
    }
    setSenhaParcSalvando(true);
    try {
      const resp = await supabase.rpc("set_senha_meu_inss", {
        p_cliente_id: cliente.id,
        p_senha: senhaNova,
      });
      if (resp.error) throw resp.error;
      toast.success(
        senhaParcTemSenha
          ? "Senha MEU INSS substituida"
          : "Senha MEU INSS cadastrada",
      );
      setAbrirSenhaParc(false);
      setSenhaParcValor("");
    } catch (err) {
      console.error(err);
      const errObj = err as { message?: string };
      toast.error(errObj.message || "Erro ao salvar senha");
    } finally {
      setSenhaParcSalvando(false);
    }
  }

  async function abrirVerSenha() {
    setAbrirSenha(true);
    setCarregandoSenha(true);
    setSenhaValor(null);
    setErroSenha(null);
    try {
      const resp = await supabase.rpc("get_senha_meu_inss", {
        p_cliente_id: cliente.id,
      });
      if (resp.error) throw resp.error;
      const data = resp.data as string | null;
      setSenhaValor(data);
    } catch (err) {
      console.error(err);
      const errObj = err as { message?: string };
      setErroSenha(errObj.message || "Erro ao decifrar senha");
    } finally {
      setCarregandoSenha(false);
    }
  }

  function fecharSenha() {
    setAbrirSenha(false);
    setSenhaValor(null);
    setErroSenha(null);
  }

  async function copiarSenha() {
    if (!senhaValor) return;
    try {
      await navigator.clipboard.writeText(senhaValor);
      toast.success("Senha copiada");
    } catch (err) {
      console.error(err);
      toast.error("Nao foi possivel copiar (clipboard bloqueado)");
    }
  }

  // ---- Dialog: Editar caso ----
  const [abrirEditCaso, setAbrirEditCaso] = useState(false);
  const [csTipoBeneficio, setCsTipoBeneficio] = useState("");
  const [csInterno, setCsInterno] = useState(true);
  const [csParceiroId, setCsParceiroId] = useState("");
  const [csFase, setCsFase] = useState("");
  const [csStatus, setCsStatus] = useState("");
  const [csSalvando, setCsSalvando] = useState(false);

  function abrirDialogCaso() {
    setCsTipoBeneficio(caso.tipo_beneficio);
    setCsInterno(caso.parceiro_id === null);
    setCsParceiroId(caso.parceiro_id || "");
    setCsFase(caso.fase);
    setCsStatus(caso.status);
    setAbrirEditCaso(true);
  }

  async function salvarCaso() {
    if (!csTipoBeneficio) {
      toast.error("Tipo de beneficio obrigatorio");
      return;
    }
    if (!csInterno && !csParceiroId) {
      toast.error("Selecione um parceiro indicador ou marque como cliente interno");
      return;
    }
    setCsSalvando(true);
    try {
      const resp = await supabase
        .from("casos")
        .update({
          tipo_beneficio: csTipoBeneficio,
          parceiro_id: csInterno ? null : csParceiroId,
          fase: csFase,
          status: csStatus,
        })
        .eq("id", caso.id)
        .select();
      if (resp.error) throw resp.error;
      if (!resp.data || resp.data.length === 0) {
        toast.error("Atualizacao nao foi aplicada. Possivel bloqueio de RLS.");
        return;
      }
      toast.success("Caso atualizado");
      setAbrirEditCaso(false);
      onChange();
    } catch (err) {
      console.error(err);
      const errObj = err as { message?: string };
      toast.error(errObj.message || "Erro ao atualizar caso");
    } finally {
      setCsSalvando(false);
    }
  }

  return (
    <div className="space-y-3">
      {/* Botao discreto pra editar tipo beneficio / fase / status / parceiro.
          Substitui o antigo card "Configuracoes do caso" - info ja aparece
          nas tags do header. */}
      {isInterno && (
        <div className="flex justify-end">
          <Button
            size="sm"
            variant="outline"
            onClick={abrirDialogCaso}
            className="text-xs"
          >
            <Pencil className="h-3.5 w-3.5 mr-1" />
            Editar caso
          </Button>
        </div>
      )}
      <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-2">
            <CardTitle className="text-base">Dados do cliente</CardTitle>
            {isInterno && (
              <Button
                size="sm"
                variant="outline"
                onClick={abrirDialogCliente}
              >
                <Pencil className="h-3.5 w-3.5 mr-1" />
                Editar
              </Button>
            )}
          </div>
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
            <Linha label="Telefone" valor={cliente.telefone || "-"} />
          )}
          {isInterno && (
            <Linha label="E-mail" valor={cliente.email || "-"} />
          )}
          {isInterno && (
            // Botao Ver senha MEU INSS. O clique dispara RPC com audit.
            <div className="pt-2 border-t flex items-center justify-between">
              <span className="text-xs text-muted-foreground flex items-center gap-1">
                <KeyRound className="h-3.5 w-3.5" />
                Senha MEU INSS
              </span>
              <Button
                size="sm"
                variant="outline"
                onClick={abrirVerSenha}
                disabled={carregandoSenha}
              >
                {carregandoSenha ? (
                  <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
                ) : (
                  <Eye className="h-3.5 w-3.5 mr-1" />
                )}
                Ver senha
              </Button>
            </div>
          )}
          {!isInterno && (
            // Parceiro: write-only. Nao tem botao "Ver", so "Alterar".
            <div className="pt-2 border-t flex items-center justify-between">
              <span className="text-xs text-muted-foreground flex items-center gap-1">
                <KeyRound className="h-3.5 w-3.5" />
                Senha MEU INSS
              </span>
              <Button
                size="sm"
                variant="outline"
                onClick={abrirAlterarSenhaParceiro}
              >
                <Pencil className="h-3.5 w-3.5 mr-1" />
                Alterar
              </Button>
            </div>
          )}
          {cliente.observacoes && (
            <div className="pt-2 border-t">
              <p className="text-xs text-muted-foreground mb-1">Observacoes</p>
              <p className="text-sm whitespace-pre-wrap">{cliente.observacoes}</p>
            </div>
          )}
        </CardContent>
        {isInterno && (
          <Dialog
            open={abrirEditCliente}
            onOpenChange={setAbrirEditCliente}
          >
            <DialogContent className="max-h-[90vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle>Editar cliente</DialogTitle>
                <DialogDescription>
                  CPF nao pode ser alterado (chave unica vinculada ao TI).
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-3">
                <div>
                  <Label className="text-xs">Nome</Label>
                  <Input
                    value={clNome}
                    onChange={(e) => setClNome(e.target.value)}
                  />
                </div>
                <div>
                  <Label className="text-xs">CPF</Label>
                  <Input value={maskCPF(cliente.cpf)} disabled />
                </div>
                <div>
                  <Label className="text-xs">Data de nascimento</Label>
                  <Input
                    type="date"
                    value={clDataNascimento}
                    onChange={(e) => setClDataNascimento(e.target.value)}
                  />
                </div>
                <div>
                  <Label className="text-xs">Telefone</Label>
                  <Input
                    value={clTelefone}
                    onChange={(e) => setClTelefone(e.target.value)}
                  />
                </div>
                <div>
                  <Label className="text-xs">E-mail</Label>
                  <Input
                    type="email"
                    value={clEmail}
                    onChange={(e) => setClEmail(e.target.value)}
                  />
                </div>
                <div>
                  <Label className="text-xs">Observacoes</Label>
                  <Textarea
                    rows={3}
                    value={clObservacoes}
                    onChange={(e) => setClObservacoes(e.target.value)}
                  />
                </div>
                {/* Senha MEU INSS - sempre vazio. Vazio = manter, preenchido =
                    substituir via RPC criptografada. Status atual (ja tem ou
                    nao) eh mostrado em texto auxiliar. */}
                <div className="pt-3 border-t">
                  <Label className="text-xs flex items-center gap-1">
                    <KeyRound className="h-3.5 w-3.5" />
                    Senha MEU INSS{" "}
                    <span className="text-muted-foreground font-normal">
                      ({clTemSenha ? "ja cadastrada - sera substituida" : "nao cadastrada"})
                    </span>
                  </Label>
                  <Input
                    type="password"
                    value={clSenhaMeuInss}
                    onChange={(e) => setClSenhaMeuInss(e.target.value)}
                    placeholder={
                      clTemSenha
                        ? "Deixe vazio pra manter a senha atual"
                        : "Senha do MEU INSS do cliente"
                    }
                    autoComplete="off"
                  />
                  <p className="text-xs text-muted-foreground mt-1">
                    Criptografada no banco. Toda escrita e leitura ficam
                    registradas em auditoria.
                  </p>
                </div>
              </div>
              <DialogFooter className="sm:justify-between gap-2">
                {/* Excluir vai a esquerda - separacao visual clara da acao
                    primaria (Salvar). Espacamento sm:justify-between joga
                    o destrutivo pra ponta. */}
                <Button
                  variant="destructive"
                  onClick={() => setConfExcluirCliente(true)}
                  disabled={clSalvando || excluindoCliente}
                  className="sm:mr-auto"
                >
                  <Trash2 className="h-3.5 w-3.5 mr-1" />
                  Excluir cliente
                </Button>
                <div className="flex gap-2">
                  <Button
                    variant="ghost"
                    onClick={() => setAbrirEditCliente(false)}
                    disabled={clSalvando}
                  >
                    Cancelar
                  </Button>
                  <Button onClick={salvarCliente} disabled={clSalvando}>
                    {clSalvando && (
                      <Loader2 className="h-3 w-3 mr-2 animate-spin" />
                    )}
                    Salvar
                  </Button>
                </div>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        )}
        {/* AlertDialog de confirmacao de exclusao. Acao destrutiva amplia o
            consentimento explicito do usuario - lista o que vai sumir. */}
        {isInterno && (
          <AlertDialog
            open={confExcluirCliente}
            onOpenChange={(o) => {
              if (!excluindoCliente) setConfExcluirCliente(o);
            }}
          >
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>
                  Excluir {cliente.nome}?
                </AlertDialogTitle>
                <AlertDialogDescription asChild>
                  <div className="space-y-2 text-sm">
                    <p>
                      Esta acao e <strong>irreversivel</strong>. Sera removido:
                    </p>
                    <ul className="list-disc pl-5 space-y-0.5 text-muted-foreground">
                      <li>O cliente e todos os dados cadastrais</li>
                      <li>Todos os casos vinculados</li>
                      <li>Todos os documentos, andamentos e solicitacoes</li>
                      <li>Conversas, repasses e processos do caso</li>
                      <li>Senha MEU INSS criptografada (se houver)</li>
                    </ul>
                    <p className="text-xs text-muted-foreground">
                      O log de auditoria do acesso a senhas e preservado.
                    </p>
                  </div>
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel disabled={excluindoCliente}>
                  Cancelar
                </AlertDialogCancel>
                <AlertDialogAction
                  onClick={(e) => {
                    e.preventDefault();
                    excluirCliente();
                  }}
                  disabled={excluindoCliente}
                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                >
                  {excluindoCliente && (
                    <Loader2 className="h-3 w-3 mr-2 animate-spin" />
                  )}
                  Sim, excluir tudo
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        )}
        {isInterno && (
          // Dialog para exibir a senha MEU INSS decifrada.
          // O backend ja registrou audit antes de retornar a senha.
          <Dialog
            open={abrirSenha}
            onOpenChange={(o) => {
              if (!o) fecharSenha();
            }}
          >
            <DialogContent>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <KeyRound className="h-4 w-4" />
                  Senha MEU INSS
                </DialogTitle>
                <DialogDescription className="text-xs text-warning bg-warning/10 border border-warning/30 rounded p-2 mt-1">
                  Acesso registrado em auditoria. A senha e confidencial -
                  use apenas no portal MEU INSS do cliente.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-3">
                {carregandoSenha && (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Decifrando senha...
                  </div>
                )}
                {!carregandoSenha && erroSenha && (
                  <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
                    {erroSenha}
                  </div>
                )}
                {!carregandoSenha && !erroSenha && senhaValor === null && (
                  <p className="text-sm text-muted-foreground">
                    Este cliente nao tem senha do MEU INSS cadastrada.
                  </p>
                )}
                {!carregandoSenha && !erroSenha && senhaValor !== null && (
                  <div className="space-y-2">
                    <Label className="text-xs">Senha</Label>
                    <div className="flex items-center gap-2">
                      <Input
                        value={senhaValor}
                        readOnly
                        className="font-mono"
                      />
                      <Button
                        onClick={copiarSenha}
                        size="sm"
                        variant="outline"
                        title="Copiar senha"
                      >
                        <Copy className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                )}
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={fecharSenha}>
                  Fechar
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        )}
        {!isInterno && (
          // Dialog write-only do parceiro. So input + Salvar.
          <Dialog
            open={abrirSenhaParc}
            onOpenChange={(o) => {
              if (!o) {
                setAbrirSenhaParc(false);
                setSenhaParcValor("");
              }
            }}
          >
            <DialogContent>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <KeyRound className="h-4 w-4" />
                  {senhaParcTemSenha
                    ? "Substituir senha MEU INSS"
                    : "Cadastrar senha MEU INSS"}
                </DialogTitle>
                <DialogDescription className="text-xs text-warning bg-warning/10 border border-warning/30 rounded p-2 mt-1">
                  {senhaParcTemSenha
                    ? "Ja existe uma senha cadastrada para este cliente. Ao salvar, ela sera SUBSTITUIDA pela nova. Esta acao fica registrada em auditoria."
                    : "A senha sera criptografada no banco. Voce nao podera consultar depois - apenas substituir. Acao registrada em auditoria."}
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-3">
                <div>
                  <Label className="text-xs">Nova senha do MEU INSS</Label>
                  <Input
                    type="password"
                    value={senhaParcValor}
                    onChange={(e) => setSenhaParcValor(e.target.value)}
                    placeholder="Senha do MEU INSS do cliente"
                    autoComplete="off"
                  />
                </div>
              </div>
              <DialogFooter>
                <Button
                  variant="ghost"
                  onClick={() => {
                    setAbrirSenhaParc(false);
                    setSenhaParcValor("");
                  }}
                  disabled={senhaParcSalvando}
                >
                  Cancelar
                </Button>
                <Button
                  onClick={salvarSenhaParceiro}
                  disabled={senhaParcSalvando || senhaParcValor.trim().length === 0}
                >
                  {senhaParcSalvando && (
                    <Loader2 className="h-3 w-3 mr-2 animate-spin" />
                  )}
                  Salvar
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        )}
      </Card>

      </div>
      {/* Dialog "Editar caso" - fora do grid pra ficar como overlay limpo.
          Trigger fica no botao "Editar caso" no topo da TabVisaoGeral. */}
      {isInterno && (
        <Dialog open={abrirEditCaso} onOpenChange={setAbrirEditCaso}>
            <DialogContent className="max-h-[90vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle>Editar caso</DialogTitle>
                <DialogDescription>
                  Altere os dados do caso, parceiro indicador, fase, status e
                  valores estimados.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-3">
                <div>
                  <Label className="text-xs">Tipo de beneficio</Label>
                  <Select
                    value={csTipoBeneficio}
                    onValueChange={setCsTipoBeneficio}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {TIPOS_BENEFICIO.map((t) => (
                        <SelectItem key={t} value={t}>
                          {t}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="border-t pt-3 space-y-2">
                  <div className="flex items-start gap-2">
                    <input
                      id="cs-interno"
                      type="checkbox"
                      checked={csInterno}
                      onChange={(e) => {
                        setCsInterno(e.target.checked);
                        if (e.target.checked) setCsParceiroId("");
                      }}
                      className="h-4 w-4 mt-0.5"
                    />
                    <div>
                      <Label htmlFor="cs-interno" className="text-sm">
                        Cliente interno do escritorio (sem parceiro indicador)
                      </Label>
                      <p className="text-xs text-muted-foreground">
                        Marque se nao ha advogado parceiro captando este caso.
                      </p>
                    </div>
                  </div>
                  {!csInterno && (
                    <div>
                      <Label className="text-xs">Parceiro indicador</Label>
                      <Select
                        value={csParceiroId}
                        onValueChange={setCsParceiroId}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Selecione um parceiro..." />
                        </SelectTrigger>
                        <SelectContent>
                          {parceirosDisponiveis.length === 0 && (
                            <SelectItem value="__vazio__" disabled>
                              Nenhum parceiro cadastrado
                            </SelectItem>
                          )}
                          {parceirosDisponiveis.map((p) => (
                            <SelectItem key={p.id} value={p.id}>
                              {p.nome || p.email || "(sem nome)"}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  )}
                </div>
                <div className="grid grid-cols-2 gap-3 border-t pt-3">
                  <div>
                    <Label className="text-xs">Fase</Label>
                    <Select value={csFase} onValueChange={setCsFase}>
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
                    <Select value={csStatus} onValueChange={setCsStatus}>
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
              </div>
              <DialogFooter>
                <Button
                  variant="ghost"
                  onClick={() => setAbrirEditCaso(false)}
                  disabled={csSalvando}
                >
                  Cancelar
                </Button>
                <Button onClick={salvarCaso} disabled={csSalvando}>
                  {csSalvando && (
                    <Loader2 className="h-3 w-3 mr-2 animate-spin" />
                  )}
                  Salvar
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
      )}
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
  processosAdmin: Array<ProcessoAdmin>;
  processosJudiciais: Array<ProcessoJudicial>;
  isInterno: boolean;
  temParceiro: boolean;
  usuarioId: string | null;
  onChange: () => void;
}

// Valor usado no Select de vinculo de processo.
// Formato: "nenhum" | "admin:<uuid>" | "judicial:<uuid>"
const PROCESSO_NENHUM = "nenhum";

function TabAndamentos(props: TabAndamentosProps) {
  const {
    casoId,
    andamentos,
    processosAdmin,
    processosJudiciais,
    isInterno,
    temParceiro,
    usuarioId,
    onChange,
  } = props;
  // States do dialog "Novo andamento"
  // tipoDialogoNovo: null = fechado; "admin" ou "judicial" = aberto com tipo pre-definido
  const [tipoDialogoNovo, setTipoDialogoNovo] = useState<
    "admin" | "judicial" | null
  >(null);
  const [titulo, setTitulo] = useState("");
  const [descricao, setDescricao] = useState("");
  const [visivelParceiro, setVisivelParceiro] = useState(true);
  const [processoVinculo, setProcessoVinculo] = useState(PROCESSO_NENHUM);
  const [salvando, setSalvando] = useState(false);

  // States dos accordions (qual processo esta expandido em cada card)
  const [expandidosAdmin, setExpandidosAdmin] = useState<Set<string>>(
    new Set(),
  );
  const [expandidosJud, setExpandidosJud] = useState<Set<string>>(new Set());
  // Accordions especiais "Sem processo" / "Sem vinculo" (1 unico bool cada)
  const [abertoSemProcessoAdmin, setAbertoSemProcessoAdmin] = useState(false);
  const [abertoSemVinculoGerais, setAbertoSemVinculoGerais] = useState(false);

  // Multi-select para transferencia de andamentos sem vinculo
  const [selecionadosSemProc, setSelecionadosSemProc] = useState<Set<string>>(
    new Set(),
  );
  const [selecionadosGerais, setSelecionadosGerais] = useState<Set<string>>(
    new Set(),
  );
  const [destinoTransfSemProc, setDestinoTransfSemProc] = useState("");
  const [destinoTransfGerais, setDestinoTransfGerais] = useState("");
  const [transferindo, setTransferindo] = useState(false);

  function toggleAccordionAdmin(processoId: string) {
    setExpandidosAdmin((prev) => {
      const next = new Set(prev);
      if (next.has(processoId)) next.delete(processoId);
      else next.add(processoId);
      return next;
    });
  }
  function toggleAccordionJud(processoId: string) {
    setExpandidosJud((prev) => {
      const next = new Set(prev);
      if (next.has(processoId)) next.delete(processoId);
      else next.add(processoId);
      return next;
    });
  }

  function toggleSelecaoSemProc(id: string) {
    setSelecionadosSemProc((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  function toggleSelecaoGerais(id: string) {
    setSelecionadosGerais((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  // Transfere andamentos selecionados para um processo destino.
  // destino: "admin:<id>" ou "judicial:<id>"
  async function transferirAndamentos(
    ids: Set<string>,
    destino: string,
    onSuccess: () => void,
  ) {
    if (ids.size === 0) {
      toast.error("Selecione ao menos um andamento");
      return;
    }
    if (!destino) {
      toast.error("Selecione um processo de destino");
      return;
    }
    let processoAdminId: string | null = null;
    let processoJudicialId: string | null = null;
    if (destino.startsWith("admin:")) {
      processoAdminId = destino.slice("admin:".length);
    } else if (destino.startsWith("judicial:")) {
      processoJudicialId = destino.slice("judicial:".length);
    } else {
      toast.error("Destino invalido");
      return;
    }
    setTransferindo(true);
    try {
      const resp = await supabase
        .from("andamentos")
        .update({
          processo_admin_id: processoAdminId,
          processo_judicial_id: processoJudicialId,
        })
        .in("id", Array.from(ids))
        .select();
      if (resp.error) throw resp.error;
      const n = resp.data?.length || 0;
      if (n === 0) {
        toast.error(
          "Transferencia nao aplicada. Possivel bloqueio de permissao.",
        );
        return;
      }
      toast.success(
        n + " andamento" + (n === 1 ? "" : "s") + " transferido" +
          (n === 1 ? "" : "s") + ".",
      );
      onSuccess();
      onChange();
    } catch (err) {
      console.error(err);
      const errObj = err as { message?: string };
      toast.error(errObj.message || "Erro ao transferir andamentos");
    } finally {
      setTransferindo(false);
    }
  }

  // States do dialog "Editar andamento"
  const [editando, setEditando] = useState<Andamento | null>(null);
  const [editTitulo, setEditTitulo] = useState("");
  const [editDescricao, setEditDescricao] = useState("");
  const [editVisivelParceiro, setEditVisivelParceiro] = useState(true);
  const [editProcessoVinculo, setEditProcessoVinculo] = useState(PROCESSO_NENHUM);
  const [editSalvando, setEditSalvando] = useState(false);

  const totalProcessos = processosAdmin.length + processosJudiciais.length;
  const temProcessos = totalProcessos > 0;
  const processoUnico = totalProcessos === 1;

  // Quando o caso tem apenas 1 processo, retorna o valor do Select
  // ("admin:<id>" ou "judicial:<id>") ja apontando pra ele.
  function valorProcessoUnico(): string {
    if (!processoUnico) return PROCESSO_NENHUM;
    if (processosAdmin.length === 1) return "admin:" + processosAdmin[0].id;
    return "judicial:" + processosJudiciais[0].id;
  }

  function descricaoProcesso(a: Andamento): string | null {
    if (a.processo_admin_id) {
      const p = processosAdmin.find((x) => x.id === a.processo_admin_id);
      return "Admin: " + (p?.numero_requerimento || "(sem numero)");
    }
    if (a.processo_judicial_id) {
      const p = processosJudiciais.find((x) => x.id === a.processo_judicial_id);
      return "Judicial: " + (p?.numero_processo || "(sem numero)");
    }
    return null;
  }

  function abrirEdicao(a: Andamento) {
    setEditando(a);
    setEditTitulo(a.titulo || "");
    setEditDescricao(a.descricao || "");
    setEditVisivelParceiro(a.visivel_parceiro);
    if (a.processo_admin_id) {
      setEditProcessoVinculo("admin:" + a.processo_admin_id);
    } else if (a.processo_judicial_id) {
      setEditProcessoVinculo("judicial:" + a.processo_judicial_id);
    } else if (processoUnico) {
      // Caso tem 1 processo so e o andamento esta sem vinculo:
      // ja deixa o unico processo pre-selecionado.
      setEditProcessoVinculo(valorProcessoUnico());
    } else {
      setEditProcessoVinculo(PROCESSO_NENHUM);
    }
  }

  function fecharEdicao() {
    setEditando(null);
  }

  async function salvarEdicao() {
    if (!editando) return;
    if (!editTitulo.trim()) {
      toast.error("Titulo obrigatorio");
      return;
    }
    setEditSalvando(true);
    try {
      let processoAdminId: string | null = null;
      let processoJudicialId: string | null = null;
      if (editProcessoVinculo.startsWith("admin:")) {
        processoAdminId = editProcessoVinculo.slice("admin:".length);
      } else if (editProcessoVinculo.startsWith("judicial:")) {
        processoJudicialId = editProcessoVinculo.slice("judicial:".length);
      }
      const resp = await supabase
        .from("andamentos")
        .update({
          titulo: editTitulo.trim(),
          descricao: editDescricao.trim() || null,
          visivel_parceiro: temParceiro ? editVisivelParceiro : false,
          processo_admin_id: processoAdminId,
          processo_judicial_id: processoJudicialId,
        })
        .eq("id", editando.id)
        .select();
      if (resp.error) throw resp.error;
      if (!resp.data || resp.data.length === 0) {
        // RLS bloqueou silenciosamente (0 linhas atualizadas)
        toast.error(
          "Atualizacao nao foi aplicada. Possivel bloqueio de permissao. Avise o admin.",
        );
        return;
      }
      toast.success("Andamento atualizado");
      fecharEdicao();
      onChange();
    } catch (err) {
      console.error(err);
      const errObj = err as { message?: string };
      toast.error(errObj.message || "Erro ao atualizar andamento");
    } finally {
      setEditSalvando(false);
    }
  }

  async function deletarAndamento(a: Andamento) {
    const resumo = (a.titulo || a.descricao || "").slice(0, 60);
    const ok = window.confirm(
      "Tem certeza que deseja excluir este andamento?\n\n" +
        (resumo ? '"' + resumo + '"\n\n' : "") +
        "Essa acao nao pode ser desfeita.",
    );
    if (!ok) return;
    try {
      // .select() faz o Postgres retornar as linhas deletadas.
      // Se vier vazio, e porque RLS impediu silenciosamente o DELETE.
      const resp = await supabase
        .from("andamentos")
        .delete()
        .eq("id", a.id)
        .select();
      if (resp.error) throw resp.error;
      if (!resp.data || resp.data.length === 0) {
        toast.error(
          "Exclusao nao foi aplicada. Possivel bloqueio de permissao " +
            "(andamento sem dono ou RLS). Tente fazer Sync TI novamente " +
            "para corrigir o vinculo de criador.",
        );
        return;
      }
      toast.success("Andamento excluido");
      onChange();
    } catch (err) {
      console.error(err);
      const errObj = err as { message?: string };
      toast.error(errObj.message || "Erro ao excluir andamento");
    }
  }

  const lista = isInterno
    ? andamentos
    : andamentos.filter((a) => a.visivel_parceiro === true);

  async function adicionar() {
    if (!titulo.trim() || !usuarioId) return;
    setSalvando(true);
    try {
      // Interpreta processoVinculo: "nenhum" | "admin:<id>" | "judicial:<id>"
      let processoAdminId: string | null = null;
      let processoJudicialId: string | null = null;
      if (processoVinculo.startsWith("admin:")) {
        processoAdminId = processoVinculo.slice("admin:".length);
      } else if (processoVinculo.startsWith("judicial:")) {
        processoJudicialId = processoVinculo.slice("judicial:".length);
      }

      const resp = await supabase.from("andamentos").insert({
        caso_id: casoId,
        origem: "interno",
        titulo: titulo.trim(),
        descricao: descricao.trim() || null,
        data_evento: new Date().toISOString(),
        criado_por: usuarioId,
        visivel_parceiro: temParceiro ? visivelParceiro : false,
        processo_admin_id: processoAdminId,
        processo_judicial_id: processoJudicialId,
      });
      if (resp.error) throw resp.error;
      toast.success("Andamento adicionado");
      setTitulo("");
      setDescricao("");
      setProcessoVinculo(PROCESSO_NENHUM);
      setTipoDialogoNovo(null);
      onChange();
    } catch (err) {
      console.error(err);
      const errObj = err as { message?: string };
      toast.error(errObj.message || "Erro ao adicionar andamento");
    } finally {
      setSalvando(false);
    }
  }

  // Separar andamentos por destino:
  //  - Admin: vinculados a processo administrativo
  //  - Judicial: vinculados a processo judicial
  //  - Notas TI sem vinculo: sub-secao "Sem processo" do card Admin (TI e
  //    administrativo por natureza, mesmo sem processo cadastrado ainda)
  //  - Manuais sem vinculo: card "Andamentos Gerais"
  const andamentosAdmin = lista.filter((a) => a.processo_admin_id !== null);
  const andamentosJud = lista.filter((a) => a.processo_judicial_id !== null);
  const notasTISemVinculo = lista.filter(
    (a) =>
      a.origem === "tramitacao" &&
      a.processo_admin_id === null &&
      a.processo_judicial_id === null,
  );
  const andamentosManuaisSemVinculo = lista.filter(
    (a) =>
      a.origem !== "tramitacao" &&
      a.processo_admin_id === null &&
      a.processo_judicial_id === null,
  );

  // Abre o dialog "Novo andamento" pre-configurado para um tipo
  function abrirNovoTipo(tipo: "admin" | "judicial") {
    setTipoDialogoNovo(tipo);
    setTitulo("");
    setDescricao("");
    setVisivelParceiro(true);
    if (tipo === "admin") {
      if (processosAdmin.length === 1) {
        setProcessoVinculo("admin:" + processosAdmin[0].id);
      } else {
        setProcessoVinculo(PROCESSO_NENHUM);
      }
    } else {
      if (processosJudiciais.length === 1) {
        setProcessoVinculo("judicial:" + processosJudiciais[0].id);
      } else {
        setProcessoVinculo(PROCESSO_NENHUM);
      }
    }
  }

  // Helper: conteudo interno de um item de andamento (sem o <li> envoltorio).
  // Usado pelo renderItemAndamento e tambem nas sub-secoes com checkbox.
  function renderItemAndamentoInner(a: Andamento) {
    return (
      <div>
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2 flex-wrap min-w-0">
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
          {isInterno && (
            <div className="flex items-center gap-1 shrink-0">
              <Button
                size="sm"
                variant="ghost"
                className="h-7 w-7 p-0"
                title="Editar andamento"
                onClick={() => abrirEdicao(a)}
              >
                <Pencil className="h-3.5 w-3.5" />
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="h-7 w-7 p-0 text-destructive hover:text-destructive"
                title="Excluir andamento"
                onClick={() => deletarAndamento(a)}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </div>
          )}
        </div>
        {a.titulo && <p className="text-sm font-medium mt-1">{a.titulo}</p>}
        {a.descricao && (
          <p className="text-sm mt-1 whitespace-pre-wrap text-muted-foreground">
            {a.descricao}
          </p>
        )}
      </div>
    );
  }

  // Helper: renderiza um item de andamento (usado nos accordions de processo)
  function renderItemAndamento(a: Andamento) {
    return (
      <li key={a.id} className="border-l-2 border-muted pl-3 py-1">
        {renderItemAndamentoInner(a)}
      </li>
    );
  }

  // Helper: renderiza um accordion de processo (header com chevron + lista de andamentos)
  function renderAccordion(
    label: string,
    processoId: string,
    ands: Array<Andamento>,
    aberto: boolean,
    onToggle: () => void,
  ) {
    return (
      <div key={processoId} className="border rounded-md overflow-hidden">
        <button
          type="button"
          onClick={onToggle}
          className="w-full flex items-center justify-between p-3 hover:bg-muted/50 transition-colors text-left"
        >
          <div className="flex items-center gap-2 min-w-0">
            {aberto ? (
              <ChevronDown className="h-4 w-4 shrink-0" />
            ) : (
              <ChevronRight className="h-4 w-4 shrink-0" />
            )}
            <span className="text-sm font-medium truncate">{label}</span>
          </div>
          <span className="text-xs text-muted-foreground shrink-0">
            {ands.length} andamento{ands.length === 1 ? "" : "s"}
          </span>
        </button>
        {aberto && (
          <div className="border-t p-3">
            {ands.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-2">
                Nenhum andamento registrado para este processo.
              </p>
            ) : (
              <ul className="space-y-3">{ands.map(renderItemAndamento)}</ul>
            )}
          </div>
        )}
      </div>
    );
  }

  // Tipo do dialog atualmente aberto (pra filtrar select de processo)
  const isAdminDialog = tipoDialogoNovo === "admin";
  const isJudDialog = tipoDialogoNovo === "judicial";
  const processosDoTipoDialog = isAdminDialog
    ? processosAdmin
    : isJudDialog
      ? processosJudiciais
      : [];
  const mostrarSelectProcessoDialog =
    tipoDialogoNovo !== null && processosDoTipoDialog.length >= 2;

  return (
    <div className="space-y-4">
      {/* ---- Card Andamentos administrativos ---- */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-2">
            <div>
              <CardTitle className="text-base">
                Andamentos Administrativos
              </CardTitle>
              <CardDescription>
                Movimentacoes vinculadas a processos do INSS.
              </CardDescription>
            </div>
            {isInterno && (
              <Button
                size="sm"
                onClick={() => abrirNovoTipo("admin")}
                disabled={processosAdmin.length === 0}
                title={
                  processosAdmin.length === 0
                    ? "Cadastre um processo administrativo na aba Processos primeiro"
                    : "Novo andamento administrativo"
                }
              >
                <Plus className="h-4 w-4 mr-2" />
                Novo
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {processosAdmin.length === 0 && notasTISemVinculo.length === 0 && (
            <p className="text-sm text-muted-foreground text-center py-6">
              Nenhum processo administrativo cadastrado. Cadastre na aba
              Processos para registrar andamentos.
            </p>
          )}
          {(processosAdmin.length > 0 || notasTISemVinculo.length > 0) && (
            <div className="space-y-2">
              {/* Accordion por processo admin */}
              {processosAdmin.map((p) => {
                const ands = andamentosAdmin.filter(
                  (a) => a.processo_admin_id === p.id,
                );
                const label =
                  "Admin: " + (p.numero_requerimento || "(sem numero)");
                return renderAccordion(
                  label,
                  p.id,
                  ands,
                  expandidosAdmin.has(p.id),
                  () => toggleAccordionAdmin(p.id),
                );
              })}

              {/* Sub-secao "Sem processo" para notas TI sem vinculo */}
              {notasTISemVinculo.length > 0 && (
                <div className="border rounded-md overflow-hidden border-dashed">
                  <button
                    type="button"
                    onClick={() =>
                      setAbertoSemProcessoAdmin(!abertoSemProcessoAdmin)
                    }
                    className="w-full flex items-center justify-between p-3 hover:bg-muted/50 transition-colors text-left"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      {abertoSemProcessoAdmin ? (
                        <ChevronDown className="h-4 w-4 shrink-0" />
                      ) : (
                        <ChevronRight className="h-4 w-4 shrink-0" />
                      )}
                      <span className="text-sm font-medium truncate">
                        Sem processo
                      </span>
                    </div>
                    <span className="text-xs text-muted-foreground shrink-0">
                      {notasTISemVinculo.length} andamento
                      {notasTISemVinculo.length === 1 ? "" : "s"}
                    </span>
                  </button>
                  {abertoSemProcessoAdmin && (
                    <div className="border-t">
                      {/* Barra de transferencia */}
                      {isInterno && (
                        <div className="bg-muted/30 p-3 border-b flex items-end gap-2 flex-wrap">
                          <div className="flex-1 min-w-[200px]">
                            <Label className="text-xs">
                              Transferir selecionados para
                            </Label>
                            <Select
                              value={destinoTransfSemProc}
                              onValueChange={setDestinoTransfSemProc}
                              disabled={processosAdmin.length === 0}
                            >
                              <SelectTrigger>
                                <SelectValue
                                  placeholder={
                                    processosAdmin.length === 0
                                      ? "Nenhum processo admin cadastrado"
                                      : "Selecione um processo admin..."
                                  }
                                />
                              </SelectTrigger>
                              <SelectContent>
                                {processosAdmin.map((p) => (
                                  <SelectItem
                                    key={"a-" + p.id}
                                    value={"admin:" + p.id}
                                  >
                                    Admin:{" "}
                                    {p.numero_requerimento || "(sem numero)"}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                          <Button
                            size="sm"
                            onClick={() =>
                              transferirAndamentos(
                                selecionadosSemProc,
                                destinoTransfSemProc,
                                () => {
                                  setSelecionadosSemProc(new Set());
                                  setDestinoTransfSemProc("");
                                },
                              )
                            }
                            disabled={
                              transferindo ||
                              selecionadosSemProc.size === 0 ||
                              !destinoTransfSemProc
                            }
                          >
                            {transferindo && (
                              <Loader2 className="h-3 w-3 mr-2 animate-spin" />
                            )}
                            Transferir ({selecionadosSemProc.size})
                          </Button>
                        </div>
                      )}
                      {/* Lista de andamentos com checkbox */}
                      <ul className="space-y-3 p-3">
                        {notasTISemVinculo.map((a) => (
                          <li
                            key={a.id}
                            className="border-l-2 border-muted pl-3 py-1"
                          >
                            <div className="flex items-start gap-2">
                              {isInterno && (
                                <input
                                  type="checkbox"
                                  checked={selecionadosSemProc.has(a.id)}
                                  onChange={() => toggleSelecaoSemProc(a.id)}
                                  className="h-4 w-4 mt-1 shrink-0"
                                />
                              )}
                              <div className="flex-1 min-w-0">
                                {renderItemAndamentoInner(a)}
                              </div>
                            </div>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* ---- Card Andamentos judiciais (so se ha processo judicial) ---- */}
      {processosJudiciais.length > 0 && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between gap-2">
              <div>
                <CardTitle className="text-base">
                  Andamentos Judiciais
                </CardTitle>
                <CardDescription>
                  Movimentacoes vinculadas a processos judiciais.
                </CardDescription>
              </div>
              {isInterno && (
                <Button
                  size="sm"
                  onClick={() => abrirNovoTipo("judicial")}
                  title="Novo andamento judicial"
                >
                  <Plus className="h-4 w-4 mr-2" />
                  Novo
                </Button>
              )}
            </div>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {processosJudiciais.map((p) => {
                const ands = andamentosJud.filter(
                  (a) => a.processo_judicial_id === p.id,
                );
                const label =
                  "Judicial: " + (p.numero_processo || "(sem numero)");
                return renderAccordion(
                  label,
                  p.id,
                  ands,
                  expandidosJud.has(p.id),
                  () => toggleAccordionJud(p.id),
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {/* ---- Card Andamentos Gerais (manuais sem vinculo) ---- */}
      {andamentosManuaisSemVinculo.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Andamentos Gerais</CardTitle>
            <CardDescription>
              Movimentacoes manuais sem vinculo a processo. Selecione e
              transfira para um processo, ou edite individualmente pelo lapis.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {/* Barra de transferencia */}
            {isInterno &&
              (processosAdmin.length > 0 || processosJudiciais.length > 0) && (
                <div className="bg-muted/30 p-3 border rounded-md mb-3 flex items-end gap-2 flex-wrap">
                  <div className="flex-1 min-w-[200px]">
                    <Label className="text-xs">
                      Transferir selecionados para
                    </Label>
                    <Select
                      value={destinoTransfGerais}
                      onValueChange={setDestinoTransfGerais}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Selecione um processo..." />
                      </SelectTrigger>
                      <SelectContent>
                        {processosAdmin.map((p) => (
                          <SelectItem
                            key={"a-" + p.id}
                            value={"admin:" + p.id}
                          >
                            Admin:{" "}
                            {p.numero_requerimento || "(sem numero)"}
                          </SelectItem>
                        ))}
                        {processosJudiciais.map((p) => (
                          <SelectItem
                            key={"j-" + p.id}
                            value={"judicial:" + p.id}
                          >
                            Judicial:{" "}
                            {p.numero_processo || "(sem numero)"}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <Button
                    size="sm"
                    onClick={() =>
                      transferirAndamentos(
                        selecionadosGerais,
                        destinoTransfGerais,
                        () => {
                          setSelecionadosGerais(new Set());
                          setDestinoTransfGerais("");
                        },
                      )
                    }
                    disabled={
                      transferindo ||
                      selecionadosGerais.size === 0 ||
                      !destinoTransfGerais
                    }
                  >
                    {transferindo && (
                      <Loader2 className="h-3 w-3 mr-2 animate-spin" />
                    )}
                    Transferir ({selecionadosGerais.size})
                  </Button>
                </div>
              )}
            <ul className="space-y-3">
              {andamentosManuaisSemVinculo.map((a) => (
                <li
                  key={a.id}
                  className="border-l-2 border-muted pl-3 py-1"
                >
                  <div className="flex items-start gap-2">
                    {isInterno && (
                      <input
                        type="checkbox"
                        checked={selecionadosGerais.has(a.id)}
                        onChange={() => toggleSelecaoGerais(a.id)}
                        className="h-4 w-4 mt-1 shrink-0"
                      />
                    )}
                    <div className="flex-1 min-w-0">
                      {renderItemAndamentoInner(a)}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {/* ---- Dialog Novo andamento (unificado, controlado por tipoDialogoNovo) ---- */}
      {isInterno && (
        <Dialog
          open={tipoDialogoNovo !== null}
          onOpenChange={(open) => {
            if (!open) setTipoDialogoNovo(null);
          }}
        >
          <DialogContent className="max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>
                Novo andamento{" "}
                {isAdminDialog ? "administrativo" : isJudDialog ? "judicial" : ""}
              </DialogTitle>
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
              {mostrarSelectProcessoDialog && (
                <div>
                  <Label className="text-xs">Processo</Label>
                  <Select
                    value={processoVinculo}
                    onValueChange={setProcessoVinculo}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Selecione o processo..." />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={PROCESSO_NENHUM}>
                        Nenhum (sem vinculo)
                      </SelectItem>
                      {isAdminDialog &&
                        processosAdmin.map((p) => (
                          <SelectItem
                            key={"a-" + p.id}
                            value={"admin:" + p.id}
                          >
                            Admin: {p.numero_requerimento || "(sem numero)"}
                          </SelectItem>
                        ))}
                      {isJudDialog &&
                        processosJudiciais.map((p) => (
                          <SelectItem
                            key={"j-" + p.id}
                            value={"judicial:" + p.id}
                          >
                            Judicial: {p.numero_processo || "(sem numero)"}
                          </SelectItem>
                        ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
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
                onClick={() => setTipoDialogoNovo(null)}
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

      {/* ---- Dialog Editar andamento ---- */}
      {isInterno && (
        <Dialog
          open={editando !== null}
          onOpenChange={(open) => {
            if (!open) fecharEdicao();
          }}
        >
          <DialogContent className="max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Editar andamento</DialogTitle>
              <DialogDescription>
                Altere o conteudo, vinculacao com processo e visibilidade.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-3">
              <div>
                <Label className="text-xs">Titulo</Label>
                <Input
                  value={editTitulo}
                  onChange={(e) => setEditTitulo(e.target.value)}
                />
              </div>
              <div>
                <Label className="text-xs">Descricao (opcional)</Label>
                <Textarea
                  rows={5}
                  value={editDescricao}
                  onChange={(e) => setEditDescricao(e.target.value)}
                />
              </div>
              {temProcessos && !processoUnico && (
                <div>
                  <Label className="text-xs">Processo (opcional)</Label>
                  <Select
                    value={editProcessoVinculo}
                    onValueChange={setEditProcessoVinculo}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Vincular a um processo..." />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={PROCESSO_NENHUM}>Nenhum</SelectItem>
                      {processosAdmin.map((p) => (
                        <SelectItem
                          key={"a-" + p.id}
                          value={"admin:" + p.id}
                        >
                          Admin: {p.numero_requerimento || "(sem numero)"}
                        </SelectItem>
                      ))}
                      {processosJudiciais.map((p) => (
                        <SelectItem
                          key={"j-" + p.id}
                          value={"judicial:" + p.id}
                        >
                          Judicial: {p.numero_processo || "(sem numero)"}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
              {temParceiro && (
                <div className="flex items-center gap-2">
                  <input
                    id="edit-visivel-parceiro"
                    type="checkbox"
                    checked={editVisivelParceiro}
                    onChange={(e) => setEditVisivelParceiro(e.target.checked)}
                    className="h-4 w-4"
                  />
                  <Label
                    htmlFor="edit-visivel-parceiro"
                    className="text-sm"
                  >
                    Visivel para o parceiro indicador
                  </Label>
                </div>
              )}
            </div>
            <DialogFooter>
              <Button
                variant="ghost"
                onClick={fecharEdicao}
                disabled={editSalvando}
              >
                Cancelar
              </Button>
              <Button onClick={salvarEdicao} disabled={editSalvando}>
                {editSalvando && (
                  <Loader2 className="h-3 w-3 mr-2 animate-spin" />
                )}
                Salvar
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
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
  // Usuario logado (usado pelo preview do parceiro para watermark)
  const { usuario } = useAuth();

  // Modal para coletar motivo (dispensa ou atendimento)
  const [acaoAlvo, setAcaoAlvo] = useState<{
    solic: SolicitacaoDocumento;
    novoStatus: string;
  } | null>(null);
  const [comentarioModal, setComentarioModal] = useState("");
  const [salvandoModal, setSalvandoModal] = useState(false);
  // Upload de arquivo no atendimento
  const [arquivoUpload, setArquivoUpload] = useState<File | null>(null);
  const [comAnexo, setComAnexo] = useState(false);
  // Estado do accordion "Solicitações cumpridas"
  const [cumpridasAberto, setCumpridasAberto] = useState(false);
  // Preview de documento (parceiro: visualizar sem baixar)
  const [previewDoc, setPreviewDoc] = useState<
    { doc: Documento; url: string } | null
  >(null);
  const [carregandoPreview, setCarregandoPreview] = useState(false);
  // Multi-select de documentos para deletar em batch (so interno usa)
  const [docsSelecionados, setDocsSelecionados] = useState<Set<string>>(
    new Set(),
  );
  // Accordions dos grupos 6, 7, 8 (Laudos medicos, Laudos INSS, Holerites).
  // Por padrao recolhidos para nao poluir a tela quando ha muitos arquivos.
  const [gruposExpandidos, setGruposExpandidos] = useState<Set<number>>(
    new Set(),
  );

  function toggleGrupoExpandido(g: number) {
    setGruposExpandidos((prev) => {
      const next = new Set(prev);
      if (next.has(g)) next.delete(g);
      else next.add(g);
      return next;
    });
  }

  function toggleDocSelecionado(id: string) {
    setDocsSelecionados((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleSelecionarTodos(listaParaCheck: Array<Documento>) {
    if (docsSelecionados.size === listaParaCheck.length) {
      setDocsSelecionados(new Set());
    } else {
      setDocsSelecionados(new Set(listaParaCheck.map((d) => d.id)));
    }
  }

  // Renomeia arquivo para o nome do tipo solicitado (ex.: CNIS.pdf)
  function nomearArquivo(tipoSolic: string, arquivoOriginal: File): string {
    const ext = arquivoOriginal.name.includes(".")
      ? arquivoOriginal.name.split(".").pop() || "pdf"
      : "pdf";
    const label = TIPOS_DOCUMENTO_LABEL[tipoSolic] || tipoSolic;
    const labelSanit = label
      .replace(/[\/\\?*:|"<>]/g, "_")
      .replace(/\s+/g, "_")
      .trim();
    return labelSanit + "." + ext.toLowerCase();
  }

  const listaFiltrada = isInterno
    ? documentos
    : documentos.filter((d) => d.visivel_parceiro === true);

  // Ordena por grupo (categoria) e, dentro do mesmo grupo, por nome do
  // arquivo alfabetico SEM o prefixo numerico ("01 - ", "02 - ", etc.).
  // Fica previsivel mesmo com uploads fora de ordem ou nomeacoes diferentes.
  const lista = listaFiltrada.slice().sort((a, b) => {
    const ga = getDocGroup(a.tipo);
    const gb = getDocGroup(b.tipo);
    if (ga !== gb) return ga - gb;
    return displayNomeArquivo(a.nome_arquivo).localeCompare(
      displayNomeArquivo(b.nome_arquivo),
    );
  });

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

  async function abrirPreview(d: Documento) {
    setCarregandoPreview(true);
    try {
      const resp = await supabase.storage
        .from("documentos")
        .createSignedUrl(d.storage_path, 300); // 5 min de TTL
      if (resp.error) throw resp.error;
      const signedUrl = resp.data ? resp.data.signedUrl : null;
      if (!signedUrl) throw new Error("Nao foi possivel gerar link de visualizacao");

      // Buscamos o arquivo e convertemos para blob: URL same-origin.
      // Sem isso, o Chrome bloqueia iframes apontados direto para o
      // Supabase Storage (cross-origin + Content-Disposition pode forcar
      // download, e o sandbox impede o PDF viewer de renderizar).
      // Com blob: URL o iframe e same-origin do app e o PDF viewer interno
      // do Chrome consegue exibir normalmente.
      const fileResp = await fetch(signedUrl);
      if (!fileResp.ok) {
        throw new Error("Erro ao baixar arquivo para preview");
      }
      const blob = await fileResp.blob();
      console.log("[preview]", {
        nome: d.nome_arquivo,
        contentType: fileResp.headers.get("content-type"),
        blobType: blob.type,
        blobSize: blob.size,
      });
      const blobUrl = URL.createObjectURL(blob);

      setPreviewDoc({ doc: d, url: blobUrl });
    } catch (err) {
      console.error(err);
      const errObj = err as { message?: string };
      toast.error(errObj.message || "Erro ao abrir preview");
    } finally {
      setCarregandoPreview(false);
    }
  }

  function fecharPreview() {
    // Libera memoria do blob URL gerado em abrirPreview.
    if (previewDoc && previewDoc.url.startsWith("blob:")) {
      URL.revokeObjectURL(previewDoc.url);
    }
    setPreviewDoc(null);
  }

  // Detecta se o arquivo eh imagem (pra usar <img> em vez de <iframe>)
  function ehImagemDoc(nome: string | null | undefined): boolean {
    if (!nome) return false;
    return /\.(jpe?g|png|gif|webp|bmp)$/i.test(nome);
  }

  async function baixarSelecionados() {
    if (docsSelecionados.size === 0) return;
    const alvos = lista.filter((d) => docsSelecionados.has(d.id));
    if (alvos.length === 0) return;
    let okCount = 0;
    let errCount = 0;
    for (const d of alvos) {
      try {
        const resp = await supabase.storage
          .from("documentos")
          .createSignedUrl(d.storage_path, 60);
        if (resp.error) throw resp.error;
        const url = resp.data ? resp.data.signedUrl : null;
        if (url) {
          window.open(url, "_blank");
          okCount++;
        } else {
          errCount++;
        }
        // pausa curta entre downloads para nao saturar/popup-blocker
        await new Promise((r) => setTimeout(r, 300));
      } catch (err) {
        console.error("erro baixar", d.nome_arquivo, err);
        errCount++;
      }
    }
    if (okCount > 0) {
      toast.success(
        okCount + " download" + (okCount === 1 ? "" : "s") + " iniciado" +
          (okCount === 1 ? "" : "s"),
      );
    }
    if (errCount > 0) {
      toast.error(
        errCount + " falha" + (errCount === 1 ? "" : "s") +
          " ao gerar link. Ver console.",
      );
    }
  }

  async function deletarSelecionados() {
    if (docsSelecionados.size === 0) return;
    const alvos = lista.filter((d) => docsSelecionados.has(d.id));
    if (alvos.length === 0) return;
    const ok = window.confirm(
      "Excluir " + alvos.length + " documento" +
        (alvos.length === 1 ? "" : "s") + " selecionado" +
        (alvos.length === 1 ? "" : "s") + "?\n\n" +
        "Os arquivos serão removidos do storage e do banco. Essa ação não pode ser desfeita.",
    );
    if (!ok) return;
    let okCount = 0;
    let errCount = 0;
    for (const d of alvos) {
      try {
        const storageResp = await supabase.storage
          .from("documentos")
          .remove([d.storage_path]);
        if (storageResp.error) {
          console.error("Erro storage", d.nome_arquivo, storageResp.error);
        }
        const delResp = await supabase
          .from("documentos")
          .delete()
          .eq("id", d.id);
        if (delResp.error) throw delResp.error;
        okCount++;
      } catch (err) {
        console.error("erro deletar", d.nome_arquivo, err);
        errCount++;
      }
    }
    if (okCount > 0) {
      toast.success(
        okCount + " documento" + (okCount === 1 ? "" : "s") + " excluido" +
          (okCount === 1 ? "" : "s"),
      );
    }
    if (errCount > 0) {
      toast.error(
        errCount + " documento" + (errCount === 1 ? "" : "s") +
          " falharam. Ver console.",
      );
    }
    setDocsSelecionados(new Set());
    onChange();
  }

  async function deletarTodos() {
    if (lista.length === 0) return;
    const ok = window.confirm(
      "Tem certeza que deseja deletar TODOS os " +
        lista.length +
        " documento" +
        (lista.length === 1 ? "" : "s") +
        " deste caso?\n\n" +
        "Essa ação remove TODOS os arquivos do storage e os registros do banco, e NÃO pode ser desfeita.\n\n" +
        "Solicitações que estavam vinculadas a esses documentos podem ficar com link quebrado (precisará reanexar o documento).",
    );
    if (!ok) return;
    let okCount = 0;
    let errCount = 0;
    for (const d of lista) {
      try {
        const storageResp = await supabase.storage
          .from("documentos")
          .remove([d.storage_path]);
        if (storageResp.error) {
          console.error("Erro storage", d.nome_arquivo, storageResp.error);
        }
        const delResp = await supabase
          .from("documentos")
          .delete()
          .eq("id", d.id);
        if (delResp.error) throw delResp.error;
        okCount++;
      } catch (err) {
        console.error("erro deletar", d.nome_arquivo, err);
        errCount++;
      }
    }
    if (okCount > 0) {
      toast.success(
        okCount + " documento" + (okCount === 1 ? "" : "s") + " deletado" +
          (okCount === 1 ? "" : "s"),
      );
    }
    if (errCount > 0) {
      toast.error(
        errCount + " documento" + (errCount === 1 ? "" : "s") +
          " falharam. Ver console.",
      );
    }
    onChange();
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
    setArquivoUpload(null);
    // Parceiro SEMPRE cumpre com arquivo. Interno por default sem.
    setComAnexo(!isInterno && novoStatus === "atendido");
  }

  function fecharAcaoModal() {
    setAcaoAlvo(null);
    setComentarioModal("");
    setSalvandoModal(false);
    setArquivoUpload(null);
    setComAnexo(false);
  }

  async function confirmarAcaoModal() {
    if (!acaoAlvo) return;
    if (acaoAlvo.novoStatus === "atendido" && comAnexo && !arquivoUpload) {
      toast.error("Selecione um arquivo para anexar");
      return;
    }
    // Valida tamanho antes de subir.
    if (arquivoUpload) {
      const erroTamanho = validateFileSize(arquivoUpload);
      if (erroTamanho) {
        toast.error(erroTamanho);
        return;
      }
    }
    setSalvandoModal(true);
    try {
      let documentoId: string | null = null;

      // Upload + criacao de documento (se houver arquivo)
      if (
        acaoAlvo.novoStatus === "atendido" &&
        comAnexo &&
        arquivoUpload &&
        usuarioId
      ) {
        const nomeArq = nomearArquivo(acaoAlvo.solic.tipo, arquivoUpload);
        const path = casoId + "/" + nomeArq;
        const upResp = await supabase.storage
          .from("documentos")
          .upload(path, arquivoUpload, { upsert: true });
        if (upResp.error) throw upResp.error;
        const docInsert = await supabase
          .from("documentos")
          .insert({
            caso_id: casoId,
            tipo: acaoAlvo.solic.tipo,
            nome_arquivo: nomeArq,
            storage_path: path,
            tamanho_bytes: arquivoUpload.size,
            uploaded_by: usuarioId,
            visivel_parceiro: true,
          })
          .select("id")
          .single();
        if (docInsert.error) throw docInsert.error;
        documentoId = (docInsert.data as { id: string }).id;
      }

      // Atualiza solicitacao
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
      onChange();
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
            <div className="flex items-center gap-2 flex-wrap">
              {isInterno && lista.length > 0 && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={docsSelecionados.size === 0}
                      title={
                        docsSelecionados.size === 0
                          ? "Selecione documentos primeiro"
                          : "Ações nos selecionados"
                      }
                    >
                      <MoreVertical className="h-4 w-4 mr-1" />
                      Ações ({docsSelecionados.size})
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onClick={baixarSelecionados}>
                      <Download className="h-4 w-4 mr-2" />
                      Baixar
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      onClick={deletarSelecionados}
                      className="text-destructive focus:text-destructive"
                    >
                      <Trash2 className="h-4 w-4 mr-2" />
                      Excluir
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
              <UploadDoc
                casoId={casoId}
                usuarioId={usuarioId}
                onChange={onChange}
              />
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {lista.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-6">
              Nenhum documento anexado ainda.
            </p>
          ) : (
            <div className="space-y-2">
              {isInterno && (
                <label className="flex items-center gap-2 px-3 py-2 text-sm text-muted-foreground cursor-pointer">
                  <input
                    type="checkbox"
                    checked={
                      lista.length > 0 &&
                      docsSelecionados.size === lista.length
                    }
                    onChange={() => toggleSelecionarTodos(lista)}
                    className="h-4 w-4"
                  />
                  Selecionar tudo ({lista.length})
                </label>
              )}
              {(() => {
                // Helper: renderiza o <li> de um documento individual.
                // Usado tanto na lista plana quanto dentro dos accordions.
                function renderDocLi(d: Documento) {
                  return (
                    <li
                      key={d.id}
                      className="flex items-center justify-between gap-2 border rounded-md p-3"
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        {isInterno && (
                          <input
                            type="checkbox"
                            checked={docsSelecionados.has(d.id)}
                            onChange={() => toggleDocSelecionado(d.id)}
                            className="h-4 w-4 shrink-0"
                            title="Selecionar para excluir em batch"
                          />
                        )}
                        <FileText className="h-5 w-5 text-muted-foreground flex-shrink-0" />
                        <div className="min-w-0">
                          <p className="text-sm font-medium truncate">
                            {displayNomeArquivo(d.nome_arquivo)}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {d.tipo === "outro" && d.tipo_personalizado
                              ? d.tipo_personalizado
                              : TIPOS_DOCUMENTO_LABEL[d.tipo] || d.tipo}{" "}
                            -{" "}
                            {formatBytes(d.tamanho_bytes)} -{" "}
                            {formatDate(d.created_at)}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        {isInterno && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => baixar(d)}
                          >
                            <Download className="h-4 w-4 mr-2" />
                            Baixar
                          </Button>
                        )}
                        {!isInterno && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => abrirPreview(d)}
                            disabled={carregandoPreview}
                          >
                            <Eye className="h-4 w-4 mr-2" />
                            Visualizar
                          </Button>
                        )}
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
                  );
                }

                // Divide lista (ja ordenada por grupo) em secoes:
                //  - tipo "flat": grupo nao-accordion, renderiza como <li> direto
                //  - tipo "accordion": grupo 6/7/8, renderiza como bloco
                //    expansivel com cabecalho clicavel.
                type Secao =
                  | { kind: "flat"; doc: Documento }
                  | { kind: "accordion"; grupo: number; docs: Array<Documento> };
                const secoes: Array<Secao> = [];
                for (const d of lista) {
                  const g = getDocGroup(d.tipo);
                  if (GRUPOS_ACCORDION.has(g)) {
                    const ultima = secoes[secoes.length - 1];
                    if (
                      ultima &&
                      ultima.kind === "accordion" &&
                      ultima.grupo === g
                    ) {
                      ultima.docs.push(d);
                    } else {
                      secoes.push({ kind: "accordion", grupo: g, docs: [d] });
                    }
                  } else {
                    secoes.push({ kind: "flat", doc: d });
                  }
                }

                return (
                  <ul className="space-y-2">
                    {secoes.map((s, idx) => {
                      if (s.kind === "flat") {
                        return renderDocLi(s.doc);
                      }
                      const aberto = gruposExpandidos.has(s.grupo);
                      const label = GRUPO_LABELS[s.grupo] || "Grupo " + s.grupo;
                      return (
                        <li
                          key={"grupo-" + s.grupo + "-" + idx}
                          className="border rounded-md overflow-hidden"
                        >
                          <button
                            type="button"
                            onClick={() => toggleGrupoExpandido(s.grupo)}
                            className="w-full flex items-center justify-between p-3 hover:bg-muted/50 transition-colors text-left"
                          >
                            <div className="flex items-center gap-2 min-w-0">
                              {aberto ? (
                                <ChevronDown className="h-4 w-4 shrink-0" />
                              ) : (
                                <ChevronRight className="h-4 w-4 shrink-0" />
                              )}
                              <span className="text-sm font-medium truncate">
                                {label}
                              </span>
                            </div>
                            <span className="text-xs text-muted-foreground shrink-0">
                              {s.docs.length}{" "}
                              {s.docs.length === 1 ? "arquivo" : "arquivos"}
                            </span>
                          </button>
                          {aberto && (
                            <ul className="space-y-2 p-3 border-t">
                              {s.docs.map(renderDocLi)}
                            </ul>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                );
              })()}
            </div>
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
          {(() => {
            const pendentes = solicitacoesOrdenadas.filter(
              (s) => s.status === "pendente",
            );
            const cumpridas = solicitacoesOrdenadas.filter(
              (s) => s.status !== "pendente",
            );

            function renderSolicLi(s: SolicitacaoDocumento) {
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
                    {!isInterno && isPendente && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => abrirAcaoModal(s, "atendido")}
                      >
                        <CheckCircle2 className="h-3 w-3 mr-1" />
                        Cumprir
                      </Button>
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
            }

            if (solicitacoesOrdenadas.length === 0) {
              return (
                <p className="text-sm text-muted-foreground text-center py-6">
                  Nenhuma solicitacao registrada.
                </p>
              );
            }

            return (
              <div className="space-y-3">
                {pendentes.length > 0 && (
                  <ul className="space-y-2">
                    {pendentes.map(renderSolicLi)}
                  </ul>
                )}
                {pendentes.length === 0 && cumpridas.length > 0 && (
                  <p className="text-sm text-muted-foreground text-center py-3">
                    Nenhuma solicitação pendente.
                  </p>
                )}
                {cumpridas.length > 0 && (
                  <div className="border rounded-md overflow-hidden border-dashed">
                    <button
                      type="button"
                      onClick={() => setCumpridasAberto(!cumpridasAberto)}
                      className="w-full flex items-center justify-between p-3 hover:bg-muted/50 transition-colors text-left"
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        {cumpridasAberto ? (
                          <ChevronDown className="h-4 w-4 shrink-0" />
                        ) : (
                          <ChevronRight className="h-4 w-4 shrink-0" />
                        )}
                        <span className="text-sm font-medium truncate">
                          Solicitações cumpridas
                        </span>
                      </div>
                      <span className="text-xs text-muted-foreground shrink-0">
                        {cumpridas.length}{" "}
                        {cumpridas.length === 1
                          ? "solicitação"
                          : "solicitações"}
                      </span>
                    </button>
                    {cumpridasAberto && (
                      <ul className="space-y-2 p-3 border-t">
                        {cumpridas.map(renderSolicLi)}
                      </ul>
                    )}
                  </div>
                )}
              </div>
            );
          })()}
        </CardContent>
      </Card>

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
                        name="comAnexoCaso"
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
                        name="comAnexoCaso"
                        checked={comAnexo}
                        onChange={() => setComAnexo(true)}
                        className="h-4 w-4 mt-0.5"
                      />
                      <span className="text-sm">
                        Anexar arquivo (sera renomeado para o tipo solicitado)
                      </span>
                    </label>
                  </div>
                </div>
              )}

            {/* File input */}
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
                  <p className="text-xs text-muted-foreground mt-1">
                    Tamanho maximo: {MAX_FILE_SIZE_MB} MB por arquivo.
                  </p>
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

      {/* ---- Dialog de preview de documento (parceiro: visualizar sem baixar) ---- */}
      <Dialog
        open={previewDoc !== null}
        onOpenChange={(o) => {
          if (!o) fecharPreview();
        }}
      >
        <DialogContent
          className="max-w-4xl max-h-[95vh] overflow-hidden p-0"
          onContextMenu={(e) => e.preventDefault()}
        >
          <DialogHeader className="px-4 pt-4 pb-2">
            <DialogTitle className="text-base">
              {previewDoc
                ? displayNomeArquivo(previewDoc.doc.nome_arquivo)
                : ""}
            </DialogTitle>
            <DialogDescription className="text-xs text-destructive bg-destructive/10 border border-destructive/30 rounded p-2 mt-1">
              <strong>Documento confidencial.</strong> Captura de tela, gravação
              ou compartilhamento configura responsabilidade legal. Acesso
              registrado para auditoria.
            </DialogDescription>
          </DialogHeader>
          {previewDoc && (
            <div
              className="relative bg-muted/30 select-none"
              style={{ height: "75vh" }}
              onContextMenu={(e) => e.preventDefault()}
              onDragStart={(e) => e.preventDefault()}
            >
              {ehImagemDoc(previewDoc.doc.nome_arquivo) ? (
                <img
                  src={previewDoc.url}
                  alt={previewDoc.doc.nome_arquivo}
                  draggable={false}
                  onDragStart={(e) => e.preventDefault()}
                  onContextMenu={(e) => e.preventDefault()}
                  className="w-full h-full object-contain pointer-events-none"
                />
              ) : (
                // Sem sandbox: o PDF viewer interno do Chrome precisa rodar
                // scripts pra renderizar. Como a URL e blob: same-origin
                // (gerado por nos no client), o risco e baixo.
                <iframe
                  src={previewDoc.url + "#toolbar=0&navpanes=0&scrollbar=1"}
                  title={previewDoc.doc.nome_arquivo}
                  className="w-full h-full"
                />
              )}
              {/* Watermark com identificacao do usuario */}
              <div className="absolute inset-0 pointer-events-none flex flex-col items-center justify-center overflow-hidden">
                <div
                  className="font-bold text-gray-400/30 -rotate-12 text-center whitespace-pre-line leading-tight"
                  style={{ fontSize: "2rem" }}
                >
                  {(usuario && usuario.nome) || "Confidencial"}
                  {"\n"}
                  {(usuario && usuario.email) || ""}
                  {"\n"}
                  {new Date().toLocaleString("pt-BR")}
                </div>
              </div>
            </div>
          )}
          <div className="flex items-center justify-end gap-2 px-4 py-3 border-t">
            <Button variant="outline" size="sm" onClick={fecharPreview}>
              Fechar
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

interface ArquivoComTipo {
  id: string; // id local para o React key
  arquivo: File;
  tipo: string;
  tipoPersonalizado: string;
}

function UploadDoc(props: {
  casoId: string;
  usuarioId: string | null;
  onChange: () => void;
}) {
  const { casoId, usuarioId, onChange } = props;
  const [aberto, setAberto] = useState(false);
  const [itens, setItens] = useState<Array<ArquivoComTipo>>([]);
  const [visivelParceiro, setVisivelParceiro] = useState(true);
  const [enviando, setEnviando] = useState(false);

  // Lista de tipos para o Combobox (deriva da tabela TIPOS_DOCUMENTO_LABEL)
  const tiposOptions = Object.keys(TIPOS_DOCUMENTO_LABEL).map((k) => ({
    value: k,
    label: TIPOS_DOCUMENTO_LABEL[k],
  }));

  function adicionarArquivos(files: FileList | null) {
    if (!files) return;
    const novos: Array<ArquivoComTipo> = [];
    for (let i = 0; i < files.length; i++) {
      const f = files[i];
      novos.push({
        id: Date.now() + "-" + i + "-" + Math.random().toString(36).slice(2, 8),
        arquivo: f,
        tipo: "",
        tipoPersonalizado: "",
      });
    }
    setItens((prev) => [...prev, ...novos]);
  }

  function removerItem(id: string) {
    setItens((prev) => prev.filter((it) => it.id !== id));
  }

  function atualizarTipo(id: string, novoTipo: string) {
    setItens((prev) =>
      prev.map((it) =>
        it.id === id
          ? { ...it, tipo: novoTipo, tipoPersonalizado: "" }
          : it,
      ),
    );
  }

  function atualizarPersonalizado(id: string, texto: string) {
    setItens((prev) =>
      prev.map((it) =>
        it.id === id ? { ...it, tipoPersonalizado: texto } : it,
      ),
    );
  }

  function fechar() {
    setAberto(false);
    setItens([]);
    setEnviando(false);
  }

  // Cada item precisa ter tipo selecionado.
  // Se tipo === "outro", precisa tambem ter tipoPersonalizado preenchido.
  const todosValidos =
    itens.length > 0 &&
    itens.every(
      (it) =>
        it.tipo &&
        (it.tipo !== "outro" || it.tipoPersonalizado.trim().length > 0),
    );

  async function enviarTodos() {
    if (!usuarioId || !todosValidos) return;

    // Valida tamanho de TODOS os arquivos antes de comecar a subir,
    // pra evitar criar registros parciais.
    const errosTamanho = validateFileSizes(itens.map((it) => it.arquivo));
    if (errosTamanho.length > 0) {
      errosTamanho.slice(0, 3).forEach((e) => toast.error(e));
      if (errosTamanho.length > 3) {
        toast.error(
          "Mais " + (errosTamanho.length - 3) + " arquivo(s) acima do limite.",
        );
      }
      return;
    }

    setEnviando(true);
    let okCount = 0;
    let errCount = 0;
    try {
      for (const it of itens) {
        try {
          const fileName = Date.now() + "_" +
            sanitizeFileName(it.arquivo.name);
          const storagePath = casoId + "/" + fileName;
          const uploadResp = await supabase.storage
            .from("documentos")
            .upload(storagePath, it.arquivo, {
              cacheControl: "3600",
              upsert: false,
            });
          if (uploadResp.error) throw uploadResp.error;

          const insertResp = await supabase.from("documentos").insert({
            caso_id: casoId,
            tipo: it.tipo,
            tipo_personalizado: it.tipo === "outro"
              ? it.tipoPersonalizado.trim()
              : null,
            nome_arquivo: it.arquivo.name,
            storage_path: storagePath,
            tamanho_bytes: it.arquivo.size,
            uploaded_by: usuarioId,
            visivel_parceiro: visivelParceiro,
          });
          if (insertResp.error) throw insertResp.error;
          okCount++;
        } catch (errInner) {
          console.error("erro upload de", it.arquivo.name, errInner);
          errCount++;
        }
      }
      if (okCount > 0) {
        toast.success(
          okCount + " documento" + (okCount === 1 ? "" : "s") +
            " adicionado" + (okCount === 1 ? "" : "s"),
        );
      }
      if (errCount > 0) {
        toast.error(
          errCount + " arquivo" + (errCount === 1 ? "" : "s") +
            " falharam. Ver console.",
        );
      }
      if (okCount > 0) {
        onChange();
        fechar();
      }
    } finally {
      setEnviando(false);
    }
  }

  return (
    <Dialog
      open={aberto}
      onOpenChange={(o) => (o ? setAberto(true) : fechar())}
    >
      <DialogTrigger asChild>
        <Button size="sm">
          <Plus className="h-4 w-4 mr-2" />
          Adicionar
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Adicionar documentos</DialogTitle>
          <DialogDescription>
            Selecione um ou vários arquivos. Cada um precisa de um tipo. Se
            escolher &quot;Outro&quot;, informe o nome do documento. Tamanho
            máximo: {MAX_FILE_SIZE_MB} MB por arquivo.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label className="text-xs">Adicionar arquivos</Label>
            <Input
              type="file"
              multiple
              accept="application/pdf,image/jpeg,image/png,image/jpg,.doc,.docx,.xls,.xlsx"
              onChange={(e) => {
                adicionarArquivos(e.target.files);
                // limpa o input para permitir adicionar o mesmo arquivo de novo
                e.target.value = "";
              }}
            />
          </div>

          {itens.length === 0 && (
            <p className="text-sm text-muted-foreground text-center py-4">
              Nenhum arquivo selecionado.
            </p>
          )}

          {itens.length > 0 && (
            <ul className="space-y-3">
              {itens.map((it) => (
                <li key={it.id} className="border rounded-md p-3 space-y-2">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium truncate">
                        {it.arquivo.name}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {formatBytes(it.arquivo.size)}
                      </p>
                    </div>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 w-7 p-0 text-destructive hover:text-destructive"
                      onClick={() => removerItem(it.id)}
                      title="Remover este arquivo"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                  <div>
                    <Label className="text-xs">Tipo</Label>
                    <DocTypeCombobox
                      options={tiposOptions}
                      value={it.tipo}
                      onChange={(v) => atualizarTipo(it.id, v)}
                      placeholder="Selecione ou busque o tipo..."
                    />
                  </div>
                  {it.tipo === "outro" && (
                    <div>
                      <Label className="text-xs">
                        Nome do documento (obrigatório)
                      </Label>
                      <Input
                        placeholder="Ex.: Cartão do INSS, Decisão do MS..."
                        value={it.tipoPersonalizado}
                        onChange={(e) =>
                          atualizarPersonalizado(it.id, e.target.value)
                        }
                      />
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}

          <div className="flex items-center gap-2 pt-2">
            <input
              id="doc-visivel-parceiro"
              type="checkbox"
              checked={visivelParceiro}
              onChange={(e) => setVisivelParceiro(e.target.checked)}
              className="h-4 w-4"
            />
            <Label htmlFor="doc-visivel-parceiro" className="text-sm">
              Visíveis para o parceiro indicador
            </Label>
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={fechar} disabled={enviando}>
            Cancelar
          </Button>
          <Button onClick={enviarTodos} disabled={!todosValidos || enviando}>
            {enviando && <Loader2 className="h-3 w-3 mr-2 animate-spin" />}
            Enviar ({itens.length})
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
  const [tipo, setTipo] = useState("");
  const [tipoPersonalizado, setTipoPersonalizado] = useState("");
  const [descricao, setDescricao] = useState("");
  const [origem, setOrigem] = useState("externa");
  const [enviando, setEnviando] = useState(false);

  const tiposOptions = Object.keys(TIPOS_DOCUMENTO_LABEL).map((k) => ({
    value: k,
    label: TIPOS_DOCUMENTO_LABEL[k],
  }));

  const valido =
    !!tipo &&
    (tipo !== "outro" || tipoPersonalizado.trim().length > 0);

  async function criar() {
    if (!usuarioId || !valido) return;
    setEnviando(true);
    try {
      // Se tipo=outro, usa o nome customizado como prefixo da descricao
      // (a tabela solicitacoes_documento nao tem coluna tipo_personalizado).
      const descricaoFinal = tipo === "outro" && tipoPersonalizado.trim()
        ? "[" + tipoPersonalizado.trim() + "] " + (descricao.trim() || "")
        : descricao.trim() || null;
      const resp = await supabase
        .from("solicitacoes_documento")
        .insert({
          caso_id: casoId,
          tipo: tipo,
          descricao: descricaoFinal || null,
          status: "pendente",
          origem: origem,
          solicitado_por: usuarioId,
        })
        .select("id")
        .single();
      if (resp.error) throw resp.error;
      toast.success("Solicitacao criada");

      // Notifica parceiro por email (fire-and-forget; nao bloqueia UI).
      // A edge function checa as regras (origem=externa, caso com parceiro)
      // e silenciosamente nao envia se nao se aplicam.
      if (resp.data) {
        const solicId = (resp.data as { id: string }).id;
        supabase.functions
          .invoke("notify-solicitacao-doc", {
            body: { solicitacao_id: solicId },
          })
          .catch((err) => console.error("notify-solicitacao-doc falhou", err));
      }

      setTipo("");
      setTipoPersonalizado("");
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
            <Label className="text-xs">Tipo de documento</Label>
            <DocTypeCombobox
              options={tiposOptions}
              value={tipo}
              onChange={setTipo}
              placeholder="Selecione ou busque o tipo..."
            />
          </div>
          {tipo === "outro" && (
            <div>
              <Label className="text-xs">
                Nome do documento (obrigatório)
              </Label>
              <Input
                placeholder="Ex.: Cartão do INSS, Decisão do MS..."
                value={tipoPersonalizado}
                onChange={(e) => setTipoPersonalizado(e.target.value)}
              />
            </div>
          )}
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
            <Label className="text-xs">Observação</Label>
            <Textarea
              rows={3}
              placeholder="Detalhes sobre o documento necessário..."
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
          <Button onClick={criar} disabled={enviando || !valido}>
            {enviando && <Loader2 className="h-3 w-3 mr-2 animate-spin" />}
            Criar solicitação
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
            <p className="text-base font-medium text-warning">
              {formatMoney(aPagar)}
            </p>
          </div>
          <div className="border rounded-md p-3">
            <p className="text-xs text-muted-foreground">Pago</p>
            <p className="text-base font-medium text-success">
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
  cliente: Cliente;
  usuarioId: string | null;
  processosAdmin: Array<ProcessoAdmin>;
  processosJudiciais: Array<ProcessoJudicial>;
  onChange: () => void;
}

interface ResultadoBuscaLM {
  score: number;
  idprocessos: string | number;
  numero_processo: string;
  poloativo_nome: string;
  tribunal: string | null;
  juizo: string | null;
  processo_tema: string | null;
  inbox_atual: string | null;
}

function TabProcessos(props: TabProcessosProps) {
  const { casoId, cliente, usuarioId, processosAdmin, processosJudiciais, onChange } =
    props;

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

  // ---- Busca no Legalmail ----
  const [abrirBuscaLM, setAbrirBuscaLM] = useState(false);
  const [buscandoLM, setBuscandoLM] = useState(false);
  const [resultadosLM, setResultadosLM] = useState<Array<ResultadoBuscaLM>>([]);
  const [selecionadosLM, setSelecionadosLM] = useState<Set<string>>(
    new Set(),
  );
  const [importandoLM, setImportandoLM] = useState(false);

  async function buscarLegalmail() {
    setBuscandoLM(true);
    setResultadosLM([]);
    setSelecionadosLM(new Set());
    setAbrirBuscaLM(true);
    try {
      const resp = await supabase.functions.invoke("check-legalmail-nome", {
        body: { nome: cliente.nome },
      });
      if (resp.error) throw resp.error;
      const r = resp.data as {
        processos_similares?: Array<ResultadoBuscaLM>;
        error?: string;
      };
      if (r.error) {
        toast.error("Erro do Legalmail: " + r.error);
        return;
      }
      const lista = r.processos_similares || [];
      setResultadosLM(lista);
      if (lista.length === 0) {
        toast.message("Nenhum processo similar encontrado no Legalmail.");
      } else {
        toast.success(
          lista.length + " processo" + (lista.length === 1 ? "" : "s") +
            " similar" + (lista.length === 1 ? "" : "es") + " encontrado" +
            (lista.length === 1 ? "" : "s") + ".",
        );
      }
    } catch (err) {
      console.error(err);
      const errObj = err as { message?: string };
      toast.error(errObj.message || "Erro ao buscar no Legalmail");
    } finally {
      setBuscandoLM(false);
    }
  }

  function toggleSelecionadoLM(idStr: string) {
    setSelecionadosLM((prev) => {
      const next = new Set(prev);
      if (next.has(idStr)) {
        next.delete(idStr);
      } else {
        next.add(idStr);
      }
      return next;
    });
  }

  async function importarSelecionadosLM() {
    if (selecionadosLM.size === 0) {
      toast.error("Selecione ao menos um processo");
      return;
    }
    setImportandoLM(true);
    try {
      const ids = Array.from(selecionadosLM).map((s) => Number(s));
      const resp = await supabase.functions.invoke("sync-legalmail-caso", {
        body: {
          caso_id: casoId,
          usuario_id: usuarioId,
          idprocessos: ids,
        },
      });
      if (resp.error) throw resp.error;
      const r = resp.data as {
        processos_criados?: number;
        processos_atualizados?: number;
        movimentacoes_importadas?: number;
        movimentacoes_ja_existentes?: number;
        movimentacoes_ignoradas?: number;
        erros?: Array<{ idprocesso: number; motivo: string }>;
      };
      const pc = r.processos_criados || 0;
      const pa = r.processos_atualizados || 0;
      const mi = r.movimentacoes_importadas || 0;
      const mj = r.movimentacoes_ja_existentes || 0;
      const mig = r.movimentacoes_ignoradas || 0;
      let msg = "Importado: ";
      msg += pc + " novo" + (pc === 1 ? "" : "s") + ", ";
      msg += pa + " atualizado" + (pa === 1 ? "" : "s") + ". ";
      msg += mi + " movimentaca" + (mi === 1 ? "o" : "oes") + " importada" +
        (mi === 1 ? "" : "s");
      if (mj > 0) {
        msg += " (" + mj + " ja existia" + (mj === 1 ? "" : "m") + ")";
      }
      if (mig > 0) {
        msg += ". " + mig + " mov" + (mig === 1 ? "" : "s") +
          " ignorada" + (mig === 1 ? "" : "s") + " pela whitelist";
      }
      msg += ".";
      toast.success(msg);
      if (r.erros && r.erros.length > 0) {
        console.warn("erros no import legalmail:", r.erros);
        toast.warning(r.erros.length + " erro(s) durante importacao. Ver console.");
      }
      setAbrirBuscaLM(false);
      setResultadosLM([]);
      setSelecionadosLM(new Set());
      onChange();
    } catch (err) {
      console.error(err);
      const errObj = err as { message?: string };
      toast.error(errObj.message || "Erro ao importar do Legalmail");
    } finally {
      setImportandoLM(false);
    }
  }

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
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div>
              <CardTitle className="text-base">Processos judiciais</CardTitle>
              <CardDescription>
                Acoes ajuizadas relacionadas ao caso.
              </CardDescription>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <Button
                size="sm"
                variant="outline"
                onClick={buscarLegalmail}
                disabled={buscandoLM || !cliente.nome}
                title="Buscar processos no Legalmail pelo nome do cliente"
              >
                {buscandoLM && (
                  <Loader2 className="h-3 w-3 mr-2 animate-spin" />
                )}
                <Search className="h-4 w-4 mr-1" />
                Buscar no Legalmail
              </Button>
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
                        {p.comarca ? p.comarca : ""}
                        {p.uf ? "/" + p.uf : ""}
                        {p.data_distribuicao
                          ? " - Distribuido em " +
                            formatDate(p.data_distribuicao)
                          : ""}
                      </p>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Dialog open={abrirBuscaLM} onOpenChange={setAbrirBuscaLM}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Processos no Legalmail</DialogTitle>
            <DialogDescription>
              Resultados de busca por nome para "{cliente.nome}". Marque os que
              quer importar.
            </DialogDescription>
          </DialogHeader>
          {buscandoLM && (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              <span className="ml-2 text-sm text-muted-foreground">
                Buscando no Legalmail (pode demorar alguns segundos)...
              </span>
            </div>
          )}
          {!buscandoLM && resultadosLM.length === 0 && (
            <p className="text-sm text-muted-foreground text-center py-8">
              Nenhum processo similar encontrado.
            </p>
          )}
          {!buscandoLM && resultadosLM.length > 0 && (
            <ul className="space-y-2">
              {resultadosLM.map((r) => {
                const idStr = String(r.idprocessos);
                const marcado = selecionadosLM.has(idStr);
                return (
                  <li
                    key={idStr}
                    className="border rounded-md p-3 flex items-start gap-3"
                  >
                    <input
                      type="checkbox"
                      checked={marcado}
                      onChange={() => toggleSelecionadoLM(idStr)}
                      className="h-4 w-4 mt-0.5"
                    />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="text-sm font-medium">
                          {r.numero_processo}
                        </p>
                        <Badge
                          variant="outline"
                          className="text-xs"
                          title="Similaridade do nome"
                        >
                          score {(r.score * 100).toFixed(0)}%
                        </Badge>
                        {r.inbox_atual && (
                          <Badge variant="secondary" className="text-xs">
                            {r.inbox_atual}
                          </Badge>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground mt-1">
                        Polo ativo: {r.poloativo_nome}
                      </p>
                      {(r.juizo || r.tribunal) && (
                        <p className="text-xs text-muted-foreground">
                          {[r.juizo, r.tribunal].filter(Boolean).join(" - ")}
                        </p>
                      )}
                      {r.processo_tema && (
                        <p className="text-xs text-muted-foreground">
                          Tema: {r.processo_tema}
                        </p>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => setAbrirBuscaLM(false)}
              disabled={importandoLM}
            >
              Cancelar
            </Button>
            <Button
              onClick={importarSelecionadosLM}
              disabled={
                importandoLM || buscandoLM || selecionadosLM.size === 0
              }
            >
              {importandoLM && (
                <Loader2 className="h-3 w-3 mr-2 animate-spin" />
              )}
              Importar selecionados ({selecionadosLM.size})
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

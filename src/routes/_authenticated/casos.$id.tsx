import { createFileRoute, useParams, useNavigate, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import {
  ArrowLeft,
  Loader2,
  FileText,
  FileDown,
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
  Sparkles,
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
  X,
  ListTodo,
} from "lucide-react";

import { useAuth } from "@/hooks/use-auth";
import { DESTAQUE_CLASSE, useFocoItem } from "@/hooks/use-foco-item";
import { notificarEquipe } from "@/lib/notificar";
import { iaAnalise } from "@/lib/ia/client";
import { supabase } from "@/lib/supabase";
import { parseCnj } from "@/lib/processos/cnj";
import {
  DESTAQUE_CLASSE_GLOBAL,
  useDestaque,
} from "@/lib/destaque/destaque-context";
import { MAX_FILE_SIZE_MB, validateFileSize, validateFileSizes } from "@/lib/upload-limits";
import {
  abrirDrivePicker,
  abrirDrivePickerPasta,
  isGoogleDriveConfigured,
  listarArquivosDaPasta,
  obterAccessToken,
  type DrivePickedFile,
} from "@/lib/google-drive";
import { ClientOnly } from "@/components/client-only";
import { DocTypeCombobox } from "@/components/doc-type-combobox";
import { DrivePickerDialog, type DriveImportedFile } from "@/components/drive-picker-dialog";
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
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { CasoTarefasTab } from "@/components/tarefas/caso-tarefas-tab";
import { EtiquetasCliente } from "@/components/etiquetas-cliente";
import { Markdown } from "@/components/markdown";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
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
  // Deep-link pra aba (?tab=) e item a destacar (?foco=<id>) — usado pelo sino.
  validateSearch: (search: Record<string, unknown>): { tab?: string; foco?: string } => {
    const out: { tab?: string; foco?: string } = {};
    if (typeof search.tab === "string") out.tab = search.tab;
    if (typeof search.foco === "string") out.foco = search.foco;
    return out;
  },
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
  // Pasta do Drive vinculada (Fase 52). Null = sem vinculo.
  gdrive_folder_id?: string | null;
  gdrive_folder_name?: string | null;
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
  // ID do arquivo no Drive (se foi importado de la) - usado pra dedupe de sync
  gdrive_file_id?: string | null;
  // Caminho da subpasta no Drive (ex.: "Diversos"). Null = raiz/manual.
  pasta_relativa?: string | null;
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
  // Legacy: tabela mensagens nao eh mais usada na UI - mantida no banco como
  // historico. Comentarios (nova tabela) substituiu desde Fase 48.
  id: string;
  caso_id: string;
  remetente_id: string;
  texto: string;
  lida: boolean;
  created_at: string;
}

interface ComentarioRow {
  id: string;
  caso_id: string;
  parent_id: string | null;
  autor_id: string;
  texto: string;
  created_at: string;
  // Join virtual com usuarios (vem de select aninhado)
  autor?: {
    id: string;
    nome: string | null;
    email: string | null;
    tipo: string;
  } | null;
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
  parent_id: string | null;
  parent_tipo: "admin" | "judicial" | null;
  etapa_tipo: string | null;
  tipo_beneficio: string | null;
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
  parent_id: string | null;
  parent_tipo: "admin" | "judicial" | null;
  etapa_tipo: string | null;
}

// Etapas da cadeia de processos (lista fixa). "" = sem classificacao.
const ETAPAS_ADMIN = [
  "Requerimento inicial",
  "Recurso ordinario",
  "Prorrogacao",
  "Pedido de revisao",
  "Cumprimento de exigencia",
  "Outro",
];
const ETAPAS_JUDICIAL = [
  "Acao inicial",
  "Recurso (apelacao)",
  "Embargos",
  "Cumprimento de sentenca",
  "Outro",
];

// Tribunais relevantes para o previdenciario: Justica Federal (TRFs) + TJs.
const TRIBUNAIS_FEDERAIS = [
  "TRF1 - Tribunal Regional Federal da 1a Regiao",
  "TRF2 - Tribunal Regional Federal da 2a Regiao",
  "TRF3 - Tribunal Regional Federal da 3a Regiao",
  "TRF4 - Tribunal Regional Federal da 4a Regiao",
  "TRF5 - Tribunal Regional Federal da 5a Regiao",
  "TRF6 - Tribunal Regional Federal da 6a Regiao",
];
const TRIBUNAIS_ESTADUAIS = [
  "TJAC - Tribunal de Justica do Acre",
  "TJAL - Tribunal de Justica de Alagoas",
  "TJAP - Tribunal de Justica do Amapa",
  "TJAM - Tribunal de Justica do Amazonas",
  "TJBA - Tribunal de Justica da Bahia",
  "TJCE - Tribunal de Justica do Ceara",
  "TJDFT - Tribunal de Justica do Distrito Federal e Territorios",
  "TJES - Tribunal de Justica do Espirito Santo",
  "TJGO - Tribunal de Justica de Goias",
  "TJMA - Tribunal de Justica do Maranhao",
  "TJMT - Tribunal de Justica de Mato Grosso",
  "TJMS - Tribunal de Justica de Mato Grosso do Sul",
  "TJMG - Tribunal de Justica de Minas Gerais",
  "TJPA - Tribunal de Justica do Para",
  "TJPB - Tribunal de Justica da Paraiba",
  "TJPR - Tribunal de Justica do Parana",
  "TJPE - Tribunal de Justica de Pernambuco",
  "TJPI - Tribunal de Justica do Piaui",
  "TJRJ - Tribunal de Justica do Rio de Janeiro",
  "TJRN - Tribunal de Justica do Rio Grande do Norte",
  "TJRS - Tribunal de Justica do Rio Grande do Sul",
  "TJRO - Tribunal de Justica de Rondonia",
  "TJRR - Tribunal de Justica de Roraima",
  "TJSC - Tribunal de Justica de Santa Catarina",
  "TJSP - Tribunal de Justica de Sao Paulo",
  "TJSE - Tribunal de Justica de Sergipe",
  "TJTO - Tribunal de Justica do Tocantins",
];
const TRIBUNAIS = [...TRIBUNAIS_FEDERAIS, ...TRIBUNAIS_ESTADUAIS];

// No normalizado da arvore de processos (admin OU judicial num mesmo formato).
type ProcTipo = "admin" | "judicial";
interface ProcNode {
  tipo: ProcTipo;
  id: string;
  parent_id: string | null;
  parent_tipo: "admin" | "judicial" | null;
  etapa_tipo: string | null;
  numero: string | null;
  admin?: ProcessoAdmin;
  judicial?: ProcessoJudicial;
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
  tramitacao: "Tramitação Inteligente",
  legalmail: "Legalmail",
  djen: "Diário (DJEN)",
  sistema: "Sistema",
};

const TIPOS_DOCUMENTO_LABEL: Record<string, string> = {
  cnis: "CNIS",
  rg_cpf: "RG / CPF",
  comprovante_residencia: "Comprovante de residência",
  ctps: "CTPS",
  holerite: "Holerite / contracheque",
  ppp: "PPP",
  laudo_medico: "Laudo médico",
  ltcat: "LTCAT",
  atestado_medico: "Atestado médico",
  cat: "CAT",
  carne_gps: "Carnê de contribuição (GPS)",
  ctc: "CTC",
  carta_concessao_inss: "Carta de concessão/indeferimento INSS",
  hiscre: "HISCRE",
  certidao_casamento: "Certidão de casamento",
  certidao_obito: "Certidão de óbito",
  certidao_nascimento: "Certidão de nascimento",
  declaracao_uniao_estavel: "Declaração de união estável",
  declaracao_atividade_rural: "Declaração de atividade rural",
  procuracao: "Procuração",
  substabelecimento: "Substabelecimento",
  contrato_honorarios: "Contrato de honorários",
  declaracao_hipossuficiencia: "Declaração de hipossuficiência",
  declaracao_ausencia_duplicidade: "Declaração de ausência de duplicidade de ação",
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
  6: "Laudos médicos",
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

// Feature de Repasses PAUSADA na UI (tabela/componente/logica mantidos no
// backend). Trocar para true quando formos retomar. Ver todo list.
const REPASSES_ATIVO = false;

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
  interna: "Interna (escritório)",
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

function labelFromList(list: Array<{ value: string; label: string }>, value: string): string {
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
  const search = Route.useSearch();
  const { usuario } = useAuth();
  const isInterno = usuario?.tipo === "interno";

  // Aba ativa controlada — permite deep-link via ?tab= (ex.: clicar numa
  // notificacao de andamento abre o caso ja na aba Andamentos).
  const [aba, setAba] = useState(search.tab || "visao_geral");
  useEffect(() => {
    if (search.tab) setAba(search.tab);
  }, [search.tab]);

  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const jaCarregouRef = useRef(false);

  const [caso, setCaso] = useState<Caso | null>(null);
  const [cliente, setCliente] = useState<Cliente | null>(null);
  // TODOS os casos do cliente (inclui o atual) — para o seletor de casos.
  const [casosCliente, setCasosCliente] = useState<
    Array<{ id: string; tipo_beneficio: string | null; status: string | null }>
  >([]);
  const [parceiro, setParceiro] = useState<ParceiroLite | null>(null);
  const [parceirosDisponiveis, setParceirosDisponiveis] = useState<Array<ParceiroLite>>([]);
  const [andamentos, setAndamentos] = useState<Array<Andamento>>([]);
  const [documentos, setDocumentos] = useState<Array<Documento>>([]);
  const [solicitacoes, setSolicitacoes] = useState<Array<SolicitacaoDocumento>>([]);
  const [analises, setAnalises] = useState<Array<AnaliseTecnica>>([]);
  const [mensagens, setMensagens] = useState<Array<Mensagem>>([]);
  const [comentarios, setComentarios] = useState<Array<ComentarioRow>>([]);
  const [repasses, setRepasses] = useState<Array<Repasse>>([]);
  const [processosAdmin, setProcessosAdmin] = useState<Array<ProcessoAdmin>>([]);
  const [processosJudiciais, setProcessosJudiciais] = useState<Array<ProcessoJudicial>>([]);

  const carregar = useCallback(async () => {
    // So mostra loading global na primeira carga, depois recarregamentos sao silenciosos
    if (!jaCarregouRef.current) {
      setLoading(true);
    }
    setErro(null);
    try {
      const casoResp = await supabase.from("casos").select("*").eq("id", casoId).maybeSingle();
      if (casoResp.error) throw casoResp.error;
      const casoData = casoResp.data as Caso | null;
      if (!casoData) {
        setErro("Caso não encontrado ou você não tem permissão para visualizá-lo.");
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

      // Todos os casos do cliente (inclui o atual). RLS ja filtra o que o
      // usuario pode ver (parceiro so os dele).
      const casosResp = await supabase
        .from("casos")
        .select("id, tipo_beneficio, status, created_at")
        .eq("cliente_id", casoData.cliente_id)
        .order("created_at", { ascending: true });
      setCasosCliente(
        (casosResp.data as Array<{
          id: string;
          tipo_beneficio: string | null;
          status: string | null;
        }>) ?? [],
      );

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
        setParceirosDisponiveis((parceirosResp.data || []) as Array<ParceiroLite>);
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

      // Mensagens (legacy chat) nao sao mais carregadas. Substituido por
      // comentarios desde Fase 48. Mantemos setMensagens vazio pra nao
      // quebrar nada se algum codigo antigo referenciar.
      setMensagens([]);

      // Carrega comentarios do caso com join no autor.
      const comentariosResp = await supabase
        .from("comentarios")
        .select(
          "id, caso_id, parent_id, autor_id, texto, created_at, autor:autor_id(id, nome, email, tipo)",
        )
        .eq("caso_id", casoId)
        .order("created_at", { ascending: true });
      if (!comentariosResp.error) {
        setComentarios((comentariosResp.data || []) as unknown as Array<ComentarioRow>);
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
        setProcessosJudiciais((procJudResp.data || []) as Array<ProcessoJudicial>);
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

  // Recarrega quando um sync (ex.: "Sincronizar tudo" do sino) termina, pra
  // refletir novos andamentos/vinculos sem o usuario dar refresh manual.
  useEffect(() => {
    function onSyncDone() {
      carregar();
    }
    window.addEventListener("msc:sync-done", onSyncDone);
    return () => window.removeEventListener("msc:sync-done", onSyncDone);
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
          <Link to="/casos">
            <ArrowLeft className="h-4 w-4 mr-2" />
            Voltar
          </Link>
        </Button>
        <Card>
          <CardContent className="py-12 text-center">
            <AlertCircle className="h-10 w-10 mx-auto text-muted-foreground mb-2" />
            <p className="text-sm text-muted-foreground">{erro || "Caso não encontrado"}</p>
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
            <Link to="/casos">
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

        <Tabs value={aba} onValueChange={setAba} className="w-full">
          {/* Tabs em uma unica linha com scroll horizontal em telas estreitas.
              Evita o efeito de "linhas quebradas" desorganizadas. */}
          <TabsList className="w-full flex justify-start overflow-x-auto">
            <TabsTrigger value="visao_geral" className="flex items-center gap-1 shrink-0">
              <Activity className="h-4 w-4" />
              <span>Visão geral</span>
            </TabsTrigger>
            <TabsTrigger value="documentos" className="flex items-center gap-1 shrink-0">
              <FileCheck className="h-4 w-4" />
              <span>Documentos</span>
            </TabsTrigger>
            <TabsTrigger value="atividades" className="flex items-center gap-1 shrink-0">
              <ListTodo className="h-4 w-4" />
              <span>{isInterno ? "Atividades" : "Andamentos"}</span>
            </TabsTrigger>
            {isInterno && (
              <TabsTrigger value="analise" className="flex items-center gap-1 shrink-0">
                <FileText className="h-4 w-4" />
                <span>Análise</span>
              </TabsTrigger>
            )}
            <TabsTrigger value="comentarios" className="flex items-center gap-1 shrink-0">
              <MessageSquare className="h-4 w-4" />
              <span>Comentários</span>
            </TabsTrigger>
            {REPASSES_ATIVO && (
              <TabsTrigger value="repasses" className="flex items-center gap-1 shrink-0">
                <DollarSign className="h-4 w-4" />
                <span>Repasses</span>
              </TabsTrigger>
            )}
            <TabsTrigger value="processos" className="flex items-center gap-1 shrink-0">
              <Scale className="h-4 w-4" />
              <span>Processos</span>
            </TabsTrigger>
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
            {casosCliente.length > 1 && (
              <div className="mt-4 rounded-lg border border-border bg-card p-4">
                <h3 className="mb-1 text-sm font-semibold">Casos deste cliente</h3>
                <p className="mb-3 text-xs text-muted-foreground">
                  Clique em um benefício para ver os andamentos daquele caso. O destacado é o que
                  você está vendo agora.
                </p>
                <div className="flex flex-wrap gap-2">
                  {casosCliente.map((oc) => {
                    const atual = oc.id === casoId;
                    const label = oc.tipo_beneficio ?? "(sem benefício)";
                    const status = (oc.status ?? "").replace(/_/g, " ");
                    if (atual) {
                      return (
                        <span
                          key={oc.id}
                          className="inline-flex items-center gap-2 rounded-md border border-gold/50 bg-gold-soft/40 px-3 py-1.5 text-sm font-medium text-foreground shadow-sm"
                          title="Caso atual"
                        >
                          {label}
                          <span className="text-[10px] uppercase tracking-wide text-foreground/60">
                            atual
                          </span>
                        </span>
                      );
                    }
                    return (
                      <Link
                        key={oc.id}
                        to="/casos/$id"
                        params={{ id: oc.id }}
                        search={{ tab: "andamentos" }}
                        className="inline-flex items-center gap-2 rounded-md border border-border px-3 py-1.5 text-sm hover:bg-muted/60"
                        title={"Ver andamentos: " + label + " (" + status + ")"}
                      >
                        {label}
                        <span className="text-xs capitalize text-muted-foreground">{status}</span>
                      </Link>
                    );
                  })}
                </div>
              </div>
            )}
          </TabsContent>

          <TabsContent value="documentos" className="mt-4">
            <TabDocumentos
              casoId={casoId}
              documentos={documentos}
              solicitacoes={solicitacoes}
              isInterno={isInterno}
              usuarioId={usuario ? usuario.id : null}
              gdriveFolderId={caso.gdrive_folder_id ?? null}
              gdriveFolderName={caso.gdrive_folder_name ?? null}
              focoId={search.foco}
              onChange={carregar}
            />
          </TabsContent>

          <TabsContent value="atividades" className="mt-4">
            <div
              className={
                isInterno ? "grid gap-6 lg:grid-cols-2" : "grid gap-6 grid-cols-1"
              }
            >
              {isInterno && (
                <div className="min-w-0">
                  <CasoTarefasTab casoId={casoId} onChange={carregar} />
                </div>
              )}
              <div className="min-w-0">
                <TabAndamentos
                  casoId={casoId}
                  andamentos={andamentos}
                  processosAdmin={processosAdmin}
                  processosJudiciais={processosJudiciais}
                  isInterno={isInterno}
                  temParceiro={caso.parceiro_id !== null}
                  usuarioId={usuario ? usuario.id : null}
                  focoId={search.foco}
                  onChange={carregar}
                />
              </div>
            </div>
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

          <TabsContent value="comentarios" className="mt-4">
            <TabComentarios
              casoId={casoId}
              comentarios={comentarios}
              setComentarios={setComentarios}
              usuarioId={usuario ? usuario.id : null}
              temParceiro={caso.parceiro_id !== null}
              focoId={search.foco}
            />
          </TabsContent>

          {REPASSES_ATIVO && (
            <TabsContent value="repasses" className="mt-4">
              <TabRepasses
                casoId={casoId}
                repasses={repasses}
                parceiroId={parceiro ? parceiro.id : null}
                isInterno={isInterno}
                onChange={carregar}
              />
            </TabsContent>
          )}

          <TabsContent value="processos" className="mt-4">
            <TabProcessos
              casoId={casoId}
              cliente={cliente}
              usuarioId={usuario ? usuario.id : null}
              isInterno={isInterno}
              processosAdmin={processosAdmin}
              processosJudiciais={processosJudiciais}
              focoId={search.foco}
              onChange={carregar}
            />
          </TabsContent>
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
  const { caso, cliente, isInterno, usuarioId, processosJudiciais, onChange } = props;
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
        toast.error("Cliente não encontrado no Tramitação Inteligente");
      } else if (r.atualizado) {
        const tags = r.tags_aplicadas || 0;
        const notasNovas = r.notas_importadas || 0;
        const notasJa = r.notas_ja_existentes || 0;
        let msg =
          "Sincronizado com TI. " +
          tags +
          " tag" +
          (tags === 1 ? "" : "s") +
          " aplicada" +
          (tags === 1 ? "" : "s") +
          ".";
        if (notasNovas > 0) {
          msg +=
            " " +
            notasNovas +
            " nota" +
            (notasNovas === 1 ? "" : "s") +
            " do TI importada" +
            (notasNovas === 1 ? "" : "s") +
            " como andamento" +
            (notasNovas === 1 ? "" : "s") +
            ".";
        }
        if (notasJa > 0) {
          msg += " " + notasJa + " ja existia" + (notasJa === 1 ? "" : "m") + " (dedup).";
        }
        toast.success(msg);
        onChange();
        if (typeof window !== "undefined") {
          window.dispatchEvent(new CustomEvent("msc:sync-done"));
        }
      } else {
        toast.error(r.motivo || "Não foi possível sincronizar");
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
    const idprocessos = procsComLM.map((p) => Number(p.legalmail_id)).filter((n) => !isNaN(n));
    if (idprocessos.length === 0) {
      toast.error("Erro ao ler IDs do Legalmail dos processos vinculados.");
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
        pa +
        " processo" +
        (pa === 1 ? "" : "s") +
        " atualizado" +
        (pa === 1 ? "" : "s") +
        ". " +
        mi +
        " movimentaç" +
        (mi === 1 ? "ão" : "ões") +
        " nova" +
        (mi === 1 ? "" : "s");
      if (mj > 0) {
        msg += " (" + mj + " já existia" + (mj === 1 ? "" : "m") + ")";
      }
      if (mig > 0) {
        msg +=
          ". " +
          mig +
          " mov" +
          (mig === 1 ? "" : "s") +
          " ignorada" +
          (mig === 1 ? "" : "s") +
          " pela whitelist";
      }
      msg += ".";
      toast.success(msg);
      if (r.erros && r.erros.length > 0) {
        console.warn("erros no sync Legalmail:", r.erros);
        toast.warning(r.erros.length + " erro(s) durante sync. Ver console.");
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

  const cpfFormatado = isInterno ? maskCPF(cliente.cpf) : maskCPFParceiro(cliente.cpf);

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
                  aria-label="Ações do caso"
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
                  title="Sincronizar tags e dados com Tramitação Inteligente"
                >
                  {syncing && <Loader2 className="h-3 w-3 mr-2 animate-spin" />}
                  Sync TI
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={syncLegalmail}
                  disabled={syncingLM}
                  title="Atualizar movimentações dos processos Legalmail vinculados"
                >
                  {syncingLM && <Loader2 className="h-3 w-3 mr-2 animate-spin" />}
                  Sync Legal
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
        {/* Linha 2: etiquetas do cliente (editáveis pelo interno via popover). */}
        <EtiquetasCliente clienteId={cliente.id} isInterno={isInterno} />
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
  const { caso, cliente, parceiro, parceirosDisponiveis, isInterno, onChange } = props;
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
    // Edicao unificada: prefill tambem os dados do caso.
    setCsTipoBeneficio(caso.tipo_beneficio);
    setCsInterno(caso.parceiro_id === null);
    setCsParceiroId(caso.parceiro_id || "");
    setCsFase(caso.fase);
    setCsStatus(caso.status);
    setAbrirEditCliente(true);
  }

  async function salvarCliente() {
    if (!clNome.trim()) {
      toast.error("Nome obrigatório");
      return;
    }
    if (!csTipoBeneficio) {
      toast.error("Tipo de benefício obrigatório");
      return;
    }
    if (!csInterno && !csParceiroId) {
      toast.error("Selecione um parceiro indicador ou marque como cliente interno");
      return;
    }
    setClSalvando(true);
    try {
      // Atualiza o caso (edicao unificada cliente + caso).
      const respCaso = await supabase
        .from("casos")
        .update({
          tipo_beneficio: csTipoBeneficio,
          parceiro_id: csInterno ? null : csParceiroId,
          fase: csFase,
          status: csStatus,
        })
        .eq("id", caso.id)
        .select();
      if (respCaso.error) throw respCaso.error;

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
        toast.error("Atualização não foi aplicada. Possível bloqueio de RLS.");
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
            "Cliente atualizado, mas a senha MEU INSS não foi salva: " +
              (senhaResp.error.message || "erro desconhecido"),
          );
        } else {
          toast.success(clTemSenha ? "Senha MEU INSS substituída" : "Senha MEU INSS cadastrada");
        }
      }
      toast.success("Cliente e caso atualizados");
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
        const remResp = await supabase.storage.from("documentos").remove(paths);
        if (remResp.error) {
          // Banco ja apagado - so deixa warning sobre lixo no storage.
          console.warn("Cliente excluido, mas arquivos do storage falharam:", remResp.error);
        }
      }

      toast.success("Cliente e dados vinculados excluídos.");
      setConfExcluirCliente(false);
      setAbrirEditCliente(false);
      navigate({ to: "/casos" });
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
      toast.success(senhaParcTemSenha ? "Senha MEU INSS substituída" : "Senha MEU INSS cadastrada");
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
      toast.error("Não foi possível copiar (clipboard bloqueado)");
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
      toast.error("Tipo de benefício obrigatório");
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
        toast.error("Atualização não foi aplicada. Possível bloqueio de RLS.");
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
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between gap-2">
              <CardTitle className="text-base">Dados do cliente</CardTitle>
              {isInterno && (
                <Button size="sm" variant="outline" onClick={abrirDialogCliente}>
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
              valor={isInterno ? maskCPF(cliente.cpf) : maskCPFParceiro(cliente.cpf)}
            />
            <Linha label="Nascimento" valor={formatDate(cliente.data_nascimento)} />
            {isInterno && <Linha label="Telefone" valor={cliente.telefone || "-"} />}
            {isInterno && <Linha label="E-mail" valor={cliente.email || "-"} />}
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
                <Button size="sm" variant="outline" onClick={abrirAlterarSenhaParceiro}>
                  <Pencil className="h-3.5 w-3.5 mr-1" />
                  Alterar
                </Button>
              </div>
            )}
            {cliente.observacoes && (
              <div className="pt-2 border-t">
                <p className="text-xs text-muted-foreground mb-1">Observações</p>
                <p className="text-sm whitespace-pre-wrap">{cliente.observacoes}</p>
              </div>
            )}
          </CardContent>
          {isInterno && (
            <Dialog open={abrirEditCliente} onOpenChange={setAbrirEditCliente}>
              <DialogContent className="max-h-[90vh] overflow-y-auto">
                <DialogHeader>
                  <DialogTitle>Editar cliente e caso</DialogTitle>
                  <DialogDescription>
                    Dados do cliente e do caso num só lugar. CPF não pode ser alterado (chave única
                    vinculada ao TI).
                  </DialogDescription>
                </DialogHeader>
                <div className="space-y-3">
                  <div>
                    <Label className="text-xs">Nome</Label>
                    <Input value={clNome} onChange={(e) => setClNome(e.target.value)} />
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
                    <Input value={clTelefone} onChange={(e) => setClTelefone(e.target.value)} />
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
                    <Label className="text-xs">Observações</Label>
                    <Textarea
                      rows={3}
                      value={clObservacoes}
                      onChange={(e) => setClObservacoes(e.target.value)}
                    />
                  </div>

                  {/* ---- Dados do caso (edicao unificada) ---- */}
                  <div className="border-t pt-3 space-y-3">
                    <p className="text-sm font-medium">Dados do caso</p>
                    <div>
                      <Label className="text-xs">Tipo de benefício</Label>
                      <Select value={csTipoBeneficio} onValueChange={setCsTipoBeneficio}>
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
                    <div className="flex items-start gap-2">
                      <input
                        id="cl-cs-interno"
                        type="checkbox"
                        checked={csInterno}
                        onChange={(e) => {
                          setCsInterno(e.target.checked);
                          if (e.target.checked) setCsParceiroId("");
                        }}
                        className="h-4 w-4 mt-0.5"
                      />
                      <Label htmlFor="cl-cs-interno" className="text-sm">
                        Cliente interno do escritório (sem parceiro indicador)
                      </Label>
                    </div>
                    {!csInterno && (
                      <div>
                        <Label className="text-xs">Parceiro indicador</Label>
                        <Select value={csParceiroId} onValueChange={setCsParceiroId}>
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
                    <div className="grid grid-cols-2 gap-3">
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

                  {/* Senha MEU INSS - sempre vazio. Vazio = manter, preenchido =
                    substituir via RPC criptografada. Status atual (ja tem ou
                    nao) eh mostrado em texto auxiliar. */}
                  <div className="pt-3 border-t">
                    <Label className="text-xs flex items-center gap-1">
                      <KeyRound className="h-3.5 w-3.5" />
                      Senha MEU INSS{" "}
                      <span className="text-muted-foreground font-normal">
                        ({clTemSenha ? "já cadastrada - será substituída" : "não cadastrada"})
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
                      Criptografada no banco. Toda escrita e leitura ficam registradas em auditoria.
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
                      {clSalvando && <Loader2 className="h-3 w-3 mr-2 animate-spin" />}
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
                  <AlertDialogTitle>Excluir {cliente.nome}?</AlertDialogTitle>
                  <AlertDialogDescription asChild>
                    <div className="space-y-2 text-sm">
                      <p>
                        Esta ação é <strong>irreversível</strong>. Será removido:
                      </p>
                      <ul className="list-disc pl-5 space-y-0.5 text-muted-foreground">
                        <li>O cliente e todos os dados cadastrais</li>
                        <li>Todos os casos vinculados</li>
                        <li>Todos os documentos, andamentos e solicitações</li>
                        <li>Conversas, repasses e processos do caso</li>
                        <li>Senha MEU INSS criptografada (se houver)</li>
                      </ul>
                      <p className="text-xs text-muted-foreground">
                        O log de auditoria do acesso a senhas é preservado.
                      </p>
                    </div>
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel disabled={excluindoCliente}>Cancelar</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={(e) => {
                      e.preventDefault();
                      excluirCliente();
                    }}
                    disabled={excluindoCliente}
                    className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                  >
                    {excluindoCliente && <Loader2 className="h-3 w-3 mr-2 animate-spin" />}
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
                    Acesso registrado em auditoria. A senha é confidencial - use apenas no portal
                    MEU INSS do cliente.
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
                      Este cliente não tem senha do MEU INSS cadastrada.
                    </p>
                  )}
                  {!carregandoSenha && !erroSenha && senhaValor !== null && (
                    <div className="space-y-2">
                      <Label className="text-xs">Senha</Label>
                      <div className="flex items-center gap-2">
                        <Input value={senhaValor} readOnly className="font-mono" />
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
                    {senhaParcTemSenha ? "Substituir senha MEU INSS" : "Cadastrar senha MEU INSS"}
                  </DialogTitle>
                  <DialogDescription className="text-xs text-warning bg-warning/10 border border-warning/30 rounded p-2 mt-1">
                    {senhaParcTemSenha
                      ? "Já existe uma senha cadastrada para este cliente. Ao salvar, ela será SUBSTITUÍDA pela nova. Esta ação fica registrada em auditoria."
                      : "A senha será criptografada no banco. Você não poderá consultar depois - apenas substituir. Ação registrada em auditoria."}
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
                    {senhaParcSalvando && <Loader2 className="h-3 w-3 mr-2 animate-spin" />}
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
                Altere os dados do caso, parceiro indicador, fase, status e valores estimados.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-3">
              <div>
                <Label className="text-xs">Tipo de beneficio</Label>
                <Select value={csTipoBeneficio} onValueChange={setCsTipoBeneficio}>
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
                      Cliente interno do escritório (sem parceiro indicador)
                    </Label>
                    <p className="text-xs text-muted-foreground">
                      Marque se não há advogado parceiro captando este caso.
                    </p>
                  </div>
                </div>
                {!csInterno && (
                  <div>
                    <Label className="text-xs">Parceiro indicador</Label>
                    <Select value={csParceiroId} onValueChange={setCsParceiroId}>
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
              <Button variant="ghost" onClick={() => setAbrirEditCaso(false)} disabled={csSalvando}>
                Cancelar
              </Button>
              <Button onClick={salvarCaso} disabled={csSalvando}>
                {csSalvando && <Loader2 className="h-3 w-3 mr-2 animate-spin" />}
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
      <span className="text-xs text-muted-foreground min-w-[7rem]">{props.label}:</span>
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
  focoId?: string;
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
    focoId,
    onChange,
  } = props;
  const foco = useFocoItem(focoId);
  // Destaque global pra andamentos recém-criados (etapas, dialog novo, etc).
  const { ativos: destaquesAtivos, marcar: marcarDestaque } = useDestaque();
  // States do dialog "Novo andamento"
  // tipoDialogoNovo: null = fechado; "admin" ou "judicial" = aberto com tipo pre-definido
  const [tipoDialogoNovo, setTipoDialogoNovo] = useState<"admin" | "judicial" | null>(null);
  const [titulo, setTitulo] = useState("");
  const [descricao, setDescricao] = useState("");
  const [visivelParceiro, setVisivelParceiro] = useState(true);
  const [processoVinculo, setProcessoVinculo] = useState(PROCESSO_NENHUM);
  const [salvando, setSalvando] = useState(false);
  const [togglandoVisId, setTogglandoVisId] = useState<string | null>(null);

  // Alterna a visibilidade do andamento para o parceiro (interno <-> visivel).
  async function toggleVisivelParceiro(a: Andamento) {
    const novo = !a.visivel_parceiro;
    setTogglandoVisId(a.id);
    try {
      const resp = await supabase
        .from("andamentos")
        .update({ visivel_parceiro: novo })
        .eq("id", a.id);
      if (resp.error) throw resp.error;
      toast.success(
        novo ? "Andamento agora visível ao parceiro" : "Andamento marcado como interno",
      );
      onChange();
    } catch (err) {
      console.error(err);
      const errObj = err as { message?: string };
      toast.error(errObj.message || "Erro ao alterar visibilidade");
    } finally {
      setTogglandoVisId(null);
    }
  }

  // States dos accordions (qual processo esta expandido em cada card)
  const [expandidosAdmin, setExpandidosAdmin] = useState<Set<string>>(new Set());
  const [expandidosJud, setExpandidosJud] = useState<Set<string>>(new Set());
  // Accordions especiais "Sem processo" / "Sem vinculo" (1 unico bool cada)
  const [abertoSemProcessoAdmin, setAbertoSemProcessoAdmin] = useState(false);
  const [abertoSemVinculoGerais, setAbertoSemVinculoGerais] = useState(false);

  // Qual andamento está aberto (expansão inline com texto completo).
  // Apenas UM andamento por vez. Click fora fecha automaticamente.
  const [andamentoAbertoId, setAndamentoAbertoId] = useState<string | null>(null);
  useEffect(() => {
    if (!andamentoAbertoId) return;
    function onDocMouseDown(ev: MouseEvent) {
      const el = document.getElementById("foco-" + andamentoAbertoId);
      if (el && !el.contains(ev.target as Node)) {
        setAndamentoAbertoId(null);
      }
    }
    document.addEventListener("mousedown", onDocMouseDown);
    return () => document.removeEventListener("mousedown", onDocMouseDown);
  }, [andamentoAbertoId]);

  // Heurística: descrição "longa" o suficiente pra valer o botão "Ler mais".
  function descricaoEhLonga(s: string | null): boolean {
    if (!s) return false;
    if (s.length > 180) return true;
    return (s.match(/\n/g) ?? []).length >= 3;
  }

  // Ao chegar via notificacao (?foco=<andamento>), expande o accordion que
  // contem o andamento pra ele ficar visivel (e o destaque rola ate ele).
  useEffect(() => {
    if (!focoId) return;
    const a = andamentos.find((x) => x.id === focoId);
    if (!a) return;
    if (a.processo_admin_id) {
      setExpandidosAdmin((prev) => new Set(prev).add(a.processo_admin_id!));
    } else if (a.processo_judicial_id) {
      setExpandidosJud((prev) => new Set(prev).add(a.processo_judicial_id!));
    } else if (a.origem === "tramitacao") {
      setAbertoSemProcessoAdmin(true);
    } else {
      setAbertoSemVinculoGerais(true);
    }
  }, [focoId, andamentos]);

  // Multi-select para transferencia de andamentos sem vinculo
  const [selecionadosSemProc, setSelecionadosSemProc] = useState<Set<string>>(new Set());
  const [selecionadosGerais, setSelecionadosGerais] = useState<Set<string>>(new Set());
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
  async function transferirAndamentos(ids: Set<string>, destino: string, onSuccess: () => void) {
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
      toast.error("Destino inválido");
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
        toast.error("Transferência não aplicada. Possível bloqueio de permissão.");
        return;
      }
      toast.success(
        n + " andamento" + (n === 1 ? "" : "s") + " transferido" + (n === 1 ? "" : "s") + ".",
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
      return "Admin: " + (p?.numero_requerimento || "(sem número)");
    }
    if (a.processo_judicial_id) {
      const p = processosJudiciais.find((x) => x.id === a.processo_judicial_id);
      return "Judicial: " + (p?.numero_processo || "(sem número)");
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
      toast.error("Título obrigatório");
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
        toast.error("Atualização não foi aplicada. Possível bloqueio de permissão. Avise o admin.");
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
        "Essa ação não pode ser desfeita.",
    );
    if (!ok) return;
    try {
      // .select() faz o Postgres retornar as linhas deletadas.
      // Se vier vazio, e porque RLS impediu silenciosamente o DELETE.
      const resp = await supabase.from("andamentos").delete().eq("id", a.id).select();
      if (resp.error) throw resp.error;
      if (!resp.data || resp.data.length === 0) {
        toast.error(
          "Exclusão não foi aplicada. Possível bloqueio de permissão " +
            "(andamento sem dono ou RLS). Tente fazer Sync TI novamente " +
            "para corrigir o vínculo de criador.",
        );
        return;
      }
      toast.success("Andamento excluído");
      onChange();
    } catch (err) {
      console.error(err);
      const errObj = err as { message?: string };
      toast.error(errObj.message || "Erro ao excluir andamento");
    }
  }

  const lista = isInterno ? andamentos : andamentos.filter((a) => a.visivel_parceiro === true);

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

      const visivelFinal = temParceiro ? visivelParceiro : false;
      const resp = await supabase
        .from("andamentos")
        .insert({
          caso_id: casoId,
          origem: "interno",
          titulo: titulo.trim(),
          descricao: descricao.trim() || null,
          data_evento: new Date().toISOString(),
          criado_por: usuarioId,
          visivel_parceiro: visivelFinal,
          processo_admin_id: processoAdminId,
          processo_judicial_id: processoJudicialId,
        })
        .select("id")
        .single();
      if (resp.error) throw resp.error;
      const novoAndamentoId = (resp.data as { id: string } | null)?.id;
      if (novoAndamentoId) marcarDestaque(novoAndamentoId);

      // Dispara email pro parceiro se andamento visivel. Fire-and-forget.
      // A edge function valida visivel_parceiro=true e parceiro_id antes de
      // realmente enviar - aqui so chamamos sempre que visivel pra simplificar.
      if (visivelFinal && novoAndamentoId) {
        supabase.functions
          .invoke("notify-novo-andamento", {
            body: { andamento_id: novoAndamentoId },
          })
          .then((r) => {
            if (r.error) console.warn("notify-novo-andamento:", r.error);
          });
      }

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
      a.origem === "tramitacao" && a.processo_admin_id === null && a.processo_judicial_id === null,
  );
  const andamentosManuaisSemVinculo = lista.filter(
    (a) =>
      a.origem !== "tramitacao" && a.processo_admin_id === null && a.processo_judicial_id === null,
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

  // Abre o dialog "Novo andamento" ja vinculado a UM processo especifico
  // (botao "+ Andamento" no cabecalho de cada card de processo).
  function abrirNovoNoProcesso(tipo: "admin" | "judicial", processoId: string) {
    setTipoDialogoNovo(tipo);
    setTitulo("");
    setDescricao("");
    setVisivelParceiro(true);
    setProcessoVinculo((tipo === "admin" ? "admin:" : "judicial:") + processoId);
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
            {isInterno && temParceiro && (
              <Button
                type="button"
                size="sm"
                variant={a.visivel_parceiro ? "secondary" : "outline"}
                className="h-6 px-2 text-xs"
                disabled={togglandoVisId === a.id}
                onClick={() => toggleVisivelParceiro(a)}
                title={
                  a.visivel_parceiro
                    ? "Visível ao parceiro - clique para tornar interno"
                    : "Interno - clique para tornar visível ao parceiro"
                }
              >
                {togglandoVisId === a.id ? (
                  <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                ) : a.visivel_parceiro ? (
                  <Eye className="h-3 w-3 mr-1" />
                ) : (
                  <EyeOff className="h-3 w-3 mr-1" />
                )}
                {a.visivel_parceiro ? "visível parceiro" : "interno"}
              </Button>
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
          <div className="mt-1">
            <p
              className={
                "text-sm whitespace-pre-wrap text-muted-foreground " +
                (andamentoAbertoId === a.id ? "" : "line-clamp-3")
              }
            >
              {a.descricao}
            </p>
            {(descricaoEhLonga(a.descricao) || andamentoAbertoId === a.id) && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setAndamentoAbertoId(andamentoAbertoId === a.id ? null : a.id);
                }}
                className="mt-1 text-xs underline text-muted-foreground hover:text-foreground"
              >
                {andamentoAbertoId === a.id ? "Fechar" : "Ler mais"}
              </button>
            )}
          </div>
        )}
      </div>
    );
  }

  // Helper: renderiza um item de andamento (usado nos accordions de processo)
  function renderItemAndamento(a: Andamento) {
    const destacadoGlobal = destaquesAtivos.has(a.id);
    return (
      <li
        key={a.id}
        id={"foco-" + a.id}
        className={
          "border-l-2 border-muted pl-3 py-1 " +
          (foco === a.id ? DESTAQUE_CLASSE : "") +
          (destacadoGlobal ? " " + DESTAQUE_CLASSE_GLOBAL : "")
        }
      >
        {renderItemAndamentoInner(a)}
      </li>
    );
  }

  // Helper: renderiza um accordion de processo (header com chevron + lista de andamentos)
  // Ordena uma lista de processos por hierarquia (raiz primeiro, filhos
  // aninhados depois), retornando o nivel (depth) de cada um pra indentar.
  function ordenarPorHierarquia<T extends { id: string; parent_id: string | null }>(
    lista: Array<T>,
  ): Array<{ item: T; depth: number }> {
    const ids = new Set(lista.map((x) => x.id));
    const filhosPorPai = new Map<string, Array<T>>();
    const raizes: Array<T> = [];
    for (const x of lista) {
      if (x.parent_id && ids.has(x.parent_id)) {
        const arr = filhosPorPai.get(x.parent_id) || [];
        arr.push(x);
        filhosPorPai.set(x.parent_id, arr);
      } else {
        raizes.push(x);
      }
    }
    const out: Array<{ item: T; depth: number }> = [];
    function visita(x: T, depth: number) {
      out.push({ item: x, depth });
      for (const f of filhosPorPai.get(x.id) || []) visita(f, depth + 1);
    }
    for (const r of raizes) visita(r, 0);
    return out;
  }

  function renderAccordion(
    label: string,
    processoId: string,
    ands: Array<Andamento>,
    aberto: boolean,
    onToggle: () => void,
    tipo: "admin" | "judicial",
    depth = 0,
  ) {
    return (
      <div
        key={processoId}
        className="border rounded-md overflow-hidden"
        style={depth > 0 ? { marginLeft: depth * 16 } : undefined}
      >
        <div className="w-full flex items-center justify-between gap-2 p-3 hover:bg-muted/50 transition-colors">
          <button
            type="button"
            onClick={onToggle}
            className="flex items-center gap-2 min-w-0 flex-1 text-left"
          >
            {aberto ? (
              <ChevronDown className="h-4 w-4 shrink-0" />
            ) : (
              <ChevronRight className="h-4 w-4 shrink-0" />
            )}
            <span className="text-sm font-medium truncate">{label}</span>
          </button>
          <div className="flex items-center gap-2 shrink-0">
            <span className="text-xs text-muted-foreground">
              {ands.length} andamento{ands.length === 1 ? "" : "s"}
            </span>
            {/* Botao "+ Andamento" por processo - so para a equipe interna. */}
            {isInterno && (
              <Button
                size="sm"
                variant="outline"
                className="h-7 px-2"
                onClick={() => abrirNovoNoProcesso(tipo, processoId)}
                title="Adicionar andamento a este processo"
              >
                <Plus className="h-3.5 w-3.5" />
                <span className="ml-1 hidden sm:inline text-xs">Andamento</span>
              </Button>
            )}
          </div>
        </div>
        {aberto && (
          <div className="border-t p-3">
            {ands.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-2">
                Nenhum andamento registrado para este processo.
              </p>
            ) : (
              // Janela ~3 cards visíveis (com line-clamp-3 cada um fica ~140px);
              // scroll vertical pros demais.
              <ul className="space-y-3 max-h-[28rem] overflow-y-auto pr-1">
                {ands.map(renderItemAndamento)}
              </ul>
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
  // Mostrar sempre que há pelo menos 1 processo do tipo (Naira sempre
  // confirma/escolhe a vinculação; permite também escolher "Nenhum").
  const mostrarSelectProcessoDialog = tipoDialogoNovo !== null && processosDoTipoDialog.length >= 1;

  return (
    <div className="space-y-4">
      {/* ---- Card Andamentos administrativos ---- */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-2">
            <div>
              <CardTitle className="text-base">Andamentos Administrativos</CardTitle>
              <CardDescription>Movimentações vinculadas a processos do INSS.</CardDescription>
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
              Nenhum processo administrativo cadastrado. Cadastre na aba Processos para registrar
              andamentos.
            </p>
          )}
          {(processosAdmin.length > 0 || notasTISemVinculo.length > 0) && (
            <div className="space-y-2">
              {/* Accordion por processo admin, em ordem de hierarquia
                  (principal primeiro, sub-processos aninhados embaixo) */}
              {ordenarPorHierarquia(processosAdmin).map(({ item: p, depth }) => {
                const ands = andamentosAdmin.filter((a) => a.processo_admin_id === p.id);
                const extras = [p.etapa_tipo, p.tipo_beneficio].filter(Boolean);
                const label =
                  "Admin: " +
                  (p.numero_requerimento || "(sem número)") +
                  (extras.length ? " · " + extras.join(" · ") : "");
                return renderAccordion(
                  label,
                  p.id,
                  ands,
                  expandidosAdmin.has(p.id),
                  () => toggleAccordionAdmin(p.id),
                  "admin",
                  depth,
                );
              })}

              {/* Sub-secao "Sem processo" para notas TI sem vinculo */}
              {notasTISemVinculo.length > 0 && (
                <div className="border rounded-md overflow-hidden border-dashed">
                  <button
                    type="button"
                    onClick={() => setAbertoSemProcessoAdmin(!abertoSemProcessoAdmin)}
                    className="w-full flex items-center justify-between p-3 hover:bg-muted/50 transition-colors text-left"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      {abertoSemProcessoAdmin ? (
                        <ChevronDown className="h-4 w-4 shrink-0" />
                      ) : (
                        <ChevronRight className="h-4 w-4 shrink-0" />
                      )}
                      <span className="text-sm font-medium truncate">Sem processo</span>
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
                            <Label className="text-xs">Transferir selecionados para</Label>
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
                                  <SelectItem key={"a-" + p.id} value={"admin:" + p.id}>
                                    Admin: {p.numero_requerimento || "(sem número)"}
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
                            {transferindo && <Loader2 className="h-3 w-3 mr-2 animate-spin" />}
                            Transferir ({selecionadosSemProc.size})
                          </Button>
                        </div>
                      )}
                      {/* Lista de andamentos com checkbox */}
                      <ul className="space-y-3 p-3">
                        {notasTISemVinculo.map((a) => (
                          <li
                            key={a.id}
                            id={"foco-" + a.id}
                            className={
                              "border-l-2 border-muted pl-3 py-1 " +
                              (foco === a.id ? DESTAQUE_CLASSE : "")
                            }
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
                              <div className="flex-1 min-w-0">{renderItemAndamentoInner(a)}</div>
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
                <CardTitle className="text-base">Andamentos Judiciais</CardTitle>
                <CardDescription>Movimentações vinculadas a processos judiciais.</CardDescription>
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
              {ordenarPorHierarquia(processosJudiciais).map(({ item: p, depth }) => {
                const ands = andamentosJud.filter((a) => a.processo_judicial_id === p.id);
                const label =
                  "Judicial: " +
                  (p.numero_processo || "(sem número)") +
                  (p.etapa_tipo ? " · " + p.etapa_tipo : "");
                return renderAccordion(
                  label,
                  p.id,
                  ands,
                  expandidosJud.has(p.id),
                  () => toggleAccordionJud(p.id),
                  "judicial",
                  depth,
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
              Movimentações manuais sem vínculo a processo. Selecione e transfira para um processo,
              ou edite individualmente pelo lápis.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {/* Barra de transferencia */}
            {isInterno && (processosAdmin.length > 0 || processosJudiciais.length > 0) && (
              <div className="bg-muted/30 p-3 border rounded-md mb-3 flex items-end gap-2 flex-wrap">
                <div className="flex-1 min-w-[200px]">
                  <Label className="text-xs">Transferir selecionados para</Label>
                  <Select value={destinoTransfGerais} onValueChange={setDestinoTransfGerais}>
                    <SelectTrigger>
                      <SelectValue placeholder="Selecione um processo..." />
                    </SelectTrigger>
                    <SelectContent>
                      {processosAdmin.map((p) => (
                        <SelectItem key={"a-" + p.id} value={"admin:" + p.id}>
                          Admin: {p.numero_requerimento || "(sem número)"}
                        </SelectItem>
                      ))}
                      {processosJudiciais.map((p) => (
                        <SelectItem key={"j-" + p.id} value={"judicial:" + p.id}>
                          Judicial: {p.numero_processo || "(sem número)"}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <Button
                  size="sm"
                  onClick={() =>
                    transferirAndamentos(selecionadosGerais, destinoTransfGerais, () => {
                      setSelecionadosGerais(new Set());
                      setDestinoTransfGerais("");
                    })
                  }
                  disabled={transferindo || selecionadosGerais.size === 0 || !destinoTransfGerais}
                >
                  {transferindo && <Loader2 className="h-3 w-3 mr-2 animate-spin" />}
                  Transferir ({selecionadosGerais.size})
                </Button>
              </div>
            )}
            <ul className="space-y-3">
              {andamentosManuaisSemVinculo.map((a) => (
                <li
                  key={a.id}
                  id={"foco-" + a.id}
                  className={
                    "border-l-2 border-muted pl-3 py-1 " + (foco === a.id ? DESTAQUE_CLASSE : "")
                  }
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
                    <div className="flex-1 min-w-0">{renderItemAndamentoInner(a)}</div>
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
                Novo andamento {isAdminDialog ? "administrativo" : isJudDialog ? "judicial" : ""}
              </DialogTitle>
              <DialogDescription>Registre uma movimentação manual no caso.</DialogDescription>
            </DialogHeader>
            <div className="space-y-3">
              <div>
                <Label className="text-xs">Título</Label>
                <Input
                  placeholder="Ex.: Documentos recebidos"
                  value={titulo}
                  onChange={(e) => setTitulo(e.target.value)}
                />
              </div>
              <div>
                <Label className="text-xs">Descrição (opcional)</Label>
                <Textarea
                  rows={4}
                  placeholder="Detalhe da movimentação..."
                  value={descricao}
                  onChange={(e) => setDescricao(e.target.value)}
                />
              </div>
              {mostrarSelectProcessoDialog && (
                <div>
                  <Label className="text-xs">Processo</Label>
                  <Select value={processoVinculo} onValueChange={setProcessoVinculo}>
                    <SelectTrigger>
                      <SelectValue placeholder="Selecione o processo..." />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={PROCESSO_NENHUM}>Nenhum (sem vínculo)</SelectItem>
                      {isAdminDialog &&
                        processosAdmin.map((p) => (
                          <SelectItem key={"a-" + p.id} value={"admin:" + p.id}>
                            Admin: {p.numero_requerimento || "(sem número)"}
                          </SelectItem>
                        ))}
                      {isJudDialog &&
                        processosJudiciais.map((p) => (
                          <SelectItem key={"j-" + p.id} value={"judicial:" + p.id}>
                            Judicial: {p.numero_processo || "(sem número)"}
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
                    Visível para o parceiro indicador
                  </Label>
                </div>
              )}
            </div>
            <DialogFooter>
              <Button variant="ghost" onClick={() => setTipoDialogoNovo(null)} disabled={salvando}>
                Cancelar
              </Button>
              <Button onClick={adicionar} disabled={salvando}>
                {salvando && <Loader2 className="h-3 w-3 mr-2 animate-spin" />}
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
                Altere o conteúdo, vinculação com processo e visibilidade.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-3">
              <div>
                <Label className="text-xs">Título</Label>
                <Input value={editTitulo} onChange={(e) => setEditTitulo(e.target.value)} />
              </div>
              <div>
                <Label className="text-xs">Descrição (opcional)</Label>
                <Textarea
                  rows={5}
                  value={editDescricao}
                  onChange={(e) => setEditDescricao(e.target.value)}
                />
              </div>
              {temProcessos && !processoUnico && (
                <div>
                  <Label className="text-xs">Processo (opcional)</Label>
                  <Select value={editProcessoVinculo} onValueChange={setEditProcessoVinculo}>
                    <SelectTrigger>
                      <SelectValue placeholder="Vincular a um processo..." />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={PROCESSO_NENHUM}>Nenhum</SelectItem>
                      {processosAdmin.map((p) => (
                        <SelectItem key={"a-" + p.id} value={"admin:" + p.id}>
                          Admin: {p.numero_requerimento || "(sem número)"}
                        </SelectItem>
                      ))}
                      {processosJudiciais.map((p) => (
                        <SelectItem key={"j-" + p.id} value={"judicial:" + p.id}>
                          Judicial: {p.numero_processo || "(sem número)"}
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
                  <Label htmlFor="edit-visivel-parceiro" className="text-sm">
                    Visível para o parceiro indicador
                  </Label>
                </div>
              )}
            </div>
            <DialogFooter>
              <Button variant="ghost" onClick={fecharEdicao} disabled={editSalvando}>
                Cancelar
              </Button>
              <Button onClick={salvarEdicao} disabled={editSalvando}>
                {editSalvando && <Loader2 className="h-3 w-3 mr-2 animate-spin" />}
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
  gdriveFolderId: string | null;
  gdriveFolderName: string | null;
  focoId?: string;
  onChange: () => void;
}

function TabDocumentos(props: TabDocumentosProps) {
  const {
    casoId,
    documentos,
    solicitacoes,
    isInterno,
    usuarioId,
    gdriveFolderId,
    gdriveFolderName,
    focoId,
    onChange,
  } = props;
  const foco = useFocoItem(focoId);
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
  // Nome editavel do arquivo a ser salvo. Pre-preenchido com nomearArquivo
  // (auto-renomeacao baseada no tipo da solicitacao), mas o parceiro pode
  // editar pra dar nome mais descritivo (ex.: "RG_Joao_2024.pdf").
  const [nomeArquivoEdit, setNomeArquivoEdit] = useState<string>("");
  const [comAnexo, setComAnexo] = useState(false);
  // Estado do accordion "Solicitações cumpridas"
  const [cumpridasAberto, setCumpridasAberto] = useState(false);
  // Preview de documento (parceiro: visualizar sem baixar)
  const [previewDoc, setPreviewDoc] = useState<{ doc: Documento; url: string } | null>(null);
  const [carregandoPreview, setCarregandoPreview] = useState(false);
  // Multi-select de documentos para deletar em batch (so interno usa)
  const [docsSelecionados, setDocsSelecionados] = useState<Set<string>>(new Set());
  // Accordions dos grupos 6, 7, 8 (Laudos medicos, Laudos INSS, Holerites).
  // Por padrao recolhidos para nao poluir a tela quando ha muitos arquivos.
  const [gruposExpandidos, setGruposExpandidos] = useState<Set<number>>(new Set());
  // Pastas (Drive) expandidas na aba Documentos. Vazio = todas fechadas
  // exceto a raiz que abre por default. Usado quando ha pasta_relativa nos
  // documentos.
  const [pastasDocExpandidas, setPastasDocExpandidas] = useState<Set<string>>(new Set([""]));

  function togglePastaDoc(pasta: string) {
    setPastasDocExpandidas((prev) => {
      const next = new Set(prev);
      if (next.has(pasta)) next.delete(pasta);
      else next.add(pasta);
      return next;
    });
  }

  // ---- Importar do Google Drive (interno only) ----
  // O parente abre o Picker e so depois passa os arquivos pro dialog.
  // Isso evita race conditions onde o Picker e o dialog do app brigavam
  // pelo foco durante a interacao.
  const [drivePicked, setDrivePicked] = useState<{
    files: Array<DrivePickedFile>;
    accessToken: string;
  } | null>(null);

  async function handleClickDrive() {
    try {
      const result = await abrirDrivePicker();
      if (result.files.length === 0) return; // cancelou
      setDrivePicked({ files: result.files, accessToken: result.accessToken });
    } catch (err) {
      const msg = (err as { message?: string })?.message || "Erro ao abrir Google Drive";
      toast.error(msg);
    }
  }

  // ---- Vincular / Desvincular / Sincronizar pasta do Drive ----
  const [vinculandoPasta, setVinculandoPasta] = useState(false);
  const [sincronizando, setSincronizando] = useState(false);

  async function handleVincularPasta() {
    setVinculandoPasta(true);
    try {
      const folder = await abrirDrivePickerPasta();
      if (!folder.id) return; // cancelou
      const resp = await supabase
        .from("casos")
        .update({
          gdrive_folder_id: folder.id,
          gdrive_folder_name: folder.name,
          gdrive_vinculado_em: new Date().toISOString(),
          gdrive_vinculado_por: usuarioId,
        })
        .eq("id", casoId);
      if (resp.error) throw resp.error;
      toast.success("Pasta vinculada: " + folder.name);
      onChange();
    } catch (err) {
      const msg = (err as { message?: string })?.message || "Erro ao vincular pasta";
      toast.error(msg);
    } finally {
      setVinculandoPasta(false);
    }
  }

  async function handleDesvincularPasta() {
    if (!confirm("Desvincular pasta do Drive? Arquivos já importados continuam no caso.")) {
      return;
    }
    try {
      const resp = await supabase
        .from("casos")
        .update({
          gdrive_folder_id: null,
          gdrive_folder_name: null,
          gdrive_vinculado_em: null,
          gdrive_vinculado_por: null,
        })
        .eq("id", casoId);
      if (resp.error) throw resp.error;
      toast.success("Pasta desvinculada");
      onChange();
    } catch (err) {
      const msg = (err as { message?: string })?.message || "Erro ao desvincular";
      toast.error(msg);
    }
  }

  async function handleSincronizarPasta() {
    if (!gdriveFolderId) return;
    setSincronizando(true);
    try {
      // 1) Pega access token (silencioso se ja autorizou antes)
      const accessToken = await obterAccessToken();
      // 2) Lista todos os arquivos da pasta no Drive
      const arquivosDrive = await listarArquivosDaPasta(gdriveFolderId, accessToken);
      // 3) Dedupe em 2 niveis:
      //    a) Por gdrive_file_id (forte) - funciona pra docs importados via app
      //    b) Por nome do arquivo (fallback) - cobre docs legacy uploadados antes
      //       da feature de file_id existir. Tambem cobre docs uploadados manual.
      const idsImportados = new Set(
        documentos.map((d) => d.gdrive_file_id).filter((id): id is string => !!id),
      );
      const nomesImportados = new Set(documentos.map((d) => d.nome_arquivo.toLowerCase().trim()));
      const novos = arquivosDrive.filter((f) => {
        if (idsImportados.has(f.id)) return false; // dedupe forte
        if (nomesImportados.has(f.name.toLowerCase().trim())) return false; // fallback nome
        return true;
      });
      const ignorados = arquivosDrive.length - novos.length;
      if (novos.length === 0) {
        toast.success(arquivosDrive.length + " arquivo(s) na pasta, todos já no caso.");
        return;
      }
      // 4) Passa pro DrivePickerDialog (mesmo fluxo de Importar)
      setDrivePicked({ files: novos, accessToken });
      const msg =
        novos.length +
        " novo(s) encontrado(s)" +
        (ignorados > 0 ? " (" + ignorados + " já existiam, ignorados)" : "");
      toast.success(msg);
    } catch (err) {
      const msg = (err as { message?: string })?.message || "Erro ao sincronizar pasta";
      toast.error(msg);
    } finally {
      setSincronizando(false);
    }
  }
  const tiposDocImportOptions = Object.keys(TIPOS_DOCUMENTO_LABEL).map((k) => ({
    value: k,
    label: TIPOS_DOCUMENTO_LABEL[k],
  }));

  async function importarDriveParaCaso(arquivos: Array<DriveImportedFile>): Promise<void> {
    if (!usuarioId) {
      toast.error("Sessão inválida.");
      return;
    }
    let okCount = 0;
    let errCount = 0;
    for (const a of arquivos) {
      try {
        const fileName = Date.now() + "_" + sanitizeFileName(a.file.name);
        const storagePath = casoId + "/" + fileName;
        const uploadResp = await supabase.storage.from("documentos").upload(storagePath, a.file, {
          cacheControl: "3600",
          upsert: false,
        });
        if (uploadResp.error) throw uploadResp.error;

        const insertResp = await supabase.from("documentos").insert({
          caso_id: casoId,
          tipo: a.tipo,
          tipo_personalizado: a.tipo === "outro" ? a.tipoPersonalizado.trim() : null,
          nome_arquivo: a.file.name,
          storage_path: storagePath,
          tamanho_bytes: a.file.size,
          uploaded_by: usuarioId,
          // Importados do Drive sao visiveis ao parceiro por default,
          // alinhado com o resto do app.
          visivel_parceiro: true,
          // Salva file_id do Drive pra dedupe no proximo sync da pasta
          gdrive_file_id: a.gdriveFileId,
          // Caminho da subpasta no Drive (ex.: "Diversos"). Vazio = raiz.
          pasta_relativa: a.pastaRelativa || null,
        });
        if (insertResp.error) throw insertResp.error;
        okCount++;
      } catch (err) {
        console.error("Falha ao importar", a.file.name, err);
        errCount++;
      }
    }
    if (okCount > 0) {
      onChange(); // recarrega lista
    }
    if (errCount > 0) {
      toast.error(errCount + " arquivo(s) falharam ao importar.");
    }
  }

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

  // Ordena por grupo (categoria). Dentro do mesmo grupo:
  //   - Grupos 1-8 (categorias estruturadas): alfabetico pelo nome de
  //     arquivo sem prefixo numerico - fica previsivel.
  //   - Grupo 9 (Outros): por created_at crescente - preserva a ordem
  //     em que foram uploadados, util porque sao documentos diversos
  //     onde a ordem manual faz sentido.
  const lista = listaFiltrada.slice().sort((a, b) => {
    const ga = getDocGroup(a.tipo);
    const gb = getDocGroup(b.tipo);
    if (ga !== gb) return ga - gb;
    if (ga === 9) {
      // Outros: ordem de upload (mais antigo primeiro)
      return a.created_at.localeCompare(b.created_at);
    }
    return displayNomeArquivo(a.nome_arquivo).localeCompare(displayNomeArquivo(b.nome_arquivo));
  });

  // Agrupa por pasta_relativa pra mostrar subpastas como secoes separadas.
  // Se nenhum doc tem pasta_relativa setada, retorna 1 grupo unico (flat).
  // Raiz aparece primeiro, depois subpastas em ordem alfabetica.
  const algumDocComPasta = lista.some((d) => d.pasta_relativa);
  const gruposPasta: Array<[string, Array<Documento>]> = algumDocComPasta
    ? (() => {
        const map = new Map<string, Array<Documento>>();
        for (const d of lista) {
          const key = d.pasta_relativa || "";
          if (!map.has(key)) map.set(key, []);
          map.get(key)!.push(d);
        }
        return Array.from(map.entries()).sort(([a], [b]) => {
          if (a === "" && b !== "") return -1;
          if (b === "" && a !== "") return 1;
          return a.localeCompare(b);
        });
      })()
    : [["", lista]];

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
      const resp = await supabase.storage.from("documentos").createSignedUrl(doc.storage_path, 60);
      if (resp.error) throw resp.error;
      const url = resp.data ? resp.data.signedUrl : null;
      if (url) {
        // Audit log (LGPD Art. 37) — fire-and-forget.
        supabase
          .rpc("log_acesso_documento", { p_documento_id: doc.id, p_acao: "download" })
          .then(undefined, () => {});
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
      const resp = await supabase.storage.from("documentos").createSignedUrl(d.storage_path, 300); // 5 min de TTL
      if (resp.error) throw resp.error;
      const signedUrl = resp.data ? resp.data.signedUrl : null;
      if (!signedUrl) throw new Error("Não foi possível gerar link de visualização");

      // Audit log (LGPD Art. 37) — fire-and-forget.
      supabase
        .rpc("log_acesso_documento", { p_documento_id: d.id, p_acao: "visualizacao" })
        .then(undefined, () => {});

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
        const resp = await supabase.storage.from("documentos").createSignedUrl(d.storage_path, 60);
        if (resp.error) throw resp.error;
        const url = resp.data ? resp.data.signedUrl : null;
        if (url) {
          // Audit log (LGPD Art. 37) — fire-and-forget.
          supabase
            .rpc("log_acesso_documento", { p_documento_id: d.id, p_acao: "download" })
            .then(undefined, () => {});
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
        okCount +
          " download" +
          (okCount === 1 ? "" : "s") +
          " iniciado" +
          (okCount === 1 ? "" : "s"),
      );
    }
    if (errCount > 0) {
      toast.error(
        errCount + " falha" + (errCount === 1 ? "" : "s") + " ao gerar link. Ver console.",
      );
    }
  }

  async function deletarSelecionados() {
    if (docsSelecionados.size === 0) return;
    const alvos = lista.filter((d) => docsSelecionados.has(d.id));
    if (alvos.length === 0) return;
    const ok = window.confirm(
      "Excluir " +
        alvos.length +
        " documento" +
        (alvos.length === 1 ? "" : "s") +
        " selecionado" +
        (alvos.length === 1 ? "" : "s") +
        "?\n\n" +
        "Os arquivos serão removidos do storage e do banco. Essa ação não pode ser desfeita.",
    );
    if (!ok) return;
    let okCount = 0;
    let errCount = 0;
    for (const d of alvos) {
      try {
        const storageResp = await supabase.storage.from("documentos").remove([d.storage_path]);
        if (storageResp.error) {
          console.error("Erro storage", d.nome_arquivo, storageResp.error);
        }
        const delResp = await supabase.from("documentos").delete().eq("id", d.id);
        if (delResp.error) throw delResp.error;
        okCount++;
      } catch (err) {
        console.error("erro deletar", d.nome_arquivo, err);
        errCount++;
      }
    }
    if (okCount > 0) {
      toast.success(
        okCount +
          " documento" +
          (okCount === 1 ? "" : "s") +
          " excluído" +
          (okCount === 1 ? "" : "s"),
      );
    }
    if (errCount > 0) {
      toast.error(
        errCount + " documento" + (errCount === 1 ? "" : "s") + " falharam. Ver console.",
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
        const storageResp = await supabase.storage.from("documentos").remove([d.storage_path]);
        if (storageResp.error) {
          console.error("Erro storage", d.nome_arquivo, storageResp.error);
        }
        const delResp = await supabase.from("documentos").delete().eq("id", d.id);
        if (delResp.error) throw delResp.error;
        okCount++;
      } catch (err) {
        console.error("erro deletar", d.nome_arquivo, err);
        errCount++;
      }
    }
    if (okCount > 0) {
      toast.success(
        okCount +
          " documento" +
          (okCount === 1 ? "" : "s") +
          " deletado" +
          (okCount === 1 ? "" : "s"),
      );
    }
    if (errCount > 0) {
      toast.error(
        errCount + " documento" + (errCount === 1 ? "" : "s") + " falharam. Ver console.",
      );
    }
    onChange();
  }

  async function deletarDoc(d: Documento) {
    const ok = window.confirm(
      "Tem certeza que deseja deletar o documento '" +
        d.nome_arquivo +
        "'?\n\nEssa ação remove o arquivo do storage e o registro do banco, e não pode ser desfeita.",
    );
    if (!ok) return;
    try {
      // 1) Remove arquivo do storage (best effort)
      const storageResp = await supabase.storage.from("documentos").remove([d.storage_path]);
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
      const resp = await supabase.from("solicitacoes_documento").update(update).eq("id", s.id);
      if (resp.error) throw resp.error;
      toast.success("Solicitação atualizada");
      onChange();
    } catch (err) {
      console.error(err);
      const errObj = err as { message?: string };
      toast.error(errObj.message || "Erro ao atualizar solicitação");
    }
  }

  function abrirAcaoModal(s: SolicitacaoDocumento, novoStatus: string) {
    setAcaoAlvo({ solic: s, novoStatus: novoStatus });
    setComentarioModal(s.comentario || "");
    setArquivoUpload(null);
    setNomeArquivoEdit("");
    // Parceiro SEMPRE cumpre com arquivo. Interno por default sem.
    setComAnexo(!isInterno && novoStatus === "atendido");
  }

  function fecharAcaoModal() {
    setAcaoAlvo(null);
    setComentarioModal("");
    setSalvandoModal(false);
    setArquivoUpload(null);
    setNomeArquivoEdit("");
    setComAnexo(false);
  }

  async function confirmarAcaoModal() {
    if (!acaoAlvo) return;
    if (acaoAlvo.novoStatus === "atendido" && comAnexo && !arquivoUpload) {
      toast.error("Selecione um arquivo para anexar");
      return;
    }
    // Nome do arquivo obrigatorio quando ha upload
    if (
      acaoAlvo.novoStatus === "atendido" &&
      comAnexo &&
      arquivoUpload &&
      !nomeArquivoEdit.trim()
    ) {
      toast.error("Informe o nome do arquivo");
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
      if (acaoAlvo.novoStatus === "atendido" && comAnexo && arquivoUpload && usuarioId) {
        // Usa nome editado pelo usuario (ou fallback pra auto-rename)
        const nomeArq = nomeArquivoEdit.trim() || nomearArquivo(acaoAlvo.solic.tipo, arquivoUpload);
        const path = casoId + "/" + nomeArq;
        // upsert só pra interno: a RLS de UPDATE em storage.objects exige
        // is_interno(), e supabase-js com upsert=true dispara INSERT ON
        // CONFLICT DO UPDATE — que tropeça na policy mesmo sem conflito real.
        // Parceiro envia com nome único (auto-rename pelo tipo); colisão é rara.
        const upResp = await supabase.storage
          .from("documentos")
          .upload(path, arquivoUpload, { upsert: isInterno });
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
      // Se quem cumpriu foi o PARCEIRO, avisa o sino da equipe (interno).
      if (usuario?.tipo === "parceiro") {
        notificarEquipe({
          tipo: documentoId ? "documento" : "solicitacao",
          titulo: documentoId
            ? `Documento enviado por ${usuario.nome || "parceiro"}`
            : `Solicitação atualizada por ${usuario.nome || "parceiro"}`,
          descricao: acaoAlvo.solic.tipo,
          caso_id: casoId,
          foco_id: documentoId || acaoAlvo.solic.id,
        });
      }
      toast.success(
        documentoId ? "Solicitação cumprida e documento anexado" : "Solicitação atualizada",
      );
      onChange();
    } catch (err) {
      console.error(err);
      const errObj = err as { message?: string };
      toast.error(errObj.message || "Erro ao atualizar solicitação");
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
              <CardDescription>Arquivos anexados a este caso.</CardDescription>
              {isInterno && gdriveFolderId && (
                <div className="mt-1 text-xs text-muted-foreground flex items-center gap-1">
                  <span>Pasta vinculada:</span>
                  <span className="font-medium text-foreground">
                    {gdriveFolderName ?? "(sem nome)"}
                  </span>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={handleDesvincularPasta}
                    className="h-5 px-1 text-xs text-muted-foreground hover:text-destructive ml-1"
                    title="Desvincular pasta"
                  >
                    <X className="h-3 w-3" />
                  </Button>
                </div>
              )}
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
              {/* Botoes de Drive: vincular pasta / sync / importar avulso */}
              {isInterno && isGoogleDriveConfigured() && gdriveFolderId && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={handleSincronizarPasta}
                  disabled={sincronizando}
                  title={"Sincronizar com pasta: " + (gdriveFolderName ?? "")}
                  className="border-[var(--gold)]/40"
                >
                  {sincronizando ? (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <FileDown className="h-4 w-4 mr-2" />
                  )}
                  Sync pasta
                </Button>
              )}
              {isInterno && isGoogleDriveConfigured() && !gdriveFolderId && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={handleVincularPasta}
                  disabled={vinculandoPasta}
                  title="Vincular pasta do Drive a este caso (sync futuro)"
                >
                  {vinculandoPasta ? (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <FileDown className="h-4 w-4 mr-2" />
                  )}
                  Vincular pasta
                </Button>
              )}
              {isInterno && isGoogleDriveConfigured() && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={handleClickDrive}
                  title="Importar arquivos avulsos do Google Drive"
                >
                  <FileDown className="h-4 w-4 mr-2" />
                  Drive
                </Button>
              )}
              <UploadDoc casoId={casoId} usuarioId={usuarioId} onChange={onChange} />
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
                    checked={lista.length > 0 && docsSelecionados.size === lista.length}
                    onChange={() => toggleSelecionarTodos(lista)}
                    className="h-4 w-4"
                  />
                  Selecionar tudo ({lista.length})
                </label>
              )}
              {(() => {
                // Renderiza secoes (tipo-grupos) dentro de um array de docs.
                // Extraido pra reusar em cada pasta quando ha agrupamento.
                function renderSecoesDeDocs(docs: Array<Documento>) {
                  type Secao =
                    | { kind: "flat"; doc: Documento }
                    | { kind: "accordion"; grupo: number; docs: Array<Documento> };
                  const secoes: Array<Secao> = [];
                  for (const d of docs) {
                    const g = getDocGroup(d.tipo);
                    if (GRUPOS_ACCORDION.has(g)) {
                      const ultima = secoes[secoes.length - 1];
                      if (ultima && ultima.kind === "accordion" && ultima.grupo === g) {
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
                                <span className="text-sm font-medium truncate">{label}</span>
                              </div>
                              <span className="text-xs text-muted-foreground shrink-0">
                                {s.docs.length} {s.docs.length === 1 ? "arquivo" : "arquivos"}
                              </span>
                            </button>
                            {aberto && (
                              <ul className="space-y-2 p-3 border-t">{s.docs.map(renderDocLi)}</ul>
                            )}
                          </li>
                        );
                      })}
                    </ul>
                  );
                }

                // Helper: renderiza o <li> de um documento individual.
                // Usado tanto na lista plana quanto dentro dos accordions.
                function renderDocLi(d: Documento) {
                  return (
                    <li
                      key={d.id}
                      id={"foco-" + d.id}
                      className={
                        "flex items-center justify-between gap-2 border rounded-md p-3 " +
                        (foco === d.id ? DESTAQUE_CLASSE : "")
                      }
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
                            - {formatBytes(d.tamanho_bytes)} - {formatDate(d.created_at)}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        {isInterno && (
                          <Button size="sm" variant="outline" onClick={() => baixar(d)}>
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

                // Se ha agrupamento por pasta (algum doc tem pasta_relativa),
                // renderiza cada pasta como uma secao colapsavel. Dentro
                // de cada pasta usa o mesmo agrupamento por tipo.
                // Caso contrario, renderiza flat.
                if (!algumDocComPasta) {
                  return renderSecoesDeDocs(lista);
                }
                return (
                  <div className="space-y-3">
                    {gruposPasta.map(([pasta, docs]) => {
                      const aberta = pastasDocExpandidas.has(pasta);
                      const labelPasta =
                        pasta === ""
                          ? gdriveFolderName || "(raiz)"
                          : gdriveFolderName
                            ? gdriveFolderName + "/" + pasta
                            : pasta;
                      return (
                        <div key={pasta || "_raiz"} className="border rounded-md overflow-hidden">
                          <button
                            type="button"
                            onClick={() => togglePastaDoc(pasta)}
                            className="w-full flex items-center gap-2 px-3 py-2 bg-muted/40 hover:bg-muted/60 text-left"
                          >
                            {aberta ? (
                              <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
                            ) : (
                              <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                            )}
                            <span className="text-sm font-medium truncate flex-1 text-foreground">
                              📂 {labelPasta}
                            </span>
                            <span className="text-xs text-muted-foreground shrink-0">
                              {docs.length} {docs.length === 1 ? "arquivo" : "arquivos"}
                            </span>
                          </button>
                          {aberta && <div className="p-3 border-t">{renderSecoesDeDocs(docs)}</div>}
                        </div>
                      );
                    })}
                  </div>
                );
              })()}
            </div>
          )}
          {!isInterno && lista.length > 0 && (
            <p className="text-xs text-muted-foreground mt-3">
              Precisa que um documento seja removido? Avise o escritório pelo chat do caso.
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
                  ? "Histórico de pedidos abertos pelo escritório."
                  : "Documentos que o escritório precisa. Envie por 'Adicionar' abaixo."}
              </CardDescription>
            </div>
            {isInterno && (
              <SolicitarDocBotao casoId={casoId} usuarioId={usuarioId} onChange={onChange} />
            )}
          </div>
        </CardHeader>
        <CardContent>
          {(() => {
            const pendentes = solicitacoesOrdenadas.filter((s) => s.status === "pendente");
            const cumpridas = solicitacoesOrdenadas.filter((s) => s.status !== "pendente");

            function renderSolicLi(s: SolicitacaoDocumento) {
              const isPendente = s.status === "pendente";
              const isAtendido = s.status === "atendido";
              const isDispensado = s.status === "dispensado";
              return (
                <li
                  key={s.id}
                  id={"foco-" + s.id}
                  className={
                    "border rounded-md p-3 " +
                    (isAtendido || isDispensado ? "bg-muted/30 " : "") +
                    (foco === s.id ? DESTAQUE_CLASSE : "")
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
                        <p className="text-xs text-muted-foreground mt-1">{s.descricao}</p>
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
                              ? "Observação do atendimento"
                              : isDispensado
                                ? "Motivo da dispensa"
                                : "Comentário"}
                          </p>
                          <p className="text-sm whitespace-pre-wrap italic">{s.comentario}</p>
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
                  Nenhuma solicitação registrada.
                </p>
              );
            }

            return (
              <div className="space-y-3">
                {pendentes.length > 0 && (
                  <ul className="space-y-2">{pendentes.map(renderSolicLi)}</ul>
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
                        <span className="text-sm font-medium truncate">Solicitações cumpridas</span>
                      </div>
                      <span className="text-xs text-muted-foreground shrink-0">
                        {cumpridas.length} {cumpridas.length === 1 ? "solicitação" : "solicitações"}
                      </span>
                    </button>
                    {cumpridasAberto && (
                      <ul className="space-y-2 p-3 border-t">{cumpridas.map(renderSolicLi)}</ul>
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
                  : "Cumprir solicitação"
                : "Dispensar solicitação"}
            </DialogTitle>
            <DialogDescription>
              {acaoAlvo && acaoAlvo.novoStatus === "atendido"
                ? isInterno
                  ? "Marque sem arquivo (recebeu pessoalmente) ou anexe o documento."
                  : "Anexe o documento solicitado. Será renomeado automaticamente."
                : "Informe o motivo da dispensa (recomendado)."}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            {/* Radio "como atender" - so para interno + atendido */}
            {isInterno && acaoAlvo && acaoAlvo.novoStatus === "atendido" && (
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
                    <span className="text-sm">Sem arquivo (recebi pessoalmente)</span>
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
                      Anexar arquivo (será renomeado para o tipo solicitado)
                    </span>
                  </label>
                </div>
              </div>
            )}

            {/* File input */}
            {acaoAlvo && acaoAlvo.novoStatus === "atendido" && comAnexo && (
              <div>
                <Label className="text-xs">Arquivo {!isInterno && "(obrigatório)"}</Label>
                <input
                  type="file"
                  onChange={(e) => {
                    const f = e.target.files?.[0] || null;
                    setArquivoUpload(f);
                    // Pre-preenche o nome com a auto-renomeacao quando o
                    // arquivo eh selecionado. Usuario pode editar.
                    if (f && acaoAlvo) {
                      setNomeArquivoEdit(nomearArquivo(acaoAlvo.solic.tipo, f));
                    } else {
                      setNomeArquivoEdit("");
                    }
                  }}
                  className="block w-full text-sm border rounded-md p-2"
                  accept=".pdf,.jpg,.jpeg,.png,.doc,.docx,.xls,.xlsx"
                />
                <p className="text-xs text-muted-foreground mt-1">
                  Tamanho máximo: {MAX_FILE_SIZE_MB} MB por arquivo.
                </p>
                {arquivoUpload && (
                  <div className="mt-2">
                    <Label className="text-xs">Nome do arquivo (obrigatório)</Label>
                    <Input
                      value={nomeArquivoEdit}
                      onChange={(e) => setNomeArquivoEdit(e.target.value)}
                      placeholder="Ex: RG_e_CPF_Joao.pdf"
                      className="text-sm"
                    />
                    <p className="text-xs text-muted-foreground mt-1">
                      Pré-preenchido com nome padrão - você pode editar. Mantenha a extensão (.pdf,
                      .jpg, etc.).
                    </p>
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
                    : "Ex.: cliente não consegue obter; documento não necessário para esse benefício"
                }
                value={comentarioModal}
                onChange={(e) => setComentarioModal(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={fecharAcaoModal} disabled={salvandoModal}>
              Cancelar
            </Button>
            <Button onClick={confirmarAcaoModal} disabled={salvandoModal}>
              {salvandoModal && <Loader2 className="h-3 w-3 mr-2 animate-spin" />}
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
              {previewDoc ? displayNomeArquivo(previewDoc.doc.nome_arquivo) : ""}
            </DialogTitle>
            <DialogDescription className="text-xs text-destructive bg-destructive/10 border border-destructive/30 rounded p-2 mt-1">
              <strong>Documento confidencial.</strong> Captura de tela, gravação ou compartilhamento
              configura responsabilidade legal. Acesso registrado para auditoria.
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
      {/* Dialog do Google Drive Picker (interno only). */}
      {isInterno && (
        <DrivePickerDialog
          arquivosSelecionados={drivePicked?.files ?? null}
          accessToken={drivePicked?.accessToken ?? ""}
          onFechar={() => setDrivePicked(null)}
          tiposDocumento={tiposDocImportOptions}
          pastaRaizNome={gdriveFolderName}
          onConfirmar={importarDriveParaCaso}
        />
      )}
    </div>
  );
}

interface ArquivoComTipo {
  id: string; // id local para o React key
  arquivo: File;
  tipo: string;
  tipoPersonalizado: string;
}

function UploadDoc(props: { casoId: string; usuarioId: string | null; onChange: () => void }) {
  const { casoId, usuarioId, onChange } = props;
  const { usuario } = useAuth();
  const souParceiro = usuario?.tipo === "parceiro";
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
      prev.map((it) => (it.id === id ? { ...it, tipo: novoTipo, tipoPersonalizado: "" } : it)),
    );
  }

  function atualizarPersonalizado(id: string, texto: string) {
    setItens((prev) => prev.map((it) => (it.id === id ? { ...it, tipoPersonalizado: texto } : it)));
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
    itens.every((it) => it.tipo && (it.tipo !== "outro" || it.tipoPersonalizado.trim().length > 0));

  async function enviarTodos() {
    if (!usuarioId || !todosValidos) return;

    // Valida tamanho de TODOS os arquivos antes de comecar a subir,
    // pra evitar criar registros parciais.
    const errosTamanho = validateFileSizes(itens.map((it) => it.arquivo));
    if (errosTamanho.length > 0) {
      errosTamanho.slice(0, 3).forEach((e) => toast.error(e));
      if (errosTamanho.length > 3) {
        toast.error("Mais " + (errosTamanho.length - 3) + " arquivo(s) acima do limite.");
      }
      return;
    }

    setEnviando(true);
    let okCount = 0;
    let errCount = 0;
    const idsInseridos: Array<string> = [];
    try {
      for (const it of itens) {
        try {
          const fileName = Date.now() + "_" + sanitizeFileName(it.arquivo.name);
          const storagePath = casoId + "/" + fileName;
          const uploadResp = await supabase.storage
            .from("documentos")
            .upload(storagePath, it.arquivo, {
              cacheControl: "3600",
              upsert: false,
            });
          if (uploadResp.error) throw uploadResp.error;

          const insertResp = await supabase
            .from("documentos")
            .insert({
              caso_id: casoId,
              tipo: it.tipo,
              tipo_personalizado: it.tipo === "outro" ? it.tipoPersonalizado.trim() : null,
              nome_arquivo: it.arquivo.name,
              storage_path: storagePath,
              tamanho_bytes: it.arquivo.size,
              uploaded_by: usuarioId,
              // Doc do parceiro e sempre visivel a ele (sem checkbox).
              visivel_parceiro: souParceiro ? true : visivelParceiro,
            })
            .select("id")
            .single();
          if (insertResp.error) throw insertResp.error;
          if (insertResp.data?.id) idsInseridos.push(insertResp.data.id);
          okCount++;
        } catch (errInner) {
          console.error("erro upload de", it.arquivo.name, errInner);
          errCount++;
        }
      }
      // Se quem enviou foi o PARCEIRO, avisa o sino da equipe (interno).
      if (souParceiro && idsInseridos.length > 0) {
        notificarEquipe({
          tipo: "documento",
          titulo: `${okCount} documento(s) enviado(s) por ${usuario?.nome || "parceiro"}`,
          caso_id: casoId,
          foco_id: idsInseridos[0],
        });
      }
      if (okCount > 0) {
        toast.success(
          okCount +
            " documento" +
            (okCount === 1 ? "" : "s") +
            " adicionado" +
            (okCount === 1 ? "" : "s"),
        );
      }
      if (errCount > 0) {
        toast.error(
          errCount + " arquivo" + (errCount === 1 ? "" : "s") + " falharam. Ver console.",
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
    <Dialog open={aberto} onOpenChange={(o) => (o ? setAberto(true) : fechar())}>
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
            Selecione um ou vários arquivos. Cada um precisa de um tipo. Se escolher
            &quot;Outro&quot;, informe o nome do documento. Tamanho máximo: {MAX_FILE_SIZE_MB} MB
            por arquivo.
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
                      <p className="text-sm font-medium truncate">{it.arquivo.name}</p>
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
                      <Label className="text-xs">Nome do documento (obrigatório)</Label>
                      <Input
                        placeholder="Ex.: Cartão do INSS, Decisão do MS..."
                        value={it.tipoPersonalizado}
                        onChange={(e) => atualizarPersonalizado(it.id, e.target.value)}
                      />
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}

          {/* Checkbox de visibilidade so faz sentido para o interno; o doc do
              parceiro e sempre visivel a ele. */}
          {!souParceiro && (
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
          )}
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

  const valido = !!tipo && (tipo !== "outro" || tipoPersonalizado.trim().length > 0);

  async function criar() {
    if (!usuarioId || !valido) return;
    setEnviando(true);
    try {
      // Se tipo=outro, usa o nome customizado como prefixo da descricao
      // (a tabela solicitacoes_documento nao tem coluna tipo_personalizado).
      const descricaoFinal =
        tipo === "outro" && tipoPersonalizado.trim()
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
      toast.success("Solicitação criada");

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
      toast.error(errObj.message || "Erro ao criar solicitação");
    } finally {
      setEnviando(false);
    }
  }

  return (
    <Dialog open={aberto} onOpenChange={setAberto}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">
          <Plus className="h-4 w-4 mr-2" />
          Nova solicitação
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
              <Label className="text-xs">Nome do documento (obrigatório)</Label>
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
                <SelectItem value="externa">Externa - parceiro ou cliente envia</SelectItem>
                <SelectItem value="interna">Interna - escritório providencia</SelectItem>
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
          <Button variant="ghost" onClick={() => setAberto(false)} disabled={enviando}>
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
  const [analisandoIA, setAnalisandoIA] = useState(false);

  async function analisarIA() {
    setAnalisandoIA(true);
    try {
      const { data, error } = await iaAnalise.gerar(casoId);
      if (data?.ok) {
        toast.success("Análise por IA gerada (versão " + data.versao + ")");
        onChange();
      } else if (error?.code === "nao_configurado" || error?.code === "desativado") {
        toast.error("Configure e ative a Integração de IA em Configurações.");
      } else {
        toast.error(error?.message || "Falha ao gerar análise");
      }
    } finally {
      setAnalisandoIA(false);
    }
  }

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
      toast.success("Análise técnica versão " + proximaVersao + " salva");
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
      toast.error(errObj.message || "Erro ao salvar análise");
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
            <CardTitle className="text-base">Análise técnica</CardTitle>
            <CardDescription>
              Histórico versionado. Não visível ao parceiro (exceto o resumo).
            </CardDescription>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <Button size="sm" variant="outline" onClick={analisarIA} disabled={analisandoIA}>
              {analisandoIA ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Sparkles className="h-4 w-4 mr-2" />
              )}
              Analisar com IA
            </Button>
            <Dialog open={aberto} onOpenChange={setAberto}>
              <DialogTrigger asChild>
                <Button size="sm">
                  <Plus className="h-4 w-4 mr-2" />
                  Nova versão
                </Button>
              </DialogTrigger>
              <DialogContent className="max-w-2xl">
                <DialogHeader>
                  <DialogTitle>Nova análise técnica (versão {proximaVersao})</DialogTitle>
                </DialogHeader>
                <div className="space-y-3">
                  <div>
                    <Label className="text-xs">Benefício recomendado *</Label>
                    <Input
                      placeholder="Ex.: Aposentadoria por tempo de contribuição"
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
                      <Label className="text-xs">Valor estimado da ação (R$)</Label>
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
                    <Label className="text-xs">Observações (interno)</Label>
                    <Textarea
                      rows={6}
                      placeholder="Raciocínio jurídico, cálculos, fundamentação..."
                      value={observacoes}
                      onChange={(e) => setObservacoes(e.target.value)}
                    />
                  </div>
                  <div>
                    <Label className="text-xs">Resumo para o parceiro (opcional)</Label>
                    <Textarea
                      rows={3}
                      placeholder="Versão simplificada exibida ao parceiro..."
                      value={resumoParceiro}
                      onChange={(e) => setResumoParceiro(e.target.value)}
                    />
                  </div>
                </div>
                <DialogFooter>
                  <Button variant="ghost" onClick={() => setAberto(false)} disabled={salvando}>
                    Cancelar
                  </Button>
                  <Button onClick={salvar} disabled={salvando}>
                    {salvando && <Loader2 className="h-3 w-3 mr-2 animate-spin" />}
                    Salvar versão
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {analises.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-6">
            Nenhuma análise registrada. Crie a primeira versão.
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
                    <p className="text-sm font-medium">{a.beneficio_recomendado}</p>
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
                        <span className="text-muted-foreground">Valor da ação: </span>
                        <span>{formatMoney(a.valor_estimado_acao)}</span>
                      </div>
                    )}
                  </div>
                  {obs && (
                    <div className="mt-2 pt-2 border-t">
                      <p className="text-xs text-muted-foreground mb-1">Observações</p>
                      <Markdown>{obs}</Markdown>
                    </div>
                  )}
                  {a.resumo_parceiro && (
                    <div className="mt-2 pt-2 border-t">
                      <p className="text-xs text-muted-foreground mb-1">Resumo para o parceiro</p>
                      <Markdown>{a.resumo_parceiro}</Markdown>
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
// Tab: Comentarios (threads)
// ===========================================================================
//
// Substitui o antigo Chat por sistema de comentarios com threads:
//   - Top-level comments aparecem como "cards"
//   - Cada thread pode ter replies (1 nivel apenas, sem aninhamento profundo)
//   - "Novo comentario" abre input no topo
//   - "Responder" abre input inline dentro de um thread
//   - Email automatico pro destinatario (parceiro <-> interno) via edge function
//
// Padrao de comunicacao assincrona (nao e chat tempo real - sem polling
// frequente, recarrega quando usuario interage).

interface TabComentariosProps {
  casoId: string;
  comentarios: Array<ComentarioRow>;
  setComentarios: (c: Array<ComentarioRow>) => void;
  usuarioId: string | null;
  // Se false, caso nao tem parceiro vinculado - comentarios funcionam como
  // notas internas (so equipe ve). UI muda copy pra refletir isso.
  temParceiro: boolean;
  focoId?: string;
}

function tipoBadgeClasses(tipo: string | undefined | null): string {
  if (tipo === "interno") {
    return "bg-gold-soft/40 border border-gold/40 text-foreground";
  }
  if (tipo === "parceiro") {
    return "bg-secondary text-secondary-foreground border border-border";
  }
  return "bg-muted text-muted-foreground border border-border";
}

function tipoBadgeLabel(tipo: string | undefined | null): string {
  if (tipo === "interno") return "Equipe";
  if (tipo === "parceiro") return "Parceiro";
  return "?";
}

function TabComentarios(props: TabComentariosProps) {
  const { casoId, comentarios, setComentarios, usuarioId, temParceiro, focoId } = props;
  const { usuario } = useAuth();
  // Interno pode excluir QUALQUER comentario (moderacao) - a RLS ja permite.
  // Autor pode excluir o proprio. Parceiro so ve excluir nos seus.
  const isInterno = usuario?.tipo === "interno";
  const foco = useFocoItem(focoId);

  // Estado: textos por thread (chave = parent_id ou "novo")
  const [novoTexto, setNovoTexto] = useState("");
  const [respostaTexto, setRespostaTexto] = useState<Record<string, string>>({});
  const [respondendoEm, setRespondendoEm] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [excluindoId, setExcluindoId] = useState<string | null>(null);

  // Agrupa comentarios em threads: top-level + replies
  const threads = useMemo(() => {
    const tops = comentarios.filter((c) => c.parent_id === null);
    const byParent = new Map<string, Array<ComentarioRow>>();
    for (const c of comentarios) {
      if (c.parent_id) {
        const arr = byParent.get(c.parent_id) || [];
        arr.push(c);
        byParent.set(c.parent_id, arr);
      }
    }
    // Top-level mais recente primeiro; replies cronologico (mais antigo primeiro)
    return tops
      .slice()
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
      .map((top) => ({
        top,
        replies: (byParent.get(top.id) || [])
          .slice()
          .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()),
      }));
  }, [comentarios]);

  async function recarregar() {
    const resp = await supabase
      .from("comentarios")
      .select(
        "id, caso_id, parent_id, autor_id, texto, created_at, autor:autor_id(id, nome, email, tipo)",
      )
      .eq("caso_id", casoId)
      .order("created_at", { ascending: true });
    if (!resp.error) {
      setComentarios((resp.data || []) as unknown as Array<ComentarioRow>);
    }
  }

  async function enviarComentario(texto: string, parentId: string | null) {
    if (!texto.trim() || !usuarioId) return;
    setEnviando(true);
    try {
      const insertResp = await supabase
        .from("comentarios")
        .insert({
          caso_id: casoId,
          parent_id: parentId,
          autor_id: usuarioId,
          texto: texto.trim(),
        })
        .select("id")
        .single();
      if (insertResp.error) throw insertResp.error;
      const novoId = (insertResp.data as { id: string }).id;

      // Dispara email fire-and-forget. Nao bloqueia a UI nem mostra erro
      // ao usuario - se falhar, eh registrado no console e Resend logs.
      supabase.functions
        .invoke("notify-novo-comentario", {
          body: { comentario_id: novoId },
        })
        .then((r) => {
          if (r.error) console.warn("notify-novo-comentario:", r.error);
        });

      // Se quem comentou foi o PARCEIRO, avisa o sino da equipe (interno).
      if (usuario?.tipo === "parceiro") {
        notificarEquipe({
          tipo: "comentario",
          titulo: `Comentário de ${usuario.nome || "parceiro"}`,
          descricao: texto.trim().slice(0, 140),
          caso_id: casoId,
          foco_id: novoId,
        });
      }

      // Limpa input e recarrega lista
      if (parentId === null) {
        setNovoTexto("");
      } else {
        setRespostaTexto((prev) => ({ ...prev, [parentId]: "" }));
        setRespondendoEm(null);
      }
      await recarregar();
      toast.success(parentId === null ? "Comentário enviado" : "Resposta enviada");
    } catch (err) {
      console.error(err);
      const errObj = err as { message?: string };
      toast.error(errObj.message || "Erro ao enviar comentário");
    } finally {
      setEnviando(false);
    }
  }

  async function excluirComentario(id: string) {
    if (!confirm("Excluir este comentário? Replies também serão removidas.")) {
      return;
    }
    setExcluindoId(id);
    try {
      const resp = await supabase.from("comentarios").delete().eq("id", id);
      if (resp.error) throw resp.error;
      await recarregar();
      toast.success("Comentário excluído");
    } catch (err) {
      console.error(err);
      const errObj = err as { message?: string };
      toast.error(errObj.message || "Erro ao excluir");
    } finally {
      setExcluindoId(null);
    }
  }

  return (
    <div className="space-y-4">
      {/* Input pra novo comentario top-level */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Novo comentário</CardTitle>
          <CardDescription>
            {temParceiro
              ? "Inicie um novo tópico. O destinatário (parceiro ou equipe) recebe email avisando."
              : "Caso sem parceiro vinculado - comentários funcionam como notas internas da equipe. Outros internos são notificados por email."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Textarea
            rows={3}
            placeholder="Escreva um comentário..."
            value={novoTexto}
            onChange={(e) => setNovoTexto(e.target.value)}
          />
          <div className="flex justify-end mt-2">
            <Button
              onClick={() => enviarComentario(novoTexto, null)}
              disabled={enviando || !novoTexto.trim()}
            >
              {enviando ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Send className="h-4 w-4 mr-2" />
              )}
              Publicar comentário
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Lista de threads */}
      {threads.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-sm text-muted-foreground">
            Nenhum comentário ainda. Inicie um novo tópico acima.
          </CardContent>
        </Card>
      ) : (
        threads.map(({ top, replies }) => (
          <Card key={top.id}>
            <CardContent className="py-4 space-y-3">
              {/* Top-level */}
              <ComentarioItem
                comentario={top}
                podeExcluir={top.autor_id === usuarioId || isInterno}
                onExcluir={() => excluirComentario(top.id)}
                excluindo={excluindoId === top.id}
                destacado={foco === top.id}
              />

              {/* Replies (recuadas) */}
              {replies.length > 0 && (
                <div className="ml-6 pl-3 border-l-2 border-border space-y-3">
                  {replies.map((r) => (
                    <ComentarioItem
                      key={r.id}
                      comentario={r}
                      podeExcluir={r.autor_id === usuarioId || isInterno}
                      onExcluir={() => excluirComentario(r.id)}
                      excluindo={excluindoId === r.id}
                      destacado={foco === r.id}
                    />
                  ))}
                </div>
              )}

              {/* Input de resposta (inline) */}
              {respondendoEm === top.id ? (
                <div className="ml-6 pl-3 border-l-2 border-[var(--gold)]/40">
                  <Textarea
                    rows={2}
                    placeholder="Sua resposta..."
                    value={respostaTexto[top.id] || ""}
                    onChange={(e) =>
                      setRespostaTexto((prev) => ({
                        ...prev,
                        [top.id]: e.target.value,
                      }))
                    }
                    className="text-sm"
                    autoFocus
                  />
                  <div className="flex justify-end gap-2 mt-2">
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        setRespondendoEm(null);
                        setRespostaTexto((prev) => ({ ...prev, [top.id]: "" }));
                      }}
                      disabled={enviando}
                    >
                      Cancelar
                    </Button>
                    <Button
                      size="sm"
                      onClick={() => enviarComentario(respostaTexto[top.id] || "", top.id)}
                      disabled={enviando || !(respostaTexto[top.id] || "").trim()}
                    >
                      {enviando && <Loader2 className="h-3 w-3 mr-2 animate-spin" />}
                      Responder
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="ml-6">
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setRespondendoEm(top.id)}
                    className="text-xs h-7 text-muted-foreground hover:text-foreground"
                  >
                    Responder
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        ))
      )}
    </div>
  );
}

function ComentarioItem(props: {
  comentario: ComentarioRow;
  podeExcluir: boolean;
  onExcluir: () => void;
  excluindo: boolean;
  destacado?: boolean;
}) {
  const { comentario, podeExcluir, onExcluir, excluindo, destacado } = props;
  const autorNome = comentario.autor?.nome || comentario.autor?.email || "(sem nome)";
  const tipo = comentario.autor?.tipo;

  return (
    <div
      id={"foco-" + comentario.id}
      className={"flex gap-3 " + (destacado ? DESTAQUE_CLASSE + " p-2" : "")}
    >
      <Avatar className="h-8 w-8 shrink-0">
        <AvatarFallback className="bg-primary text-primary-foreground text-xs">
          {autorNome
            .split(" ")
            .map((p) => p[0])
            .slice(0, 2)
            .join("")
            .toUpperCase()}
        </AvatarFallback>
      </Avatar>
      <div className="flex-1 min-w-0">
        <div className="flex flex-wrap items-baseline gap-2 mb-1">
          <span className="text-sm font-medium">{autorNome}</span>
          <Badge variant="outline" className={"text-[10px] font-normal " + tipoBadgeClasses(tipo)}>
            {tipoBadgeLabel(tipo)}
          </Badge>
          <span className="text-xs text-muted-foreground">
            {formatDateTime(comentario.created_at)}
          </span>
          {podeExcluir && (
            <Button
              size="sm"
              variant="ghost"
              onClick={onExcluir}
              disabled={excluindo}
              className="h-5 px-1 text-xs text-muted-foreground hover:text-destructive ml-auto"
            >
              {excluindo ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <Trash2 className="h-3 w-3" />
              )}
            </Button>
          )}
        </div>
        <p className="text-sm whitespace-pre-wrap text-foreground/90">{comentario.texto}</p>
      </div>
    </div>
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
  const [totalRecebido, setTotalRecebido] = useState("");
  const [pctRepasse, setPctRepasse] = useState("30");
  const [pctParceiro, setPctParceiro] = useState(30);
  const [statusInicial, setStatusInicial] = useState("previsto");
  const [salvando, setSalvando] = useState(false);

  // Busca o % de repasse padrão do parceiro para pré-preencher o cálculo.
  useEffect(() => {
    if (!parceiroId) return;
    (async () => {
      const { data } = await supabase
        .from("usuarios")
        .select("percentual_parceiro")
        .eq("id", parceiroId)
        .maybeSingle();
      const pct = (data as { percentual_parceiro?: number } | null)
        ?.percentual_parceiro;
      if (pct != null) {
        setPctParceiro(Number(pct));
        setPctRepasse(String(pct));
      }
    })();
  }, [parceiroId]);

  // Valor do repasse = total recebido × % do parceiro (2 casas).
  const totalNum = parseFloat((totalRecebido || "").replace(",", "."));
  const pctNum = parseFloat((pctRepasse || "").replace(",", "."));
  const valorRepasse =
    !isNaN(totalNum) && totalNum > 0 && !isNaN(pctNum)
      ? Math.round(totalNum * pctNum) / 100
      : 0;

  const lista = isInterno ? repasses : repasses.filter((r) => r.parceiro_id === parceiroId);

  const total = lista.reduce((acc, r) => acc + (r.valor || 0), 0);
  const pago = lista.filter((r) => r.status === "pago").reduce((acc, r) => acc + (r.valor || 0), 0);
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
    if (isNaN(totalNum) || totalNum <= 0) {
      toast.error("Informe o valor total recebido");
      return;
    }
    if (valorRepasse <= 0) {
      toast.error("Valor de repasse inválido");
      return;
    }
    setSalvando(true);
    try {
      const resp = await supabase.from("repasses").insert({
        caso_id: casoId,
        parceiro_id: parceiroId,
        valor: valorRepasse,
        percentual: Math.min(100, Math.max(0, pctNum || pctParceiro)),
        status: statusInicial,
      });
      if (resp.error) throw resp.error;
      toast.success("Repasse registrado");
      setTotalRecebido("");
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
      const resp = await supabase.from("repasses").update(update).eq("id", r.id);
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
              Honorários do parceiro indicador ({pctParceiro}%).
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
                  <div className="grid grid-cols-[1fr_auto] gap-2">
                    <div>
                      <Label className="text-xs">Valor total recebido (R$)</Label>
                      <Input
                        type="text"
                        inputMode="decimal"
                        placeholder="0,00"
                        value={totalRecebido}
                        onChange={(e) => setTotalRecebido(e.target.value)}
                      />
                    </div>
                    <div className="w-20">
                      <Label className="text-xs">% parceiro</Label>
                      <Input
                        type="number"
                        inputMode="decimal"
                        min={0}
                        max={100}
                        value={pctRepasse}
                        onChange={(e) => setPctRepasse(e.target.value)}
                      />
                    </div>
                  </div>
                  <div className="rounded-md border bg-muted/40 px-3 py-2 text-sm">
                    Repasse ao parceiro:{" "}
                    <span className="font-semibold">{formatMoney(valorRepasse)}</span>
                  </div>
                  <div>
                    <Label className="text-xs">Status inicial</Label>
                    <Select value={statusInicial} onValueChange={setStatusInicial}>
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
                  <Button variant="ghost" onClick={() => setAberto(false)} disabled={salvando}>
                    Cancelar
                  </Button>
                  <Button onClick={adicionar} disabled={salvando}>
                    {salvando && <Loader2 className="h-3 w-3 mr-2 animate-spin" />}
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
            <p className="text-base font-medium text-muted-foreground">{formatMoney(previsto)}</p>
          </div>
          <div className="border rounded-md p-3">
            <p className="text-xs text-muted-foreground">A pagar</p>
            <p className="text-base font-medium text-warning">{formatMoney(aPagar)}</p>
          </div>
          <div className="border rounded-md p-3">
            <p className="text-xs text-muted-foreground">Pago</p>
            <p className="text-base font-medium text-success">{formatMoney(pago)}</p>
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
                  <p className="text-sm font-medium">{formatMoney(r.valor)}</p>
                  <p className="text-xs text-muted-foreground">
                    Criado em {formatDate(r.created_at)}
                    {r.data_pagamento ? " - Pago em " + formatDate(r.data_pagamento) : ""}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant={r.status === "pago" ? "default" : "outline"}>
                    {STATUS_REPASSE_LABEL[r.status] || r.status}
                  </Badge>
                  {isInterno && r.status !== "pago" && (
                    <Select value={r.status} onValueChange={(v) => atualizarStatus(r, v)}>
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
  isInterno: boolean;
  processosAdmin: Array<ProcessoAdmin>;
  processosJudiciais: Array<ProcessoJudicial>;
  focoId?: string;
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
  const {
    casoId,
    cliente,
    usuarioId,
    isInterno,
    processosAdmin,
    processosJudiciais,
    focoId,
    onChange,
  } = props;
  const foco = useFocoItem(focoId);

  const [abrirAdmin, setAbrirAdmin] = useState(false);
  const [editAdminId, setEditAdminId] = useState<string | null>(null);
  const [numReq, setNumReq] = useState("");
  const [dataProtocolo, setDataProtocolo] = useState("");
  const [decisao, setDecisao] = useState("");
  const [dataDecisao, setDataDecisao] = useState("");
  const [etapaAdmin, setEtapaAdmin] = useState("");
  const [parentAdmin, setParentAdmin] = useState("");
  const [tipoBeneficioAdmin, setTipoBeneficioAdmin] = useState("");
  const [salvandoAdmin, setSalvandoAdmin] = useState(false);

  const [abrirJud, setAbrirJud] = useState(false);
  const [editJudId, setEditJudId] = useState<string | null>(null);
  const [numProcesso, setNumProcesso] = useState("");
  const [vara, setVara] = useState("");
  const [comarca, setComarca] = useState("");
  const [uf, setUf] = useState("");
  const [dataDist, setDataDist] = useState("");
  const [etapaJud, setEtapaJud] = useState("");
  const [parentJud, setParentJud] = useState("");
  const [salvandoJud, setSalvandoJud] = useState(false);

  const [excluindo, setExcluindo] = useState<ProcNode | null>(null);
  const [excluindoLoading, setExcluindoLoading] = useState(false);

  // Quando a Naira cola/digita o número do processo judicial:
  //  1. Parse CNJ local — auto-preenche Tribunal/UF na hora pelo TR.
  //  2. Quando o número está completo (20 dígitos), consulta o DataJud
  //     (CNJ) pra puxar comarca (município) e vara (órgão julgador).
  // Não sobrescreve campos já preenchidos manualmente.
  const ultimaConsultaRef = useRef<string>("");
  const [consultandoDataJud, setConsultandoDataJud] = useState(false);

  function aoDigitarNumProcesso(novo: string) {
    setNumProcesso(novo);
    const parsed = parseCnj(novo);
    if (!parsed.valido) return;
    // Quando o número está válido (20 dígitos), o tribunal/UF são
    // determinísticos: SEMPRE sobrescreve. Isso evita state preso de
    // outras tentativas e bugs de "(atual)" no select.
    if (parsed.tribunal) setVara(parsed.tribunal);
    if (parsed.uf) setUf(parsed.uf);

    // Consulta DataJud só uma vez por número.
    const digitos = novo.replace(/\D/g, "");
    if (digitos === ultimaConsultaRef.current) return;
    ultimaConsultaRef.current = digitos;
    setConsultandoDataJud(true);
    supabase.functions
      .invoke("cnj-consulta-processo", {
        body: { numero: novo },
        headers: { "x-region": "sa-east-1" },
      })
      .then(({ data }) => {
        if (!data?.encontrado) return;
        // DataJud é fonte autoritativa: sobrescreve comarca/vara também.
        if (data.comarca) setComarca(data.comarca);
        if (data.tribunal) setVara(data.tribunal);
      })
      .catch(() => {})
      .finally(() => setConsultandoDataJud(false));
  }

  // ---- Arvore de processos (admin + judicial num mesmo formato) ----
  const allNodes = useMemo<Array<ProcNode>>(
    () => [
      ...processosAdmin.map((p) => ({
        tipo: "admin" as const,
        id: p.id,
        parent_id: p.parent_id,
        parent_tipo: p.parent_tipo,
        etapa_tipo: p.etapa_tipo,
        numero: p.numero_requerimento,
        admin: p,
      })),
      ...processosJudiciais.map((p) => ({
        tipo: "judicial" as const,
        id: p.id,
        parent_id: p.parent_id,
        parent_tipo: p.parent_tipo,
        etapa_tipo: p.etapa_tipo,
        numero: p.numero_processo,
        judicial: p,
      })),
    ],
    [processosAdmin, processosJudiciais],
  );

  const idSet = useMemo(() => new Set(allNodes.map((n) => n.id)), [allNodes]);
  // Pai inexistente (registro removido) => tratamos como raiz, pra nao sumir.
  const isRaiz = (n: ProcNode) => !n.parent_id || !idSet.has(n.parent_id);
  const childrenOf = (id: string) => allNodes.filter((n) => n.parent_id === id);

  function descendantes(rootId: string): Set<string> {
    const out = new Set<string>();
    const pilha = [rootId];
    while (pilha.length) {
      const cur = pilha.pop() as string;
      for (const n of allNodes) {
        if (n.parent_id === cur && !out.has(n.id)) {
          out.add(n.id);
          pilha.push(n.id);
        }
      }
    }
    return out;
  }

  // Opcoes de pai: todos os processos menos o proprio e seus descendentes (evita ciclo).
  function parentOptions(selfId: string | null): Array<ProcNode> {
    const bloqueados = new Set<string>();
    if (selfId) {
      bloqueados.add(selfId);
      for (const d of descendantes(selfId)) bloqueados.add(d);
    }
    return allNodes.filter((n) => !bloqueados.has(n.id));
  }

  function nodeLabel(n: ProcNode): string {
    const t = n.tipo === "admin" ? "Adm" : "Jud";
    const num = n.numero || "(sem número)";
    return t + " . " + num + (n.etapa_tipo ? " . " + n.etapa_tipo : "");
  }

  function resetAdmin() {
    setEditAdminId(null);
    setNumReq("");
    setDataProtocolo("");
    setDecisao("");
    setDataDecisao("");
    setEtapaAdmin("");
    setParentAdmin("");
    setTipoBeneficioAdmin("");
  }
  function abrirNovoAdmin(parentId = "") {
    resetAdmin();
    setParentAdmin(parentId);
    setAbrirAdmin(true);
  }
  function abrirEditarAdmin(p: ProcessoAdmin) {
    setEditAdminId(p.id);
    setNumReq(p.numero_requerimento || "");
    setDataProtocolo(p.data_protocolo || "");
    setDecisao(p.decisao || "");
    setDataDecisao(p.data_decisao || "");
    setEtapaAdmin(p.etapa_tipo || "");
    setParentAdmin(p.parent_id || "");
    setTipoBeneficioAdmin(p.tipo_beneficio || "");
    setAbrirAdmin(true);
  }

  function resetJud() {
    setEditJudId(null);
    setNumProcesso("");
    setVara("");
    setComarca("");
    setUf("");
    setDataDist("");
    setEtapaJud("");
    setParentJud("");
  }
  function abrirNovoJud(parentId = "") {
    resetJud();
    setParentJud(parentId);
    setAbrirJud(true);
  }
  function abrirEditarJud(p: ProcessoJudicial) {
    setEditJudId(p.id);
    setNumProcesso(p.numero_processo || "");
    setVara(p.vara || "");
    setComarca(p.comarca || "");
    setUf(p.uf || "");
    setDataDist(p.data_distribuicao || "");
    setEtapaJud(p.etapa_tipo || "");
    setParentJud(p.parent_id || "");
    setAbrirJud(true);
  }

  // Checa numero duplicado (global) usando a coluna normalizada do banco.
  // Se a coluna ainda nao existir (migration nao aplicada), nao bloqueia aqui
  // e deixa o indice unico do banco ser a rede de seguranca.
  async function numeroDuplicado(
    tabela: "processos_admin" | "processos_judiciais",
    colunaNorm: string,
    numero: string,
    ignoreId: string | null,
  ): Promise<{ id: string; caso_id: string } | null> {
    const norm = numero.replace(/\D/g, "");
    if (!norm) return null;
    const resp = await supabase.from(tabela).select("id, caso_id").eq(colunaNorm, norm).limit(1);
    if (resp.error) return null;
    const found = (resp.data || [])[0] as { id: string; caso_id: string } | undefined;
    if (found && found.id !== ignoreId) return found;
    return null;
  }

  // ---- Busca no Legalmail ----
  const [abrirBuscaLM, setAbrirBuscaLM] = useState(false);
  const [buscandoLM, setBuscandoLM] = useState(false);
  const [resultadosLM, setResultadosLM] = useState<Array<ResultadoBuscaLM>>([]);
  const [selecionadosLM, setSelecionadosLM] = useState<Set<string>>(new Set());
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
          lista.length +
            " processo" +
            (lista.length === 1 ? "" : "s") +
            " similar" +
            (lista.length === 1 ? "" : "es") +
            " encontrado" +
            (lista.length === 1 ? "" : "s") +
            ".",
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
      msg += mi + " movimentaç" + (mi === 1 ? "ão" : "ões") + " importada" + (mi === 1 ? "" : "s");
      if (mj > 0) {
        msg += " (" + mj + " já existia" + (mj === 1 ? "" : "m") + ")";
      }
      if (mig > 0) {
        msg +=
          ". " +
          mig +
          " mov" +
          (mig === 1 ? "" : "s") +
          " ignorada" +
          (mig === 1 ? "" : "s") +
          " pela whitelist";
      }
      msg += ".";
      toast.success(msg);
      if (r.erros && r.erros.length > 0) {
        console.warn("erros no import legalmail:", r.erros);
        toast.warning(r.erros.length + " erro(s) durante importação. Ver console.");
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
    if (numReq.trim()) {
      const dup = await numeroDuplicado(
        "processos_admin",
        "numero_req_normalizado",
        numReq,
        editAdminId,
      );
      if (dup) {
        toast.error(
          dup.caso_id === casoId
            ? "Já existe um processo administrativo com esse número neste caso."
            : "Esse número de requerimento já está cadastrado em outro caso.",
        );
        return;
      }
    }
    setSalvandoAdmin(true);
    try {
      const parentTipo = parentAdmin
        ? (allNodes.find((n) => n.id === parentAdmin)?.tipo ?? null)
        : null;
      const payload = {
        caso_id: casoId,
        numero_requerimento: numReq.trim() || null,
        data_protocolo: dataProtocolo || null,
        decisao: decisao.trim() || null,
        data_decisao: dataDecisao || null,
        etapa_tipo: etapaAdmin || null,
        parent_id: parentAdmin || null,
        parent_tipo: parentTipo,
        tipo_beneficio: tipoBeneficioAdmin || null,
      };
      const resp = editAdminId
        ? await supabase.from("processos_admin").update(payload).eq("id", editAdminId)
        : await supabase.from("processos_admin").insert(payload);
      if (resp.error) throw resp.error;
      toast.success(
        editAdminId ? "Processo administrativo atualizado" : "Processo administrativo registrado",
      );
      resetAdmin();
      setAbrirAdmin(false);
      onChange();
    } catch (err) {
      console.error(err);
      const errObj = err as { message?: string; code?: string };
      toast.error(
        errObj.code === "23505"
          ? "Número já cadastrado no sistema: esse requerimento já existe."
          : errObj.message || "Erro ao registrar processo",
      );
    } finally {
      setSalvandoAdmin(false);
    }
  }

  async function salvarJud() {
    const faltando: Array<string> = [];
    if (!numProcesso.trim()) faltando.push("Número do processo");
    if (!vara.trim()) faltando.push("Tribunal");
    if (!comarca.trim()) faltando.push("Comarca");
    if (!uf.trim()) faltando.push("UF");
    if (!dataDist) faltando.push("Data da distribuição");
    if (faltando.length > 0) {
      toast.error("Preencha os campos obrigatórios: " + faltando.join(", "));
      return;
    }
    if (numProcesso.trim()) {
      const dup = await numeroDuplicado(
        "processos_judiciais",
        "numero_proc_normalizado",
        numProcesso,
        editJudId,
      );
      if (dup) {
        toast.error(
          dup.caso_id === casoId
            ? "Já existe um processo judicial com esse número neste caso."
            : "Esse número de processo já está cadastrado em outro caso.",
        );
        return;
      }
    }
    setSalvandoJud(true);
    try {
      const parentTipo = parentJud
        ? (allNodes.find((n) => n.id === parentJud)?.tipo ?? null)
        : null;
      const payload = {
        caso_id: casoId,
        numero_processo: numProcesso.trim() || null,
        vara: vara.trim() || null,
        comarca: comarca.trim() || null,
        uf: uf.trim() || null,
        data_distribuicao: dataDist || null,
        etapa_tipo: etapaJud || null,
        parent_id: parentJud || null,
        parent_tipo: parentTipo,
      };
      const resp = editJudId
        ? await supabase.from("processos_judiciais").update(payload).eq("id", editJudId)
        : await supabase.from("processos_judiciais").insert(payload);
      if (resp.error) throw resp.error;
      toast.success(editJudId ? "Processo judicial atualizado" : "Processo judicial registrado");
      resetJud();
      setAbrirJud(false);
      onChange();
    } catch (err) {
      console.error(err);
      const errObj = err as { message?: string; code?: string };
      toast.error(
        errObj.code === "23505"
          ? "Número já cadastrado no sistema: esse processo já existe."
          : errObj.message || "Erro ao registrar processo",
      );
    } finally {
      setSalvandoJud(false);
    }
  }

  async function confirmarExclusao() {
    if (!excluindo) return;
    const node = excluindo;
    setExcluindoLoading(true);
    try {
      // Religa os filhos ao "avo" (pai do no excluido) pra nao deixar orfaos.
      const temFilhos = allNodes.some((n) => n.parent_id === node.id);
      if (temFilhos) {
        const upd = { parent_id: node.parent_id, parent_tipo: node.parent_tipo };
        const r1 = await supabase.from("processos_admin").update(upd).eq("parent_id", node.id);
        if (r1.error) throw r1.error;
        const r2 = await supabase.from("processos_judiciais").update(upd).eq("parent_id", node.id);
        if (r2.error) throw r2.error;
      }
      const tabela = node.tipo === "admin" ? "processos_admin" : "processos_judiciais";
      const del = await supabase.from(tabela).delete().eq("id", node.id);
      if (del.error) throw del.error;
      toast.success("Processo excluído");
      setExcluindo(null);
      onChange();
    } catch (err) {
      console.error(err);
      const errObj = err as { message?: string };
      toast.error(errObj.message || "Erro ao excluir processo");
    } finally {
      setExcluindoLoading(false);
    }
  }

  function renderNode(node: ProcNode, depth: number) {
    const filhos = childrenOf(node.id);
    return (
      <li key={node.tipo + ":" + node.id} className="space-y-2">
        <div
          id={"foco-" + node.id}
          className={"border rounded-md p-3 " + (foco === node.id ? DESTAQUE_CLASSE : "")}
          style={{ marginLeft: depth * 16 }}
        >
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <p className="text-sm font-medium">
                  {node.tipo === "admin" ? "Req.: " : "Processo: "}
                  <span className="font-mono tabular-nums">{node.numero || "-"}</span>
                </p>
                <Badge
                  variant={node.tipo === "admin" ? "secondary" : "outline"}
                  className="text-xs"
                >
                  {node.tipo === "admin" ? "Administrativo" : "Judicial"}
                </Badge>
                {node.etapa_tipo && (
                  <Badge variant="outline" className="text-xs">
                    {node.etapa_tipo}
                  </Badge>
                )}
                {node.admin?.tipo_beneficio && (
                  <Badge variant="outline" className="text-xs">
                    {node.admin.tipo_beneficio}
                  </Badge>
                )}
              </div>
              {node.tipo === "admin" ? (
                <>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {node.admin?.data_protocolo
                      ? "Protocolado em " + formatDate(node.admin.data_protocolo)
                      : "Sem data de protocolo"}
                    {node.admin?.data_decisao
                      ? " - Decidido em " + formatDate(node.admin.data_decisao)
                      : ""}
                  </p>
                  {node.admin?.decisao && (
                    <Badge variant="outline" className="mt-1">
                      {node.admin.decisao}
                    </Badge>
                  )}
                </>
              ) : (
                <p className="text-xs text-muted-foreground mt-0.5">
                  {node.judicial?.vara ? node.judicial.vara + " - " : ""}
                  {node.judicial?.comarca ? node.judicial.comarca : ""}
                  {node.judicial?.uf ? "/" + node.judicial.uf : ""}
                  {node.judicial?.data_distribuicao
                    ? " - Distribuído em " + formatDate(node.judicial.data_distribuicao)
                    : ""}
                </p>
              )}
            </div>
            {isInterno && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0">
                    <MoreVertical className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem
                    onClick={() =>
                      node.tipo === "admin"
                        ? abrirEditarAdmin(node.admin as ProcessoAdmin)
                        : abrirEditarJud(node.judicial as ProcessoJudicial)
                    }
                  >
                    <Pencil className="h-4 w-4 mr-2" />
                    Editar
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => abrirNovoAdmin(node.id)}>
                    <Plus className="h-4 w-4 mr-2" />
                    Sub-processo administrativo
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => abrirNovoJud(node.id)}>
                    <Plus className="h-4 w-4 mr-2" />
                    Sub-processo judicial
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    className="text-destructive focus:text-destructive"
                    onClick={() => setExcluindo(node)}
                  >
                    <Trash2 className="h-4 w-4 mr-2" />
                    Excluir
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>
        </div>
        {filhos.length > 0 && (
          <ul className="space-y-2">{filhos.map((c) => renderNode(c, depth + 1))}</ul>
        )}
      </li>
    );
  }

  const adminRaizes = allNodes.filter((n) => n.tipo === "admin" && isRaiz(n));
  const judRaizes = allNodes.filter((n) => n.tipo === "judicial" && isRaiz(n));

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-base">Processos administrativos</CardTitle>
              <CardDescription>Requerimentos protocolados no INSS.</CardDescription>
            </div>
            {isInterno && (
              <Button size="sm" onClick={() => abrirNovoAdmin()}>
                <Plus className="h-4 w-4 mr-2" />
                Novo
              </Button>
            )}
            <Dialog open={abrirAdmin} onOpenChange={setAbrirAdmin}>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>
                    {editAdminId
                      ? "Editar processo administrativo"
                      : "Novo processo administrativo"}
                  </DialogTitle>
                </DialogHeader>
                <div className="space-y-3">
                  <div>
                    <Label className="text-xs">Número do requerimento</Label>
                    <Input
                      value={numReq}
                      onChange={(e) => setNumReq(e.target.value)}
                      placeholder="0000000000000000"
                    />
                  </div>
                  <div>
                    <Label className="text-xs">Tipo de benefício</Label>
                    <Select
                      value={tipoBeneficioAdmin || "__none__"}
                      onValueChange={(v) => setTipoBeneficioAdmin(v === "__none__" ? "" : v)}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Selecione o benefício" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__none__">Não informado</SelectItem>
                        {TIPOS_BENEFICIO.map((b) => (
                          <SelectItem key={b} value={b}>
                            {b}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label className="text-xs">Processo de origem (pai)</Label>
                    <Select
                      value={parentAdmin || "__none__"}
                      onValueChange={(v) => setParentAdmin(v === "__none__" ? "" : v)}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Nenhum (principal)" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__none__">Nenhum (principal)</SelectItem>
                        {parentOptions(editAdminId).map((n) => (
                          <SelectItem key={n.tipo + ":" + n.id} value={n.id}>
                            {nodeLabel(n)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
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
                    <Label className="text-xs">Decisão (se houver)</Label>
                    <Input
                      value={decisao}
                      onChange={(e) => setDecisao(e.target.value)}
                      placeholder="Ex.: deferido, indeferido, em exigência..."
                    />
                  </div>
                  <div>
                    <Label className="text-xs">Data da decisão</Label>
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
                    {salvandoAdmin && <Loader2 className="h-3 w-3 mr-2 animate-spin" />}
                    Salvar
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
        </CardHeader>
        <CardContent>
          {adminRaizes.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-6">
              Nenhum processo administrativo registrado.
            </p>
          ) : (
            <ul className="space-y-2">{adminRaizes.map((n) => renderNode(n, 0))}</ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div>
              <CardTitle className="text-base">Processos judiciais</CardTitle>
              <CardDescription>Ações ajuizadas relacionadas ao caso.</CardDescription>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              {isInterno && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={buscarLegalmail}
                  disabled={buscandoLM || !cliente.nome}
                  title="Buscar processos no Legalmail pelo nome do cliente"
                >
                  {buscandoLM && <Loader2 className="h-3 w-3 mr-2 animate-spin" />}
                  <Search className="h-4 w-4 mr-1" />
                  Buscar no Legalmail
                </Button>
              )}
              {isInterno && (
                <Button size="sm" onClick={() => abrirNovoJud()}>
                  <Plus className="h-4 w-4 mr-2" />
                  Novo
                </Button>
              )}
              <Dialog open={abrirJud} onOpenChange={setAbrirJud}>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>
                      {editJudId ? "Editar processo judicial" : "Novo processo judicial"}
                    </DialogTitle>
                  </DialogHeader>
                  <div className="space-y-3">
                    <div>
                      <Label className="text-xs">Número do processo *</Label>
                      <Input
                        value={numProcesso}
                        onChange={(e) => aoDigitarNumProcesso(e.target.value)}
                        placeholder="0000000-00.0000.0.00.0000"
                      />
                      {(() => {
                        const p = parseCnj(numProcesso);
                        if (!p.valido || !p.tribunal) return null;
                        return (
                          <p className="text-xs text-muted-foreground mt-1 flex items-center gap-1 flex-wrap">
                            <span>
                              Identificado: {p.tribunal}
                              {p.uf ? ` (${p.uf})` : ""} · {p.segmento} · ano {p.ano}
                            </span>
                            {consultandoDataJud && (
                              <span className="inline-flex items-center gap-1">
                                <Loader2 className="h-3 w-3 animate-spin" />
                                Consultando DataJud…
                              </span>
                            )}
                          </p>
                        );
                      })()}
                    </div>
                    <div>
                      <Label className="text-xs">Processo de origem (pai)</Label>
                      <Select
                        value={parentJud || "__none__"}
                        onValueChange={(v) => setParentJud(v === "__none__" ? "" : v)}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Nenhum (principal)" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="__none__">Nenhum (principal)</SelectItem>
                          {parentOptions(editJudId).map((n) => (
                            <SelectItem key={n.tipo + ":" + n.id} value={n.id}>
                              {nodeLabel(n)}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <Label className="text-xs">Tribunal *</Label>
                      <Select value={vara || undefined} onValueChange={setVara}>
                        <SelectTrigger>
                          <SelectValue placeholder="Selecione o tribunal" />
                        </SelectTrigger>
                        <SelectContent>
                          {vara && !TRIBUNAIS.includes(vara) && (
                            <SelectItem value={vara}>{vara} (atual)</SelectItem>
                          )}
                          <SelectGroup>
                            <SelectLabel>Justiça Federal</SelectLabel>
                            {TRIBUNAIS_FEDERAIS.map((t) => (
                              <SelectItem key={t} value={t}>
                                {t}
                              </SelectItem>
                            ))}
                          </SelectGroup>
                          <SelectGroup>
                            <SelectLabel>Justiça Estadual</SelectLabel>
                            {TRIBUNAIS_ESTADUAIS.map((t) => (
                              <SelectItem key={t} value={t}>
                                {t}
                              </SelectItem>
                            ))}
                          </SelectGroup>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="grid grid-cols-3 gap-2">
                      <div className="col-span-2">
                        <Label className="text-xs">Comarca *</Label>
                        <Input
                          value={comarca}
                          onChange={(e) => setComarca(e.target.value)}
                          placeholder="Ex.: São Paulo"
                        />
                      </div>
                      <div>
                        <Label className="text-xs">UF *</Label>
                        <Input
                          value={uf}
                          onChange={(e) => setUf(e.target.value.toUpperCase().slice(0, 2))}
                          placeholder="SP"
                          maxLength={2}
                        />
                      </div>
                    </div>
                    <div>
                      <Label className="text-xs">Data da distribuição *</Label>
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
                      {salvandoJud && <Loader2 className="h-3 w-3 mr-2 animate-spin" />}
                      Salvar
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {judRaizes.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-6">
              Nenhum processo judicial registrado.
            </p>
          ) : (
            <ul className="space-y-2">{judRaizes.map((n) => renderNode(n, 0))}</ul>
          )}
        </CardContent>
      </Card>

      <Dialog open={abrirBuscaLM} onOpenChange={setAbrirBuscaLM}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Processos no Legalmail</DialogTitle>
            <DialogDescription>
              Resultados de busca por nome para "{cliente.nome}". Marque os que quer importar.
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
                  <li key={idStr} className="border rounded-md p-3 flex items-start gap-3">
                    <input
                      type="checkbox"
                      checked={marcado}
                      onChange={() => toggleSelecionadoLM(idStr)}
                      className="h-4 w-4 mt-0.5"
                    />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="text-sm font-medium">{r.numero_processo}</p>
                        <Badge variant="outline" className="text-xs" title="Similaridade do nome">
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
                        <p className="text-xs text-muted-foreground">Tema: {r.processo_tema}</p>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
          <DialogFooter>
            <Button variant="ghost" onClick={() => setAbrirBuscaLM(false)} disabled={importandoLM}>
              Cancelar
            </Button>
            <Button
              onClick={importarSelecionadosLM}
              disabled={importandoLM || buscandoLM || selecionadosLM.size === 0}
            >
              {importandoLM && <Loader2 className="h-3 w-3 mr-2 animate-spin" />}
              Importar selecionados ({selecionadosLM.size})
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={!!excluindo}
        onOpenChange={(o) => {
          if (!o) setExcluindo(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir processo?</AlertDialogTitle>
            <AlertDialogDescription>
              {excluindo && childrenOf(excluindo.id).length > 0
                ? "Este processo tem " +
                  childrenOf(excluindo.id).length +
                  " sub-processo(s). Eles serão mantidos e religados ao processo de origem deste. Esta ação não pode ser desfeita."
                : "Esta ação não pode ser desfeita."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={excluindoLoading}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                confirmarExclusao();
              }}
              disabled={excluindoLoading}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {excluindoLoading && <Loader2 className="h-3 w-3 mr-2 animate-spin" />}
              Excluir
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

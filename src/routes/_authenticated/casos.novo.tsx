import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import { ArrowLeft, Loader2, Eye, EyeOff, Plus, X, FileText, FileDown, Search } from "lucide-react";

import { useAuth } from "@/hooks/use-auth";
import { supabase } from "@/lib/supabase";
import { MAX_FILE_SIZE_MB, validateFileSizes } from "@/lib/upload-limits";
import { ClientOnly } from "@/components/client-only";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { DocTypeCombobox } from "@/components/doc-type-combobox";
import { NovoParceiroDialog } from "@/components/novo-parceiro-dialog";
import { notificarEquipe } from "@/lib/notificar";
import { DrivePickerDialog, type DriveImportedFile } from "@/components/drive-picker-dialog";
import {
  abrirDrivePicker,
  isGoogleDriveConfigured,
  type DrivePickedFile,
} from "@/lib/google-drive";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export const Route = createFileRoute("/_authenticated/casos/novo")({
  component: NovoCasoPage,
});

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

const TIPOS_DOCUMENTO = [
  { value: "cnis", label: "CNIS" },
  { value: "rg_cpf", label: "RG / CPF" },
  { value: "comprovante_residencia", label: "Comprovante de residência" },
  { value: "ctps", label: "CTPS" },
  { value: "holerite", label: "Holerite / contracheque" },
  { value: "ppp", label: "PPP" },
  { value: "laudo_medico", label: "Laudo médico" },
  { value: "ltcat", label: "LTCAT" },
  { value: "atestado_medico", label: "Atestado médico" },
  { value: "cat", label: "CAT (Comunicação de Acidente de Trabalho)" },
  { value: "carne_gps", label: "Carnê de contribuição (GPS)" },
  { value: "ctc", label: "CTC" },
  { value: "carta_concessao_inss", label: "Carta de concessão / indeferimento INSS" },
  { value: "hiscre", label: "HISCRE (Histórico de Créditos)" },
  { value: "certidao_casamento", label: "Certidão de casamento" },
  { value: "certidao_obito", label: "Certidão de óbito" },
  { value: "certidao_nascimento", label: "Certidão de nascimento" },
  { value: "declaracao_uniao_estavel", label: "Declaração de união estável" },
  { value: "declaracao_atividade_rural", label: "Declaração de atividade rural" },
  { value: "procuracao", label: "Procuração" },
  { value: "substabelecimento", label: "Substabelecimento" },
  { value: "contrato_honorarios", label: "Contrato de honorários" },
  {
    value: "declaracao_hipossuficiencia",
    label: "Declaração de hipossuficiência",
  },
  {
    value: "declaracao_ausencia_duplicidade",
    label: "Declaração de ausência de duplicidade de ação",
  },
  { value: "outro", label: "Outro" },
];

type TipoDocumento = string;

interface DocUpload {
  id: string;
  file: File | null;
  tipo: TipoDocumento;
  tipoPersonalizado: string;
  // Quando o doc veio do Drive, guarda o file_id pra dedupe futura.
  gdriveFileId?: string;
  // Caminho da subpasta no Drive (ex.: "Diversos"). Vazio = raiz/manual.
  pastaRelativa?: string;
}

// Helpers de mascara e validacao
function maskCPF(v: string) {
  return v
    .replace(/\D/g, "")
    .slice(0, 11)
    .replace(/(\d{3})(\d)/, "$1.$2")
    .replace(/(\d{3})(\d)/, "$1.$2")
    .replace(/(\d{3})(\d{1,2})$/, "$1-$2");
}

function maskTelefone(v: string) {
  const d = v.replace(/\D/g, "").slice(0, 11);
  if (d.length <= 10) {
    return d.replace(/(\d{2})(\d)/, "($1) $2").replace(/(\d{4})(\d)/, "$1-$2");
  }
  return d.replace(/(\d{2})(\d)/, "($1) $2").replace(/(\d{5})(\d)/, "$1-$2");
}

function isValidCPF(cpf: string): boolean {
  const c = cpf.replace(/\D/g, "");
  if (c.length !== 11 || /^(\d)\1{10}$/.test(c)) return false;
  let sum = 0;
  for (let i = 0; i < 9; i++) sum += parseInt(c[i]) * (10 - i);
  let d1 = (sum * 10) % 11;
  if (d1 === 10) d1 = 0;
  if (d1 !== parseInt(c[9])) return false;
  sum = 0;
  for (let i = 0; i < 10; i++) sum += parseInt(c[i]) * (11 - i);
  let d2 = (sum * 10) % 11;
  if (d2 === 10) d2 = 0;
  return d2 === parseInt(c[10]);
}

function sanitizeFileName(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9._-]/g, "_");
}

const schema = z.object({
  nome: z.string().trim().min(3, "Informe o nome completo").max(150),
  cpf: z
    .string()
    .min(14, "CPF incompleto")
    .refine((v) => isValidCPF(v), "CPF inválido"),
  data_nascimento: z.string().min(1, "Informe a data de nascimento"),
  telefone: z.string().trim().min(14, "Telefone incompleto").max(16),
  email: z.string().trim().email("E-mail inválido").max(150).optional().or(z.literal("")),
  senha_meu_inss: z.string().max(100).optional().or(z.literal("")),
  endereco: z.string().max(200).optional().or(z.literal("")),
  observacoes_cliente: z.string().max(1000).optional().or(z.literal("")),
  tipo_beneficio: z.string().min(1, "Selecione o tipo de benefício"),
  cliente_interno: z.boolean().optional(),
  parceiro_id: z.string().optional().or(z.literal("")),
  observacoes_caso: z.string().max(1000).optional().or(z.literal("")),
});

type FormValues = z.infer<typeof schema>;

interface ParceiroOption {
  id: string;
  nome: string | null;
  email: string | null;
}

interface ClienteExistenteRow {
  id: string;
  casos: Array<{ id: string }> | null;
}

interface ClienteInsertRow {
  id: string;
}

interface CasoInsertRow {
  id: string;
}

interface PostgresError {
  code?: string;
  message?: string;
}

function NovoCasoPage() {
  const { usuario } = useAuth();
  const navigate = useNavigate();
  const [parceiros, setParceiros] = useState<Array<ParceiroOption>>([]);
  const [submitting, setSubmitting] = useState(false);
  const [showPwd, setShowPwd] = useState(false);
  const [buscandoTI, setBuscandoTI] = useState(false);
  // Marca que o cliente foi localizado no TI via "Buscar no TI". Quando true,
  // ao salvar o caso disparamos o sync automatico (importa andamentos +
  // vincula processos) — sem precisar sincronizar manualmente depois.
  const [achadoNoTI, setAchadoNoTI] = useState(false);
  const [docs, setDocs] = useState<Array<DocUpload>>([]);
  // Dialog do Google Drive Picker. O parente chama abrirDrivePicker direto
  // antes de abrir o dialog, e so abre o dialog quando o Picker retorna com
  // arquivos selecionados. Isso evita race conditions onde o dialog fechava
  // sozinho durante a interacao com o Picker.
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

  const isInterno = usuario?.tipo === "interno";

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      nome: "",
      cpf: "",
      data_nascimento: "",
      telefone: "",
      email: "",
      senha_meu_inss: "",
      endereco: "",
      observacoes_cliente: "",
      tipo_beneficio: "",
      cliente_interno: false,
      parceiro_id: "",
      observacoes_caso: "",
    },
  });

  const clienteInternoWatch = form.watch("cliente_interno");

  // Normaliza data vinda do TI para YYYY-MM-DD (formato do input date).
  function coerceData(d: string | null | undefined): string {
    if (!d) return "";
    const s = String(d).trim();
    const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
    const br = s.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
    if (br) return `${br[3]}-${br[2]}-${br[1]}`;
    return "";
  }

  // Busca o cliente no Tramitacao Inteligente pelo CPF e pre-preenche o form.
  // Usa check-ti-cliente que, quando o cliente ainda nao existe localmente,
  // retorna customer_ti sem gravar nada.
  async function buscarNoTI() {
    const cpfDigits = (form.getValues("cpf") || "").replace(/\D/g, "");
    if (cpfDigits.length !== 11) {
      toast.error("Digite um CPF válido (11 dígitos) antes de buscar no TI");
      return;
    }
    setBuscandoTI(true);
    try {
      const resp = await supabase.functions.invoke("check-ti-cliente", {
        body: { cpf: cpfDigits },
      });
      if (resp.error) throw resp.error;
      const r = resp.data as {
        achou_no_ti?: boolean;
        customer_ti?: {
          name?: string | null;
          email?: string | null;
          phone_mobile?: string | null;
          birthdate?: string | null;
        };
        motivo?: string;
      };
      if (!r.achou_no_ti) {
        toast.message("Cliente não encontrado no Tramitação Inteligente.");
        return;
      }
      const c = r.customer_ti;
      if (!c) {
        toast.message(r.motivo || "Cliente encontrado no TI, mas já existe no sistema.");
        return;
      }
      // Cliente existe no TI -> habilita import automatico ao salvar o caso.
      setAchadoNoTI(true);
      let campos = 0;
      if (c.name) {
        form.setValue("nome", c.name, { shouldValidate: true });
        campos++;
      }
      const nasc = coerceData(c.birthdate);
      if (nasc) {
        form.setValue("data_nascimento", nasc, { shouldValidate: true });
        campos++;
      }
      if (c.phone_mobile) {
        form.setValue("telefone", maskTelefone(c.phone_mobile), {
          shouldValidate: true,
        });
        campos++;
      }
      if (c.email) {
        form.setValue("email", c.email, { shouldValidate: true });
        campos++;
      }
      toast.success(
        "Dados do TI preenchidos (" +
          campos +
          " campo" +
          (campos === 1 ? "" : "s") +
          "). Ao salvar, os processos e andamentos serão importados automaticamente.",
      );
    } catch (err) {
      console.error(err);
      const e = err as { message?: string };
      toast.error(e.message || "Erro ao buscar no TI");
    } finally {
      setBuscandoTI(false);
    }
  }

  useEffect(() => {
    if (!isInterno) return;
    (async () => {
      const { data, error } = await supabase
        .from("usuarios")
        .select("id, nome, email")
        .eq("tipo", "parceiro")
        .order("nome", { ascending: true });
      if (error) {
        console.error(error);
        return;
      }
      const parceirosData = (data || []) as Array<ParceiroOption>;
      setParceiros(parceirosData);
    })();
  }, [isInterno]);

  function addDocsFromFiles(files: FileList | null) {
    if (!files) return;
    const novos: Array<DocUpload> = [];
    for (let i = 0; i < files.length; i++) {
      novos.push({
        id: crypto.randomUUID(),
        file: files[i],
        tipo: "",
        tipoPersonalizado: "",
      });
    }
    setDocs((prev) => [...prev, ...novos]);
  }

  // Recebe arquivos importados do Google Drive (ja baixados como File pelo
  // DrivePickerDialog) e adiciona ao array `docs` ja com tipo pre-inferido.
  // Ao submit do form, eles seguem o mesmo upload-flow dos files manuais.
  async function addDocsFromDrive(arquivos: Array<DriveImportedFile>) {
    const novos: Array<DocUpload> = arquivos.map((a) => ({
      id: crypto.randomUUID(),
      file: a.file,
      tipo: a.tipo,
      tipoPersonalizado: a.tipoPersonalizado,
      gdriveFileId: a.gdriveFileId,
      pastaRelativa: a.pastaRelativa,
    }));
    setDocs((prev) => [...prev, ...novos]);
  }

  function addDocVazio() {
    setDocs((prev) => [
      ...prev,
      {
        id: crypto.randomUUID(),
        file: null,
        tipo: "",
        tipoPersonalizado: "",
      },
    ]);
  }

  function removeDoc(id: string) {
    setDocs((prev) => prev.filter((d) => d.id !== id));
  }

  function updateDocFile(id: string, file: File | null) {
    setDocs((prev) => prev.map((d) => (d.id === id ? { ...d, file } : d)));
  }

  function updateDocTipo(id: string, tipo: TipoDocumento) {
    setDocs((prev) => prev.map((d) => (d.id === id ? { ...d, tipo, tipoPersonalizado: "" } : d)));
  }

  function updateDocPersonalizado(id: string, texto: string) {
    setDocs((prev) => prev.map((d) => (d.id === id ? { ...d, tipoPersonalizado: texto } : d)));
  }

  async function onSubmit(values: FormValues) {
    if (!usuario) return;

    // Validacao de tamanho dos arquivos antes de qualquer insert.
    // Falha cedo evita criar cliente+caso e travar no upload depois.
    const arquivosParaSubir = docs.map((d) => d.file).filter((f): f is File => f !== null);
    if (arquivosParaSubir.length > 0) {
      const errosTamanho = validateFileSizes(arquivosParaSubir);
      if (errosTamanho.length > 0) {
        // Mostra ate 3 erros pra nao explodir a tela
        errosTamanho.slice(0, 3).forEach((e) => toast.error(e));
        if (errosTamanho.length > 3) {
          toast.error("Mais " + (errosTamanho.length - 3) + " arquivo(s) acima do limite.");
        }
        return;
      }
    }

    setSubmitting(true);
    try {
      const cpfDigits = values.cpf.replace(/\D/g, "");
      let parceiroId: string | null;
      if (isInterno) {
        // Se marcou "cliente interno", caso fica sem parceiro
        if (values.cliente_interno) {
          parceiroId = null;
        } else {
          parceiroId = values.parceiro_id || null;
        }
      } else {
        // Parceiro logado vira automaticamente parceiro_id do caso
        parceiroId = usuario.id;
      }

      // 1) Insere cliente SEM senha. A senha do MEU INSS e gravada por
      // RPC criptografada no passo 1b (set_senha_meu_inss).
      const clienteResp = await supabase
        .from("clientes")
        .insert({
          nome: values.nome.trim(),
          cpf: cpfDigits,
          data_nascimento: values.data_nascimento,
          telefone: values.telefone.trim(),
          email: values.email ? values.email.trim() || null : null,
          endereco: values.endereco ? values.endereco.trim() || null : null,
          observacoes: values.observacoes_cliente
            ? values.observacoes_cliente.trim() || null
            : null,
        })
        .select("id")
        .single();

      const clienteErr = clienteResp.error as PostgresError | null;
      const clienteInsert = clienteResp.data as ClienteInsertRow | null;

      if (clienteErr) {
        const clienteErrCode = clienteErr.code;
        if (clienteErrCode === "23505") {
          const existenteResp = await supabase
            .from("clientes")
            .select("id, casos(id)")
            .eq("cpf", cpfDigits)
            .maybeSingle();

          const existente = existenteResp.data as ClienteExistenteRow | null;
          const casosExistente = existente ? existente.casos : null;
          const primeiroCaso =
            casosExistente && casosExistente.length > 0 ? casosExistente[0] : null;
          const casoExistenteId = primeiroCaso ? primeiroCaso.id : null;

          await supabase.from("alertas_duplicidade").insert({
            cpf_tentado: cpfDigits,
            parceiro_solicitante_id: parceiroId,
            caso_existente_id: casoExistenteId,
          });

          toast.success(
            "Cliente já cadastrado. Sua solicitação foi registrada e nossa equipe entrará em contato em breve.",
          );
          setSubmitting(false);
          return;
        }
        throw clienteErr;
      }

      if (!clienteInsert) {
        throw new Error("Falha ao obter ID do cliente recém-criado");
      }
      const clienteId = clienteInsert.id;

      // 2) Insere caso PRIMEIRO. A funcao set_senha_meu_inss valida que o
      // parceiro eh dono de algum caso do cliente - entao precisamos do caso
      // criado antes da chamada RPC.
      const casoResp = await supabase
        .from("casos")
        .insert({
          cliente_id: clienteId,
          parceiro_id: parceiroId,
          tipo_beneficio: values.tipo_beneficio,
          fase: "analise",
          status: "em_analise",
          observacoes: values.observacoes_caso ? values.observacoes_caso.trim() || null : null,
        })
        .select("id")
        .single();

      const casoErr = casoResp.error as PostgresError | null;
      const casoInsert = casoResp.data as CasoInsertRow | null;

      if (casoErr) throw casoErr;
      if (!casoInsert) {
        throw new Error("Falha ao obter ID do caso recém-criado");
      }
      const casoId = casoInsert.id;

      // 2b) Grava a senha do MEU INSS criptografada via RPC.
      // Funcao backend cifra com pgcrypto e grava em senha_meu_inss (bytea).
      // Parceiro consegue chamar porque o caso ja existe vinculado a ele.
      const senhaInformada = values.senha_meu_inss ? values.senha_meu_inss.trim() : "";
      if (senhaInformada.length > 0) {
        const setSenhaResp = await supabase.rpc("set_senha_meu_inss", {
          p_cliente_id: clienteId,
          p_senha: senhaInformada,
        });
        if (setSenhaResp.error) {
          // Nao bloqueia o fluxo - registra aviso. Senha pode ser definida
          // depois pela tela de edicao do cliente.
          console.error("Falha ao gravar senha MEU INSS:", setSenhaResp.error);
          toast.warning(
            "Caso cadastrado, mas a senha do MEU INSS não foi salva: " +
              (setSenhaResp.error.message || "erro desconhecido"),
          );
        }
      }

      // 3) Upload de documentos (se houver)
      const docsToUpload = docs.filter((d) => d.file !== null);
      if (docsToUpload.length > 0) {
        for (const doc of docsToUpload) {
          if (!doc.file) continue;
          const fileName = Date.now() + "_" + sanitizeFileName(doc.file.name);
          const storagePath = casoId + "/" + fileName;

          const uploadResp = await supabase.storage
            .from("documentos")
            .upload(storagePath, doc.file, {
              cacheControl: "3600",
              upsert: false,
            });

          if (uploadResp.error) {
            console.error("Falha no upload de", doc.file.name, uploadResp.error);
            toast.error("Falha ao enviar " + doc.file.name + ": " + uploadResp.error.message);
            continue;
          }

          const docInsertResp = await supabase.from("documentos").insert({
            caso_id: casoId,
            tipo: doc.tipo,
            tipo_personalizado: doc.tipo === "outro" ? doc.tipoPersonalizado.trim() || null : null,
            nome_arquivo: doc.file.name,
            storage_path: storagePath,
            tamanho_bytes: doc.file.size,
            uploaded_by: usuario.id,
            // Documentos cadastrados durante criacao do caso sao visiveis ao
            // parceiro por default - sao a documentacao base que ele forneceu
            // ou conhece. Interno pode marcar individualmente como privado
            // depois pela aba Documentos se algum for sensivel.
            visivel_parceiro: true,
            // Se veio do Drive, guarda file_id pra dedupe em sync futuro
            gdrive_file_id: doc.gdriveFileId ?? null,
            pasta_relativa: doc.pastaRelativa || null,
          });

          if (docInsertResp.error) {
            console.error("Falha ao registrar documento", docInsertResp.error);
            toast.error("Falha ao registrar " + doc.file.name + ": " + docInsertResp.error.message);
          }
        }
      }

      // Se quem cadastrou foi o PARCEIRO, avisa o sino da equipe (interno):
      // caso novo pronto para analise (com a contagem de documentos anexados).
      if (!isInterno) {
        const qtdDocs = docsToUpload.length;
        notificarEquipe({
          tipo: "caso",
          titulo: `Novo caso para análise: ${values.nome.trim()}`,
          descricao:
            `${values.tipo_beneficio}` +
            (qtdDocs > 0 ? ` · ${qtdDocs} documento(s)` : " · sem documentos") +
            ` · por ${usuario.nome || "parceiro"}`,
          caso_id: casoId,
        });
      }

      // 4) Import automatico do Tramitacao Inteligente.
      // Se o cliente foi localizado no TI (via "Buscar no TI"), ja puxa
      // processos e andamentos junto com a criacao do caso — assim a usuaria
      // nao precisa rodar o sync manualmente depois.
      if (achadoNoTI) {
        const toastSync = toast.loading(
          "Importando processos e andamentos do Tramitação Inteligente...",
        );
        try {
          const syncResp = await supabase.functions.invoke("sync-ti-cliente", {
            body: { cpf: cpfDigits, caso_id: casoId, usuario_id: usuario.id },
          });
          if (syncResp.error) throw syncResp.error;
          const s = (syncResp.data || {}) as {
            achou_no_ti?: boolean;
            notas_importadas?: number;
            notas_ja_existentes?: number;
          };
          const n = s.notas_importadas ?? 0;
          if (s.achou_no_ti) {
            toast.success(
              n > 0
                ? `Importação concluída: ${n} andamento${n === 1 ? "" : "s"} do TI.`
                : "Cliente sincronizado com o TI (nenhum andamento novo).",
              { id: toastSync },
            );
          } else {
            toast.message("Cliente não encontrado no TI na importação.", {
              id: toastSync,
            });
          }
        } catch (errSync) {
          console.error("Falha na importação automática do TI:", errSync);
          const e = errSync as { message?: string };
          toast.warning(
            "Caso criado, mas a importação automática do TI falhou" +
              (e.message ? ": " + e.message : "") +
              ". Você pode sincronizar manualmente no caso.",
            { id: toastSync },
          );
        }
      }

      toast.success("Caso cadastrado com sucesso!");
      navigate({ to: "/casos/$id", params: { id: casoId } });
    } catch (err) {
      console.error(err);
      const errAsObj = err as PostgresError;
      const msg = (errAsObj && errAsObj.message) || "Erro ao cadastrar caso. Tente novamente.";
      toast.error(msg);
    } finally {
      setSubmitting(false);
    }
  }

  // Valida documentos: cada doc com arquivo precisa de tipo selecionado;
  // se tipo='outro', precisa de tipoPersonalizado preenchido.
  const docsComArquivo = docs.filter((d) => d.file !== null);
  const docsInvalidos = docsComArquivo.filter(
    (d) => !d.tipo || (d.tipo === "outro" && d.tipoPersonalizado.trim().length === 0),
  );
  const todosDocumentosNomeados = docsInvalidos.length === 0;

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-serif text-3xl font-semibold tracking-tight">Novo caso</h1>
          <p className="text-sm text-muted-foreground">
            Cadastre o cliente e abra o caso previdenciário.
          </p>
        </div>
        <Button variant="ghost" size="sm" asChild>
          <Link to="/casos">
            <ArrowLeft className="h-4 w-4 mr-2" />
            Voltar
          </Link>
        </Button>
      </div>

      <ClientOnly
        fallback={
          <div className="flex h-96 items-center justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        }
      >
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
            {/* Secao 1: Dados do cliente */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Dados do cliente</CardTitle>
                <CardDescription>Informações pessoais do segurado.</CardDescription>
              </CardHeader>
              <CardContent className="grid gap-4 sm:grid-cols-2">
                <FormField
                  control={form.control}
                  name="nome"
                  render={({ field }) => (
                    <FormItem className="sm:col-span-2">
                      <FormLabel>Nome completo *</FormLabel>
                      <FormControl>
                        <Input placeholder="Nome do cliente" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="cpf"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>CPF *</FormLabel>
                      <FormControl>
                        <div className="flex items-center gap-2">
                          <Input
                            placeholder="000.000.000-00"
                            inputMode="numeric"
                            value={field.value}
                            onChange={(e) => field.onChange(maskCPF(e.target.value))}
                          />
                          {/* "Buscar no TI" so para a equipe interna - o
                              Tramitacao Inteligente e ferramenta interna; o
                              parceiro nao tem acesso a essa busca. */}
                          {isInterno && (
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              className="shrink-0"
                              onClick={buscarNoTI}
                              disabled={buscandoTI}
                              title="Buscar dados do cliente no Tramitação Inteligente pelo CPF"
                            >
                              {buscandoTI ? (
                                <Loader2 className="h-4 w-4 animate-spin" />
                              ) : (
                                <Search className="h-4 w-4" />
                              )}
                              <span className="ml-1 hidden sm:inline">Buscar no TI</span>
                            </Button>
                          )}
                        </div>
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="data_nascimento"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Data de nascimento *</FormLabel>
                      <FormControl>
                        <Input type="date" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="telefone"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Telefone *</FormLabel>
                      <FormControl>
                        <Input
                          placeholder="(00) 00000-0000"
                          inputMode="tel"
                          value={field.value}
                          onChange={(e) => field.onChange(maskTelefone(e.target.value))}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="email"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>E-mail</FormLabel>
                      <FormControl>
                        <Input type="email" placeholder="email@exemplo.com" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="endereco"
                  render={({ field }) => (
                    <FormItem className="sm:col-span-2">
                      <FormLabel>Endereço</FormLabel>
                      <FormControl>
                        <Input placeholder="Rua, número, bairro, cidade - UF" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="senha_meu_inss"
                  render={({ field }) => (
                    <FormItem className="sm:col-span-2">
                      <FormLabel>Senha MEU INSS</FormLabel>
                      <FormControl>
                        <div className="relative">
                          <Input
                            type={showPwd ? "text" : "password"}
                            placeholder="Senha do portal MEU INSS"
                            autoComplete="off"
                            {...field}
                          />
                          <button
                            type="button"
                            onClick={() => setShowPwd((v) => !v)}
                            className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                            aria-label={showPwd ? "Ocultar senha" : "Mostrar senha"}
                          >
                            {showPwd ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                          </button>
                        </div>
                      </FormControl>
                      <p className="text-xs text-muted-foreground">
                        Aviso temporário: armazenada em texto puro durante a fase de testes. Será
                        criptografada antes do uso em produção.
                      </p>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="observacoes_cliente"
                  render={({ field }) => (
                    <FormItem className="sm:col-span-2">
                      <FormLabel>Observações sobre o cliente</FormLabel>
                      <FormControl>
                        <Textarea rows={3} placeholder="Notas opcionais..." {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </CardContent>
            </Card>

            {/* Secao 2: Dados do caso */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Dados do caso</CardTitle>
                <CardDescription>Tipo de benefício e responsáveis.</CardDescription>
              </CardHeader>
              <CardContent className="grid gap-4 sm:grid-cols-2">
                <FormField
                  control={form.control}
                  name="tipo_beneficio"
                  render={({ field }) => (
                    <FormItem className={isInterno ? "" : "sm:col-span-2"}>
                      <FormLabel>Tipo de benefício *</FormLabel>
                      <Select value={field.value} onValueChange={field.onChange}>
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder="Selecione" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {TIPOS_BENEFICIO.map((t) => (
                            <SelectItem key={t} value={t}>
                              {t}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                {isInterno && (
                  <FormField
                    control={form.control}
                    name="cliente_interno"
                    render={({ field }) => (
                      <FormItem className="sm:col-span-2 flex flex-row items-center gap-2 space-y-0 rounded-md border p-3 bg-muted/30">
                        <FormControl>
                          <input
                            type="checkbox"
                            checked={field.value === true}
                            onChange={(e) => {
                              field.onChange(e.target.checked);
                              if (e.target.checked) {
                                form.setValue("parceiro_id", "");
                              }
                            }}
                            className="h-4 w-4"
                          />
                        </FormControl>
                        <div className="space-y-0.5 leading-none">
                          <FormLabel className="text-sm cursor-pointer">
                            Cliente interno do escritório (sem parceiro indicador)
                          </FormLabel>
                          <p className="text-xs text-muted-foreground">
                            Marque se o cliente veio direto ao escritório, sem indicação de parceiro
                            captador.
                          </p>
                        </div>
                      </FormItem>
                    )}
                  />
                )}

                {isInterno && !clienteInternoWatch && (
                  <FormField
                    control={form.control}
                    name="parceiro_id"
                    render={({ field }) => (
                      <FormItem>
                        <div className="flex items-center justify-between gap-2">
                          <FormLabel>Parceiro indicador</FormLabel>
                          <NovoParceiroDialog
                            onCriado={(p) => {
                              setParceiros((prev) => {
                                const semDup = prev.filter((x) => x.id !== p.id);
                                return [...semDup, p].sort((a, b) =>
                                  (a.nome || "").localeCompare(b.nome || ""),
                                );
                              });
                              form.setValue("parceiro_id", p.id, {
                                shouldValidate: true,
                              });
                            }}
                          />
                        </div>
                        <Select value={field.value} onValueChange={field.onChange}>
                          <FormControl>
                            <SelectTrigger>
                              <SelectValue placeholder="Selecione o parceiro" />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            {parceiros.length === 0 ? (
                              <div className="px-2 py-1.5 text-sm text-muted-foreground">
                                Nenhum parceiro cadastrado
                              </div>
                            ) : (
                              parceiros.map((p) => (
                                <SelectItem key={p.id} value={p.id}>
                                  {p.nome || p.email || p.id}
                                </SelectItem>
                              ))
                            )}
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                )}

                <FormField
                  control={form.control}
                  name="observacoes_caso"
                  render={({ field }) => (
                    <FormItem className="sm:col-span-2">
                      <FormLabel>Observações iniciais sobre o caso</FormLabel>
                      <FormControl>
                        <Textarea
                          rows={4}
                          placeholder="Contexto, urgência, documentos já recebidos..."
                          {...field}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </CardContent>
            </Card>

            {/* Secao 3: Documentos */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Documentos</CardTitle>
                <CardDescription>
                  Anexe documentos que já tem em mãos. Pode adicionar mais depois no caso. Tamanho
                  máximo: {MAX_FILE_SIZE_MB} MB por arquivo.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <div>
                  <Label className="text-xs">Adicionar arquivos</Label>
                  <Input
                    type="file"
                    multiple
                    accept="application/pdf,image/jpeg,image/png,image/jpg,.doc,.docx,.xls,.xlsx"
                    onChange={(e) => {
                      addDocsFromFiles(e.target.files);
                      e.target.value = "";
                    }}
                  />
                </div>
                {/* Importar do Google Drive - so aparece pra interno e se
                    as env vars estiverem configuradas. Util pra migrar
                    documentos de clientes que ja tem pasta no Drive. */}
                {isInterno && isGoogleDriveConfigured() && (
                  <div>
                    <Button type="button" variant="outline" size="sm" onClick={handleClickDrive}>
                      <FileDown className="h-4 w-4 mr-2" />
                      Importar do Google Drive
                    </Button>
                  </div>
                )}
                {docs.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Nenhum documento adicionado.</p>
                ) : (
                  <div className="space-y-3">
                    {docs.map((d) => (
                      <div key={d.id} className="border rounded-md p-3 bg-muted/30 space-y-2">
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0 flex-1">
                            {d.file ? (
                              <p className="text-sm font-medium truncate flex items-center gap-1">
                                <FileText className="h-3.5 w-3.5 shrink-0" />
                                {d.file.name}
                                <span className="text-xs text-muted-foreground ml-1">
                                  ({(d.file.size / 1024).toFixed(0)} KB)
                                </span>
                              </p>
                            ) : (
                              <Input
                                type="file"
                                accept="application/pdf,image/jpeg,image/png,image/jpg,.doc,.docx,.xls,.xlsx"
                                onChange={(e) => {
                                  const files = e.target.files;
                                  const file = files && files.length > 0 ? files[0] : null;
                                  updateDocFile(d.id, file);
                                }}
                              />
                            )}
                          </div>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            onClick={() => removeDoc(d.id)}
                            aria-label="Remover documento"
                          >
                            <X className="h-4 w-4" />
                          </Button>
                        </div>
                        <div>
                          <Label className="text-xs">Tipo</Label>
                          <DocTypeCombobox
                            options={TIPOS_DOCUMENTO}
                            value={d.tipo}
                            onChange={(v) => updateDocTipo(d.id, v)}
                            placeholder="Selecione ou busque o tipo..."
                          />
                        </div>
                        {d.tipo === "outro" && (
                          <div>
                            <Label className="text-xs">Nome do documento (obrigatório)</Label>
                            <Input
                              placeholder="Ex.: Cartão do INSS, Decisão do MS..."
                              value={d.tipoPersonalizado}
                              onChange={(e) => updateDocPersonalizado(d.id, e.target.value)}
                            />
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
                <Button type="button" variant="outline" size="sm" onClick={addDocVazio}>
                  <Plus className="h-4 w-4 mr-2" />
                  Adicionar linha em branco
                </Button>
              </CardContent>
            </Card>

            {!todosDocumentosNomeados && (
              <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
                <p className="font-medium">
                  Há {docsInvalidos.length}{" "}
                  {docsInvalidos.length === 1 ? "documento sem tipo" : "documentos sem tipo"}{" "}
                  selecionado{docsInvalidos.length === 1 ? "" : "s"}.
                </p>
                <p className="text-xs mt-1">
                  Selecione o tipo de cada arquivo. Se for &quot;Outro&quot;, informe o nome.
                </p>
              </div>
            )}
            <div className="flex items-center justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => navigate({ to: "/casos" })}
                disabled={submitting}
              >
                Cancelar
              </Button>
              <Button
                type="submit"
                disabled={submitting || !todosDocumentosNomeados}
                title={!todosDocumentosNomeados ? "Há documentos sem tipo selecionado" : undefined}
              >
                {submitting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                Cadastrar caso
              </Button>
            </div>
          </form>
        </Form>
        {/* Dialog do Google Drive Picker */}
        {isInterno && (
          <DrivePickerDialog
            arquivosSelecionados={drivePicked?.files ?? null}
            accessToken={drivePicked?.accessToken ?? ""}
            onFechar={() => setDrivePicked(null)}
            tiposDocumento={TIPOS_DOCUMENTO}
            onConfirmar={addDocsFromDrive}
          />
        )}
      </ClientOnly>
    </div>
  );
}

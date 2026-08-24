// Sheet (slide-in) para criar/editar tarefa. Reusado em /tarefas, na home
// (Minhas hoje) e na tab Tarefas do caso. "Aplicar template" só aparece
// quando há caso selecionado.

import { useCallback, useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { toast } from "sonner";
import { Loader2, Trash2, ExternalLink, AlarmClock } from "lucide-react";

import { Button } from "@/components/ui/button";
import { DocTypeCombobox } from "@/components/doc-type-combobox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  atualizarTarefa,
  criarTarefa,
  excluirTarefa,
  listarCasosResumo,
  listarInternosAtivos,
  listarProcessosDoCaso,
  listarTemplates,
  obterContextoCaso,
  type ContextoCasoParaTemplate,
} from "@/lib/tarefas/queries";
import { enviarAvisoEvento, montarTextoAvisoEvento } from "@/lib/agenda/aviso";
import { AvisoParceiroEvento } from "@/components/agenda/aviso-parceiro-evento";
import {
  PRIORIDADE_LABEL,
  STATUS_LABEL,
  STATUS_ORDEM,
  TIPO_LABEL,
  templateTemAgenda,
  type ProcessoDoCasoOpcao,
  type TarefaComJoins,
  type TarefaStatus,
  type TarefaTemplateRow,
  type TarefaTipo,
} from "@/lib/tarefas/types";
import { criarEvento } from "@/lib/agenda/queries";
import type { AgendaTipo } from "@/lib/agenda/types";
import {
  calcularDueAtRelativo,
  dueAtDoPrazoFatal,
  fatalPorDiasUteis,
} from "@/lib/agenda/helpers";
import {
  descreverAutoriaStatus,
  formatarDataHoraCurtaBR,
  formatarDueAtCurto,
  inputDateTimeValueFromIso,
  isoFromInputDateTime,
  nomeAmigavel,
  substituirPlaceholders,
} from "@/lib/tarefas/helpers";
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
import { EtapasAcompanhamento } from "@/components/tarefas/etapas-acompanhamento";
import { AcompanhamentoPericia } from "@/components/tarefas/acompanhamento-pericia";
import { AcompanhamentoImplementacao } from "@/components/tarefas/acompanhamento-implementacao";
import { MontagemInicial } from "@/components/tarefas/montagem-inicial";
import { ComparecimentoPericia } from "@/components/tarefas/comparecimento-pericia";
import { EnviarAvisoParceiro } from "@/components/tarefas/enviar-aviso-parceiro";
import { EtapaCumprimentoExigencia } from "@/components/tarefas/etapa-cumprimento-exigencia";
import { EtapaProtocoloRealizado } from "@/components/tarefas/etapa-protocolo-realizado";
import { useDestaque } from "@/lib/destaque/destaque-context";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/hooks/use-auth";

type Modo =
  | {
      kind: "criar";
      casoIdInicial?: string | null;
      templateInicial?: string;        // nome do template a pré-selecionar
    }
  | { kind: "editar"; tarefa: TarefaComJoins };

// Export pra outras telas (ex: /clientes "+ Perícia") abrirem o sheet
// com template pré-selecionado.
export type TarefaSheetModo = Modo;

interface Props {
  modo: Modo | null;                 // null = fechado
  onClose: () => void;
  onSaved: () => void;               // recarregar lista
}

const TIPOS: TarefaTipo[] = ["interna", "prazo", "pericia", "pos_protocolo", "contato_cliente"];

// Mesma sanitização de casos.$id/casos.novo (storage não aceita acento/espaço).
function sanitizeFileName(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-zA-Z0-9._-]/g, "_");
}

export function TarefaSheet({ modo, onClose, onSaved }: Props) {
  const aberto = modo !== null;
  const { marcar: marcarDestaque } = useDestaque();
  const { usuario } = useAuth();
  const editando = modo?.kind === "editar";
  const tarefa = modo?.kind === "editar" ? modo.tarefa : null;

  const [titulo, setTitulo] = useState("");
  const [descricao, setDescricao] = useState("");
  const [tipo, setTipo] = useState<TarefaTipo>("interna");
  // So pra tipo='pericia': true = a pericia EM SI (aparece na Agenda);
  // false = tarefa SOBRE a pericia (acompanhar resultado, contatar...).
  const [periciaEvento, setPericiaEvento] = useState(true);
  const [prioridade, setPrioridade] = useState<number>(3);
  const [status, setStatus] = useState<TarefaStatus>("a_fazer");
  const [casoId, setCasoId] = useState<string | null>(null);
  const [trocandoCaso, setTrocandoCaso] = useState(false);
  // Único valor para processo: "" = nenhum, "admin:<id>" ou "judicial:<id>".
  const [processoToken, setProcessoToken] = useState<string>("");
  const [responsavelId, setResponsavelId] = useState<string | null>(null);
  const [dueDate, setDueDate] = useState<string>("");
  // Campo extra que aparece quando o template selecionado tem item
  // destino=agenda (ex: Perícia com parceiro). É o local da perícia.
  const [local, setLocal] = useState<string>("");

  // Campo extra que aparece quando o template tem item
  // destino=solicitacao_documento (ex: Exigência). É a lista/despacho do
  // INSS com os documentos pedidos — vai pra descrição da solicitação,
  // substituindo o placeholder {despacho} no template.
  const [docsExigencia, setDocsExigencia] = useState<string>("");
  // Prazo fatal informado ao aplicar template com item ancorado em
  // due_relative_to="prazo_fatal" (Exigência Judicial): "aaaa-mm-dd".
  const [prazoFatal, setPrazoFatal] = useState<string>("");
  // Calculadora do fatal: data da publicação + prazo em dias úteis
  // (5/10/15/outro). Preenche prazoFatal, que segue editável — feriado não
  // é descontado, quem aplica confere.
  const [pubData, setPubData] = useState<string>("");
  const [prazoDias, setPrazoDias] = useState<string>("");
  const [prazoDiasCustom, setPrazoDiasCustom] = useState<string>("");

  const recalcularFatal = (pub: string, diasStr: string, custom: string) => {
    const dias = parseInt(diasStr === "outro" ? custom : diasStr, 10);
    if (!pub || !Number.isInteger(dias) || dias <= 0) return;
    const fatal = fatalPorDiasUteis(pub, dias);
    if (fatal) setPrazoFatal(fatal);
  };

  // Aviso ao parceiro embutido no agendamento por template de agenda
  // (perícia/audiência) — mesma mecânica do AgendaSheet.
  const [ctxCaso, setCtxCaso] = useState<ContextoCasoParaTemplate | null>(null);
  const [avisoAtivo, setAvisoAtivo] = useState(true);
  const [avisoTexto, setAvisoTexto] = useState("");
  const [avisoEditado, setAvisoEditado] = useState(false);
  // Comprovante de agendamento (Meu INSS): a IA lê o PDF/foto e preenche
  // data/local/protocolo/endereço; no salvar, o arquivo sobe pros Documentos
  // do caso seguindo a numeração dos arquivos existentes ("26 - …").
  const [comprovanteFile, setComprovanteFile] = useState<File | null>(null);
  const [extraindoComprovante, setExtraindoComprovante] = useState(false);
  const [avisoProtocolo, setAvisoProtocolo] = useState<string>("");
  const [avisoEndereco, setAvisoEndereco] = useState<string>("");

  async function lerComprovante(file: File) {
    setExtraindoComprovante(true);
    try {
      const base64 = await new Promise<string>((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(String(r.result).split(",")[1] ?? "");
        r.onerror = () => reject(r.error);
        r.readAsDataURL(file);
      });
      const { data, error } = await supabase.functions.invoke(
        "extrair-agendamento-pericia",
        {
          body: {
            arquivo: {
              nome: file.name,
              mime: file.type || "application/pdf",
              base64,
            },
          },
        },
      );
      if (error) throw error;
      const campos = (
        data as {
          campos?: {
            data?: string | null;
            hora?: string | null;
            local?: string | null;
            endereco?: string | null;
            protocolo?: string | null;
            servico?: string | null;
            requerente?: string | null;
          } | null;
        } | null
      )?.campos;
      if (!campos) {
        toast.error("Não consegui ler o comprovante — preencha os campos na mão.");
        return;
      }
      if (campos.data) {
        setDueDate(`${campos.data}T${campos.hora || "09:00"}`);
      }
      if (campos.local) setLocal(campos.local);
      setAvisoProtocolo(campos.protocolo ?? "");
      setAvisoEndereco(campos.endereco ?? "");
      setAvisoEditado(false); // regenera o aviso com os dados do comprovante
      setComprovanteFile(file);
      // O comprovante é do cliente certo? Nome divergente é o erro clássico
      // de anexar o arquivo da pessoa errada.
      const req = (campos.requerente ?? "").trim().toLowerCase();
      const cli = (ctxCaso?.cliente_nome ?? "").trim().toLowerCase();
      if (req && cli && req !== cli) {
        toast.warning(
          `Atenção: o comprovante é de "${campos.requerente}", mas o caso é de "${ctxCaso?.cliente_nome}". Confira o arquivo.`,
        );
      } else {
        toast.success("Comprovante lido — confira os campos preenchidos.");
      }
    } catch (e) {
      console.error("extrair comprovante falhou:", e);
      toast.error("Falha ao ler o comprovante. Preencha os campos na mão.");
    } finally {
      setExtraindoComprovante(false);
    }
  }

  const [casos, setCasos] = useState<Array<{ id: string; cliente_nome: string | null }>>([]);
  const [internos, setInternos] = useState<
    Array<{ id: string; nome: string | null; email: string | null }>
  >([]);
  const [templates, setTemplates] = useState<TarefaTemplateRow[]>([]);
  const [templateSelecionado, setTemplateSelecionado] = useState<string>("");
  // Responsável POR ITEM quando o template cria mais de uma tarefa. index =
  // posição do item no template (template_item_index). respId aceita um uuid
  // de interno, "herdar" (usa o responsável do form) ou "sem".
  const [extrasResp, setExtrasResp] = useState<
    Array<{ index: number; titulo: string; respId: string }>
  >([]);
  const [processosDoCaso, setProcessosDoCaso] = useState<ProcessoDoCasoOpcao[]>([]);

  const [salvando, setSalvando] = useState(false);
  // Diálogo de adiamento de prazo fatal: exige justificativa antes de salvar.
  const [confirmandoAdiamento, setConfirmandoAdiamento] = useState(false);
  const [justificativa, setJustificativa] = useState("");
  const [excluindo, setExcluindo] = useState(false);

  // Template atual selecionado tem item destino=agenda? Se sim, o save
  // cria evento na agenda + tarefas extras com prazos relativos. UI
  // também mostra campo "Local" e rótulos diferentes.
  const templateAgenda = templateSelecionado
    ? templates.find((t) => t.nome === templateSelecionado && templateTemAgenda(t)) ?? null
    : null;

  // Template atual tem item destino=solicitacao_documento? Se sim,
  // mostra o campo "Documentos solicitados" no form.
  const templateTemSolicitacao = templateSelecionado
    ? templates
        .find((t) => t.nome === templateSelecionado)
        ?.itens.some((i) => i.destino === "solicitacao_documento") ?? false
    : false;

  // Template atual tem item ancorado no prazo fatal (Exigência Judicial)?
  // Se sim, o form mostra o campo de data do fatal — obrigatório no salvar.
  const templateTemPrazoFatalForm = templateSelecionado
    ? templates
        .find((t) => t.nome === templateSelecionado)
        ?.itens.some((i) => i.due_relative_to === "prazo_fatal") ?? false
    : false;

  const agendaTipoDoTemplate = templateAgenda
    ? ((templateAgenda.itens.find((i) => i.destino === "agenda")?.tipo ?? "") as string)
    : "";
  const avisoAplicavel =
    !editando &&
    (agendaTipoDoTemplate === "pericia" || agendaTipoDoTemplate === "audiencia") &&
    !!casoId &&
    !!ctxCaso?.parceiro_id;

  // Contexto do caso (parceiro, nomes) pro aviso — atualiza quando muda o caso.
  useEffect(() => {
    if (!casoId) {
      setCtxCaso(null);
      return;
    }
    let cancelado = false;
    obterContextoCaso(casoId, processoToken)
      .then((c) => {
        if (!cancelado) setCtxCaso(c);
      })
      .catch(() => {});
    return () => {
      cancelado = true;
    };
  }, [casoId, processoToken]);

  // Texto padrão do aviso — regenera até a pessoa editar na mão.
  useEffect(() => {
    if (!avisoAplicavel || avisoEditado || !ctxCaso) return;
    const natureza: "admin" | "judicial" =
      templateSelecionado === "pericia_judicial" || processoToken.startsWith("judicial:")
        ? "judicial"
        : "admin";
    let cancelado = false;
    montarTextoAvisoEvento({
      tipo: agendaTipoDoTemplate === "audiencia" ? "audiencia" : "pericia",
      natureza,
      cliente: ctxCaso.cliente_nome,
      servico: ctxCaso.servico || ctxCaso.tipo_beneficio,
      startIso: dueDate ? isoFromInputDateTime(dueDate) : null,
      local: local.trim() || null,
      protocolo: avisoProtocolo || null,
      endereco: avisoEndereco || null,
    })
      .then((t) => {
        if (!cancelado) setAvisoTexto(t);
      })
      .catch(() => {});
    return () => {
      cancelado = true;
    };
     
  }, [avisoAplicavel, avisoEditado, ctxCaso, agendaTipoDoTemplate, dueDate, local, templateSelecionado, processoToken, avisoProtocolo, avisoEndereco]);

  // Carrega listas auxiliares uma vez (ao abrir).
  useEffect(() => {
    if (!aberto) return;
    listarCasosResumo().then(setCasos).catch(() => {});
    listarInternosAtivos().then(setInternos).catch(() => {});
    // Mostra TODOS os templates ativos não-ocultos. Quando o template tem
    // item destino=agenda (ex: "Perícia (com parceiro)"), o salvar() cria
    // o agenda_evento + tarefas extras com datas relativas.
    listarTemplates().then(setTemplates).catch(() => {});
  }, [aberto]);

  // Carrega processos do caso quando muda. Limpa quando não há caso.
  useEffect(() => {
    if (!casoId) {
      setProcessosDoCaso([]);
      return;
    }
    listarProcessosDoCaso(casoId).then(setProcessosDoCaso).catch(() => {});
  }, [casoId]);

  // Quando a Naira escolhe um template (modo criar), popula o form. Se o
  // template tem item destino=agenda (ex: "Perícia com parceiro"), esse
  // item vira o "main" — a Data/hora do form passa a ser o start da
  // perícia. Os demais itens (destino=tarefa) ficam pra criação no salvar()
  // com prazos relativos ao start da perícia.
  // Quando não tem item destino=agenda, comportamento clássico: itens[0]
  // popula o form, demais viram tarefas extras.
  useEffect(() => {
    if (editando) return;
    if (!templateSelecionado || !casoId) {
      setExtrasResp([]);
      return;
    }
    const tpl = templates.find((t) => t.nome === templateSelecionado);
    if (!tpl || tpl.itens.length === 0) {
      setExtrasResp([]);
      return;
    }
    const agendaItem = tpl.itens.find((i) => i.destino === "agenda");
    // Main = item de agenda (se houver) → form é a perícia. Senão, o
    // primeiro item destino=tarefa (ou sem destino). Itens destino=
    // andamento NUNCA viram main — eles são sempre criados como
    // andamento no extras loop.
    const primeiroTarefa = tpl.itens.find(
      (i) => !i.destino || i.destino === "tarefa",
    );
    const main = agendaItem ?? primeiroTarefa ?? tpl.itens[0];
    let cancelado = false;
    (async () => {
      const ctx = await obterContextoCaso(casoId, processoToken);
      if (cancelado) return;
      const ph = {
        nome_cliente: ctx.cliente_nome,
        protocolo: ctx.protocolo,
        cpf: ctx.cliente_cpf,
        servico: ctx.servico,
        processo: ctx.numero_processo_judicial,
      };
      setTitulo(substituirPlaceholders(main.titulo, ph));
      setDescricao(substituirPlaceholders(main.descricao ?? "", ph));
      setTipo((main.tipo as TarefaTipo) || "interna");
      setPrioridade(main.prioridade ?? 3);
      // Responsáveis por item: o executor_email de cada item do template é o
      // default; sem executor (ou sem match), herda do responsável do form.
      const emailParaIdPrefill = new Map<string, string>();
      for (const u of internos) {
        if (u.email) emailParaIdPrefill.set(u.email.toLowerCase(), u.id);
      }
      setExtrasResp(
        tpl.itens
          .map((item, i) => ({ item, i }))
          .filter(
            ({ item }) =>
              item !== main && (!item.destino || item.destino === "tarefa"),
          )
          .map(({ item, i }) => ({
            index: i,
            titulo: substituirPlaceholders(item.titulo, ph),
            respId: item.executor_email
              ? (emailParaIdPrefill.get(item.executor_email.toLowerCase()) ??
                "herdar")
              : "herdar",
          })),
      );
      // Main também tem executor default no template — pré-seleciona se a
      // Naira ainda não escolheu ninguém no form.
      if (main.executor_email) {
        const mainResp = emailParaIdPrefill.get(main.executor_email.toLowerCase());
        if (mainResp) setResponsavelId((prev) => prev ?? mainResp);
      }
      if (agendaItem) {
        // Pra agenda: form começa vazio (Naira preenche data/hora/local).
        // Não inferimos data — perícia é específica.
        setDueDate("");
        setLocal("");
      } else if (typeof main.offset_dias === "number") {
        const dt = new Date(Date.now() + main.offset_dias * 86400_000);
        setDueDate(inputDateTimeValueFromIso(dt.toISOString()));
      } else {
        setDueDate("");
      }
    })();
    return () => {
      cancelado = true;
    };
  }, [templateSelecionado, casoId, processoToken, templates, editando, internos]);

  // Sincroniza o formulário com o modo (abertura).
  useEffect(() => {
    if (!modo) return;
    if (modo.kind === "criar") {
      setTitulo("");
      setDescricao("");
      setTipo("interna");
      setPrioridade(3);
      setStatus("a_fazer");
      setCasoId(modo.casoIdInicial ?? null);
      setTrocandoCaso(false);
      setProcessoToken("");
      setResponsavelId(null);
      setDueDate("");
      setLocal("");
      setDocsExigencia("");
      setPrazoFatal("");
      {
        // "Publicado em" já nasce com hoje — o comum é processar a
        // publicação no dia em que ela sai no Legalmail.
        const hoje = new Date();
        const pad = (n: number) => String(n).padStart(2, "0");
        setPubData(`${hoje.getFullYear()}-${pad(hoje.getMonth() + 1)}-${pad(hoje.getDate())}`);
      }
      setPrazoDias("");
      setPrazoDiasCustom("");
      setAvisoAtivo(true);
      setAvisoTexto("");
      setAvisoEditado(false);
      setComprovanteFile(null);
      setExtraindoComprovante(false);
      setAvisoProtocolo("");
      setAvisoEndereco("");
      setPericiaEvento(true);
      setExtrasResp([]);
      setTemplateSelecionado(modo.templateInicial ?? "");
    } else {
      const t = modo.tarefa;
      setTitulo(t.titulo);
      setDescricao(t.descricao ?? "");
      setTipo(t.tipo);
      {
        const flag = (t.metadata as { pericia_evento?: boolean } | null)?.pericia_evento;
        setPericiaEvento(
          flag !== undefined
            ? !!flag
            : !/(acompanh|contatar|resultado|ligar|compareceu|agendamento de)/i.test(t.titulo),
        );
      }
      setPrioridade(t.prioridade);
      setStatus(t.status);
      setCasoId(t.caso_id);
      setTrocandoCaso(false);
      setProcessoToken(
        t.processo_admin_id
          ? `admin:${t.processo_admin_id}`
          : t.processo_judicial_id
            ? `judicial:${t.processo_judicial_id}`
            : "",
      );
      setResponsavelId(t.responsavel_id);
      setDueDate(inputDateTimeValueFromIso(t.due_at));
      setLocal("");
      setDocsExigencia("");
      setExtrasResp([]);
      setTemplateSelecionado("");
    }
  }, [modo]);

  const fechar = useCallback(() => {
    if (salvando || excluindo) return;
    onClose();
  }, [salvando, excluindo, onClose]);

  function parseProcesso(): {
    processo_admin_id: string | null;
    processo_judicial_id: string | null;
  } {
    // "" / "admin:<id>" / "judicial:<id>"  → 2 colunas mutuamente exclusivas.
    if (!processoToken || !casoId) {
      return { processo_admin_id: null, processo_judicial_id: null };
    }
    if (processoToken.startsWith("admin:")) {
      return { processo_admin_id: processoToken.slice(6), processo_judicial_id: null };
    }
    if (processoToken.startsWith("judicial:")) {
      return { processo_admin_id: null, processo_judicial_id: processoToken.slice(9) };
    }
    return { processo_admin_id: null, processo_judicial_id: null };
  }

  /**
   * Adiar tarefa de prazo fatal exige justificativa. Ao detectar que a nova
   * data é POSTERIOR à atual numa tarefa marcada `prazo_fatal`, o salvamento
   * para e o diálogo assume — a justificativa vira andamento interno, para
   * ficar registrado por que o prazo não foi cumprido.
   *
   * Só adiamento dispara: antecipar prazo fatal é sempre livre.
   */
  function adiandoPrazoFatal(novoDueAt: string | null): boolean {
    if (!editando || !tarefa) return false;
    const fatal = (tarefa.metadata as { prazo_fatal?: boolean } | null)?.prazo_fatal === true;
    if (!fatal || !tarefa.due_at || !novoDueAt) return false;
    return new Date(novoDueAt).getTime() > new Date(tarefa.due_at).getTime();
  }

  async function salvar(justificativa?: string) {
    if (!titulo.trim()) {
      toast.error("Título é obrigatório.");
      return;
    }
    const dueCalculado = isoFromInputDateTime(dueDate);
    if (justificativa === undefined && adiandoPrazoFatal(dueCalculado)) {
      setConfirmandoAdiamento(true);
      return;
    }
    setSalvando(true);
    try {
      const due_at = dueCalculado;
      const proc = parseProcesso();
      if (editando && tarefa) {
        await atualizarTarefa({
          id: tarefa.id,
          patch: {
            titulo: titulo.trim(),
            descricao: descricao.trim() || null,
            tipo,
            prioridade,
            status,
            caso_id: casoId,
            responsavel_id: responsavelId,
            due_at,
            processo_admin_id: proc.processo_admin_id,
            processo_judicial_id: proc.processo_judicial_id,
            // Preserva o metadata e grava a flag da agenda quando e pericia.
            ...(tipo === "pericia"
              ? {
                  metadata: {
                    ...((tarefa.metadata as Record<string, unknown> | null) ?? {}),
                    pericia_evento: periciaEvento,
                  },
                }
              : {}),
          },
        });
        // Registra o adiamento do prazo fatal como andamento INTERNO: fica
        // gravado por que não foi cumprido, sem expor isso ao parceiro.
        if (justificativa && tarefa.caso_id) {
          const de = tarefa.due_at ? formatarDueAtCurto(tarefa.due_at) : "sem prazo";
          const para = due_at ? formatarDueAtCurto(due_at) : "sem prazo";
          const { error: errAnd } = await supabase.from("andamentos").insert({
            caso_id: tarefa.caso_id,
            processo_admin_id: proc.processo_admin_id,
            processo_judicial_id: proc.processo_judicial_id,
            origem: "interno",
            titulo: "Prazo fatal adiado — " + titulo.trim(),
            descricao:
              "Prazo adiado de " + de + " para " + para + "." +
              "\n\nJustificativa: " + justificativa.trim(),
            data_evento: new Date().toISOString(),
            criado_por: usuario?.id ?? null,
            visivel_parceiro: false,
            metadata: {
              adiamento_prazo_fatal: true,
              tarefa_id: tarefa.id,
              due_anterior: tarefa.due_at,
              due_novo: due_at,
            },
          });
          if (errAnd) {
            // O prazo já foi adiado; falhar aqui não deve desfazer isso, mas a
            // pessoa precisa saber que o registro não ficou.
            toast.warning("Prazo adiado, mas o registro da justificativa falhou", {
              description: errAnd.message,
            });
          }
        }
        toast.success(justificativa ? "Prazo adiado e justificativa registrada." : "Tarefa atualizada.");
      } else {
        // Modo criar.
        // Template define dois cenários:
        //  A) Tem item destino=agenda → "main" é o EVENTO de agenda. Form
        //     vira a perícia. Demais itens são tarefas extras com prazos
        //     relativos ao start_at do evento (due_relative_to=agenda /
        //     sexta_antes_agenda).
        //  B) Não tem destino=agenda → "main" é tarefa[0]. Form cria a
        //     tarefa principal. Demais itens viram tarefas extras (hoje + offset).
        //  C) Sem template → cria 1 tarefa do form (default).
        const tpl = templateSelecionado
          ? templates.find((t) => t.nome === templateSelecionado)
          : null;
        const tplItens = tpl?.itens ?? [];
        const agendaItem = tpl?.itens.find((i) => i.destino === "agenda") ?? null;
        // Mesmo critério do prefill: main NUNCA é destino=andamento
        // (esses sempre vão pelo extras loop). Prioriza agenda → primeiro
        // tarefa (ou sem destino) → fallback itens[0] (edge case).
        const primeiroTarefa = tpl?.itens.find(
          (i) => !i.destino || i.destino === "tarefa",
        ) ?? null;
        const mainItem = agendaItem ?? primeiroTarefa ?? tplItens[0] ?? null;

        // Template ancorado no prazo fatal (Exigência Judicial) não sai sem a
        // data — o FATAL derivaria de nada.
        if (templateTemPrazoFatalForm && !prazoFatal) {
          toast.error("Informe o prazo fatal da publicação.");
          setSalvando(false);
          return;
        }

        // Contexto pra substituir placeholders e lookup de e-mail→uuid
        // (compartilhado entre main + extras).
        const ctx = casoId ? await obterContextoCaso(casoId, processoToken) : null;
        const ph = {
          // {motivo} = o que a pessoa escreveu em Observações no momento do
          // agendamento. É o que o parceiro lê no andamento do guichê — sem
          // isso ele receberia "Motivo: {motivo}" literal.
          motivo: descricao.trim() || "não informado",
          nome_cliente: ctx?.cliente_nome ?? "",
          protocolo: ctx?.protocolo ?? "",
          cpf: ctx?.cliente_cpf ?? "",
          servico: ctx?.servico ?? "",
          // Quando o template tem item destino=solicitacao_documento, o
          // texto do despacho/lista de documentos vem do campo do form
          // (docsExigencia). No fluxo automático INSS, o edge function
          // popula despacho com o trecho extraído do e-mail.
          despacho: docsExigencia.trim(),
          processo: ctx?.numero_processo_judicial ?? "",
          // Formata direto da string do input (sem passar por Date — fuso).
          prazo_fatal: prazoFatal ? prazoFatal.split("-").reverse().join("/") : "",
        };
        const emailParaId = new Map<string, string>();
        for (const u of internos) {
          if (u.email) emailParaId.set(u.email.toLowerCase(), u.id);
        }

        // ============== MAIN ==============
        let agendaStart: Date | null = null;
        if (agendaItem) {
          // Form values criam o agenda_evento.
          if (!dueDate) {
            toast.error("Data e hora da perícia são obrigatórias.");
            setSalvando(false);
            return;
          }
          const startIso = isoFromInputDateTime(dueDate)!;
          agendaStart = new Date(startIso);
          const dur = agendaItem.duracao_min ?? 60;
          const endIso = new Date(agendaStart.getTime() + dur * 60_000).toISOString();
          // Aviso direto marcado ANTES do insert: o trigger só cria a tarefa
          // "Enviar aviso ao parceiro" quando a flag falta.
          const enviaAviso = avisoAplicavel && avisoAtivo && !!avisoTexto.trim();
          const novoEvento = await criarEvento({
            tipo: (agendaItem.tipo as AgendaTipo) || "pericia",
            titulo: titulo.trim(),
            descricao: descricao.trim() || null,
            start_at: startIso,
            end_at: endIso,
            local: local.trim() || null,
            caso_id: casoId,
            responsavel_id: responsavelId,
            processo_admin_id: proc.processo_admin_id,
            processo_judicial_id: proc.processo_judicial_id,
            ...(enviaAviso ? { metadata: { aviso_direto: true } } : {}),
          });
          marcarDestaque(novoEvento.id);

          if (enviaAviso && casoId) {
            try {
              await enviarAvisoEvento({
                casoId,
                eventoId: novoEvento.id,
                tipoAviso:
                  (agendaItem.tipo as string) === "audiencia"
                    ? "audiencia_aviso"
                    : "pericia_aviso",
                texto: avisoTexto.trim(),
                autorId: usuario?.id ?? null,
              });
            } catch (e) {
              console.error("aviso ao parceiro falhou:", e);
              toast.error(
                "Evento criado, mas o aviso ao parceiro FALHOU — envie manualmente pelos Comentários do caso.",
              );
            }
          }

          // Comprovante lido sobe pros Documentos do caso, seguindo a
          // numeração dos arquivos já existentes ("25 - …" → "26 - …").
          if (comprovanteFile && casoId) {
            try {
              const { data: docsExist } = await supabase
                .from("documentos")
                .select("nome_arquivo")
                .eq("caso_id", casoId);
              let maior = 0;
              for (const d of docsExist ?? []) {
                const m = /^(\d+)\s*-/.exec(
                  (d as { nome_arquivo: string | null }).nome_arquivo ?? "",
                );
                if (m) maior = Math.max(maior, parseInt(m[1], 10));
              }
              const semNumero = comprovanteFile.name.replace(/^\d+\s*-\s*/, "");
              const nomeFinal = maior > 0 ? `${maior + 1} - ${semNumero}` : semNumero;
              const storagePath = `${casoId}/${Date.now()}_${sanitizeFileName(nomeFinal)}`;
              const up = await supabase.storage
                .from("documentos")
                .upload(storagePath, comprovanteFile, {
                  cacheControl: "3600",
                  upsert: false,
                });
              if (up.error) throw up.error;
              const ins = await supabase.from("documentos").insert({
                caso_id: casoId,
                tipo: "outro",
                tipo_personalizado: "Comprovante de agendamento de perícia",
                nome_arquivo: nomeFinal,
                storage_path: storagePath,
                tamanho_bytes: comprovanteFile.size,
                uploaded_by: usuario?.id ?? null,
                visivel_parceiro: true,
              });
              if (ins.error) throw ins.error;
            } catch (e) {
              console.error("upload do comprovante falhou:", e);
              toast.error(
                "Perícia criada, mas o upload do comprovante falhou — anexe manualmente em Documentos.",
              );
            }
          }
        } else {
          // Comportamento clássico: form cria tarefa principal.
          const firstMeta = (mainItem?.meta ?? {}) as Record<string, unknown>;
          const metaCriacao: Record<string, unknown> = tpl
            ? {
                template_aplicado: tpl.nome,
                template_item_index: 0,
                aplicado_manualmente: true,
                ...firstMeta,
              }
            : {};
          if (tipo === "pericia") metaCriacao.pericia_evento = periciaEvento;
          const novaTarefa = await criarTarefa({
            titulo: titulo.trim(),
            descricao: descricao.trim() || null,
            tipo,
            prioridade,
            caso_id: casoId,
            responsavel_id: responsavelId,
            due_at,
            processo_admin_id: proc.processo_admin_id,
            processo_judicial_id: proc.processo_judicial_id,
            metadata: Object.keys(metaCriacao).length > 0 ? metaCriacao : undefined,
          });
          marcarDestaque(novaTarefa.id);
        }

        // ============== EXTRAS (todos itens que não foram o main) ==============
        let extras = 0;
        let extrasAndamento = 0;
        if (tpl && tplItens.length > 0) {
          for (let i = 0; i < tplItens.length; i++) {
            const item = tplItens[i];
            if (item === mainItem) continue;          // skip o main (já criado)
            if (item.destino === "agenda") continue;  // ignora outros agenda (1 agenda só)

            // ----- destino=andamento → cria registro em `andamentos` -----
            if (item.destino === "andamento") {
              const visivel = item.visivel_parceiro ?? true;
              const { data: novoAnd, error: errAnd } = await supabase
                .from("andamentos")
                .insert({
                  caso_id: casoId,
                  processo_admin_id: proc.processo_admin_id,
                  processo_judicial_id: proc.processo_judicial_id,
                  origem: "interno",
                  titulo: substituirPlaceholders(item.titulo, ph),
                  descricao:
                    substituirPlaceholders(item.descricao ?? "", ph) || null,
                  data_evento: new Date().toISOString(),
                  criado_por: usuario?.id ?? null,
                  visivel_parceiro: visivel,
                  metadata: {
                    template_aplicado: tpl.nome,
                    template_item_index: i,
                    aplicado_manualmente: true,
                    ...(item.meta ?? {}),
                  },
                })
                .select("id")
                .single();
              if (errAnd) throw errAnd;
              marcarDestaque(novoAnd.id);
              // Fire-and-forget: notifica parceiro por e-mail se visível.
              if (visivel) {
                supabase.functions
                  .invoke("notify-novo-andamento", {
                    body: { andamento_id: novoAnd.id },
                  })
                  .catch(() => {});
              }
              extrasAndamento++;
              continue;
            }

            // ----- destino=solicitacao_documento → cria solicitação -----
            if (item.destino === "solicitacao_documento" && casoId) {
              const tituloSub = substituirPlaceholders(item.titulo, ph);
              const descSub = substituirPlaceholders(item.descricao ?? "", ph);
              // Exigência judicial: a IA reescreve o trecho da publicação em
              // linguagem simples pro parceiro (mesma ideia do fluxo automático
              // do INSS). IA fora do ar ou sem chave → segue o texto do
              // template — nunca bloqueia a aplicação.
              let descricaoSolic = descSub || tituloSub;
              if (
                (item.meta as { mensagem_ia?: string } | undefined)?.mensagem_ia ===
                  "exigencia_judicial" &&
                docsExigencia.trim()
              ) {
                try {
                  const { data: ia } = await supabase.functions.invoke(
                    "mensagem-parceiro-exigencia",
                    {
                      body: {
                        tipo: "judicial",
                        despacho: docsExigencia.trim(),
                        prazo_fatal: prazoFatal || null,
                        nome_cliente: ctx?.cliente_nome ?? null,
                      },
                    },
                  );
                  const msg = (ia as { mensagem?: string | null } | null)?.mensagem;
                  if (msg && msg.trim().length >= 40) {
                    descricaoSolic = msg.trim();
                  } else {
                    toast.info("IA indisponível — a solicitação saiu com o texto padrão.");
                  }
                } catch {
                  toast.info("IA indisponível — a solicitação saiu com o texto padrão.");
                }
              }
              const { data: solic, error: errSolic } = await supabase
                .from("solicitacoes_documento")
                .insert({
                  caso_id: casoId,
                  tipo: (item.tipo as string) || "outro",
                  descricao: descricaoSolic,
                  status: "pendente",
                  solicitado_por: usuario?.id ?? null,
                  origem: `template:${tpl.nome}`,
                  data_solicitacao: new Date().toISOString(),
                })
                .select("id")
                .single();
              if (errSolic) throw errSolic;
              marcarDestaque(solic.id);
              extrasAndamento++; // contagem genérica de "não-tarefa" criados
              continue;
            }

            // ----- destino=tarefa (default) -----
            // Responsável: o select por item (UI) manda. "herdar" = usa o
            // responsável do form; "sem" = fica vazio. Se o select não
            // renderizou (edge: prefill não rodou), cai no comportamento
            // antigo: form → executor_email do template.
            const escolhido = extrasResp.find((e) => e.index === i);
            let respFinal: string | null;
            if (escolhido) {
              respFinal =
                escolhido.respId === "herdar"
                  ? responsavelId
                  : escolhido.respId === "sem"
                    ? null
                    : escolhido.respId;
            } else {
              respFinal = responsavelId;
              if (!respFinal && item.executor_email) {
                respFinal = emailParaId.get(item.executor_email.toLowerCase()) ?? null;
              }
            }
            const ancora = item.due_relative_to ?? "hoje";
            const extraDueAt =
              ancora === "prazo_fatal"
                ? dueAtDoPrazoFatal(prazoFatal, item.offset_dias)
                : ancora === "agenda" || ancora === "sexta_antes_agenda"
                  ? calcularDueAtRelativo(ancora, agendaStart, item.offset_dias)
                  : calcularDueAtRelativo("hoje", null, item.offset_dias);
            const tarefaExtra = await criarTarefa({
              caso_id: casoId,
              processo_admin_id: proc.processo_admin_id,
              processo_judicial_id: proc.processo_judicial_id,
              responsavel_id: respFinal,
              tipo: (item.tipo as TarefaTipo) || "interna",
              prioridade: item.prioridade ?? 3,
              titulo: substituirPlaceholders(item.titulo, ph),
              descricao:
                substituirPlaceholders(item.descricao ?? "", ph) || null,
              due_at: extraDueAt,
              metadata: {
                template_aplicado: tpl.nome,
                template_item_index: i,
                aplicado_manualmente: true,
                ancora_prazo: ancora,
                // Data da perícia gravada NA TAREFA, não só no evento da
                // agenda. O escalonamento (ouvidoria 30d / peticionar 60d /
                // ajuizar 90d) conta daqui — se dependesse do evento, bastava
                // alguém apagar a perícia depois pra tarefa virar órfã e
                // nunca escalonar. Aconteceu em produção antes desta linha.
                ...(agendaStart ? { pericia_em: agendaStart.toISOString() } : {}),
                ...(item.meta ?? {}),
              },
            });
            marcarDestaque(tarefaExtra.id);
            extras++;
          }
        }

        // Trecho dinâmico do toast (X tarefa(s) + Y andamento(s)).
        const partesTrecho: string[] = [];
        if (extras > 0) partesTrecho.push(`${extras} tarefa${extras === 1 ? "" : "s"}`);
        if (extrasAndamento > 0) partesTrecho.push(`${extrasAndamento} andamento${extrasAndamento === 1 ? "" : "s"}`);
        const trechoExtras = partesTrecho.join(" + ");

        if (agendaItem) {
          toast.success(
            partesTrecho.length === 0
              ? "Perícia agendada."
              : `Perícia agendada + ${trechoExtras}.`,
          );
          onSaved();
          onClose();
          return;
        }

        const totalTarefas = 1 + extras;
        toast.success(
          extrasAndamento === 0
            ? totalTarefas === 1
              ? "Tarefa criada."
              : `${totalTarefas} tarefas criadas (${extras} adicional${extras === 1 ? "" : "is"} do template).`
            : `Tarefa criada + ${trechoExtras}.`,
        );
      }
      onSaved();
      onClose();
    } catch (e) {
      console.error("[tarefa-sheet] salvar falhou:", e);
      const anyErr = e as { message?: string; details?: string; hint?: string };
      let msg =
        anyErr?.message || anyErr?.details || anyErr?.hint || "";
      if (!msg) {
        try {
          msg = JSON.stringify(e);
        } catch {
          msg = String(e);
        }
      }
      toast.error(`Falha: ${msg}`);
    } finally {
      setSalvando(false);
    }
  }

  async function excluir() {
    if (!editando || !tarefa) return;
    if (!window.confirm("Excluir esta tarefa?")) return;
    setExcluindo(true);
    try {
      await excluirTarefa(tarefa.id);
      toast.success("Tarefa excluída.");
      onSaved();
      onClose();
    } catch (e) {
      console.error(e);
      toast.error("Falha ao excluir.");
    } finally {
      setExcluindo(false);
    }
  }

  return (
    <Sheet open={aberto} onOpenChange={(o) => !o && fechar()}>
      <SheetContent className="w-full sm:max-w-md overflow-y-auto">
        <SheetHeader>
          <SheetTitle>{editando ? "Editar tarefa" : "Nova tarefa"}</SheetTitle>
          {editando && tarefa && (
            <SheetDescription className="space-y-0.5">
              {/* Autoria (trigger): quem criou e quem concluiu/cancelou. */}
              <span className="block">
                Criada em {formatarDataHoraCurtaBR(tarefa.created_at)}
                {tarefa.criador?.nome ? ` por ${nomeAmigavel(tarefa.criador.nome)}` : ""} ·
                origem {tarefa.origem}
              </span>
              {descreverAutoriaStatus(tarefa) && (
                <span className="block">{descreverAutoriaStatus(tarefa)}</span>
              )}
            </SheetDescription>
          )}
        </SheetHeader>

        <div className="space-y-4 py-4">
          {editando && tarefa &&
            (tarefa.metadata as { acompanhamento_processual?: boolean })?.acompanhamento_processual && (
              <EtapasAcompanhamento tarefa={tarefa} onUpdated={onSaved} />
          )}

          {editando && tarefa &&
            (tarefa.metadata as { acompanhamento_pericia?: boolean })
              ?.acompanhamento_pericia === true && (
              <AcompanhamentoPericia tarefa={tarefa} onUpdated={onSaved} />
            )}

          {editando && tarefa &&
            (tarefa.metadata as { montagem_inicial?: boolean })?.montagem_inicial === true && (
              <MontagemInicial tarefa={tarefa} onUpdated={onSaved} />
            )}

          {editando && tarefa &&
            (tarefa.metadata as { acompanhamento_implementacao?: boolean })
              ?.acompanhamento_implementacao === true && (
              <AcompanhamentoImplementacao tarefa={tarefa} onUpdated={onSaved} />
            )}

          {editando && tarefa &&
            (tarefa.metadata as { confirmar_comparecimento?: boolean })
              ?.confirmar_comparecimento === true && (
              <ComparecimentoPericia tarefa={tarefa} onUpdated={onSaved} />
            )}

          {editando && tarefa &&
            !!(tarefa.metadata as { enviar_aviso?: object })?.enviar_aviso && (
              <EnviarAvisoParceiro tarefa={tarefa} onUpdated={onSaved} />
            )}

          {editando && tarefa &&
            (tarefa.metadata as { cumprimento_exigencia?: boolean })?.cumprimento_exigencia && (
              <EtapaCumprimentoExigencia tarefa={tarefa} onUpdated={onSaved} />
            )}

          {editando && tarefa &&
            (tarefa.metadata as { protocolo_realizado?: boolean })?.protocolo_realizado && (
              <EtapaProtocoloRealizado tarefa={tarefa} onUpdated={onSaved} />
            )}

          <div className="space-y-1.5">
            <Label>Caso</Label>
            {/* Editando uma tarefa que ja tem caso, o normal e querer ABRIR o
                cliente — nao trocar de caso. Um Select solto aqui reatribuia a
                tarefa a outro cliente com um clique torto, sem confirmacao.
                Entao: nome vira link pro caso e a troca fica atras de um botao. */}
            {editando && casoId && !trocandoCaso ? (
              <div className="flex items-center justify-between gap-2 rounded-md border px-3 py-2">
                <Link
                  to="/casos/$id"
                  params={{ id: casoId }}
                  onClick={() => fechar()}
                  className="inline-flex items-center gap-1.5 text-sm font-medium hover:text-[var(--gold)] hover:underline"
                  title="Abrir o caso deste cliente"
                >
                  <ExternalLink className="h-3.5 w-3.5 shrink-0" />
                  {casos.find((c) => c.id === casoId)?.cliente_nome ?? "Abrir caso"}
                </Link>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="text-xs text-muted-foreground"
                  onClick={() => setTrocandoCaso(true)}
                >
                  Trocar caso
                </Button>
              </div>
            ) : (
              <>
                {/* Combobox com busca: 395+ casos, rolar a lista nao dava. */}
                <DocTypeCombobox
                  options={[
                    { value: "sem", label: "Sem caso" },
                    ...casos.map((c) => ({
                      value: c.id,
                      label: c.cliente_nome ?? "(sem nome)",
                    })),
                  ]}
                  value={casoId ?? "sem"}
                  onChange={(v) => {
                    setCasoId(v === "sem" ? null : v);
                    setProcessoToken("");
                  }}
                  placeholder="Sem caso"
                  searchPlaceholder="Buscar cliente..."
                  emptyText="Nenhum cliente encontrado."
                />
                {editando && trocandoCaso && (
                  <div className="flex items-center gap-2">
                    <p className="text-xs text-muted-foreground">
                      Trocar o caso reatribui esta tarefa a outro cliente.
                    </p>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      className="text-xs"
                      onClick={() => {
                        setTrocandoCaso(false);
                        setCasoId(modo.kind === "editar" ? modo.tarefa.caso_id : null);
                      }}
                    >
                      Cancelar troca
                    </Button>
                  </div>
                )}
              </>
            )}
          </div>

          {casoId && processosDoCaso.length > 0 && (
            <div className="space-y-1.5">
              <Label>Processo (opcional)</Label>
              <Select
                value={processoToken || "sem"}
                onValueChange={(v) => setProcessoToken(v === "sem" ? "" : v)}
              >
                <SelectTrigger><SelectValue placeholder="Nenhum" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="sem">Sem processo específico</SelectItem>
                  {processosDoCaso.map((p) => (
                    <SelectItem key={`${p.natureza}:${p.id}`} value={`${p.natureza}:${p.id}`}>
                      {p.rotulo}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                Vincula a tarefa a um requerimento ou processo judicial específico.
              </p>
            </div>
          )}

          {!editando && casoId && templates.length > 0 && (
            <div className="space-y-1.5 rounded-md border border-dashed p-3 bg-muted/30">
              <Label>Template (atalho)</Label>
              <Select value={templateSelecionado} onValueChange={setTemplateSelecionado}>
                <SelectTrigger><SelectValue placeholder="Escolha um template" /></SelectTrigger>
                <SelectContent>
                  {templates.map((t) => (
                    <SelectItem key={t.id} value={t.nome}>
                      {(() => {
                        // Conta cada destino pelo nome — andamento e
                        // solicitação não são tarefas.
                        const tarefasN = t.itens.filter(
                          (i) => !i.destino || i.destino === "tarefa",
                        ).length;
                        const andamentosN = t.itens.filter(
                          (i) => i.destino === "andamento",
                        ).length;
                        const solicN = t.itens.filter(
                          (i) => i.destino === "solicitacao_documento",
                        ).length;
                        const partes: string[] = [];
                        if (templateTemAgenda(t)) partes.push("agenda");
                        if (tarefasN > 0)
                          partes.push(`${tarefasN} tarefa${tarefasN === 1 ? "" : "s"}`);
                        if (andamentosN > 0)
                          partes.push(
                            `${andamentosN} andamento${andamentosN === 1 ? "" : "s"}`,
                          );
                        if (solicN > 0)
                          partes.push(
                            `${solicN} solicitação${solicN === 1 ? "" : "ões"} de doc`,
                          );
                        return (
                          <>
                            {t.rotulo ?? t.nome}{" "}
                            <span className="text-muted-foreground">
                              ({partes.join(" + ") || "vazio"})
                            </span>
                          </>
                        );
                      })()}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                {templateSelecionado ? (
                  templateAgenda ? (
                    <>
                      <strong>Esse template cria um evento na agenda</strong> (a perícia em si)
                      {(() => {
                        const t = templateAgenda;
                        const extras = t.itens.filter((i) => i.destino !== "agenda").length;
                        return extras > 0
                          ? ` + ${extras} tarefa${extras === 1 ? "" : "s"} com prazos relativos à data da perícia.`
                          : ".";
                      })()}
                      {" "}Preencha data, hora e local da perícia abaixo.
                    </>
                  ) : (
                    <>
                      Os campos abaixo foram preenchidos com os dados do template.{" "}
                      <strong>Você pode editar tudo antes de salvar.</strong>
                      {(() => {
                        const t = templates.find((x) => x.nome === templateSelecionado);
                        const extras = (t?.itens.length ?? 0) - 1;
                        return extras > 0 ? (
                          <>
                            {" "}Ao salvar, {extras} tarefa{extras === 1 ? "" : "s"} adicional
                            {extras === 1 ? "" : "is"} do template ser{extras === 1 ? "á" : "ão"} criada
                            {extras === 1 ? "" : "s"} com os valores padrão.
                          </>
                        ) : null;
                      })()}
                    </>
                  )
                ) : (
                  <>
                    Selecionar um template preenche os campos abaixo (você pode editar antes de salvar). Sem template, preencha manualmente.
                  </>
                )}
              </p>
            </div>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="t-titulo">Título</Label>
            <Input
              id="t-titulo"
              value={titulo}
              onChange={(e) => setTitulo(e.target.value)}
              placeholder="Ex: Comunicar parceiro sobre indeferimento"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="t-descricao">Descrição</Label>
            <Textarea
              id="t-descricao"
              value={descricao}
              onChange={(e) => setDescricao(e.target.value)}
              placeholder="Notas, contexto, links..."
              rows={4}
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Tipo</Label>
              <Select value={tipo} onValueChange={(v) => setTipo(v as TarefaTipo)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {TIPOS.map((t) => (
                    <SelectItem key={t} value={t}>{TIPO_LABEL[t]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {tipo === "pericia" && (
                <label className="flex items-start gap-2 pt-1 text-xs text-muted-foreground cursor-pointer">
                  <input
                    type="checkbox"
                    checked={periciaEvento}
                    onChange={(e) => setPericiaEvento(e.target.checked)}
                    className="mt-0.5 accent-[var(--gold)]"
                  />
                  <span>
                    É a perícia em si — aparece na <strong>Agenda</strong>. Desmarque
                    pra tarefa sobre a perícia (acompanhar resultado, contatar…).
                  </span>
                </label>
              )}
            </div>
            <div className="space-y-1.5">
              <Label>Prioridade</Label>
              <Select
                value={String(prioridade)}
                onValueChange={(v) => setPrioridade(Number(v))}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {[1, 2, 3, 4].map((p) => (
                    <SelectItem key={p} value={String(p)}>{PRIORIDADE_LABEL[p]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {editando && (
            <div className="space-y-1.5">
              <Label>Status</Label>
              <Select value={status} onValueChange={(v) => setStatus(v as TarefaStatus)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {STATUS_ORDEM.map((s) => (
                    <SelectItem key={s} value={s}>{STATUS_LABEL[s]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="t-due">
              {templateAgenda ? "Data e hora da perícia" : "Data"}
            </Label>
            <Input
              id="t-due"
              type="datetime-local"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
            />
          </div>

          {templateAgenda && (
            <div className="space-y-1.5">
              <Label htmlFor="t-local">Local</Label>
              <Input
                id="t-local"
                value={local}
                onChange={(e) => setLocal(e.target.value)}
                placeholder="Ex: APS Cabreúva, endereço, sala..."
              />
            </div>
          )}

          {!editando &&
            agendaTipoDoTemplate === "pericia" &&
            !!casoId && (
              <div className="space-y-1.5 rounded-lg border border-dashed p-3 bg-muted/30">
                <Label htmlFor="t-comprovante">
                  Comprovante do agendamento (PDF ou foto do Meu INSS)
                </Label>
                <Input
                  id="t-comprovante"
                  type="file"
                  accept="application/pdf,image/*"
                  disabled={extraindoComprovante}
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) lerComprovante(f);
                  }}
                />
                <p className="text-xs text-muted-foreground">
                  {extraindoComprovante ? (
                    <span className="inline-flex items-center gap-1">
                      <Loader2 className="h-3 w-3 animate-spin" /> Lendo o
                      comprovante…
                    </span>
                  ) : comprovanteFile ? (
                    <>
                      <strong>{comprovanteFile.name}</strong> lido — data, local,
                      protocolo e endereço preenchidos. Ao salvar, o arquivo
                      entra nos Documentos do caso seguindo a numeração.
                    </>
                  ) : (
                    <>
                      Anexe o comprovante e a IA preenche data, local, protocolo
                      e endereço — e o arquivo sobe pros Documentos do caso ao
                      salvar.
                    </>
                  )}
                </p>
              </div>
            )}

          {!editando &&
            (agendaTipoDoTemplate === "pericia" ||
              agendaTipoDoTemplate === "audiencia") &&
            !!casoId &&
            !!ctxCaso &&
            !ctxCaso.parceiro_id && (
              <p className="rounded-md border border-dashed bg-muted/40 p-2.5 text-xs text-muted-foreground">
                Este caso não tem parceiro indicador — nenhum aviso será enviado
                e não nascerá tarefa de aviso.
              </p>
            )}

          {avisoAplicavel && (
            <AvisoParceiroEvento
              rotulo={agendaTipoDoTemplate === "audiencia" ? "audiência" : "perícia"}
              ativo={avisoAtivo}
              onAtivoChange={setAvisoAtivo}
              texto={avisoTexto}
              onTextoChange={(v) => {
                setAvisoTexto(v);
                setAvisoEditado(true);
              }}
            />
          )}

          {templateTemSolicitacao && !editando && (
            <div className="space-y-1.5 rounded-lg border border-dashed border-amber-300 bg-amber-50/40 p-3">
              <Label htmlFor="t-docs-exigencia" className="text-amber-900">
                {templateTemPrazoFatalForm
                  ? "Documentos solicitados pela Justiça"
                  : "Documentos solicitados pelo INSS"}
              </Label>
              <Textarea
                id="t-docs-exigencia"
                value={docsExigencia}
                onChange={(e) => setDocsExigencia(e.target.value)}
                placeholder={
                  templateTemPrazoFatalForm
                    ? "Cole aqui o trecho da publicação (Legalmail) com os documentos pedidos. A IA reescreve em linguagem simples pro parceiro; se estiver indisponível, esse texto vai como está."
                    : "Cole aqui o trecho do despacho/exigência do INSS com a lista de documentos pedidos. Esse texto vai pra descrição da solicitação que aparece ao parceiro."
                }
                rows={4}
              />
              <p className="text-xs text-amber-900/70">
                {templateTemPrazoFatalForm ? (
                  <>
                    A IA reescreve esse trecho em linguagem simples — é a versão
                    reescrita que o parceiro vê na aba{" "}
                    <strong>Documentos solicitados</strong> do caso.
                  </>
                ) : (
                  <>
                    Esse texto fica visível ao parceiro na aba{" "}
                    <strong>Documentos solicitados</strong> do caso.
                  </>
                )}
              </p>
            </div>
          )}

          {templateTemPrazoFatalForm && !editando && (
            <div className="space-y-2 rounded-lg border border-dashed border-red-300 bg-red-50/40 p-3">
              <Label className="text-red-900">Prazo judicial</Label>
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <Label
                    htmlFor="t-pub-data"
                    className="text-xs font-normal text-red-900/80"
                  >
                    Publicado em
                  </Label>
                  <Input
                    id="t-pub-data"
                    type="date"
                    value={pubData}
                    onChange={(e) => {
                      setPubData(e.target.value);
                      recalcularFatal(e.target.value, prazoDias, prazoDiasCustom);
                    }}
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs font-normal text-red-900/80">
                    Prazo (dias úteis)
                  </Label>
                  <Select
                    value={prazoDias}
                    onValueChange={(v) => {
                      setPrazoDias(v);
                      recalcularFatal(pubData, v, prazoDiasCustom);
                    }}
                  >
                    <SelectTrigger aria-label="Prazo em dias úteis">
                      <SelectValue placeholder="Escolher" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="5">5 dias</SelectItem>
                      <SelectItem value="10">10 dias</SelectItem>
                      <SelectItem value="15">15 dias</SelectItem>
                      <SelectItem value="outro">Outro…</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              {prazoDias === "outro" && (
                <Input
                  type="number"
                  min={1}
                  placeholder="Quantos dias úteis?"
                  aria-label="Prazo em dias úteis (outro)"
                  value={prazoDiasCustom}
                  onChange={(e) => {
                    setPrazoDiasCustom(e.target.value);
                    recalcularFatal(pubData, "outro", e.target.value);
                  }}
                />
              )}
              <div className="space-y-1">
                <Label
                  htmlFor="t-prazo-fatal"
                  className="text-xs font-normal text-red-900/80"
                >
                  Prazo fatal (fim do prazo judicial)
                </Label>
                <Input
                  id="t-prazo-fatal"
                  type="date"
                  value={prazoFatal}
                  onChange={(e) => setPrazoFatal(e.target.value)}
                />
              </div>
              <p className="text-xs text-red-900/70">
                Calculado em dias úteis a partir do dia útil seguinte à
                publicação. Feriado não é descontado — confira e ajuste o fatal
                se precisar. A tarefa FATAL é criada para o dia útil anterior.
              </p>
            </div>
          )}

          <div className="space-y-1.5">
            <Label>
              {!editando && extrasResp.length > 0
                ? "Responsável (tarefa principal)"
                : "Responsável"}
            </Label>
            {/* Com várias tarefas no template, mostra QUAL é a principal —
                mesmo estilo das extras logo abaixo. */}
            {!editando && extrasResp.length > 0 && titulo.trim() && (
              <p className="text-xs text-muted-foreground">{titulo}</p>
            )}
            <Select
              value={responsavelId ?? "sem"}
              onValueChange={(v) => setResponsavelId(v === "sem" ? null : v)}
            >
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="sem">Sem responsável</SelectItem>
                {internos.map((u) => (
                  <SelectItem key={u.id} value={u.id}>
                    {u.nome ?? "(sem nome)"}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Template que cria mais tarefas: um responsável por tarefa extra,
              pré-preenchido com o executor padrão do template. */}
          {!editando && extrasResp.length > 0 && (
            <div className="space-y-2 rounded-md border p-3">
              <Label>Responsáveis das outras tarefas do template</Label>
              {extrasResp.map((e) => (
                <div key={e.index} className="space-y-1">
                  <p className="text-xs text-muted-foreground">{e.titulo}</p>
                  <Select
                    value={e.respId}
                    onValueChange={(v) =>
                      setExtrasResp((prev) =>
                        prev.map((x) =>
                          x.index === e.index ? { ...x, respId: v } : x,
                        ),
                      )
                    }
                  >
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="herdar">Mesmo da tarefa principal</SelectItem>
                      <SelectItem value="sem">Sem responsável</SelectItem>
                      {internos.map((u) => (
                        <SelectItem key={u.id} value={u.id}>
                          {u.nome ?? "(sem nome)"}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              ))}
            </div>
          )}

        </div>

        <SheetFooter className="gap-2 sm:gap-2">
          {editando && (
            <Button
              variant="ghost"
              onClick={excluir}
              disabled={excluindo || salvando}
              className="mr-auto text-destructive hover:text-destructive"
            >
              {excluindo ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
              Excluir
            </Button>
          )}
          <Button variant="outline" onClick={fechar} disabled={salvando}>
            Cancelar
          </Button>
          {/* Sem argumento de propósito: passar o evento do clique aqui faria
              `justificativa` chegar preenchida e pular o diálogo do prazo fatal. */}
          <Button onClick={() => void salvar()} disabled={salvando}>
            {salvando ? <Loader2 className="h-4 w-4 animate-spin" /> : "Salvar"}
          </Button>
        </SheetFooter>
      </SheetContent>

      {/* Adiar prazo fatal: exige justificativa, que vira andamento interno.
          Não bloqueia — a pessoa pode ter um motivo legítimo —, mas obriga a
          dizer qual, e deixa isso gravado no caso. */}
      <AlertDialog open={confirmandoAdiamento} onOpenChange={setConfirmandoAdiamento}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlarmClock className="h-5 w-5 text-destructive" />
              Isso é um prazo fatal
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2">
                <p>
                  Você está adiando de{" "}
                  <strong className="text-foreground">
                    {tarefa?.due_at ? formatarDueAtCurto(tarefa.due_at) : "sem prazo"}
                  </strong>{" "}
                  para{" "}
                  <strong className="text-foreground">
                    {formatarDueAtCurto(isoFromInputDateTime(dueDate))}
                  </strong>
                  . Prazo fatal não deveria ser adiado.
                </p>
                <p>
                  Se for realmente necessário, escreva o motivo. Ele fica registrado
                  como andamento interno no caso — <strong>o parceiro não vê</strong>.
                </p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>

          <div className="space-y-1.5">
            <Label className="text-xs">Justificativa</Label>
            <Textarea
              rows={3}
              autoFocus
              value={justificativa}
              onChange={(e) => setJustificativa(e.target.value)}
              placeholder="Por que o prazo não pôde ser cumprido?"
            />
          </div>

          <AlertDialogFooter>
            <AlertDialogCancel
              onClick={() => {
                setJustificativa("");
                // Devolve o campo à data original: cancelar tem que desfazer o
                // adiamento, senão a pessoa salva depois sem passar por aqui.
                setDueDate(inputDateTimeValueFromIso(tarefa?.due_at ?? null));
              }}
            >
              Manter o prazo
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={justificativa.trim().length < 10}
              onClick={() => {
                const j = justificativa.trim();
                setConfirmandoAdiamento(false);
                setJustificativa("");
                void salvar(j);
              }}
            >
              Adiar mesmo assim
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Sheet>
  );
}

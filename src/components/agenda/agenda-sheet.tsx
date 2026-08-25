// Sheet (slide-in) para criar/editar evento de agenda. Por enquanto a UI
// foca em PERÍCIAS, mas o componente já suporta os outros tipos.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { AlarmClock, Loader2, Trash2, Check } from "lucide-react";

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
import {
  extrairComprovante,
  extrairDePublicacao,
  mesmoNome,
  subirComprovanteDocumento,
  type CamposComprovante,
} from "@/lib/agenda/comprovante";

import { Button } from "@/components/ui/button";
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
  atualizarEvento,
  buscarEventoMesmoDia,
  criarEvento,
  excluirEvento,
} from "@/lib/agenda/queries";
import { type AgendaEventoComJoins, type AgendaTipo, TIPO_LABEL } from "@/lib/agenda/types";
import { calcularDueAtRelativo } from "@/lib/agenda/helpers";
import {
  comoLocalBR,
  deLocalBR,
  formatarBR,
  hojeChaveBR,
  inputDateTimeBRParaIso,
  isoParaInputDateTimeBR,
} from "@/lib/fuso";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/hooks/use-auth";
import {
  criarTarefa,
  listarCasosResumo,
  listarInternosAtivos,
  listarProcessosDoCaso,
  listarTemplates,
  obterContextoCaso,
  type ContextoCasoParaTemplate,
} from "@/lib/tarefas/queries";
import {
  criarTarefaAvisoFallback,
  enviarAvisoEvento,
  montarTextoAvisoEvento,
} from "@/lib/agenda/aviso";
import { AvisoParceiroEvento } from "@/components/agenda/aviso-parceiro-evento";
import {
  templateTemAgenda,
  type ProcessoDoCasoOpcao,
  type TarefaTemplateRow,
  type TarefaTipo,
} from "@/lib/tarefas/types";
import { substituirPlaceholders } from "@/lib/tarefas/helpers";
import { useDestaque } from "@/lib/destaque/destaque-context";

const TIPOS: AgendaTipo[] = ["pericia", "audiencia", "reuniao", "interno"];

type Modo =
  | {
      kind: "criar";
      tipoInicial?: AgendaTipo;
      casoIdInicial?: string | null;
      processoTokenInicial?: string;
    }
  | { kind: "editar"; evento: AgendaEventoComJoins };

interface Props {
  modo: Modo | null;
  onClose: () => void;
  onSaved: () => void;
}

// Helpers de input <input type="datetime-local">. O que a pessoa digita é
// SEMPRE horário de Brasília — a perícia é no Brasil, esteja quem agenda onde
// estiver (a Naira agenda da Espanha). Ver src/lib/fuso.ts.
function isoToInputDatetime(iso: string | null): string {
  return isoParaInputDateTimeBR(iso);
}

function inputDatetimeToIso(s: string): string {
  return inputDateTimeBRParaIso(s) ?? "";
}

export function AgendaSheet({ modo, onClose, onSaved }: Props) {
  const aberto = modo !== null;
  const { marcar: marcarDestaque } = useDestaque();
  const editando = modo?.kind === "editar";
  const evento = modo?.kind === "editar" ? modo.evento : null;

  const [tipo, setTipo] = useState<AgendaTipo>("pericia");
  const [titulo, setTitulo] = useState("");
  const [descricao, setDescricao] = useState("");
  const [local, setLocal] = useState("");
  const [startInput, setStartInput] = useState("");
  const [endInput, setEndInput] = useState("");
  const [casoId, setCasoId] = useState<string | null>(null);
  const [processoToken, setProcessoToken] = useState("");
  const [responsavelId, setResponsavelId] = useState<string | null>(null);

  const [casos, setCasos] = useState<Array<{ id: string; cliente_nome: string | null }>>([]);
  const [internos, setInternos] = useState<
    Array<{ id: string; nome: string | null; email: string | null }>
  >([]);
  const [processosDoCaso, setProcessosDoCaso] = useState<ProcessoDoCasoOpcao[]>([]);
  // Templates de agenda (com pelo menos 1 item destino=agenda).
  const [templates, setTemplates] = useState<TarefaTemplateRow[]>([]);
  const [templateSelecionado, setTemplateSelecionado] = useState<string>("");

  const [salvando, setSalvando] = useState(false);
  const [excluindo, setExcluindo] = useState(false);
  const [concluindo, setConcluindo] = useState(false);
  const { usuario } = useAuth();

  // Aviso ao parceiro embutido (perícia/audiência com caso de parceiro):
  // o texto padrão vem do banco e a revisão acontece aqui, antes de salvar.
  const [ctxCaso, setCtxCaso] = useState<ContextoCasoParaTemplate | null>(null);
  const [avisoAtivo, setAvisoAtivo] = useState(true);
  const [avisoTexto, setAvisoTexto] = useState("");
  const [avisoEditado, setAvisoEditado] = useState(false);
  // Comprovante de agendamento (mesma mecânica do TarefaSheet): IA preenche
  // data/local/protocolo/endereço; nome divergente BLOQUEIA; o arquivo sobe
  // pros Documentos do caso no salvar.
  const [comprovanteFile, setComprovanteFile] = useState<File | null>(null);
  const [extraindoComprovante, setExtraindoComprovante] = useState(false);
  const [comprovanteDivergente, setComprovanteDivergente] = useState<{
    campos: CamposComprovante;
    file: File | null; // null = veio de publicação colada (nada a subir)
    requerente: string;
  } | null>(null);
  const [publicacaoColada, setPublicacaoColada] = useState("");
  const [avisoProtocolo, setAvisoProtocolo] = useState("");
  const [avisoEndereco, setAvisoEndereco] = useState("");
  // Guardas do agendamento (data passada / duplicado) em diálogo do app.
  const [avisosAgenda, setAvisosAgenda] = useState<string[] | null>(null);
  const ignorarAvisosAgenda = useRef(false);

  function aplicarComprovante(campos: CamposComprovante, file: File | null) {
    if (campos.data) {
      const inicio = `${campos.data}T${campos.hora || "09:00"}`;
      setStartInput(inicio);
      const fimIso = inputDatetimeToIso(inicio);
      if (fimIso) {
        setEndInput(isoToInputDatetime(new Date(new Date(fimIso).getTime() + 3600_000).toISOString()));
      }
    }
    if (campos.local) setLocal(campos.local);
    setAvisoProtocolo(campos.protocolo ?? "");
    setAvisoEndereco(campos.endereco ?? "");
    setAvisoEditado(false);
    if (file) setComprovanteFile(file);
  }

  function avisarSeDataPassada(campos: CamposComprovante) {
    if (campos.data && campos.data < hojeChaveBR()) {
      const [a, m, d] = campos.data.split("-");
      toast.warning(
        `Atenção: a perícia é de ${d}/${m}/${a} — data que JÁ PASSOU. Confira se é a publicação/comprovante atual.`,
      );
      return true;
    }
    return false;
  }

  async function lerPublicacaoColada() {
    if (!publicacaoColada.trim()) {
      toast.error("Cole o texto da publicação primeiro.");
      return;
    }
    if (!ctxCaso?.cliente_nome) {
      toast.error("Os dados do caso ainda estão carregando — tente de novo em instantes.");
      return;
    }
    setExtraindoComprovante(true);
    setComprovanteDivergente(null);
    try {
      const campos = await extrairDePublicacao(publicacaoColada.trim());
      if (!campos) {
        toast.error("Não consegui ler a publicação — preencha os campos na mão.");
        return;
      }
      if (!mesmoNome(campos.requerente, ctxCaso?.cliente_nome)) {
        setComprovanteDivergente({ campos, file: null, requerente: campos.requerente ?? "" });
        return;
      }
      aplicarComprovante(campos, null);
      if (!avisarSeDataPassada(campos)) {
        toast.success("Publicação lida — confira os campos preenchidos.");
      }
    } catch (e) {
      console.error("extrair publicação falhou:", e);
      toast.error("Falha ao ler a publicação. Preencha os campos na mão.");
    } finally {
      setExtraindoComprovante(false);
    }
  }

  async function lerComprovante(file: File) {
    if (!ctxCaso?.cliente_nome) {
      toast.error("Os dados do caso ainda estão carregando — tente de novo em instantes.");
      return;
    }
    setExtraindoComprovante(true);
    setComprovanteDivergente(null);
    try {
      const campos = await extrairComprovante(file);
      if (!campos) {
        toast.error("Não consegui ler o comprovante — preencha os campos na mão.");
        return;
      }
      if (!mesmoNome(campos.requerente, ctxCaso?.cliente_nome)) {
        setComprovanteDivergente({ campos, file, requerente: campos.requerente ?? "" });
        return;
      }
      aplicarComprovante(campos, file);
      if (!avisarSeDataPassada(campos)) {
        toast.success("Comprovante lido — confira os campos preenchidos.");
      }
    } catch (e) {
      console.error("extrair comprovante falhou:", e);
      toast.error("Falha ao ler o comprovante. Preencha os campos na mão.");
    } finally {
      setExtraindoComprovante(false);
    }
  }

  const avisoAplicavel =
    !editando &&
    (tipo === "pericia" || tipo === "audiencia") &&
    !!casoId &&
    !!ctxCaso?.parceiro_id;

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

  // Regenera o texto padrão quando os dados do agendamento mudam — até a
  // pessoa editar na mão (aí o texto é dela e ninguém mexe mais).
  useEffect(() => {
    if (!avisoAplicavel || avisoEditado || !ctxCaso) return;
    const natureza: "admin" | "judicial" =
      templateSelecionado === "pericia_judicial" || processoToken.startsWith("judicial:")
        ? "judicial"
        : "admin";
    let cancelado = false;
    montarTextoAvisoEvento({
      tipo,
      natureza,
      cliente: ctxCaso.cliente_nome,
      servico: ctxCaso.servico || ctxCaso.tipo_beneficio,
      startIso: startInput ? inputDatetimeToIso(startInput) : null,
      local: local.trim() || null,
      // Sem comprovante, o número vem do processo selecionado no form
      // (judicial = nº do processo; admin = nº do requerimento).
      protocolo: avisoProtocolo || ctxCaso.protocolo || null,
      endereco: avisoEndereco || null,
    })
      .then((t) => {
        if (!cancelado) setAvisoTexto(t);
      })
      .catch(() => {});
    return () => {
      cancelado = true;
    };
     
  }, [avisoAplicavel, avisoEditado, ctxCaso, tipo, startInput, local, templateSelecionado, processoToken, avisoProtocolo, avisoEndereco]);

  // Com caso, oferece os templates de cliente; sem caso, só os que não
  // dependem de um (ausência). Assim a ausência é alcançável mesmo com
  // "Sem caso" — antes o seletor inteiro sumia.
  const templatesVisiveis = useMemo(() => {
    const temSemCaso = (t: TarefaTemplateRow) =>
      t.itens.some((i) => i.destino === "agenda" && i.sem_caso);
    return templates.filter((t) => (casoId ? !temSemCaso(t) : temSemCaso(t)));
  }, [templates, casoId]);

  useEffect(() => {
    if (!aberto) return;
    listarCasosResumo()
      .then(setCasos)
      .catch(() => {});
    listarInternosAtivos()
      .then(setInternos)
      .catch(() => {});
    // AgendaSheet só mostra templates que criam evento de agenda
    // (ex: pericia_parceiro). Tarefa-only fica no TarefaSheet.
    listarTemplates()
      .then((all) => setTemplates(all.filter((t) => templateTemAgenda(t))))
      .catch(() => {});
  }, [aberto]);

  useEffect(() => {
    if (!casoId) {
      setProcessosDoCaso([]);
      return;
    }
    listarProcessosDoCaso(casoId)
      .then(setProcessosDoCaso)
      .catch(() => {});
  }, [casoId]);

  // Sincroniza form com modo na abertura.
  useEffect(() => {
    if (!modo) return;
    if (modo.kind === "criar") {
      setTipo(modo.tipoInicial ?? "pericia");
      setTitulo("");
      setDescricao("");
      setLocal("");
      // Default: próxima hora cheia (de Brasília) + 1h de duração
      const now = comoLocalBR(new Date());
      now.setMinutes(0, 0, 0);
      now.setHours(now.getHours() + 1);
      const endDate = new Date(now);
      endDate.setHours(endDate.getHours() + 1);
      setStartInput(isoToInputDatetime(deLocalBR(now).toISOString()));
      setEndInput(isoToInputDatetime(deLocalBR(endDate).toISOString()));
      setCasoId(modo.casoIdInicial ?? null);
      setProcessoToken(modo.processoTokenInicial ?? "");
      setResponsavelId(null);
      setTemplateSelecionado("");
      setAvisoAtivo(true);
      setAvisoTexto("");
      setAvisoEditado(false);
      setComprovanteFile(null);
      setExtraindoComprovante(false);
      setComprovanteDivergente(null);
      setPublicacaoColada("");
      setAvisoProtocolo("");
      setAvisoEndereco("");
      setAvisosAgenda(null);
      ignorarAvisosAgenda.current = false;
    } else {
      const e = modo.evento;
      setTipo(e.tipo);
      setTitulo(e.titulo);
      setDescricao(e.descricao ?? "");
      setLocal(e.local ?? "");
      setStartInput(isoToInputDatetime(e.start_at));
      setEndInput(isoToInputDatetime(e.end_at));
      setCasoId(e.caso_id);
      setProcessoToken(
        e.processo_admin_id
          ? `admin:${e.processo_admin_id}`
          : e.processo_judicial_id
            ? `judicial:${e.processo_judicial_id}`
            : "",
      );
      setResponsavelId(e.responsavel_id);
      setTemplateSelecionado("");
    }
  }, [modo]);

  // Escolher o TIPO ja aplica o template daquele tipo, quando existe.
  //
  // Antes a pessoa tinha que lembrar de abrir o seletor de template. Criar uma
  // pericia pela agenda gerava so o evento; criar pela tarefa gerava evento +
  // 3 tarefas de acompanhamento. Mesma pericia, resultados diferentes conforme
  // a porta de entrada.
  //
  // O casamento e pelos DADOS, nao por lista fixa: cada template declara o tipo
  // no item destino='agenda'. Se amanha nascer um template de atendimento, ele
  // passa a ser aplicado sozinho sem tocar neste arquivo. Hoje so pericia e
  // guiche tem template — audiencia e atendimento seguem manuais, como pedido.
  useEffect(() => {
    if (editando) return;
    // Só casa por tipo quando há caso. Templates sem caso (ausência) são
    // escolhidos na mão — senão marcar "Interno" viraria "Ausência" em
    // qualquer evento interno.
    if (!casoId) return;
    const doTipo = templates.filter((t) =>
      t.itens.some((i) => i.destino === "agenda" && i.tipo === tipo && !i.sem_caso),
    );
    // 2+ templates pro mesmo tipo = ambiguo; deixa a pessoa escolher.
    if (doTipo.length !== 1) return;
    if (templateSelecionado === doTipo[0].nome) return;
    setTemplateSelecionado(doTipo[0].nome);
  }, [tipo, templates, editando]); // eslint-disable-line react-hooks/exhaustive-deps

  // Selecionar template (modo criar): popula tipo/titulo/descricao do item
  // destino=agenda; usa duracao_min do template pra calcular end_at.
  // Os campos start_at/local/responsavel ficam pra Naira preencher.
  useEffect(() => {
    if (editando) return;
    if (!templateSelecionado) return;
    const tpl = templates.find((t) => t.nome === templateSelecionado);
    if (!tpl) return;
    const agendaItem = tpl.itens.find((i) => i.destino === "agenda");
    if (!agendaItem) return;
    // Template sem caso (ausência) aplica direto; os demais precisam do caso
    // pra resolver {nome_cliente} e companhia.
    if (!casoId && !agendaItem.sem_caso) return;
    let cancelado = false;
    (async () => {
      const ctx = casoId
        ? await obterContextoCaso(casoId, processoToken)
        : { cliente_nome: "", protocolo: "", cliente_cpf: "", servico: "" };
      if (cancelado) return;
      const ph = {
        nome_cliente: ctx.cliente_nome,
        protocolo: ctx.protocolo,
        cpf: ctx.cliente_cpf,
        servico: ctx.servico,
        // Ausência é da PESSOA, não de um cliente: o título sai com o nome de
        // quem está criando.
        nome_usuario: usuario?.nome ?? "",
      };
      setTipo((agendaItem.tipo as AgendaTipo) || "pericia");
      setTitulo(substituirPlaceholders(agendaItem.titulo, ph));
      setDescricao(substituirPlaceholders(agendaItem.descricao ?? "", ph));
      // Ausência é de quem está criando: já sai com a pessoa como responsável.
      if (agendaItem.sem_caso && usuario?.id) setResponsavelId(usuario.id);
      // Ajusta end_at = start_at + duracao_min se o usuário ainda não mexeu.
      const dur = agendaItem.duracao_min ?? 60;
      const startIsoTpl = inputDatetimeToIso(startInput);
      if (startIsoTpl) {
        const endDate = new Date(new Date(startIsoTpl).getTime() + dur * 60_000);
        setEndInput(isoToInputDatetime(endDate.toISOString()));
      }
    })();
    return () => {
      cancelado = true;
    };
  }, [templateSelecionado, casoId, processoToken, templates, editando]); // eslint-disable-line react-hooks/exhaustive-deps

  const fechar = useCallback(() => {
    if (salvando || excluindo) return;
    onClose();
  }, [salvando, excluindo, onClose]);

  function parseProcesso(): {
    processo_admin_id: string | null;
    processo_judicial_id: string | null;
  } {
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

  async function salvar() {
    if (!titulo.trim()) {
      toast.error("Título é obrigatório.");
      return;
    }
    if (!startInput || !endInput) {
      toast.error("Início e fim são obrigatórios.");
      return;
    }
    const startIso = inputDatetimeToIso(startInput);
    const endIso = inputDatetimeToIso(endInput);
    if (new Date(endIso).getTime() < new Date(startIso).getTime()) {
      toast.error("Fim não pode ser antes do início.");
      return;
    }
    setSalvando(true);
    try {
      const proc = parseProcesso();
      if (editando && evento) {
        await atualizarEvento({
          id: evento.id,
          patch: {
            tipo,
            titulo: titulo.trim(),
            descricao: descricao.trim() || null,
            start_at: startIso,
            end_at: endIso,
            local: local.trim() || null,
            caso_id: casoId,
            responsavel_id: responsavelId,
            processo_admin_id: proc.processo_admin_id,
            processo_judicial_id: proc.processo_judicial_id,
          },
        });
        toast.success("Evento atualizado.");
      } else {
        // Comprovante de outra pessoa pendente de decisão: não deixa salvar.
        if (comprovanteDivergente) {
          toast.error(
            "O comprovante anexado é de outra pessoa. Confirme que é o mesmo cliente ou anexe o arquivo certo.",
          );
          setSalvando(false);
          return;
        }
        // Guardas (data passada / duplicado) num diálogo do app; "Agendar
        // mesmo assim" rechama salvar() pulando as checagens UMA vez.
        const pularAvisos = ignorarAvisosAgenda.current;
        ignorarAvisosAgenda.current = false;
        if (!pularAvisos) {
          const avisos: string[] = [];
          if (new Date(startIso).getTime() < Date.now()) {
            const quando = new Date(startIso).toLocaleString("pt-BR", {
              day: "2-digit",
              month: "2-digit",
              year: "numeric",
              hour: "2-digit",
              minute: "2-digit",
              timeZone: "America/Sao_Paulo",
            });
            avisos.push(
              `A data do agendamento (${quando}) JÁ PASSOU — o evento não aparece entre os próximos.`,
            );
          }
          if (casoId) {
            const jaExiste = await buscarEventoMesmoDia(casoId, tipo, startIso);
            if (jaExiste) {
              const hora = new Date(jaExiste.start_at).toLocaleTimeString("pt-BR", {
                hour: "2-digit",
                minute: "2-digit",
                timeZone: "America/Sao_Paulo",
              });
              avisos.push(
                `Este cliente já tem ${TIPO_LABEL[tipo].toLowerCase()} neste dia (às ${hora}).`,
              );
            }
          }
          if (avisos.length > 0) {
            setAvisosAgenda(avisos);
            setSalvando(false);
            return;
          }
        }
        // Aviso direto marcado no evento ANTES do insert: o trigger do banco
        // só cria a tarefa "Enviar aviso ao parceiro" quando a flag falta.
        const enviaAviso = avisoAplicavel && avisoAtivo && !!avisoTexto.trim();
        // Cria o evento de agenda.
        const novoEvento = await criarEvento({
          tipo,
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
              tipoAviso: tipo === "audiencia" ? "audiencia_aviso" : "pericia_aviso",
              texto: avisoTexto.trim(),
              autorId: usuario?.id ?? null,
            });
          } catch (e) {
            console.error("aviso ao parceiro falhou:", e);
            try {
              await criarTarefaAvisoFallback({
                casoId,
                eventoId: novoEvento.id,
                tipoAviso: tipo === "audiencia" ? "audiencia_aviso" : "pericia_aviso",
                texto: avisoTexto.trim(),
                responsavelId: usuario?.id ?? null,
                clienteNome: ctxCaso?.cliente_nome ?? "",
              });
              toast.error(
                "O envio do aviso FALHOU — criei a tarefa 'Enviar aviso ao parceiro' pra não se perder.",
              );
            } catch (e2) {
              console.error("fallback do aviso também falhou:", e2);
              toast.error(
                "Evento criado, mas o aviso ao parceiro FALHOU — envie manualmente pelos Comentários do caso.",
              );
            }
          }
        }

        // Comprovante lido sobe pros Documentos do caso (numeração seguida).
        if (comprovanteFile && casoId) {
          try {
            await subirComprovanteDocumento(casoId, comprovanteFile, usuario?.id ?? null);
          } catch (e) {
            console.error("upload do comprovante falhou:", e);
            toast.error(
              "Evento criado, mas o upload do comprovante falhou — anexe manualmente em Documentos.",
            );
          }
        }

        // Se aplicou um template de agenda com itens destino=tarefa,
        // cria essas tarefas extras (datas relativas ao start_at do evento).
        let tarefasExtras = 0;
        const tpl = templateSelecionado
          ? templates.find((t) => t.nome === templateSelecionado)
          : null;
        if (tpl && casoId) {
          const ctx = await obterContextoCaso(casoId, processoToken);
          const ph = {
            nome_cliente: ctx.cliente_nome,
            protocolo: ctx.protocolo,
            cpf: ctx.cliente_cpf,
            servico: ctx.servico,
          };
          const emailParaId = new Map<string, string>();
          for (const u of internos) {
            if (u.email) emailParaId.set(u.email.toLowerCase(), u.id);
          }
          const agendaStart = new Date(startIso);
          for (const item of tpl.itens) {
            // destino=andamento: o tarefa-sheet ja fazia isto; a agenda nao,
            // entao criar guiche pela agenda nao registrava nada no caso nem
            // acendia o sino do parceiro. Mesmo template tem que dar no mesmo
            // resultado, venha de onde vier.
            if (item.destino === "andamento") {
              const { error: errAnd } = await supabase.from("andamentos").insert({
                caso_id: casoId,
                processo_admin_id: proc.processo_admin_id,
                processo_judicial_id: proc.processo_judicial_id,
                origem: "interno",
                titulo: substituirPlaceholders(item.titulo, ph),
                descricao: substituirPlaceholders(item.descricao ?? "", ph) || null,
                data_evento: new Date().toISOString(),
                criado_por: usuario?.id ?? null,
                visivel_parceiro: item.visivel_parceiro ?? true,
                metadata: {
                  template_aplicado: tpl.nome,
                  aplicado_via: "agenda_sheet",
                  ...(item.meta ?? {}),
                },
              });
              if (errAnd) console.warn("andamento do template falhou:", errAnd);
              continue;
            }
            if (item.destino !== "tarefa") continue;
            const respFinal =
              responsavelId ||
              (item.executor_email
                ? (emailParaId.get(item.executor_email.toLowerCase()) ?? null)
                : null);
            const ancora = item.due_relative_to ?? "hoje";
            const dueAt =
              ancora === "agenda" || ancora === "sexta_antes_agenda"
                ? calcularDueAtRelativo(ancora, agendaStart, item.offset_dias)
                : calcularDueAtRelativo("hoje", null, item.offset_dias);
            const novaTarefa = await criarTarefa({
              caso_id: casoId,
              processo_admin_id: proc.processo_admin_id,
              processo_judicial_id: proc.processo_judicial_id,
              responsavel_id: respFinal,
              tipo: (item.tipo as TarefaTipo) || "interna",
              prioridade: item.prioridade ?? 3,
              titulo: substituirPlaceholders(item.titulo, ph),
              descricao: substituirPlaceholders(item.descricao ?? "", ph) || null,
              due_at: dueAt,
              metadata: {
                template_aplicado: tpl.nome,
                aplicado_via: "agenda_sheet",
                ancora_prazo: ancora,
                // Data do evento que ancorou a tarefa. O acompanhamento de
                // pericia conta os 30/60/90 dias do escalonamento a partir
                // daqui — sem isso o job diario nao teria referencia.
                ...(agendaStart ? { pericia_em: agendaStart.toISOString() } : {}),
                ...(item.meta ?? {}),
              },
            });
            marcarDestaque(novaTarefa.id);
            tarefasExtras++;
          }
        }
        toast.success(
          tarefasExtras === 0
            ? "Evento criado."
            : `Evento criado + ${tarefasExtras} tarefa${tarefasExtras === 1 ? "" : "s"} do template.`,
        );
      }
      onSaved();
      onClose();
    } catch (e) {
      console.error(e);
      const msg = e instanceof Error ? e.message : "Falha ao salvar.";
      toast.error(msg);
    } finally {
      setSalvando(false);
    }
  }

  // Concluir NAO apaga e NAO esconde: grava a data, e o calendario mostra
  // riscado. Consertar o "guiche que ja foi mas nao saiu da agenda" era isso —
  // evento nao tinha como ser dado por realizado.
  async function alternarConclusao() {
    if (!editando || !evento) return;
    const marcando = !evento.concluido_em;
    setConcluindo(true);
    try {
      const { error } = await supabase
        .from("agenda_eventos")
        .update({
          concluido_em: marcando ? new Date().toISOString() : null,
          concluido_por: marcando ? (usuario?.id ?? null) : null,
        })
        .eq("id", evento.id);
      if (error) throw error;
      toast.success(marcando ? "Evento concluído." : "Evento reaberto.");
      onSaved();
      onClose();
    } catch (e) {
      console.error(e);
      toast.error("Falha ao atualizar o evento.");
    } finally {
      setConcluindo(false);
    }
  }

  async function excluir() {
    if (!editando || !evento) return;
    if (!window.confirm("Excluir este evento?")) return;
    setExcluindo(true);
    try {
      await excluirEvento(evento.id);
      toast.success("Evento excluído.");
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
          <SheetTitle>{editando ? "Editar agendamento" : "Agendamentos"}</SheetTitle>
          {editando && evento && (
            <SheetDescription>
              Criado em {formatarBR(evento.created_at, { dateStyle: "short", timeStyle: "short" })}
              {evento.gcal_event_id ? " · sincronizado com Google Calendar" : " · não sincronizado"}
            </SheetDescription>
          )}
        </SheetHeader>

        <div className="space-y-4 py-4">
          <div className="space-y-1.5">
            <Label>Caso</Label>
            <Select
              value={casoId ?? "sem"}
              onValueChange={(v) => {
                setCasoId(v === "sem" ? null : v);
                setProcessoToken("");
              }}
            >
              <SelectTrigger>
                <SelectValue placeholder="Sem caso" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="sem">Sem caso</SelectItem>
                {casos.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.cliente_nome ?? "(sem nome)"}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {casoId && processosDoCaso.length > 0 && (
            <div className="space-y-1.5">
              <Label>Processo (opcional)</Label>
              <Select
                value={processoToken || "sem"}
                onValueChange={(v) => setProcessoToken(v === "sem" ? "" : v)}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Nenhum" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="sem">Sem processo específico</SelectItem>
                  {processosDoCaso.map((p) => (
                    <SelectItem key={`${p.natureza}:${p.id}`} value={`${p.natureza}:${p.id}`}>
                      {p.rotulo}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {!editando && templatesVisiveis.length > 0 && (
            <div className="space-y-1.5 rounded-md border border-dashed p-3 bg-muted/30">
              <Label>Template (atalho)</Label>
              <Select value={templateSelecionado} onValueChange={setTemplateSelecionado}>
                <SelectTrigger>
                  <SelectValue placeholder="Escolha um template" />
                </SelectTrigger>
                <SelectContent>
                  {templatesVisiveis.map((t) => {
                    const tarefasExtras = t.itens.filter((i) => i.destino === "tarefa").length;
                    return (
                      <SelectItem key={t.id} value={t.nome}>
                        {t.rotulo ?? t.nome}{" "}
                        <span className="text-muted-foreground">
                          {tarefasExtras === 0
                            ? "(só evento)"
                            : `(evento + ${tarefasExtras} tarefa${tarefasExtras === 1 ? "" : "s"})`}
                        </span>
                      </SelectItem>
                    );
                  })}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                {templateSelecionado ? (
                  <>
                    Os campos abaixo foram preenchidos pelo template — ajuste data/hora/local e
                    salve. Ao salvar, as tarefas extras serão criadas com prazos relativos a essa
                    data.
                  </>
                ) : (
                  <>
                    Selecionar um template preenche os campos abaixo e cria tarefas auxiliares
                    quando salvar.
                  </>
                )}
              </p>
            </div>
          )}

          {!editando && tipo === "pericia" && !!casoId && (
            <div className="space-y-1.5 rounded-lg border border-dashed p-3 bg-muted/30">
              <Label htmlFor="ag-comprovante">
                Comprovante do agendamento (PDF/foto) ou publicação
              </Label>
              <Input
                id="ag-comprovante"
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
                    <Loader2 className="h-3 w-3 animate-spin" /> Lendo o comprovante…
                  </span>
                ) : comprovanteFile ? (
                  <>
                    <strong>{comprovanteFile.name}</strong> lido — data, local,
                    protocolo e endereço preenchidos. Ao salvar, o arquivo entra
                    nos Documentos do caso seguindo a numeração.
                  </>
                ) : (
                  <>
                    Anexe o comprovante (ou a intimação judicial) e a IA
                    preenche data, local, protocolo e endereço.
                  </>
                )}
              </p>
              <div className="space-y-1.5 border-t border-dashed pt-2">
                <Label
                  htmlFor="ag-publicacao-colada"
                  className="text-xs font-normal text-muted-foreground"
                >
                  …ou cole o texto da publicação/intimação
                </Label>
                <Textarea
                  id="ag-publicacao-colada"
                  rows={3}
                  value={publicacaoColada}
                  onChange={(e) => setPublicacaoColada(e.target.value)}
                  placeholder="Cole aqui a publicação (Legalmail/DJE) que marcou a perícia — a IA preenche os campos do mesmo jeito."
                />
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={extraindoComprovante || !publicacaoColada.trim()}
                  onClick={lerPublicacaoColada}
                >
                  {extraindoComprovante ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : null}
                  Ler publicação
                </Button>
              </div>
              {comprovanteDivergente && (
                <div className="space-y-2 rounded-md border border-red-300 bg-red-50/70 p-3">
                  <p className="text-sm font-medium text-red-900">
                    Comprovante de outra pessoa — nada foi preenchido.
                  </p>
                  <p className="text-xs text-red-900/80">
                    O comprovante é de{" "}
                    <strong>{comprovanteDivergente.requerente}</strong>, mas o
                    caso é de <strong>{ctxCaso?.cliente_nome}</strong>. Anexe o
                    arquivo certo — ou, se tiver certeza de que é a mesma pessoa,
                    confirme abaixo. Enquanto isso, o salvar fica bloqueado.
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        aplicarComprovante(
                          comprovanteDivergente.campos,
                          comprovanteDivergente.file,
                        );
                        setComprovanteDivergente(null);
                        toast.success("Comprovante aceito — confira os campos preenchidos.");
                      }}
                    >
                      Confirmei — é o mesmo cliente
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      onClick={() => setComprovanteDivergente(null)}
                    >
                      Descartar arquivo
                    </Button>
                  </div>
                </div>
              )}
            </div>
          )}

          <div className="space-y-1.5">
            <Label>Tipo</Label>
            <Select value={tipo} onValueChange={(v) => setTipo(v as AgendaTipo)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TIPOS.map((t) => (
                  <SelectItem key={t} value={t}>
                    {TIPO_LABEL[t]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="a-titulo">Título</Label>
            <Input
              id="a-titulo"
              value={titulo}
              onChange={(e) => setTitulo(e.target.value)}
              placeholder={
                tipo === "pericia" ? "Ex: Perícia médica - Maicon Vandson" : "Ex: Audiência inicial"
              }
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="a-start">Início</Label>
              <Input
                id="a-start"
                type="datetime-local"
                value={startInput}
                onChange={(e) => setStartInput(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="a-end">Fim</Label>
              <Input
                id="a-end"
                type="datetime-local"
                value={endInput}
                onChange={(e) => setEndInput(e.target.value)}
              />
            </div>
            <p className="text-xs text-muted-foreground sm:col-span-2">
              Horário de Brasília — é o que vai no aviso ao parceiro e ao cliente, não importa de
              onde você agenda.
            </p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="a-local">Local</Label>
            <Input
              id="a-local"
              value={local}
              onChange={(e) => setLocal(e.target.value)}
              placeholder="Ex: APS Cabreúva ou endereço completo"
            />
          </div>

          <div className="space-y-1.5">
            <Label>Responsável</Label>
            <Select
              value={responsavelId ?? "sem"}
              onValueChange={(v) => setResponsavelId(v === "sem" ? null : v)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
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

          <div className="space-y-1.5">
            <Label htmlFor="a-descricao">Observações</Label>
            <Textarea
              id="a-descricao"
              value={descricao}
              onChange={(e) => setDescricao(e.target.value)}
              placeholder="Detalhes, exigências, instruções pro cliente..."
              rows={4}
            />
          </div>

          {!editando &&
            (tipo === "pericia" || tipo === "audiencia") &&
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
              rotulo={tipo === "audiencia" ? "audiência" : "perícia"}
              ativo={avisoAtivo}
              onAtivoChange={setAvisoAtivo}
              texto={avisoTexto}
              onTextoChange={(v) => {
                setAvisoTexto(v);
                setAvisoEditado(true);
              }}
            />
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
              {excluindo ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Trash2 className="h-4 w-4" />
              )}
              Excluir
            </Button>
          )}
          {editando && (
            <Button
              variant="outline"
              onClick={alternarConclusao}
              disabled={concluindo || salvando || excluindo}
            >
              {concluindo ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Check className="h-4 w-4" />
              )}
              {evento?.concluido_em ? "Reabrir" : "Concluir"}
            </Button>
          )}
          <Button variant="outline" onClick={fechar} disabled={salvando}>
            Cancelar
          </Button>
          <Button onClick={salvar} disabled={salvando}>
            {salvando ? <Loader2 className="h-4 w-4 animate-spin" /> : "Salvar"}
          </Button>
        </SheetFooter>
      </SheetContent>

      {/* Guardas do agendamento: data passada / duplicado no dia. */}
      <AlertDialog
        open={!!avisosAgenda}
        onOpenChange={(o) => {
          if (!o) setAvisosAgenda(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlarmClock className="h-5 w-5 text-destructive" />
              Tem certeza que quer agendar?
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2">
                {(avisosAgenda ?? []).map((a) => (
                  <p key={a}>{a}</p>
                ))}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Voltar e corrigir</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                ignorarAvisosAgenda.current = true;
                setAvisosAgenda(null);
                void salvar();
              }}
            >
              Agendar mesmo assim
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Sheet>
  );
}

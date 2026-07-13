import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  ArrowRight,
  CalendarClock,
  ChevronDown,
  Handshake,
  Loader2,
  MessageCircle,
  PhoneCall,
  RefreshCw,
  ShieldAlert,
  UserPlus,
} from "lucide-react";

import { useAuth } from "@/hooks/use-auth";
import { supabase } from "@/lib/supabase";
import { criarTarefa } from "@/lib/tarefas/queries";
import { ClientOnly } from "@/components/client-only";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";

export const Route = createFileRoute("/_authenticated/comercial")({
  component: ComercialPage,
});

interface Lead {
  id: string;
  criado_em: string;
  atualizado_em: string;
  tipo: "cliente" | "parceiro";
  nome: string;
  whatsapp: string;
  situacao: string | null;
  inss_status: string | null;
  oab: string | null;
  interesse: string | null;
  origem: string;
  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
  etapa: string;
  primeiro_contato_em: string | null;
  consulta_em: string | null;
  agenda_evento_id: string | null;
  cliente_id: string | null;
  analise_responsavel_id: string | null;
  analise_tarefa_id: string | null;
  analise_concluida_em: string | null;
  kit_enviado_em: string | null;
}

interface Comentario {
  id: string;
  texto: string;
  criado_em: string;
  autor_nome: string | null;
}

interface Interno {
  id: string;
  nome: string | null;
  email: string | null;
}

// Esteira do comercial — mesma ordem do check constraint da tabela `leads`.
const ETAPAS_ATIVAS = [
  "novo",
  "triagem",
  "analise",
  "agendar",
  "agendado",
  "fechamento",
  "handoff",
] as const;
const ETAPAS_ENCERRADAS = ["fechado", "sem_direito", "perdido"] as const;

const ETAPA_LABEL: Record<string, string> = {
  novo: "Novo",
  triagem: "Triagem",
  analise: "Análise",
  agendar: "Agendar",
  agendado: "Agendado",
  fechamento: "Fechamento",
  handoff: "Handoff",
  fechado: "Fechado",
  sem_direito: "Sem direito",
  perdido: "Perdido",
};

const ETAPA_COR: Record<string, string> = {
  novo: "bg-sky-100 text-sky-900",
  triagem: "bg-amber-100 text-amber-900",
  analise: "bg-violet-100 text-violet-900",
  agendar: "bg-orange-100 text-orange-900",
  agendado: "bg-cyan-100 text-cyan-900",
  fechamento: "bg-lime-100 text-lime-900",
  handoff: "bg-emerald-100 text-emerald-900",
  fechado: "bg-emerald-100 text-emerald-900",
  sem_direito: "bg-zinc-200 text-zinc-700",
  perdido: "bg-red-100 text-red-900",
};

const SITUACAO_LABEL: Record<string, string> = {
  aposentadoria: "Aposentadoria",
  incapacidade: "Auxílio-doença / incapacidade",
  bpc_loas: "BPC / LOAS",
  pensao_morte: "Pensão por morte",
  salario_maternidade: "Salário-maternidade",
  revisao: "Revisão de benefício",
  planejamento: "Planejamento previdenciário",
  outro: "Outro / não soube dizer",
};

const INSS_LABEL: Record<string, string> = {
  negado: "INSS negou",
  em_analise: "Em análise no INSS",
  nao_pedi: "Ainda não pediu",
  nao_sei: "Não sabe",
};

const INTERESSE_LABEL: Record<string, string> = {
  indicar_caso: "Quer indicar caso",
  conhecer_parceria: "Quer conhecer a parceria",
  testar_demo: "Quer testar a demo",
};

function soDigitos(s: string) {
  return s.replace(/\D/g, "");
}

function linkWhatsApp(lead: Lead) {
  let d = soDigitos(lead.whatsapp);
  if (d.length <= 11) d = `55${d}`;
  const primeiroNome = lead.nome.trim().split(/\s+/)[0];
  const msg = `Olá, ${primeiroNome}! Aqui é do escritório Mara Sandra Vian Advocacia. Recebemos seu contato pelo site e queremos entender melhor o seu caso.`;
  return `https://wa.me/${d}?text=${encodeURIComponent(msg)}`;
}

function tempoDesde(iso: string) {
  const ms = Date.now() - new Date(iso).getTime();
  const min = Math.floor(ms / 60000);
  if (min < 1) return "agora";
  if (min < 60) return `há ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `há ${h} h`;
  const d = Math.floor(h / 24);
  if (d < 30) return `há ${d} d`;
  return new Date(iso).toLocaleDateString("pt-BR");
}

function dataHora(iso: string) {
  return new Date(iso).toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function resumoLead(lead: Lead) {
  return lead.tipo === "cliente"
    ? (lead.situacao ? SITUACAO_LABEL[lead.situacao] ?? lead.situacao : "Cliente")
    : (lead.interesse ? INTERESSE_LABEL[lead.interesse] ?? lead.interesse : "Parceiro");
}

function ComercialPage() {
  const { usuario } = useAuth();
  const isInterno = usuario?.tipo === "interno";

  const [leads, setLeads] = useState<Array<Lead>>([]);
  const [internos, setInternos] = useState<Array<Interno>>([]);
  const [carregando, setCarregando] = useState(true);
  const [aberto, setAberto] = useState<Lead | null>(null);
  const [comentarios, setComentarios] = useState<Array<Comentario>>([]);
  const [carregandoComentarios, setCarregandoComentarios] = useState(false);
  const [novoComentario, setNovoComentario] = useState("");
  const [enviandoComentario, setEnviandoComentario] = useState(false);
  const [filtroEtapaMobile, setFiltroEtapaMobile] = useState<string>("__todas__");
  const [agendando, setAgendando] = useState<Lead | null>(null);
  const [convertendo, setConvertendo] = useState<Lead | null>(null);
  const [analisando, setAnalisando] = useState<Lead | null>(null);

  const carregar = useCallback(async () => {
    setCarregando(true);
    const { data, error } = await supabase
      .from("leads")
      .select(
        "id, criado_em, atualizado_em, tipo, nome, whatsapp, situacao, inss_status, oab, interesse, origem, utm_source, utm_medium, utm_campaign, etapa, primeiro_contato_em, consulta_em, agenda_evento_id, cliente_id, analise_responsavel_id, analise_tarefa_id, analise_concluida_em, kit_enviado_em",
      )
      .order("criado_em", { ascending: false });
    if (error) {
      toast.error("Falha ao carregar leads.");
    } else {
      setLeads((data as unknown as Array<Lead>) ?? []);
    }
    setCarregando(false);
  }, []);

  useEffect(() => {
    if (!isInterno) return;
    carregar();
    supabase
      .from("usuarios")
      .select("id, nome, email")
      .eq("tipo", "interno")
      .eq("ativo", true)
      .order("nome")
      .then(({ data }) => setInternos((data as unknown as Array<Interno>) ?? []));
  }, [isInterno, carregar]);

  const porEtapa = useMemo(() => {
    const m = new Map<string, Array<Lead>>();
    for (const l of leads) {
      const arr = m.get(l.etapa) ?? [];
      arr.push(l);
      m.set(l.etapa, arr);
    }
    return m;
  }, [leads]);

  const encerrados = useMemo(
    () => leads.filter((l) => (ETAPAS_ENCERRADAS as readonly string[]).includes(l.etapa)),
    [leads],
  );

  const internosPorId = useMemo(() => {
    const m = new Map<string, string>();
    for (const i of internos) m.set(i.id, i.nome || i.email || i.id);
    return m;
  }, [internos]);

  /** Atualiza o lead no banco e espelha no estado local (lista + painel aberto). */
  const aplicarPatch = useCallback(
    async (leadId: string, patch: Partial<Lead> & Record<string, unknown>) => {
      const { error } = await supabase
        .from("leads")
        .update({ ...patch, atualizado_em: new Date().toISOString() })
        .eq("id", leadId);
      if (error) return false;
      setLeads((prev) => prev.map((l) => (l.id === leadId ? { ...l, ...patch } : l)));
      setAberto((a) => (a && a.id === leadId ? { ...a, ...patch } : a));
      return true;
    },
    [],
  );

  async function moverEtapa(lead: Lead, etapa: string) {
    if (etapa === lead.etapa) return;
    // Agendar consulta pede data/hora — o dialog completa o movimento.
    if (etapa === "agendado") {
      setAgendando(lead);
      return;
    }
    // Análise pede a advogada responsável — o dialog completa o movimento.
    if (etapa === "analise") {
      setAnalisando(lead);
      return;
    }
    const patch: Partial<Lead> = { etapa };
    if (lead.etapa === "novo" && !lead.primeiro_contato_em) {
      patch.primeiro_contato_em = new Date().toISOString();
    }
    const ok = await aplicarPatch(lead.id, patch);
    if (!ok) {
      toast.error("Não consegui mover o lead.");
      return;
    }
    toast.success(`Lead movido pra ${ETAPA_LABEL[etapa]}.`);

    // Automação: chegar em "agendar" cria a tarefa de agendamento pro usuário.
    if (etapa === "agendar" && usuario?.id) {
      try {
        const amanha = new Date();
        amanha.setDate(amanha.getDate() + 1);
        amanha.setHours(12, 0, 0, 0);
        await criarTarefa({
          caso_id: null,
          responsavel_id: usuario.id,
          tipo: "interna",
          prioridade: 2,
          titulo: `Agendar consulta com ${lead.nome}`,
          descricao: `Lead do comercial (${resumoLead(lead)}). WhatsApp: ${lead.whatsapp}.`,
          due_at: amanha.toISOString(),
          metadata: { lead_id: lead.id },
        });
        toast.success("Tarefa de agendamento criada.");
      } catch {
        toast.error("Lead movido, mas não consegui criar a tarefa.");
      }
    }
  }

  async function registrarPrimeiroContato(lead: Lead, silencioso = false) {
    if (lead.primeiro_contato_em) return;
    const ok = await aplicarPatch(lead.id, { primeiro_contato_em: new Date().toISOString() });
    if (!ok && !silencioso) toast.error("Não consegui registrar o contato.");
    if (ok && !silencioso) toast.success("Primeiro contato registrado.");
  }

  async function carregarComentarios(leadId: string) {
    setCarregandoComentarios(true);
    const { data, error } = await supabase
      .from("lead_comentarios")
      .select("id, texto, criado_em, usuarios(nome)")
      .eq("lead_id", leadId)
      .order("criado_em", { ascending: true });
    if (error) {
      toast.error("Falha ao carregar o histórico.");
      setComentarios([]);
    } else {
      setComentarios(
        ((data ?? []) as Array<Record<string, unknown>>).map((c) => ({
          id: c.id as string,
          texto: c.texto as string,
          criado_em: c.criado_em as string,
          autor_nome: (c.usuarios as { nome?: string } | null)?.nome ?? null,
        })),
      );
    }
    setCarregandoComentarios(false);
  }

  async function comentar() {
    if (!aberto || !novoComentario.trim() || !usuario?.id) return;
    setEnviandoComentario(true);
    const { data, error } = await supabase
      .from("lead_comentarios")
      .insert({ lead_id: aberto.id, autor_id: usuario.id, texto: novoComentario.trim() })
      .select("id, texto, criado_em")
      .single();
    setEnviandoComentario(false);
    if (error) {
      toast.error("Não consegui comentar.");
      return;
    }
    const c = data as { id: string; texto: string; criado_em: string };
    setComentarios((prev) => [
      ...prev,
      { ...c, autor_nome: usuario.nome ?? usuario.email ?? "Você" },
    ]);
    setNovoComentario("");
  }

  function abrirLead(lead: Lead) {
    setAberto(lead);
    setComentarios([]);
    setNovoComentario("");
    carregarComentarios(lead.id);
  }

  async function marcarKitEnviado(lead: Lead) {
    const agora = new Date().toISOString();
    const ok = await aplicarPatch(lead.id, { kit_enviado_em: agora });
    if (!ok) {
      toast.error("Não consegui marcar o kit.");
      return;
    }
    if (usuario?.id) {
      await supabase.from("lead_comentarios").insert({
        lead_id: lead.id,
        autor_id: usuario.id,
        texto: "Kit previdenciário enviado pro cliente assinar.",
      });
      carregarComentarios(lead.id);
    }
    toast.success("Kit marcado como enviado — assinou, é só fazer o handoff.");
  }

  if (!isInterno) {
    return (
      <div className="flex h-64 flex-col items-center justify-center gap-2 text-center">
        <ShieldAlert className="h-8 w-8 text-muted-foreground" />
        <p className="text-sm text-muted-foreground">Área restrita a usuários internos.</p>
      </div>
    );
  }

  return (
    <ClientOnly
      fallback={
        <div className="flex h-64 items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      }
    >
      <div className="space-y-4 p-4 md:p-6">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h1 className="flex items-center gap-2 text-xl font-semibold">
              <Handshake className="h-5 w-5" /> Comercial
            </h1>
            <p className="text-sm text-muted-foreground">
              Leads do site — da chegada ao fechamento.
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={carregar} disabled={carregando}>
            {carregando ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4" />
            )}
            <span className="ml-1.5">Atualizar</span>
          </Button>
        </div>

        <Tabs defaultValue="esteira">
          <TabsList>
            <TabsTrigger value="esteira">Esteira</TabsTrigger>
            <TabsTrigger value="encerrados">Encerrados ({encerrados.length})</TabsTrigger>
          </TabsList>

          <TabsContent value="esteira" className="mt-4">
            {carregando && leads.length === 0 ? (
              <div className="flex h-40 items-center justify-center">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : (
              <>
                {/* Kanban (desktop) — rola pro lado; header fixo indica onde estamos */}
                <div className="hidden md:block">
                  <p className="mb-2 text-xs text-muted-foreground">
                    {ETAPAS_ATIVAS.map((e) => `${ETAPA_LABEL[e]} ${(porEtapa.get(e) ?? []).length}`).join(" · ")}
                    <span className="ml-2 opacity-70">— role pro lado pra ver todas as etapas →</span>
                  </p>
                  <div
                    className="flex gap-3 overflow-x-auto pb-3"
                    style={{ scrollbarWidth: "thin" }}
                  >
                    {ETAPAS_ATIVAS.map((etapa) => {
                      const col = porEtapa.get(etapa) ?? [];
                      return (
                        <div key={etapa} className="w-56 shrink-0">
                          <div
                            className={`mb-2 flex items-center justify-between rounded-md px-3 py-1.5 ${col.length > 0 ? ETAPA_COR[etapa] : "bg-muted"}`}
                          >
                            <span className="text-xs font-semibold uppercase tracking-wide">
                              {ETAPA_LABEL[etapa]}
                            </span>
                            <span className="text-xs opacity-70">{col.length}</span>
                          </div>
                          <div className="space-y-2">
                            {col.map((lead) => (
                              <LeadCard
                                key={lead.id}
                                lead={lead}
                                analistaNome={
                                  lead.analise_responsavel_id
                                    ? internosPorId.get(lead.analise_responsavel_id) ?? null
                                    : null
                                }
                                onAbrir={() => abrirLead(lead)}
                                onMover={(e) => moverEtapa(lead, e)}
                                onWhats={() => registrarPrimeiroContato(lead, true)}
                              />
                            ))}
                            {col.length === 0 && (
                              <p className="px-2 py-4 text-center text-xs text-muted-foreground">
                                Vazio
                              </p>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Lista (mobile) */}
                <div className="space-y-3 md:hidden">
                  <Select value={filtroEtapaMobile} onValueChange={setFiltroEtapaMobile}>
                    <SelectTrigger className="h-9">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__todas__">Todas as etapas</SelectItem>
                      {ETAPAS_ATIVAS.map((e) => (
                        <SelectItem key={e} value={e}>
                          {ETAPA_LABEL[e]} ({(porEtapa.get(e) ?? []).length})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {ETAPAS_ATIVAS.filter(
                    (e) => filtroEtapaMobile === "__todas__" || e === filtroEtapaMobile,
                  ).flatMap((e) => porEtapa.get(e) ?? []).map((lead) => (
                    <LeadCard
                      key={lead.id}
                      lead={lead}
                      mostrarEtapa
                      analistaNome={
                        lead.analise_responsavel_id
                          ? internosPorId.get(lead.analise_responsavel_id) ?? null
                          : null
                      }
                      onAbrir={() => abrirLead(lead)}
                      onMover={(e) => moverEtapa(lead, e)}
                      onWhats={() => registrarPrimeiroContato(lead, true)}
                    />
                  ))}
                  {leads.filter((l) =>
                    (ETAPAS_ATIVAS as readonly string[]).includes(l.etapa),
                  ).length === 0 && (
                    <p className="py-8 text-center text-sm text-muted-foreground">
                      Nenhum lead na esteira ainda.
                    </p>
                  )}
                </div>
              </>
            )}
          </TabsContent>

          <TabsContent value="encerrados" className="mt-4">
            {encerrados.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">
                Nenhum lead encerrado.
              </p>
            ) : (
              <div className="grid gap-2 md:grid-cols-2 lg:grid-cols-3">
                {encerrados.map((lead) => (
                  <LeadCard
                    key={lead.id}
                    lead={lead}
                    mostrarEtapa
                    analistaNome={
                      lead.analise_responsavel_id
                        ? internosPorId.get(lead.analise_responsavel_id) ?? null
                        : null
                    }
                    onAbrir={() => abrirLead(lead)}
                    onMover={(e) => moverEtapa(lead, e)}
                    onWhats={() => registrarPrimeiroContato(lead, true)}
                  />
                ))}
              </div>
            )}
          </TabsContent>
        </Tabs>
      </div>

      {/* Detalhe do lead */}
      <Sheet open={!!aberto} onOpenChange={(o) => !o && setAberto(null)}>
        <SheetContent className="w-full overflow-y-auto sm:max-w-md">
          {aberto && (
            <>
              <SheetHeader>
                <SheetTitle className="flex items-center gap-2">
                  {aberto.nome}
                  <Badge variant="outline" className="capitalize">
                    {aberto.tipo}
                  </Badge>
                </SheetTitle>
                <SheetDescription>
                  Chegou {tempoDesde(aberto.criado_em)} · {dataHora(aberto.criado_em)}
                </SheetDescription>
              </SheetHeader>

              <div className="mt-4 space-y-4">
                <div className="space-y-1 text-sm">
                  {aberto.tipo === "cliente" ? (
                    <>
                      {aberto.situacao && (
                        <p>
                          <span className="text-muted-foreground">Situação:</span>{" "}
                          {SITUACAO_LABEL[aberto.situacao] ?? aberto.situacao}
                        </p>
                      )}
                      {aberto.inss_status && (
                        <p>
                          <span className="text-muted-foreground">INSS:</span>{" "}
                          {INSS_LABEL[aberto.inss_status] ?? aberto.inss_status}
                        </p>
                      )}
                    </>
                  ) : (
                    <>
                      {aberto.interesse && (
                        <p>
                          <span className="text-muted-foreground">Interesse:</span>{" "}
                          {INTERESSE_LABEL[aberto.interesse] ?? aberto.interesse}
                        </p>
                      )}
                      {aberto.oab && (
                        <p>
                          <span className="text-muted-foreground">OAB:</span> {aberto.oab}
                        </p>
                      )}
                    </>
                  )}
                  <p>
                    <span className="text-muted-foreground">WhatsApp:</span> {aberto.whatsapp}
                  </p>
                  <p>
                    <span className="text-muted-foreground">Origem:</span> {aberto.origem}
                    {aberto.utm_source && ` · ${aberto.utm_source}`}
                    {aberto.utm_campaign && ` / ${aberto.utm_campaign}`}
                  </p>
                  <p>
                    <span className="text-muted-foreground">1º contato:</span>{" "}
                    {aberto.primeiro_contato_em
                      ? dataHora(aberto.primeiro_contato_em)
                      : "ainda não feito"}
                  </p>
                  {aberto.consulta_em && (
                    <p>
                      <span className="text-muted-foreground">Consulta:</span>{" "}
                      {dataHora(aberto.consulta_em)}
                    </p>
                  )}
                  {aberto.analise_responsavel_id && (
                    <p>
                      <span className="text-muted-foreground">Análise:</span>{" "}
                      {internosPorId.get(aberto.analise_responsavel_id) ?? "—"}
                      {aberto.analise_concluida_em ? (
                        <span className="text-emerald-700">
                          {" "}
                          · concluída {tempoDesde(aberto.analise_concluida_em)}
                        </span>
                      ) : (
                        <span className="text-amber-700"> · aguardando</span>
                      )}
                    </p>
                  )}
                  {aberto.kit_enviado_em && (
                    <p>
                      <span className="text-muted-foreground">Kit previdenciário:</span>{" "}
                      enviado {tempoDesde(aberto.kit_enviado_em)}
                    </p>
                  )}
                  {aberto.cliente_id && (
                    <p className="text-emerald-700">✓ Já convertido em cliente</p>
                  )}
                </div>

                {/* Próximo passo do fluxo, quando há um óbvio */}
                {aberto.etapa === "analise" && aberto.analise_concluida_em && (
                  <div className="rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm">
                    <p className="font-medium text-emerald-900">
                      Análise concluída — decidir continuidade
                    </p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      <Button size="sm" onClick={() => moverEtapa(aberto, "fechamento")}>
                        Dar continuidade (fechamento)
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => moverEtapa(aberto, "sem_direito")}
                      >
                        Sem direito
                      </Button>
                    </div>
                  </div>
                )}
                {aberto.etapa === "fechamento" && !aberto.kit_enviado_em && (
                  <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm">
                    <p className="font-medium text-amber-900">
                      Enviar o kit previdenciário pro cliente assinar
                    </p>
                    <div className="mt-2">
                      <Button size="sm" onClick={() => marcarKitEnviado(aberto)}>
                        Marcar kit como enviado
                      </Button>
                    </div>
                  </div>
                )}

                <div className="flex flex-wrap gap-2">
                  <Button asChild size="sm" className="bg-[#25D366] text-white hover:bg-[#1fb959]">
                    <a
                      href={linkWhatsApp(aberto)}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={() => registrarPrimeiroContato(aberto, true)}
                    >
                      <MessageCircle className="h-4 w-4" />
                      <span className="ml-1.5">Chamar no WhatsApp</span>
                    </a>
                  </Button>
                  {!aberto.primeiro_contato_em && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => registrarPrimeiroContato(aberto)}
                    >
                      <PhoneCall className="h-4 w-4" />
                      <span className="ml-1.5">Registrar 1º contato</span>
                    </Button>
                  )}
                  <Button size="sm" variant="outline" onClick={() => setAgendando(aberto)}>
                    <CalendarClock className="h-4 w-4" />
                    <span className="ml-1.5">
                      {aberto.consulta_em ? "Reagendar consulta" : "Agendar consulta"}
                    </span>
                  </Button>
                  {!aberto.cliente_id && (
                    <Button size="sm" variant="outline" onClick={() => setConvertendo(aberto)}>
                      <UserPlus className="h-4 w-4" />
                      <span className="ml-1.5">Converter em cliente</span>
                    </Button>
                  )}
                </div>

                <div className="space-y-1.5">
                  <p className="text-sm font-medium">Etapa</p>
                  <Select value={aberto.etapa} onValueChange={(e) => moverEtapa(aberto, e)}>
                    <SelectTrigger className="h-9">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {[...ETAPAS_ATIVAS, ...ETAPAS_ENCERRADAS].map((e) => (
                        <SelectItem key={e} value={e}>
                          {ETAPA_LABEL[e]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <p className="text-sm font-medium">
                    Histórico da negociação
                    {comentarios.length > 0 && (
                      <span className="ml-1 text-xs font-normal text-muted-foreground">
                        ({comentarios.length})
                      </span>
                    )}
                  </p>
                  {carregandoComentarios ? (
                    <div className="flex justify-center py-3">
                      <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                    </div>
                  ) : comentarios.length === 0 ? (
                    <p className="text-xs text-muted-foreground">
                      Nenhum comentário ainda — registre aqui os contatos e combinados; isso
                      vira o histórico que acompanha o lead até o handoff.
                    </p>
                  ) : (
                    <div className="max-h-64 space-y-2 overflow-y-auto pr-1">
                      {comentarios.map((c) => (
                        <div key={c.id} className="rounded-md bg-muted/60 px-3 py-2">
                          <p className="text-xs text-muted-foreground">
                            <span className="font-medium text-foreground">
                              {c.autor_nome ?? "Nota antiga"}
                            </span>{" "}
                            · {tempoDesde(c.criado_em)} · {dataHora(c.criado_em)}
                          </p>
                          <p className="mt-0.5 whitespace-pre-wrap text-sm">{c.texto}</p>
                        </div>
                      ))}
                    </div>
                  )}
                  <Textarea
                    value={novoComentario}
                    onChange={(e) => setNovoComentario(e.target.value)}
                    placeholder="Comentar: contato feito, combinados, próximos passos…"
                    rows={3}
                  />
                  <Button
                    size="sm"
                    onClick={comentar}
                    disabled={enviandoComentario || !novoComentario.trim()}
                  >
                    {enviandoComentario && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
                    Comentar
                  </Button>
                </div>
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>

      <AgendarConsultaDialog
        lead={agendando}
        internos={internos}
        usuarioId={usuario?.id ?? null}
        onFechar={() => setAgendando(null)}
        onAgendado={(patch) => {
          if (agendando) {
            setLeads((prev) =>
              prev.map((l) => (l.id === agendando.id ? { ...l, ...patch } : l)),
            );
            setAberto((a) => (a && a.id === agendando.id ? { ...a, ...patch } : a));
          }
          setAgendando(null);
        }}
      />

      <EnviarAnaliseDialog
        lead={analisando}
        internos={internos}
        onFechar={() => setAnalisando(null)}
        onEnviado={(patch) => {
          if (analisando) {
            setLeads((prev) =>
              prev.map((l) => (l.id === analisando.id ? { ...l, ...patch } : l)),
            );
            setAberto((a) => (a && a.id === analisando.id ? { ...a, ...patch } : a));
          }
          setAnalisando(null);
        }}
      />

      <ConverterClienteDialog
        lead={convertendo}
        onFechar={() => setConvertendo(null)}
        onConvertido={(patch) => {
          if (convertendo) {
            setLeads((prev) =>
              prev.map((l) => (l.id === convertendo.id ? { ...l, ...patch } : l)),
            );
            setAberto((a) => (a && a.id === convertendo.id ? { ...a, ...patch } : a));
          }
          setConvertendo(null);
        }}
      />
    </ClientOnly>
  );
}

/** Dialog de agendamento: cria evento restrito na agenda e move o lead pra "agendado". */
function AgendarConsultaDialog({
  lead,
  internos,
  usuarioId,
  onFechar,
  onAgendado,
}: {
  lead: Lead | null;
  internos: Array<Interno>;
  usuarioId: string | null;
  onFechar: () => void;
  onAgendado: (patch: Partial<Lead>) => void;
}) {
  const [data, setData] = useState("");
  const [hora, setHora] = useState("10:00");
  const [duracao, setDuracao] = useState("60");
  const [convidado, setConvidado] = useState("__ninguem__");
  const [salvando, setSalvando] = useState(false);

  useEffect(() => {
    if (lead) {
      const base = lead.consulta_em ? new Date(lead.consulta_em) : null;
      setData(base ? base.toISOString().slice(0, 10) : "");
      setHora(
        base
          ? `${String(base.getHours()).padStart(2, "0")}:${String(base.getMinutes()).padStart(2, "0")}`
          : "10:00",
      );
      setConvidado("__ninguem__");
    }
  }, [lead]);

  async function agendar() {
    if (!lead || !usuarioId) return;
    if (!data || !hora) {
      toast.error("Escolha a data e a hora da consulta.");
      return;
    }
    setSalvando(true);
    try {
      const inicio = new Date(`${data}T${hora}:00`);
      const fim = new Date(inicio.getTime() + Number(duracao) * 60000);
      const restrito = [usuarioId, ...(convidado !== "__ninguem__" ? [convidado] : [])];

      // Reagendamento reaproveita o evento existente; senão cria um restrito.
      let eventoId = lead.agenda_evento_id;
      if (eventoId) {
        const { error } = await supabase
          .from("agenda_eventos")
          .update({
            start_at: inicio.toISOString(),
            end_at: fim.toISOString(),
            restrito_a: restrito,
          })
          .eq("id", eventoId);
        if (error) throw error;
      } else {
        const { data: ev, error } = await supabase
          .from("agenda_eventos")
          .insert({
            caso_id: null,
            responsavel_id: usuarioId,
            tipo: "reuniao",
            titulo: `Consulta comercial — ${lead.nome}`,
            descricao: `Lead do site (${resumoLead(lead)}). WhatsApp: ${lead.whatsapp}.`,
            start_at: inicio.toISOString(),
            end_at: fim.toISOString(),
            local: null,
            restrito_a: restrito,
          })
          .select("id")
          .single();
        if (error) throw error;
        eventoId = (ev as { id: string }).id;
      }

      const patch: Partial<Lead> = {
        etapa: "agendado",
        consulta_em: inicio.toISOString(),
        agenda_evento_id: eventoId,
      };
      if (lead.etapa === "novo" && !lead.primeiro_contato_em) {
        patch.primeiro_contato_em = new Date().toISOString();
      }
      const { error: leadErr } = await supabase
        .from("leads")
        .update({ ...patch, atualizado_em: new Date().toISOString() })
        .eq("id", lead.id);
      if (leadErr) throw leadErr;

      toast.success(
        `Consulta agendada pra ${dataHora(inicio.toISOString())} — visível só pra você${convidado !== "__ninguem__" ? " e o convidado" : ""}.`,
      );
      onAgendado(patch);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Falha ao agendar.";
      toast.error(msg);
    } finally {
      setSalvando(false);
    }
  }

  return (
    <Dialog open={!!lead} onOpenChange={(o) => !o && onFechar()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Agendar consulta — {lead?.nome}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <Label htmlFor="consulta-data">Data</Label>
              <Input
                id="consulta-data"
                type="date"
                value={data}
                onChange={(e) => setData(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="consulta-hora">Hora</Label>
              <Input
                id="consulta-hora"
                type="time"
                value={hora}
                onChange={(e) => setHora(e.target.value)}
              />
            </div>
          </div>
          <div className="space-y-1">
            <Label>Duração</Label>
            <Select value={duracao} onValueChange={setDuracao}>
              <SelectTrigger className="h-9">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="30">30 min</SelectItem>
                <SelectItem value="60">1 hora</SelectItem>
                <SelectItem value="90">1h30</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label>Convidar da equipe (opcional)</Label>
            <Select value={convidado} onValueChange={setConvidado}>
              <SelectTrigger className="h-9">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__ninguem__">Só eu vejo</SelectItem>
                {internos
                  .filter((i) => i.id !== usuarioId)
                  .map((i) => (
                    <SelectItem key={i.id} value={i.id}>
                      {i.nome || i.email || i.id}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              O evento fica visível na Agenda só pra você e quem você convidar.
            </p>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onFechar} disabled={salvando}>
            Cancelar
          </Button>
          <Button onClick={agendar} disabled={salvando}>
            {salvando && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
            Agendar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Dialog da análise: escolhe a advogada, cria a tarefa dela e move o lead. */
function EnviarAnaliseDialog({
  lead,
  internos,
  onFechar,
  onEnviado,
}: {
  lead: Lead | null;
  internos: Array<Interno>;
  onFechar: () => void;
  onEnviado: (patch: Partial<Lead>) => void;
}) {
  const [responsavel, setResponsavel] = useState("");
  const [salvando, setSalvando] = useState(false);

  useEffect(() => {
    if (lead) setResponsavel(lead.analise_responsavel_id ?? "");
  }, [lead]);

  async function enviar() {
    if (!lead) return;
    if (!responsavel) {
      toast.error("Escolha quem vai fazer a análise.");
      return;
    }
    setSalvando(true);
    try {
      const prazo = new Date();
      prazo.setDate(prazo.getDate() + 2);
      prazo.setHours(18, 0, 0, 0);
      const tarefa = await criarTarefa({
        caso_id: null,
        responsavel_id: responsavel,
        tipo: "interna",
        prioridade: 2,
        titulo: `Analisar lead do comercial — ${lead.nome}`,
        descricao: `${resumoLead(lead)}. WhatsApp: ${lead.whatsapp}. Ao concluir esta tarefa, o lead volta pro comercial decidir a continuidade.`,
        due_at: prazo.toISOString(),
        metadata: { lead_id: lead.id },
      });

      const patch: Partial<Lead> = {
        etapa: "analise",
        analise_responsavel_id: responsavel,
        analise_tarefa_id: tarefa.id,
        analise_concluida_em: null,
      };
      if (lead.etapa === "novo" && !lead.primeiro_contato_em) {
        patch.primeiro_contato_em = new Date().toISOString();
      }
      const { error } = await supabase
        .from("leads")
        .update({ ...patch, atualizado_em: new Date().toISOString() })
        .eq("id", lead.id);
      if (error) throw error;

      const nomeResp = internos.find((i) => i.id === responsavel);
      toast.success(
        `Enviado pra análise de ${nomeResp?.nome ?? "advogada(o)"} — tarefa criada com prazo em 2 dias.`,
      );
      onEnviado(patch);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Falha ao enviar pra análise.";
      toast.error(msg);
    } finally {
      setSalvando(false);
    }
  }

  return (
    <Dialog open={!!lead} onOpenChange={(o) => !o && onFechar()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Enviar pra análise — {lead?.nome}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1">
            <Label>Quem vai analisar?</Label>
            <Select value={responsavel} onValueChange={setResponsavel}>
              <SelectTrigger className="h-9">
                <SelectValue placeholder="Escolha da equipe…" />
              </SelectTrigger>
              <SelectContent>
                {internos.map((i) => (
                  <SelectItem key={i.id} value={i.id}>
                    {i.nome || i.email || i.id}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              A pessoa recebe uma tarefa "Analisar lead do comercial" com prazo de 2 dias.
              Quando ela concluir a tarefa, o lead volta pro comercial automaticamente com o
              aviso "análise concluída".
            </p>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onFechar} disabled={salvando}>
            Cancelar
          </Button>
          <Button onClick={enviar} disabled={salvando}>
            {salvando && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
            Enviar pra análise
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Dialog do handoff: cria o cliente a partir do lead (CPF é obrigatório no banco). */
function ConverterClienteDialog({
  lead,
  onFechar,
  onConvertido,
}: {
  lead: Lead | null;
  onFechar: () => void;
  onConvertido: (patch: Partial<Lead>) => void;
}) {
  const [cpf, setCpf] = useState("");
  const [telefone, setTelefone] = useState("");
  const [salvando, setSalvando] = useState(false);

  useEffect(() => {
    if (lead) {
      setCpf("");
      setTelefone(soDigitos(lead.whatsapp));
    }
  }, [lead]);

  async function converter() {
    if (!lead) return;
    const cpfDigitos = soDigitos(cpf);
    if (cpfDigitos.length !== 11) {
      toast.error("CPF precisa ter 11 dígitos.");
      return;
    }
    setSalvando(true);
    try {
      let clienteId: string;
      const { data: novo, error } = await supabase
        .from("clientes")
        .insert({
          nome: lead.nome,
          cpf: cpfDigitos,
          telefone: telefone || null,
          observacoes: `Origem: lead do site (${lead.origem}) em ${new Date(lead.criado_em).toLocaleDateString("pt-BR")}.`,
        })
        .select("id")
        .single();
      if (error) {
        // CPF já cadastrado: vincula ao cliente existente em vez de falhar.
        if (error.code === "23505") {
          const { data: existente } = await supabase
            .from("clientes")
            .select("id, nome")
            .eq("cpf", cpfDigitos)
            .maybeSingle();
          if (!existente) throw error;
          clienteId = (existente as { id: string }).id;
          toast.info(`CPF já cadastrado — lead vinculado ao cliente existente.`);
        } else {
          throw error;
        }
      } else {
        clienteId = (novo as { id: string }).id;
        toast.success("Cliente criado a partir do lead.");
      }

      const patch: Partial<Lead> = { cliente_id: clienteId, etapa: "fechado" };
      const { error: leadErr } = await supabase
        .from("leads")
        .update({ ...patch, atualizado_em: new Date().toISOString() })
        .eq("id", lead.id);
      if (leadErr) throw leadErr;
      onConvertido(patch);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Falha ao converter.";
      toast.error(msg);
    } finally {
      setSalvando(false);
    }
  }

  return (
    <Dialog open={!!lead} onOpenChange={(o) => !o && onFechar()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Converter em cliente — {lead?.nome}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1">
            <Label htmlFor="conv-cpf">CPF (obrigatório)</Label>
            <Input
              id="conv-cpf"
              inputMode="numeric"
              placeholder="Só números"
              value={cpf}
              onChange={(e) => setCpf(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="conv-tel">Telefone</Label>
            <Input
              id="conv-tel"
              inputMode="numeric"
              value={telefone}
              onChange={(e) => setTelefone(e.target.value)}
            />
          </div>
          <p className="text-xs text-muted-foreground">
            Cria o cliente no sistema com os dados do lead e marca o lead como fechado. O caso
            você abre depois na tela do cliente, como de costume.
          </p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onFechar} disabled={salvando}>
            Cancelar
          </Button>
          <Button onClick={converter} disabled={salvando}>
            {salvando && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
            Converter
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function LeadCard({
  lead,
  mostrarEtapa = false,
  analistaNome = null,
  onAbrir,
  onMover,
  onWhats,
}: {
  lead: Lead;
  mostrarEtapa?: boolean;
  analistaNome?: string | null;
  onAbrir: () => void;
  onMover: (etapa: string) => void;
  onWhats: () => void;
}) {
  const idx = (ETAPAS_ATIVAS as readonly string[]).indexOf(lead.etapa);
  const proxima = idx >= 0 && idx < ETAPAS_ATIVAS.length - 1 ? ETAPAS_ATIVAS[idx + 1] : null;

  return (
    <Card className="cursor-pointer transition-colors hover:bg-muted/50" onClick={onAbrir}>
      <CardContent className="space-y-2 p-3">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="truncate text-sm font-medium">{lead.nome}</p>
            <p className="truncate text-xs text-muted-foreground">{resumoLead(lead)}</p>
          </div>
          <Badge
            variant="secondary"
            className={`shrink-0 capitalize ${lead.tipo === "parceiro" ? "bg-indigo-100 text-indigo-900" : ""}`}
          >
            {lead.tipo}
          </Badge>
        </div>
        {lead.etapa === "agendado" && lead.consulta_em && (
          <p className="flex items-center gap-1 text-xs text-cyan-800">
            <CalendarClock className="h-3.5 w-3.5" /> {dataHora(lead.consulta_em)}
          </p>
        )}
        {lead.etapa === "analise" && (
          <p className="truncate text-xs">
            {lead.analise_concluida_em ? (
              <span className="text-emerald-700">✓ Análise concluída{analistaNome ? ` — ${analistaNome}` : ""}</span>
            ) : (
              <span className="text-amber-700">com {analistaNome ?? "…"}</span>
            )}
          </p>
        )}
        {lead.etapa === "fechamento" && (
          <p className="truncate text-xs">
            {lead.kit_enviado_em ? (
              <span className="text-emerald-700">✓ Kit enviado — aguardando assinatura</span>
            ) : (
              <span className="text-amber-700">enviar kit previdenciário</span>
            )}
          </p>
        )}
        <div className="flex items-center justify-between gap-1">
          <span className="text-xs text-muted-foreground">{tempoDesde(lead.criado_em)}</span>
          {mostrarEtapa && (
            <Badge variant="secondary" className={ETAPA_COR[lead.etapa] ?? ""}>
              {ETAPA_LABEL[lead.etapa] ?? lead.etapa}
            </Badge>
          )}
          <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
            <Button asChild size="icon" variant="ghost" className="h-7 w-7" title="WhatsApp">
              <a
                href={linkWhatsApp(lead)}
                target="_blank"
                rel="noopener noreferrer"
                onClick={onWhats}
              >
                <MessageCircle className="h-4 w-4 text-[#25D366]" />
              </a>
            </Button>
            {proxima && (
              <Button
                size="icon"
                variant="ghost"
                className="h-7 w-7"
                title={`Avançar pra ${ETAPA_LABEL[proxima]}`}
                onClick={() => onMover(proxima)}
              >
                <ArrowRight className="h-4 w-4" />
              </Button>
            )}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="icon" variant="ghost" className="h-7 w-7" title="Mover pra etapa">
                  <ChevronDown className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuLabel>Mover pra…</DropdownMenuLabel>
                {ETAPAS_ATIVAS.filter((e) => e !== lead.etapa).map((e) => (
                  <DropdownMenuItem key={e} onClick={() => onMover(e)}>
                    {ETAPA_LABEL[e]}
                  </DropdownMenuItem>
                ))}
                <DropdownMenuSeparator />
                {ETAPAS_ENCERRADAS.filter((e) => e !== lead.etapa).map((e) => (
                  <DropdownMenuItem key={e} onClick={() => onMover(e)}>
                    {ETAPA_LABEL[e]}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

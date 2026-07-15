import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import {
  Loader2,
  UserPlus,
  Mail,
  ShieldAlert,
  Pencil,
  Trash2,
  MessageCircle,
  FileSignature,
  Download,
  Send,
  Clock,
} from "lucide-react";

import { useAuth } from "@/hooks/use-auth";
import { supabase } from "@/lib/supabase";
import { ClientOnly } from "@/components/client-only";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
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
import { Label } from "@/components/ui/label";

export const Route = createFileRoute("/_authenticated/parceiros")({
  component: ParceirosPage,
});

interface ParceiroRow {
  id: string;
  nome: string | null;
  email: string | null;
  oab: string | null;
  telefone: string | null;
  percentual_parceiro: number | null;
  ativo: boolean;
  created_at: string | null;
  onboarded_em: string | null;
}

interface AceiteRow {
  id: string;
  versao: string;
  documentos: Array<{ id: string; titulo: string; hash: string }> | null;
  dados_preenchidos: Record<string, string> | null;
  nome_assinatura: string;
  ip: string | null;
  user_agent: string | null;
  assinado_em: string;
}

function fmtDataHora(iso: string | null): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString("pt-BR");
  } catch {
    return iso;
  }
}

// Gera e baixa um comprovante de aceite (HTML autocontido, imprimível em PDF).
function baixarComprovante(a: AceiteRow, parceiroNome: string) {
  const esc = (s: string) =>
    String(s ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  const dados = a.dados_preenchidos || {};
  const docsRows = (a.documentos || [])
    .map(
      (d) =>
        `<tr><td>${esc(d.titulo)}</td><td style="font-family:monospace;font-size:11px;word-break:break-all">${esc(
          d.hash,
        )}</td></tr>`,
    )
    .join("");
  const dadosRows = Object.entries(dados)
    .map(([k, v]) => `<tr><td><b>${esc(k)}</b></td><td>${esc(v)}</td></tr>`)
    .join("");
  const html = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">
<title>Comprovante de Aceite — ${esc(parceiroNome)}</title>
<style>body{font-family:Arial,Helvetica,sans-serif;color:#222;max-width:720px;margin:32px auto;padding:0 16px;line-height:1.5}
h1{font-size:20px;border-bottom:3px solid #b8862e;padding-bottom:8px}
table{border-collapse:collapse;width:100%;margin:10px 0}td{border:1px solid #ddd;padding:6px 8px;font-size:13px;vertical-align:top}
.muted{color:#777;font-size:12px}</style></head><body>
<h1>Comprovante de Aceite Eletrônico</h1>
<p class="muted">Mara Sandra Vian Advocacia · Plataforma Mara Sandra Connect</p>
<table>
<tr><td><b>Parceiro</b></td><td>${esc(parceiroNome)}</td></tr>
<tr><td><b>Assinatura (nome digitado)</b></td><td>${esc(a.nome_assinatura)}</td></tr>
<tr><td><b>Data/hora</b></td><td>${esc(fmtDataHora(a.assinado_em))}</td></tr>
<tr><td><b>Versão dos termos</b></td><td>${esc(a.versao)}</td></tr>
<tr><td><b>Endereço IP</b></td><td>${esc(a.ip || "—")}</td></tr>
<tr><td><b>Navegador</b></td><td class="muted">${esc(a.user_agent || "—")}</td></tr>
</table>
<h3>Dados informados</h3><table>${dadosRows || "<tr><td>—</td></tr>"}</table>
<h3>Documentos aceitos (hash SHA-256)</h3><table><tr><td><b>Documento</b></td><td><b>Hash</b></td></tr>${docsRows || "<tr><td>—</td></tr>"}</table>
<p class="muted">O hash identifica de forma única o texto exato de cada documento aceito, cuja versão está arquivada no repositório da plataforma.</p>
</body></html>`;
  const blob = new Blob([html], { type: "text/html;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `comprovante-aceite-${parceiroNome.replace(/\s+/g, "_")}-${a.versao}.html`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function maskTelefone(v: string) {
  const d = v.replace(/\D/g, "").slice(0, 11);
  if (d.length <= 10) {
    return d.replace(/(\d{2})(\d)/, "($1) $2").replace(/(\d{4})(\d)/, "$1-$2");
  }
  return d.replace(/(\d{2})(\d)/, "($1) $2").replace(/(\d{5})(\d)/, "$1-$2");
}

const schema = z.object({
  nome: z.string().trim().min(3, "Informe o nome completo").max(150),
  email: z.string().trim().email("E-mail inválido").max(150),
  oab: z.string().trim().min(3, "Informe o número da OAB").max(30),
  telefone: z.string().trim().min(14, "Telefone incompleto").max(16),
  percentual: z.coerce.number().min(0, "0 a 100").max(100, "0 a 100"),
  observacoes: z.string().max(1000).optional().or(z.literal("")),
});

type FormValues = z.infer<typeof schema>;

function ParceirosPage() {
  const { usuario } = useAuth();
  const navigate = useNavigate();
  const [parceiros, setParceiros] = useState<ParceiroRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [reenviandoId, setReenviandoId] = useState<string | null>(null);

  // ---- Editar parceiro ----
  // Usado pra trocar email de teste (naira+nome@gmail.com) pelo email real
  // do parceiro, ou corrigir nome/oab/telefone. Backend cuida de auth.users
  // + envia novo magic link se email mudou.
  const [editAberto, setEditAberto] = useState(false);
  const [editAlvo, setEditAlvo] = useState<ParceiroRow | null>(null);
  const [editNome, setEditNome] = useState("");
  const [editEmail, setEditEmail] = useState("");
  const [editOab, setEditOab] = useState("");
  const [editTelefone, setEditTelefone] = useState("");
  const [editPercentual, setEditPercentual] = useState("30");
  const [editSalvando, setEditSalvando] = useState(false);

  // ---- Excluir parceiro ----
  // Acao destrutiva mas com cascade que preserva historico: casos viram
  // sem parceiro indicador, andamentos/documentos perdem autoria, mas
  // continuam existindo. So comentarios feitos pelo parceiro sao apagados.
  const [excluirAlvo, setExcluirAlvo] = useState<ParceiroRow | null>(null);
  const [excluindo, setExcluindo] = useState(false);

  // ---- Ativar WhatsApp (onboarding por código) ----
  // Gera um código (RPC whatsapp_gerar_codigo_ativacao) que é enviado ao
  // WhatsApp do parceiro; ele responde o código pra vincular o LID. O código
  // tambem volta aqui pra mostrar ao interno (suporte).
  const [ativarAlvo, setAtivarAlvo] = useState<ParceiroRow | null>(null);
  const [ativando, setAtivando] = useState(false);
  const [codigoGerado, setCodigoGerado] = useState<string | null>(null);
  const [codigoParceiro, setCodigoParceiro] = useState("");

  // Aceite de termos (interno consulta/baixa o comprovante).
  const [aceiteAlvo, setAceiteAlvo] = useState<ParceiroRow | null>(null);
  const [aceites, setAceites] = useState<Array<AceiteRow>>([]);
  const [carregandoAceites, setCarregandoAceites] = useState(false);

  useEffect(() => {
    if (!aceiteAlvo) return;
    setCarregandoAceites(true);
    setAceites([]);
    (async () => {
      const { data, error } = await supabase
        .from("aceites_termos")
        .select(
          "id, versao, documentos, dados_preenchidos, nome_assinatura, ip, user_agent, assinado_em",
        )
        .eq("usuario_id", aceiteAlvo.id)
        .order("assinado_em", { ascending: false });
      if (!error) setAceites((data || []) as Array<AceiteRow>);
      setCarregandoAceites(false);
    })();
  }, [aceiteAlvo]);

  const isInterno = usuario?.tipo === "interno";

  useEffect(() => {
    if (usuario && !isInterno) {
      toast.error("Acesso restrito à equipe interna.");
      navigate({ to: "/casos" });
    }
  }, [usuario, isInterno, navigate]);

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      nome: "",
      email: "",
      oab: "",
      telefone: "",
      percentual: 30,
      observacoes: "",
    },
  });

  function abrirEditar(p: ParceiroRow) {
    setEditAlvo(p);
    setEditNome(p.nome ?? "");
    setEditEmail(p.email ?? "");
    setEditOab(p.oab ?? "");
    setEditTelefone(p.telefone ?? "");
    setEditPercentual(String(p.percentual_parceiro ?? 30));
    setEditAberto(true);
  }

  async function salvarEdit() {
    if (!editAlvo) return;
    if (!editNome.trim()) {
      toast.error("Nome obrigatório");
      return;
    }
    if (!editEmail.trim()) {
      toast.error("Email obrigatório");
      return;
    }
    setEditSalvando(true);
    try {
      const emailMudou = editEmail.trim().toLowerCase() !== (editAlvo.email ?? "").toLowerCase();
      const resp = await supabase.functions.invoke("update-parceiro", {
        body: {
          usuario_id: editAlvo.id,
          nome: editNome.trim(),
          email: editEmail.trim().toLowerCase(),
          oab: editOab.trim(),
          telefone: editTelefone.trim(),
          percentual: Number(editPercentual) || 30,
          enviar_link: emailMudou, // so envia magic link se email mudou
        },
      });
      if (resp.error) throw resp.error;
      const data = resp.data as { link_enviado?: boolean } | null;
      if (emailMudou) {
        toast.success(
          data?.link_enviado
            ? "Parceiro atualizado. Magic link enviado pro novo email."
            : "Parceiro atualizado. (Magic link não foi enviado - veja logs.)",
        );
      } else {
        toast.success("Parceiro atualizado.");
      }
      setEditAberto(false);
      setEditAlvo(null);
      await loadParceiros();
    } catch (err) {
      console.error(err);
      const errObj = err as { message?: string };
      toast.error(errObj.message || "Erro ao atualizar parceiro");
    } finally {
      setEditSalvando(false);
    }
  }

  async function excluirParceiroConfirmado() {
    if (!excluirAlvo) return;
    setExcluindo(true);
    try {
      const resp = await supabase.functions.invoke("excluir-parceiro", {
        body: { usuario_id: excluirAlvo.id, confirmar: true },
      });
      if (resp.error) throw resp.error;
      const data = resp.data as {
        excluido?: boolean;
        auth_excluido?: boolean;
        warning?: string;
      } | null;
      if (data?.warning) {
        toast.warning(data.warning);
      } else {
        toast.success("Parceiro " + (excluirAlvo.nome ?? "") + " excluído.");
      }
      setExcluirAlvo(null);
      await loadParceiros();
    } catch (err) {
      console.error(err);
      const errObj = err as { message?: string };
      toast.error(errObj.message || "Erro ao excluir parceiro");
    } finally {
      setExcluindo(false);
    }
  }

  async function ativarWhatsappConfirmado() {
    if (!ativarAlvo) return;
    setAtivando(true);
    try {
      const { data, error } = await supabase.rpc("whatsapp_gerar_codigo_ativacao", {
        p_parceiro_id: ativarAlvo.id,
      });
      if (error) throw error;
      const codigo = typeof data === "string" ? data : String(data ?? "");
      if (!codigo) throw new Error("Código não retornado.");
      setCodigoParceiro(ativarAlvo.nome ?? "parceiro");
      setCodigoGerado(codigo);
      setAtivarAlvo(null);
    } catch (err) {
      console.error(err);
      const errObj = err as { message?: string };
      toast.error(errObj.message || "Erro ao gerar código de ativação");
    } finally {
      setAtivando(false);
    }
  }

  async function loadParceiros() {
    setLoading(true);
    const { data, error } = await supabase
      .from("usuarios")
      .select(
        "id, nome, email, oab, telefone, percentual_parceiro, ativo, created_at, onboarded_em",
      )
      .eq("tipo", "parceiro")
      .order("created_at", { ascending: false });
    if (error) {
      console.error(error);
      toast.error("Falha ao carregar parceiros.");
    } else {
      setParceiros((data as ParceiroRow[]) ?? []);
    }
    setLoading(false);
  }

  useEffect(() => {
    if (isInterno) loadParceiros();
  }, [isInterno]);

  async function onSubmit(values: FormValues) {
    setSubmitting(true);
    try {
      const redirectTo =
        typeof window !== "undefined" ? `${window.location.origin}/login` : undefined;

      const resp = await supabase.functions.invoke("convidar-usuario", {
        body: {
          nome: values.nome.trim(),
          email: values.email.trim().toLowerCase(),
          tipo: "parceiro",
          oab: values.oab.trim(),
          telefone: values.telefone.trim(),
          percentual_parceiro: values.percentual,
          observacoes: values.observacoes?.trim() || null,
          redirect_to: redirectTo,
        },
      });

      if (resp.error) throw resp.error;
      const data = resp.data as { ok?: boolean; ja_existia?: boolean; error?: string };
      if (data?.error) throw new Error(data.error);

      if (data?.ja_existia) {
        toast.success(
          `Parceiro ${values.email} já existia. Use "Reenviar convite" se precisar de novo link.`,
        );
      } else {
        toast.success(
          `Convite enviado para ${values.email}. O parceiro vai receber um link de acesso por e-mail.`,
        );
      }
      form.reset();
      await loadParceiros();
    } catch (err) {
      console.error(err);
      const msg =
        (err as { message?: string })?.message ??
        "Não foi possível enviar o convite. Verifique o e-mail e tente novamente.";
      toast.error(msg);
    } finally {
      setSubmitting(false);
    }
  }

  async function reenviarConvite(p: ParceiroRow) {
    if (!p.email || !p.nome) {
      toast.error("Parceiro sem nome ou e-mail — edite antes de reenviar.");
      return;
    }
    setReenviandoId(p.id);
    try {
      const redirectTo =
        typeof window !== "undefined" ? `${window.location.origin}/login` : undefined;
      const resp = await supabase.functions.invoke("convidar-usuario", {
        body: {
          nome: p.nome,
          email: p.email,
          tipo: "parceiro",
          oab: p.oab ?? "",
          telefone: p.telefone ?? "",
          percentual_parceiro: p.percentual_parceiro,
          redirect_to: redirectTo,
        },
      });
      if (resp.error) throw resp.error;
      const data = resp.data as { error?: string };
      if (data?.error) throw new Error(data.error);
      toast.success(`Convite reenviado para ${p.email}.`);
      await loadParceiros();
    } catch (err) {
      const msg = (err as { message?: string })?.message ?? "Falha ao reenviar convite.";
      toast.error(msg);
    } finally {
      setReenviandoId(null);
    }
  }

  if (!isInterno) {
    return (
      <div className="flex h-96 flex-col items-center justify-center gap-2 text-muted-foreground">
        <ShieldAlert className="h-8 w-8" />
        <p className="text-sm">Acesso restrito à equipe interna.</p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <h1 className="font-serif text-3xl font-semibold tracking-tight">Parceiros</h1>
        <p className="text-sm text-muted-foreground">
          Advogados captadores que indicam casos ao escritório.
        </p>
      </div>

      <ClientOnly
        fallback={
          <div className="flex h-96 items-center justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        }
      >
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <UserPlus className="h-4 w-4" />
              Convidar novo parceiro
            </CardTitle>
            <CardDescription>
              O parceiro receberá um e-mail com link para definir a senha e acessar o sistema.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="grid gap-4 sm:grid-cols-2">
                <FormField
                  control={form.control}
                  name="nome"
                  render={({ field }) => (
                    <FormItem className="sm:col-span-2">
                      <FormLabel>Nome completo *</FormLabel>
                      <FormControl>
                        <Input placeholder="Nome do advogado parceiro" {...field} />
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
                      <FormLabel>E-mail *</FormLabel>
                      <FormControl>
                        <Input
                          type="email"
                          placeholder="parceiro@exemplo.com"
                          autoComplete="off"
                          {...field}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="oab"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>OAB *</FormLabel>
                      <FormControl>
                        <Input placeholder="OAB/SP 000000" {...field} />
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
                  name="percentual"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>% de repasse ao parceiro *</FormLabel>
                      <FormControl>
                        <Input
                          type="number"
                          inputMode="decimal"
                          min={0}
                          max={100}
                          step={1}
                          placeholder="30"
                          value={field.value}
                          onChange={(e) => field.onChange(e.target.value)}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="observacoes"
                  render={({ field }) => (
                    <FormItem className="sm:col-span-2">
                      <FormLabel>Observações sobre o parceiro</FormLabel>
                      <FormControl>
                        <Textarea
                          rows={3}
                          placeholder="Especialidade, área de atuação, observações internas..."
                          {...field}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <div className="flex justify-end sm:col-span-2">
                  <Button type="submit" disabled={submitting}>
                    {submitting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                    <Mail className="h-4 w-4 mr-2" />
                    Enviar convite
                  </Button>
                </div>
              </form>
            </Form>
          </CardContent>
        </Card>

        {/* Parceiros aguardando aceite (sem onboarded_em) */}
        {!loading && parceiros.some((p) => !p.onboarded_em) && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Clock className="h-4 w-4 text-amber-600" />
                Aguardando aceite do convite
              </CardTitle>
              <CardDescription>
                Convite enviado por e-mail. O parceiro ainda não acessou pela primeira vez nem
                aceitou os termos. Você pode reenviar o link ou ajustar os dados.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ul className="divide-y">
                {parceiros
                  .filter((p) => !p.onboarded_em)
                  .map((p) => (
                    <li
                      key={p.id}
                      className="flex flex-wrap items-center justify-between gap-3 py-3"
                    >
                      <div className="min-w-0">
                        <p className="text-sm font-medium">
                          {p.nome ?? "(sem nome)"}
                          <Badge
                            variant="outline"
                            className="ml-2 text-[10px] font-normal border-amber-500/50 text-amber-700 bg-amber-50"
                          >
                            convite pendente
                          </Badge>
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {p.email ?? "(sem e-mail)"}
                          {p.oab && <> · OAB {p.oab}</>}
                          {p.percentual_parceiro != null && <> · {p.percentual_parceiro}%</>}
                        </p>
                      </div>
                      <div className="flex items-center gap-1">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => reenviarConvite(p)}
                          disabled={reenviandoId === p.id}
                        >
                          {reenviandoId === p.id ? (
                            <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
                          ) : (
                            <Send className="h-3.5 w-3.5 mr-1" />
                          )}
                          Reenviar
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => abrirEditar(p)}
                          aria-label="Editar dados do convite"
                          title="Editar dados antes de reenviar"
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => setExcluirAlvo(p)}
                          aria-label="Cancelar convite"
                          title="Cancelar convite (apaga o parceiro)"
                          className="text-muted-foreground hover:text-destructive"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </li>
                  ))}
              </ul>
            </CardContent>
          </Card>
        )}

        {/* Parceiros ativos */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Parceiros ativos</CardTitle>
            <CardDescription>
              {(() => {
                const ativos = parceiros.filter((p) => p.onboarded_em).length;
                return `${ativos} ${ativos === 1 ? "parceiro" : "parceiros"} já fizeram o primeiro acesso.`;
              })()}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="flex h-32 items-center justify-center">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            ) : parceiros.filter((p) => p.onboarded_em).length === 0 ? (
              <p className="text-sm text-muted-foreground py-8 text-center">
                {parceiros.length === 0
                  ? "Nenhum parceiro cadastrado ainda. Use o formulário acima para convidar o primeiro."
                  : "Nenhum parceiro fez o primeiro acesso ainda."}
              </p>
            ) : (
              <>
                {/* Mobile: cards */}
                <div className="md:hidden space-y-3">
                  {parceiros
                    .filter((p) => p.onboarded_em)
                    .map((p) => (
                      <div
                        key={p.id}
                        className="rounded-lg border border-border bg-card p-3 space-y-2"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <div className="font-medium text-sm">{p.nome ?? "—"}</div>
                            <div className="text-xs text-muted-foreground truncate">
                              {p.email ?? "—"}
                            </div>
                          </div>
                          {p.ativo ? (
                            <Badge variant="secondary" className="shrink-0">
                              Ativo
                            </Badge>
                          ) : (
                            <Badge variant="outline" className="shrink-0">
                              Inativo
                            </Badge>
                          )}
                        </div>
                        <div className="text-xs text-muted-foreground flex flex-wrap gap-x-3 gap-y-0.5">
                          <span>OAB: {p.oab ?? "—"}</span>
                          <span>
                            Repasse:{" "}
                            {p.percentual_parceiro != null ? `${p.percentual_parceiro}%` : "—"}
                          </span>
                          <span>Tel: {p.telefone ?? "—"}</span>
                        </div>
                        <div className="flex justify-end gap-0.5 border-t border-border pt-1.5">
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => setAtivarAlvo(p)}
                            disabled={!p.telefone}
                            aria-label="Ativar WhatsApp"
                            className="text-muted-foreground hover:text-green-600"
                          >
                            <MessageCircle className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => setAceiteAlvo(p)}
                            aria-label="Ver aceite de termos"
                            className="text-muted-foreground hover:text-[var(--gold)]"
                          >
                            <FileSignature className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => abrirEditar(p)}
                            aria-label="Editar parceiro"
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => setExcluirAlvo(p)}
                            aria-label="Excluir parceiro"
                            className="text-muted-foreground hover:text-destructive"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </div>
                    ))}
                </div>
                {/* Desktop: tabela */}
                <div className="hidden md:block overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Nome</TableHead>
                        <TableHead>E-mail</TableHead>
                        <TableHead>OAB</TableHead>
                        <TableHead className="w-16">Repasse</TableHead>
                        <TableHead>Telefone</TableHead>
                        <TableHead className="w-24">Status</TableHead>
                        <TableHead className="w-36 text-right">Ações</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {parceiros
                        .filter((p) => p.onboarded_em)
                        .map((p) => (
                          <TableRow key={p.id}>
                            <TableCell className="font-medium">{p.nome ?? "—"}</TableCell>
                            <TableCell className="text-muted-foreground">
                              {p.email ?? "—"}
                            </TableCell>
                            <TableCell>{p.oab ?? "—"}</TableCell>
                            <TableCell>
                              {p.percentual_parceiro != null ? `${p.percentual_parceiro}%` : "—"}
                            </TableCell>
                            <TableCell>{p.telefone ?? "—"}</TableCell>
                            <TableCell>
                              {p.ativo ? (
                                <Badge variant="secondary">Ativo</Badge>
                              ) : (
                                <Badge variant="outline">Inativo</Badge>
                              )}
                            </TableCell>
                            <TableCell className="text-right">
                              <div className="flex justify-end gap-0.5">
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  onClick={() => setAtivarAlvo(p)}
                                  disabled={!p.telefone}
                                  aria-label="Ativar WhatsApp"
                                  title={
                                    p.telefone
                                      ? "Ativar WhatsApp (envia código ao parceiro)"
                                      : "Parceiro sem telefone cadastrado"
                                  }
                                  className="text-muted-foreground hover:text-green-600"
                                >
                                  <MessageCircle className="h-3.5 w-3.5" />
                                </Button>
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  onClick={() => setAceiteAlvo(p)}
                                  aria-label="Ver aceite de termos"
                                  title="Ver/baixar aceite de termos"
                                  className="text-muted-foreground hover:text-[var(--gold)]"
                                >
                                  <FileSignature className="h-3.5 w-3.5" />
                                </Button>
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  onClick={() => abrirEditar(p)}
                                  aria-label="Editar parceiro"
                                >
                                  <Pencil className="h-3.5 w-3.5" />
                                </Button>
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  onClick={() => setExcluirAlvo(p)}
                                  aria-label="Excluir parceiro"
                                  className="text-muted-foreground hover:text-destructive"
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
                                </Button>
                              </div>
                            </TableCell>
                          </TableRow>
                        ))}
                    </TableBody>
                  </Table>
                </div>
              </>
            )}
          </CardContent>
        </Card>

        {/* Dialog: aceite de termos do parceiro (interno only) */}
        <Dialog open={aceiteAlvo !== null} onOpenChange={(o) => !o && setAceiteAlvo(null)}>
          <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
            <DialogHeader>
              <DialogTitle>Aceite de termos — {aceiteAlvo?.nome ?? "—"}</DialogTitle>
              <DialogDescription>
                Registro do aceite eletrônico (LGPD). Use "Baixar comprovante" para
                guardar/imprimir.
              </DialogDescription>
            </DialogHeader>

            {carregandoAceites ? (
              <div className="flex h-24 items-center justify-center">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            ) : aceites.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">
                Este parceiro ainda não assinou os termos.
              </p>
            ) : (
              <div className="space-y-3">
                {aceites.map((a) => (
                  <div key={a.id} className="rounded-lg border p-3 text-sm">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium">Versão {a.versao}</span>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => baixarComprovante(a, aceiteAlvo?.nome ?? "parceiro")}
                      >
                        <Download className="h-3.5 w-3.5 mr-1.5" />
                        Baixar comprovante
                      </Button>
                    </div>
                    <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
                      <dt className="text-muted-foreground">Assinatura</dt>
                      <dd className="font-serif">{a.nome_assinatura}</dd>
                      <dt className="text-muted-foreground">Data/hora</dt>
                      <dd>{fmtDataHora(a.assinado_em)}</dd>
                      <dt className="text-muted-foreground">IP</dt>
                      <dd>{a.ip || "—"}</dd>
                      <dt className="text-muted-foreground">Documentos</dt>
                      <dd>{(a.documentos || []).map((d) => d.titulo).join(", ") || "—"}</dd>
                    </dl>
                  </div>
                ))}
              </div>
            )}

            <DialogFooter>
              <Button variant="ghost" onClick={() => setAceiteAlvo(null)}>
                Fechar
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Dialog: editar parceiro (interno only) */}
        <Dialog
          open={editAberto}
          onOpenChange={(o) => {
            if (!editSalvando) setEditAberto(o);
          }}
        >
          <DialogContent className="max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Editar parceiro</DialogTitle>
              <DialogDescription>
                Atualize dados do parceiro. Se trocar o email, um novo magic link será enviado pro
                novo endereço automaticamente - útil pra testar com seu próprio email agora e migrar
                pro email real depois.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-3">
              <div>
                <Label className="text-xs">Nome completo</Label>
                <Input
                  value={editNome}
                  onChange={(e) => setEditNome(e.target.value)}
                  placeholder="Nome do advogado parceiro"
                />
              </div>
              <div>
                <Label className="text-xs">E-mail</Label>
                <Input
                  type="email"
                  value={editEmail}
                  onChange={(e) => setEditEmail(e.target.value)}
                  placeholder="parceiro@exemplo.com"
                  autoComplete="off"
                />
                {editAlvo &&
                  editEmail.trim().toLowerCase() !== (editAlvo.email ?? "").toLowerCase() && (
                    <p className="text-xs text-[var(--gold)] mt-1 font-medium">
                      Email mudou - será enviado novo magic link ao salvar.
                    </p>
                  )}
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <Label className="text-xs">OAB</Label>
                  <Input
                    value={editOab}
                    onChange={(e) => setEditOab(e.target.value)}
                    placeholder="OAB/SP 000000"
                  />
                </div>
                <div>
                  <Label className="text-xs">Telefone</Label>
                  <Input
                    value={editTelefone}
                    onChange={(e) => setEditTelefone(maskTelefone(e.target.value))}
                    placeholder="(00) 00000-0000"
                    inputMode="tel"
                  />
                </div>
                <div>
                  <Label className="text-xs">% de repasse ao parceiro</Label>
                  <Input
                    type="number"
                    inputMode="decimal"
                    min={0}
                    max={100}
                    step={1}
                    value={editPercentual}
                    onChange={(e) => setEditPercentual(e.target.value)}
                    placeholder="30"
                  />
                </div>
              </div>
            </div>
            <DialogFooter>
              <Button variant="ghost" onClick={() => setEditAberto(false)} disabled={editSalvando}>
                Cancelar
              </Button>
              <Button onClick={salvarEdit} disabled={editSalvando}>
                {editSalvando && <Loader2 className="h-3 w-3 mr-2 animate-spin" />}
                Salvar
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* AlertDialog: confirmar exclusao destrutiva */}
        <AlertDialog
          open={excluirAlvo !== null}
          onOpenChange={(o) => {
            if (!excluindo && !o) setExcluirAlvo(null);
          }}
        >
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Excluir {excluirAlvo?.nome ?? "parceiro"}?</AlertDialogTitle>
              <AlertDialogDescription asChild>
                <div className="space-y-2 text-sm">
                  <p>
                    Esta ação é <strong>irreversível</strong>. O parceiro será removido do sistema
                    (login + cadastro).
                  </p>
                  <p>Cascade que preserva histórico:</p>
                  <ul className="list-disc pl-5 space-y-0.5 text-muted-foreground">
                    <li>
                      <strong>Casos</strong> vinculados ficarão sem parceiro indicador (parceiro_id
                      = null). Você pode reatribuir depois.
                    </li>
                    <li>
                      <strong>Andamentos e documentos</strong> do parceiro continuam existindo, mas
                      perdem a autoria.
                    </li>
                    <li>
                      <strong>Comentários</strong> feitos pelo parceiro são apagados (respostas
                      também).
                    </li>
                    <li>
                      <strong>Login</strong> e cadastro (auth.users + usuarios) são removidos.
                    </li>
                  </ul>
                </div>
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={excluindo}>Cancelar</AlertDialogCancel>
              <AlertDialogAction
                onClick={(e) => {
                  e.preventDefault();
                  excluirParceiroConfirmado();
                }}
                disabled={excluindo}
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              >
                {excluindo && <Loader2 className="h-3 w-3 mr-2 animate-spin" />}
                Sim, excluir parceiro
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        {/* AlertDialog: confirmar envio do código de ativação WhatsApp */}
        <AlertDialog
          open={ativarAlvo !== null}
          onOpenChange={(o) => {
            if (!ativando && !o) setAtivarAlvo(null);
          }}
        >
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>
                Ativar WhatsApp de {ativarAlvo?.nome ?? "parceiro"}?
              </AlertDialogTitle>
              <AlertDialogDescription asChild>
                <div className="space-y-2 text-sm">
                  <p>
                    Vamos enviar um <strong>código de ativação</strong> para o WhatsApp do parceiro
                    no número <strong>{ativarAlvo?.telefone ?? "—"}</strong>.
                  </p>
                  <p className="text-muted-foreground">
                    O parceiro deve <strong>responder o código</strong> na conversa com o bot para
                    vincular o WhatsApp dele. O código expira em 15 minutos.
                  </p>
                </div>
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={ativando}>Cancelar</AlertDialogCancel>
              <AlertDialogAction
                onClick={(e) => {
                  e.preventDefault();
                  ativarWhatsappConfirmado();
                }}
                disabled={ativando}
              >
                {ativando && <Loader2 className="h-3 w-3 mr-2 animate-spin" />}
                <MessageCircle className="h-3.5 w-3.5 mr-2" />
                Enviar código
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        {/* Dialog: mostra o código gerado (suporte) */}
        <Dialog
          open={codigoGerado !== null}
          onOpenChange={(o) => {
            if (!o) setCodigoGerado(null);
          }}
        >
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Código enviado ✅</DialogTitle>
              <DialogDescription>
                Enviamos o código de ativação para o WhatsApp de {codigoParceiro}.
              </DialogDescription>
            </DialogHeader>
            <div className="flex flex-col items-center gap-2 py-4">
              <span className="text-xs uppercase tracking-wide text-muted-foreground">
                Código gerado
              </span>
              <span className="font-mono text-4xl font-bold tracking-[0.3em]">{codigoGerado}</span>
              <p className="mt-2 text-center text-xs text-muted-foreground">
                Peça para o parceiro <strong>responder esse código</strong> na conversa do WhatsApp
                com o bot. Expira em 15 minutos.
              </p>
            </div>
            <DialogFooter>
              <Button onClick={() => setCodigoGerado(null)}>Entendi</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </ClientOnly>
    </div>
  );
}

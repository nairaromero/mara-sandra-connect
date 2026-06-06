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
} from "lucide-react";

import { useAuth } from "@/hooks/use-auth";
import { supabase } from "@/lib/supabase";
import { ClientOnly } from "@/components/client-only";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
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
  ativo: boolean;
  created_at: string | null;
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
  observacoes: z.string().max(1000).optional().or(z.literal("")),
});

type FormValues = z.infer<typeof schema>;

function ParceirosPage() {
  const { usuario } = useAuth();
  const navigate = useNavigate();
  const [parceiros, setParceiros] = useState<ParceiroRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

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
  const [editSalvando, setEditSalvando] = useState(false);

  // ---- Excluir parceiro ----
  // Acao destrutiva mas com cascade que preserva historico: casos viram
  // sem parceiro indicador, andamentos/documentos perdem autoria, mas
  // continuam existindo. So comentarios feitos pelo parceiro sao apagados.
  const [excluirAlvo, setExcluirAlvo] = useState<ParceiroRow | null>(null);
  const [excluindo, setExcluindo] = useState(false);

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
      observacoes: "",
    },
  });

  function abrirEditar(p: ParceiroRow) {
    setEditAlvo(p);
    setEditNome(p.nome ?? "");
    setEditEmail(p.email ?? "");
    setEditOab(p.oab ?? "");
    setEditTelefone(p.telefone ?? "");
    setEditAberto(true);
  }

  async function salvarEdit() {
    if (!editAlvo) return;
    if (!editNome.trim()) {
      toast.error("Nome obrigatorio");
      return;
    }
    if (!editEmail.trim()) {
      toast.error("Email obrigatorio");
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
          enviar_link: emailMudou, // so envia magic link se email mudou
        },
      });
      if (resp.error) throw resp.error;
      const data = resp.data as { link_enviado?: boolean } | null;
      if (emailMudou) {
        toast.success(
          data?.link_enviado
            ? "Parceiro atualizado. Magic link enviado pro novo email."
            : "Parceiro atualizado. (Magic link nao foi enviado - veja logs.)",
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
        toast.success(
          "Parceiro " + (excluirAlvo.nome ?? "") + " excluido.",
        );
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

  async function loadParceiros() {
    setLoading(true);
    const { data, error } = await supabase
      .from("usuarios")
      .select("id, nome, email, oab, telefone, ativo, created_at")
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
        typeof window !== "undefined"
          ? `${window.location.origin}/login`
          : undefined;

      const { error } = await supabase.auth.signInWithOtp({
        email: values.email.trim().toLowerCase(),
        options: {
          shouldCreateUser: true,
          emailRedirectTo: redirectTo,
          data: {
            nome: values.nome.trim(),
            oab: values.oab.trim(),
            telefone: values.telefone.trim(),
            tipo: "parceiro",
            observacoes_iniciais: values.observacoes?.trim() || null,
          },
        },
      });

      if (error) throw error;

      toast.success(
        `Convite enviado para ${values.email}. Peça para o parceiro verificar a caixa de entrada.`,
      );
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
        <h1 className="font-serif text-3xl font-semibold tracking-tight">
          Parceiros
        </h1>
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
              <form
                onSubmit={form.handleSubmit(onSubmit)}
                className="grid gap-4 sm:grid-cols-2"
              >
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
                          onChange={(e) =>
                            field.onChange(maskTelefone(e.target.value))
                          }
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

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Parceiros cadastrados</CardTitle>
            <CardDescription>
              {parceiros.length} {parceiros.length === 1 ? "parceiro" : "parceiros"} no total.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="flex h-32 items-center justify-center">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            ) : parceiros.length === 0 ? (
              <p className="text-sm text-muted-foreground py-8 text-center">
                Nenhum parceiro cadastrado ainda. Use o formulário acima para convidar o primeiro.
              </p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Nome</TableHead>
                    <TableHead>E-mail</TableHead>
                    <TableHead>OAB</TableHead>
                    <TableHead>Telefone</TableHead>
                    <TableHead className="w-24">Status</TableHead>
                    <TableHead className="w-28 text-right">Acoes</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {parceiros.map((p) => (
                    <TableRow key={p.id}>
                      <TableCell className="font-medium">{p.nome ?? "—"}</TableCell>
                      <TableCell className="text-muted-foreground">{p.email ?? "—"}</TableCell>
                      <TableCell>{p.oab ?? "—"}</TableCell>
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
            )}
          </CardContent>
        </Card>

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
                Atualize dados do parceiro. Se trocar o email, um novo magic
                link sera enviado pro novo endereco automaticamente - util pra
                testar com seu proprio email agora e migrar pro email real
                depois.
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
                {editAlvo && editEmail.trim().toLowerCase() !==
                  (editAlvo.email ?? "").toLowerCase() && (
                  <p className="text-xs text-[var(--gold)] mt-1 font-medium">
                    Email mudou - sera enviado novo magic link ao salvar.
                  </p>
                )}
              </div>
              <div className="grid grid-cols-2 gap-3">
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
                    onChange={(e) =>
                      setEditTelefone(maskTelefone(e.target.value))
                    }
                    placeholder="(00) 00000-0000"
                    inputMode="tel"
                  />
                </div>
              </div>
            </div>
            <DialogFooter>
              <Button
                variant="ghost"
                onClick={() => setEditAberto(false)}
                disabled={editSalvando}
              >
                Cancelar
              </Button>
              <Button onClick={salvarEdit} disabled={editSalvando}>
                {editSalvando && (
                  <Loader2 className="h-3 w-3 mr-2 animate-spin" />
                )}
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
              <AlertDialogTitle>
                Excluir {excluirAlvo?.nome ?? "parceiro"}?
              </AlertDialogTitle>
              <AlertDialogDescription asChild>
                <div className="space-y-2 text-sm">
                  <p>
                    Esta acao e <strong>irreversivel</strong>. O parceiro sera
                    removido do sistema (login + cadastro).
                  </p>
                  <p>Cascade que preserva historico:</p>
                  <ul className="list-disc pl-5 space-y-0.5 text-muted-foreground">
                    <li>
                      <strong>Casos</strong> vinculados ficarao sem parceiro
                      indicador (parceiro_id = null). Voce pode reatribuir
                      depois.
                    </li>
                    <li>
                      <strong>Andamentos e documentos</strong> do parceiro
                      continuam existindo, mas perdem a autoria.
                    </li>
                    <li>
                      <strong>Comentarios</strong> feitos pelo parceiro sao
                      apagados (respostas tambem).
                    </li>
                    <li>
                      <strong>Login</strong> e cadastro (auth.users + usuarios)
                      sao removidos.
                    </li>
                  </ul>
                </div>
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={excluindo}>
                Cancelar
              </AlertDialogCancel>
              <AlertDialogAction
                onClick={(e) => {
                  e.preventDefault();
                  excluirParceiroConfirmado();
                }}
                disabled={excluindo}
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              >
                {excluindo && (
                  <Loader2 className="h-3 w-3 mr-2 animate-spin" />
                )}
                Sim, excluir parceiro
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </ClientOnly>
    </div>
  );
}

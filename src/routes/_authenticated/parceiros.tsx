import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import { Loader2, UserPlus, Mail, ShieldAlert } from "lucide-react";

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

  const isInterno = usuario?.tipo === "interno";

  useEffect(() => {
    if (usuario && !isInterno) {
      toast.error("Acesso restrito à equipe interna.");
      navigate({ to: "/" });
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
        <h1 className="text-2xl font-semibold tracking-tight">Parceiros</h1>
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
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </ClientOnly>
    </div>
  );
}

import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import { ArrowLeft, Loader2, Eye, EyeOff, Plus, X, FileText } from "lucide-react";

import { useAuth } from "@/hooks/use-auth";
import { supabase } from "@/lib/supabase";
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
  { value: "comprovante_residencia", label: "Comprovante de residencia" },
  { value: "ctps", label: "CTPS" },
  { value: "holerite", label: "Holerite / contracheque" },
  { value: "ppp", label: "PPP" },
  { value: "laudo_medico", label: "Laudo medico" },
  { value: "ltcat", label: "LTCAT" },
  { value: "atestado_medico", label: "Atestado medico" },
  { value: "cat", label: "CAT (Comunicacao de Acidente de Trabalho)" },
  { value: "carne_gps", label: "Carne de contribuicao (GPS)" },
  { value: "ctc", label: "CTC" },
  { value: "carta_concessao_inss", label: "Carta de concessao / indeferimento INSS" },
  { value: "hiscre", label: "HISCRE (Historico de Creditos)" },
  { value: "certidao_casamento", label: "Certidao de casamento" },
  { value: "certidao_obito", label: "Certidao de obito" },
  { value: "certidao_nascimento", label: "Certidao de nascimento" },
  { value: "declaracao_uniao_estavel", label: "Declaracao de uniao estavel" },
  { value: "declaracao_atividade_rural", label: "Declaracao de atividade rural" },
  { value: "procuracao", label: "Procuracao" },
  { value: "contrato_honorarios", label: "Contrato de honorarios" },
  { value: "outro", label: "Outro" },
];

type TipoDocumento = string;

interface DocUpload {
  id: string;
  file: File | null;
  tipo: TipoDocumento;
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
    .refine((v) => isValidCPF(v), "CPF invalido"),
  data_nascimento: z.string().min(1, "Informe a data de nascimento"),
  telefone: z.string().trim().min(14, "Telefone incompleto").max(16),
  email: z
    .string()
    .trim()
    .email("E-mail invalido")
    .max(150)
    .optional()
    .or(z.literal("")),
  senha_meu_inss: z.string().max(100).optional().or(z.literal("")),
  observacoes_cliente: z.string().max(1000).optional().or(z.literal("")),
  tipo_beneficio: z.string().min(1, "Selecione o tipo de beneficio"),
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
  const [docs, setDocs] = useState<Array<DocUpload>>([]);

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
      observacoes_cliente: "",
      tipo_beneficio: "",
      cliente_interno: false,
      parceiro_id: "",
      observacoes_caso: "",
    },
  });

  const clienteInternoWatch = form.watch("cliente_interno");

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

  function addDoc() {
    setDocs((prev) => [
      ...prev,
      { id: crypto.randomUUID(), file: null, tipo: "cnis" },
    ]);
  }

  function removeDoc(id: string) {
    setDocs((prev) => prev.filter((d) => d.id !== id));
  }

  function updateDocFile(id: string, file: File | null) {
    setDocs((prev) => prev.map((d) => (d.id === id ? { ...d, file } : d)));
  }

  function updateDocTipo(id: string, tipo: TipoDocumento) {
    setDocs((prev) => prev.map((d) => (d.id === id ? { ...d, tipo } : d)));
  }

  async function onSubmit(values: FormValues) {
    if (!usuario) return;
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

      // 1) Insere cliente (senha em texto puro temporariamente, ver TODO.md)
      const clienteResp = await supabase
        .from("clientes")
        .insert({
          nome: values.nome.trim(),
          cpf: cpfDigits,
          data_nascimento: values.data_nascimento,
          telefone: values.telefone.trim(),
          email: values.email ? values.email.trim() || null : null,
          senha_meu_inss_plain: values.senha_meu_inss
            ? values.senha_meu_inss.trim() || null
            : null,
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
            casosExistente && casosExistente.length > 0
              ? casosExistente[0]
              : null;
          const casoExistenteId = primeiroCaso ? primeiroCaso.id : null;

          await supabase.from("alertas_duplicidade").insert({
            cpf_tentado: cpfDigits,
            parceiro_solicitante_id: parceiroId,
            caso_existente_id: casoExistenteId,
          });

          toast.success(
            "Cliente ja cadastrado. Sua solicitacao foi registrada e nossa equipe entrara em contato em breve.",
          );
          setSubmitting(false);
          return;
        }
        throw clienteErr;
      }

      if (!clienteInsert) {
        throw new Error("Falha ao obter ID do cliente recem-criado");
      }
      const clienteId = clienteInsert.id;

      // 2) Insere caso
      const casoResp = await supabase
        .from("casos")
        .insert({
          cliente_id: clienteId,
          parceiro_id: parceiroId,
          tipo_beneficio: values.tipo_beneficio,
          fase: "analise",
          status: "em_analise",
          observacoes: values.observacoes_caso
            ? values.observacoes_caso.trim() || null
            : null,
        })
        .select("id")
        .single();

      const casoErr = casoResp.error as PostgresError | null;
      const casoInsert = casoResp.data as CasoInsertRow | null;

      if (casoErr) throw casoErr;
      if (!casoInsert) {
        throw new Error("Falha ao obter ID do caso recem-criado");
      }
      const casoId = casoInsert.id;

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
            toast.error(
              "Falha ao enviar " + doc.file.name + ": " + uploadResp.error.message,
            );
            continue;
          }

          const docInsertResp = await supabase.from("documentos").insert({
            caso_id: casoId,
            tipo: doc.tipo,
            nome_arquivo: doc.file.name,
            storage_path: storagePath,
            tamanho_bytes: doc.file.size,
            uploaded_by: usuario.id,
          });

          if (docInsertResp.error) {
            console.error("Falha ao registrar documento", docInsertResp.error);
            toast.error(
              "Falha ao registrar " +
                doc.file.name +
                ": " +
                docInsertResp.error.message,
            );
          }
        }
      }

      toast.success("Caso cadastrado com sucesso!");
      navigate({ to: "/" });
    } catch (err) {
      console.error(err);
      const errAsObj = err as PostgresError;
      const msg =
        (errAsObj && errAsObj.message) ||
        "Erro ao cadastrar caso. Tente novamente.";
      toast.error(msg);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Novo caso</h1>
          <p className="text-sm text-muted-foreground">
            Cadastre o cliente e abra o caso previdenciario.
          </p>
        </div>
        <Button variant="ghost" size="sm" asChild>
          <Link to="/">
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
                <CardDescription>
                  Informacoes pessoais do segurado.
                </CardDescription>
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
                        <Input
                          placeholder="000.000.000-00"
                          inputMode="numeric"
                          value={field.value}
                          onChange={(e) =>
                            field.onChange(maskCPF(e.target.value))
                          }
                        />
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
                  name="email"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>E-mail</FormLabel>
                      <FormControl>
                        <Input
                          type="email"
                          placeholder="email@exemplo.com"
                          {...field}
                        />
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
                            aria-label={
                              showPwd ? "Ocultar senha" : "Mostrar senha"
                            }
                          >
                            {showPwd ? (
                              <EyeOff className="h-4 w-4" />
                            ) : (
                              <Eye className="h-4 w-4" />
                            )}
                          </button>
                        </div>
                      </FormControl>
                      <p className="text-xs text-muted-foreground">
                        Aviso temporario: armazenada em texto puro durante a
                        fase de testes. Sera criptografada antes do uso em
                        producao.
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
                      <FormLabel>Observacoes sobre o cliente</FormLabel>
                      <FormControl>
                        <Textarea
                          rows={3}
                          placeholder="Notas opcionais..."
                          {...field}
                        />
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
                <CardDescription>
                  Tipo de beneficio e responsaveis.
                </CardDescription>
              </CardHeader>
              <CardContent className="grid gap-4 sm:grid-cols-2">
                <FormField
                  control={form.control}
                  name="tipo_beneficio"
                  render={({ field }) => (
                    <FormItem
                      className={isInterno ? "" : "sm:col-span-2"}
                    >
                      <FormLabel>Tipo de beneficio *</FormLabel>
                      <Select
                        value={field.value}
                        onValueChange={field.onChange}
                      >
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
                            Cliente interno do escritorio (sem parceiro indicador)
                          </FormLabel>
                          <p className="text-xs text-muted-foreground">
                            Marque se o cliente veio direto ao escritorio,
                            sem indicacao de parceiro captador.
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
                        <FormLabel>Parceiro indicador</FormLabel>
                        <Select
                          value={field.value}
                          onValueChange={field.onChange}
                        >
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
                      <FormLabel>
                        Observacoes iniciais sobre o caso
                      </FormLabel>
                      <FormControl>
                        <Textarea
                          rows={4}
                          placeholder="Contexto, urgencia, documentos ja recebidos..."
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
                  Anexe documentos que ja tem em maos. Pode adicionar mais
                  depois no caso.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {docs.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    Nenhum documento adicionado.
                  </p>
                ) : (
                  <div className="space-y-3">
                    {docs.map((d) => (
                      <div
                        key={d.id}
                        className="grid grid-cols-1 sm:grid-cols-[1fr_180px_auto] gap-2 items-end p-3 border rounded-md bg-muted/30"
                      >
                        <div>
                          <Label className="text-xs">Arquivo</Label>
                          <Input
                            type="file"
                            accept="application/pdf,image/jpeg,image/png,image/jpg"
                            onChange={(e) => {
                              const files = e.target.files;
                              const file = files && files.length > 0 ? files[0] : null;
                              updateDocFile(d.id, file);
                            }}
                          />
                          {d.file && (
                            <p className="text-xs text-muted-foreground mt-1 flex items-center gap-1">
                              <FileText className="h-3 w-3" />
                              {d.file.name} -{" "}
                              {(d.file.size / 1024).toFixed(0)} KB
                            </p>
                          )}
                        </div>
                        <div>
                          <Label className="text-xs">Tipo</Label>
                          <Select
                            value={d.tipo}
                            onValueChange={(v) =>
                              updateDocTipo(d.id, v as TipoDocumento)
                            }
                          >
                            <SelectTrigger>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {TIPOS_DOCUMENTO.map((t) => (
                                <SelectItem key={t.value} value={t.value}>
                                  {t.label}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
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
                    ))}
                  </div>
                )}
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={addDoc}
                >
                  <Plus className="h-4 w-4 mr-2" />
                  Adicionar documento
                </Button>
              </CardContent>
            </Card>

            <div className="flex items-center justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => navigate({ to: "/" })}
                disabled={submitting}
              >
                Cancelar
              </Button>
              <Button type="submit" disabled={submitting}>
                {submitting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                Cadastrar caso
              </Button>
            </div>
          </form>
        </Form>
      </ClientOnly>
    </div>
  );
}

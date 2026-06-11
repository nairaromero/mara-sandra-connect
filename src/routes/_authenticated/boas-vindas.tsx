import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  Loader2,
  Briefcase,
  FileWarning,
  ShieldCheck,
  KeyRound,
  ArrowRight,
  Sparkles,
  FileSignature,
  ScrollText,
} from "lucide-react";

import { useAuth } from "@/hooks/use-auth";
import { supabase } from "@/lib/supabase";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Markdown } from "@/components/markdown";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  renderDocumentos,
  sha256Hex,
  TERMOS_VERSAO,
  type ParceiroDados,
} from "@/lib/legal/termos";

export const Route = createFileRoute("/_authenticated/boas-vindas")({
  component: BoasVindasPage,
});

interface RecursoCard {
  icon: typeof Briefcase;
  titulo: string;
  descricao: string;
}

const RECURSOS: RecursoCard[] = [
  {
    icon: Briefcase,
    titulo: "Cadastre seus casos",
    descricao:
      "Clique em 'Novo caso' no topo pra registrar um novo cliente, anexar documentos iniciais e abrir o caso no escritório.",
  },
  {
    icon: Sparkles,
    titulo: "Acompanhe em tempo real",
    descricao:
      "Cada caso tem timeline de andamentos, status do processo e visão dos documentos. Você vê tudo sem precisar ligar pra equipe.",
  },
  {
    icon: FileWarning,
    titulo: "Cumpra solicitações de documentos",
    descricao:
      "Quando a equipe interna precisar de algum documento, aparece em 'Documentos pendentes'. Faça o upload por lá pra fechar a solicitação.",
  },
  {
    icon: KeyRound,
    titulo: "Cadastre a senha do MEU INSS",
    descricao:
      "Você pode adicionar ou alterar a senha do MEU INSS do cliente quando ele te repassar. A senha é criptografada e protegida.",
  },
];

function BoasVindasPage() {
  const { usuario } = useAuth();
  const ehParceiro = usuario?.tipo === "parceiro";
  const primeiroNome =
    usuario?.nome?.split(" ")[0] ?? usuario?.email?.split("@")[0] ?? "";

  return (
    <div className="mx-auto max-w-3xl space-y-6 pb-8">
      <div className="space-y-2 text-center sm:text-left">
        <p className="text-sm text-[var(--gold)] font-medium tracking-wide uppercase">
          Boas-vindas
        </p>
        <h1 className="font-serif text-3xl sm:text-4xl font-semibold tracking-tight">
          Olá{primeiroNome ? `, ${primeiroNome}` : ""}!
        </h1>
        <p className="text-base text-muted-foreground">
          Você agora faz parte do Mara Sandra Connect — a plataforma de gestão de
          casos do escritório{" "}
          <strong className="text-foreground">Mara Sandra Vian Advocacia</strong>.
        </p>
      </div>

      {/* Cards de recursos */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">O que você pode fazer</CardTitle>
          <CardDescription>
            Um resumo rápido das principais funções disponíveis pra você como
            {ehParceiro ? " parceiro" : " membro da equipe"}.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 sm:grid-cols-2">
            {RECURSOS.map((r) => (
              <div
                key={r.titulo}
                className="flex gap-3 rounded-lg border border-border/60 bg-muted/30 p-3"
              >
                <div
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-white"
                  style={{
                    background:
                      "linear-gradient(135deg, #c9a14a 0%, #e8c878 50%, #b8862e 100%)",
                  }}
                >
                  <r.icon className="h-4 w-4" />
                </div>
                <div className="space-y-1">
                  <p className="font-medium text-sm leading-tight">{r.titulo}</p>
                  <p className="text-xs text-muted-foreground leading-snug">
                    {r.descricao}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {ehParceiro && usuario ? (
        <AceiteParceiro usuarioId={usuario.id} nomeInicial={usuario.nome ?? ""} />
      ) : (
        <InternoConcluir />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Fluxo interno: aceite simples (sem assinatura de documentos do parceiro).
// ---------------------------------------------------------------------------
function InternoConcluir() {
  const { usuario, refreshUsuario } = useAuth();
  const navigate = useNavigate();
  const [aceiteLgpd, setAceiteLgpd] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  async function handleConcluir() {
    if (!aceiteLgpd || !usuario?.id) return;
    setSubmitting(true);
    try {
      const agora = new Date().toISOString();
      const { error } = await supabase
        .from("usuarios")
        .update({ onboarded_em: agora, aceitou_termos_em: agora })
        .eq("id", usuario.id);
      if (error) throw error;
      await refreshUsuario();
      toast.success("Bem-vindo(a)!");
      navigate({ to: "/casos" });
    } catch (err) {
      console.error(err);
      toast.error("Não conseguimos salvar agora. Tente novamente.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <Card>
        <CardContent className="pt-6">
          <div className="flex items-start gap-3 rounded-lg border border-[var(--gold)]/30 bg-[var(--gold-soft)]/20 p-3">
            <Checkbox
              id="aceite-lgpd"
              checked={aceiteLgpd}
              onCheckedChange={(c) => setAceiteLgpd(c === true)}
              className="mt-0.5"
            />
            <label
              htmlFor="aceite-lgpd"
              className="text-sm leading-snug cursor-pointer select-none"
            >
              Li e concordo com os termos de uso e a política de privacidade do
              Mara Sandra Connect, e me comprometo a tratar com sigilo
              profissional os dados pessoais dos clientes.
            </label>
          </div>
        </CardContent>
      </Card>
      <div className="flex justify-end">
        <Button size="lg" onClick={handleConcluir} disabled={!aceiteLgpd || submitting}>
          {submitting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
          Começar a usar
          <ArrowRight className="h-4 w-4 ml-2" />
        </Button>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Fluxo parceiro: preenche dados, lê e ASSINA os documentos (aceite eletrônico).
// ---------------------------------------------------------------------------
function AceiteParceiro({
  usuarioId,
  nomeInicial,
}: {
  usuarioId: string;
  nomeInicial: string;
}) {
  const { refreshUsuario } = useAuth();
  const navigate = useNavigate();

  const [dados, setDados] = useState<ParceiroDados>({
    nome: nomeInicial,
    documento: "",
    oab: "",
    oab_uf: "",
    endereco: "",
  });
  const [assinatura, setAssinatura] = useState("");
  const [aceite, setAceite] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // Pré-preenche com o que o interno já cadastrou (OAB etc.).
  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from("usuarios")
        .select("oab, oab_uf, documento, endereco")
        .eq("id", usuarioId)
        .maybeSingle();
      if (data) {
        setDados((d) => ({
          ...d,
          oab: (data.oab as string) ?? d.oab,
          oab_uf: (data.oab_uf as string) ?? d.oab_uf,
          documento: (data.documento as string) ?? d.documento,
          endereco: (data.endereco as string) ?? d.endereco,
        }));
      }
    })();
  }, [usuarioId]);

  const docs = useMemo(() => renderDocumentos(dados), [dados]);

  const docDigits = dados.documento.replace(/\D/g, "");
  const dadosOk =
    dados.nome.trim().length >= 3 &&
    (docDigits.length === 11 || docDigits.length === 14) &&
    dados.oab.trim().length >= 2 &&
    dados.endereco.trim().length >= 5;
  const assinaturaOk = assinatura.trim().length >= 3;

  function set<K extends keyof ParceiroDados>(k: K, v: string) {
    setDados((d) => ({ ...d, [k]: v }));
  }

  async function assinar() {
    if (!dadosOk) {
      toast.error("Preencha seus dados: nome, CPF/CNPJ, OAB (com UF) e endereço.");
      return;
    }
    if (!aceite) {
      toast.error("Marque que leu e aceita os documentos.");
      return;
    }
    if (!assinaturaOk) {
      toast.error("Digite seu nome completo no campo de assinatura.");
      return;
    }
    setSubmitting(true);
    try {
      const documentos = await Promise.all(
        docs.map(async (d) => ({
          id: d.id,
          titulo: d.titulo,
          hash: await sha256Hex(d.texto),
        })),
      );
      const { error } = await supabase.rpc("registrar_aceite_termos", {
        p_versao: TERMOS_VERSAO,
        p_dados: dados,
        p_documentos: documentos,
        p_nome_assinatura: assinatura.trim(),
        p_user_agent:
          typeof navigator !== "undefined" ? navigator.userAgent : null,
      });
      if (error) throw error;
      await refreshUsuario();
      toast.success("Aceite registrado. Bem-vindo(a)!");
      navigate({ to: "/casos" });
    } catch (err) {
      console.error(err);
      const msg =
        (err as { message?: string })?.message ??
        "Não conseguimos registrar o aceite. Tente novamente.";
      toast.error(msg);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      {/* Dados do parceiro */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <FileSignature className="h-4 w-4 text-[var(--gold)]" />
            Seus dados
          </CardTitle>
          <CardDescription>
            Confirme seus dados — eles preenchem automaticamente os documentos
            abaixo.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="ac-nome">Nome completo / Razão social</Label>
            <Input
              id="ac-nome"
              value={dados.nome}
              onChange={(e) => set("nome", e.target.value)}
              placeholder="Nome completo"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ac-doc">CPF ou CNPJ</Label>
            <Input
              id="ac-doc"
              value={dados.documento}
              onChange={(e) => set("documento", e.target.value)}
              placeholder="Somente números"
            />
          </div>
          <div className="grid grid-cols-3 gap-2">
            <div className="space-y-1.5 col-span-2">
              <Label htmlFor="ac-oab">OAB nº</Label>
              <Input
                id="ac-oab"
                value={dados.oab}
                onChange={(e) => set("oab", e.target.value)}
                placeholder="123456"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ac-uf">UF</Label>
              <Input
                id="ac-uf"
                value={dados.oab_uf}
                maxLength={2}
                onChange={(e) => set("oab_uf", e.target.value.toUpperCase())}
                placeholder="SP"
              />
            </div>
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="ac-end">Endereço</Label>
            <Input
              id="ac-end"
              value={dados.endereco}
              onChange={(e) => set("endereco", e.target.value)}
              placeholder="Rua, nº, cidade/UF"
            />
          </div>
        </CardContent>
      </Card>

      {/* Documentos */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <ScrollText className="h-4 w-4 text-[var(--gold)]" />
            Documentos para aceite
          </CardTitle>
          <CardDescription>
            Leia os documentos abaixo. Eles passam a valer com o seu aceite
            eletrônico (versão {TERMOS_VERSAO}).
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {docs.map((d) => (
            <div key={d.id} className="rounded-lg border">
              <div className="flex items-center justify-between gap-2 border-b bg-muted/40 px-3 py-2">
                <span className="text-sm font-medium">{d.titulo}</span>
                <span className="text-[11px] uppercase tracking-wide text-muted-foreground">
                  {d.requerAssinatura ? "Assinatura" : "Ciência"}
                </span>
              </div>
              <div className="max-h-72 overflow-y-auto px-4 py-3">
                <Markdown>{d.texto}</Markdown>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      {/* Assinatura */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-[var(--gold)]" />
            Assinatura eletrônica
          </CardTitle>
          <CardDescription>
            Seu aceite é registrado com data, hora, endereço IP e versão dos
            documentos.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-start gap-3 rounded-lg border border-[var(--gold)]/30 bg-[var(--gold-soft)]/20 p-3">
            <Checkbox
              id="ac-aceite"
              checked={aceite}
              onCheckedChange={(c) => setAceite(c === true)}
              className="mt-0.5"
            />
            <label
              htmlFor="ac-aceite"
              className="text-sm leading-snug cursor-pointer select-none"
            >
              Li e <strong>aceito</strong> o Acordo de Tratamento de Dados e o
              Termo de Uso, e dou ciência da Política de Privacidade. Comprometo-me
              a tratar com sigilo profissional os dados dos clientes.
            </label>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ac-assinatura">
              Assinatura — digite seu nome completo
            </Label>
            <Input
              id="ac-assinatura"
              value={assinatura}
              onChange={(e) => setAssinatura(e.target.value)}
              placeholder="Seu nome completo"
              className="font-serif"
            />
          </div>
        </CardContent>
      </Card>

      <div className="flex justify-end">
        <Button
          size="lg"
          onClick={assinar}
          disabled={submitting || !dadosOk || !aceite || !assinaturaOk}
        >
          {submitting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
          Assinar e começar
          <ArrowRight className="h-4 w-4 ml-2" />
        </Button>
      </div>
    </>
  );
}

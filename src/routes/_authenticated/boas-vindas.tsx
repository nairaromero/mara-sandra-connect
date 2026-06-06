import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import {
  Loader2,
  Briefcase,
  FileWarning,
  ShieldCheck,
  KeyRound,
  ArrowRight,
  Sparkles,
} from "lucide-react";

import { useAuth } from "@/hooks/use-auth";
import { supabase } from "@/lib/supabase";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

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
  const { usuario, refreshUsuario } = useAuth();
  const navigate = useNavigate();
  const [aceiteLgpd, setAceiteLgpd] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const primeiroNome =
    usuario?.nome?.split(" ")[0] ?? usuario?.email?.split("@")[0] ?? "";
  const ehParceiro = usuario?.tipo === "parceiro";

  async function handleConcluir() {
    if (!aceiteLgpd) {
      toast.error("Você precisa aceitar os termos pra continuar.");
      return;
    }
    if (!usuario?.id) {
      toast.error("Sessão expirada. Recarregue a página.");
      return;
    }
    setSubmitting(true);
    try {
      const agora = new Date().toISOString();
      const { error } = await supabase
        .from("usuarios")
        .update({
          onboarded_em: agora,
          aceitou_termos_em: agora,
        })
        .eq("id", usuario.id);
      if (error) throw error;

      await refreshUsuario();
      toast.success("Bem-vindo(a)! Boa jornada.");
      navigate({ to: "/casos" });
    } catch (err) {
      console.error(err);
      const msg =
        (err as { message?: string })?.message ??
        "Não conseguimos salvar agora. Tente novamente em instantes.";
      toast.error(msg);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6 pb-8">
      {/* Cabecalho com saudacao personalizada */}
      <div className="space-y-2 text-center sm:text-left">
        <p className="text-sm text-[var(--gold)] font-medium tracking-wide uppercase">
          Boas-vindas
        </p>
        <h1 className="font-serif text-3xl sm:text-4xl font-semibold tracking-tight">
          Olá{primeiroNome ? `, ${primeiroNome}` : ""}!
        </h1>
        <p className="text-base text-muted-foreground">
          Você agora faz parte do Mara Sandra Connect — a plataforma de gestão
          de casos do escritório <strong className="text-foreground">Mara Sandra Vian Advocacia</strong>.
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
                  <p className="font-medium text-sm leading-tight">
                    {r.titulo}
                  </p>
                  <p className="text-xs text-muted-foreground leading-snug">
                    {r.descricao}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Proteção de dados / LGPD */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-[var(--gold)]" />
            Como protegemos os dados dos seus clientes
          </CardTitle>
          <CardDescription>
            Conformidade com a Lei Geral de Proteção de Dados (LGPD).
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ul className="space-y-2 text-sm text-foreground/90">
            <li className="flex gap-2">
              <span className="text-[var(--gold)] mt-0.5">●</span>
              <span>
                <strong>Senhas do MEU INSS</strong> são criptografadas com AES
                e armazenadas em segredo. Como parceiro, você pode cadastrar
                ou substituir a senha, mas nunca consegue lê-la depois — apenas
                a equipe interna do escritório tem essa permissão.
              </span>
            </li>
            <li className="flex gap-2">
              <span className="text-[var(--gold)] mt-0.5">●</span>
              <span>
                <strong>Audit log imutável</strong> registra cada leitura,
                escrita ou remoção de dados sensíveis com data, hora e usuário.
              </span>
            </li>
            <li className="flex gap-2">
              <span className="text-[var(--gold)] mt-0.5">●</span>
              <span>
                <strong>Isolamento por parceiro</strong>: você só enxerga casos
                que indicou. Outros parceiros não têm acesso aos seus dados.
              </span>
            </li>
            <li className="flex gap-2">
              <span className="text-[var(--gold)] mt-0.5">●</span>
              <span>
                <strong>Dados pessoais sensíveis</strong> (CPF, RG, laudos
                médicos) são tratados com base no consentimento do titular ou
                em obrigação legal vinculada ao caso previdenciário.
              </span>
            </li>
          </ul>

          <div className="mt-5 flex items-start gap-3 rounded-lg border border-[var(--gold)]/30 bg-[var(--gold-soft)]/20 p-3">
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
              Li e concordo com os termos de uso e a política de privacidade
              do Mara Sandra Connect, e me comprometo a tratar com sigilo
              profissional os dados pessoais dos clientes que cadastrar.
            </label>
          </div>
        </CardContent>
      </Card>

      <div className="flex justify-end">
        <Button
          size="lg"
          onClick={handleConcluir}
          disabled={!aceiteLgpd || submitting}
        >
          {submitting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
          Começar a usar
          <ArrowRight className="h-4 w-4 ml-2" />
        </Button>
      </div>
    </div>
  );
}

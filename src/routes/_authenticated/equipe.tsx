import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Loader2, UserPlus, Users, ShieldAlert } from "lucide-react";

import { useAuth } from "@/hooks/use-auth";
import { supabase } from "@/lib/supabase";
import { ClientOnly } from "@/components/client-only";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export const Route = createFileRoute("/_authenticated/equipe")({
  component: EquipePage,
});

interface InternoRow {
  id: string;
  nome: string | null;
  email: string | null;
  ativo: boolean;
  onboarded_em: string | null;
}

function EquipePage() {
  const { usuario } = useAuth();
  const isInterno = usuario?.tipo === "interno";

  const [lista, setLista] = useState<Array<InternoRow>>([]);
  const [carregando, setCarregando] = useState(true);
  const [nome, setNome] = useState("");
  const [email, setEmail] = useState("");
  const [enviando, setEnviando] = useState(false);

  const carregar = useCallback(async () => {
    setCarregando(true);
    const { data, error } = await supabase
      .from("usuarios")
      .select("id, nome, email, ativo, onboarded_em")
      .eq("tipo", "interno")
      .order("nome", { ascending: true });
    if (!error) setLista((data || []) as Array<InternoRow>);
    setCarregando(false);
  }, []);

  useEffect(() => {
    if (isInterno) carregar();
  }, [isInterno, carregar]);

  async function convidar() {
    const emailNorm = email.trim().toLowerCase();
    if (nome.trim().length < 3) {
      toast.error("Informe o nome completo");
      return;
    }
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(emailNorm)) {
      toast.error("E-mail inválido");
      return;
    }
    setEnviando(true);
    try {
      const redirectTo = typeof window !== "undefined"
        ? `${window.location.origin}/login`
        : undefined;
      const resp = await supabase.functions.invoke("convidar-usuario", {
        body: {
          nome: nome.trim(),
          email: emailNorm,
          tipo: "interno",
          redirect_to: redirectTo,
        },
      });
      if (resp.error) throw resp.error;
      const r = (resp.data || {}) as { error?: string; ja_existia?: boolean };
      if (r.error) {
        toast.error(r.error);
        return;
      }
      toast.success(
        r.ja_existia
          ? "Esse e-mail já tem cadastro."
          : `Convite enviado para ${emailNorm}. Peça para verificar a caixa de entrada.`,
      );
      setNome("");
      setEmail("");
      carregar();
    } catch (err) {
      console.error(err);
      toast.error(
        (err as { message?: string }).message || "Erro ao convidar interno",
      );
    } finally {
      setEnviando(false);
    }
  }

  if (!isInterno) {
    return (
      <div className="flex h-64 flex-col items-center justify-center gap-2 text-center">
        <ShieldAlert className="h-8 w-8 text-muted-foreground" />
        <p className="text-sm text-muted-foreground">
          Área restrita a usuários internos.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-serif text-3xl font-semibold tracking-tight flex items-center gap-2">
          <Users className="h-7 w-7 text-[var(--gold)]" />
          Equipe interna
        </h1>
        <p className="text-sm text-muted-foreground">
          Convide pessoas da equipe para acessar a plataforma como usuário
          interno (acesso total).
        </p>
      </div>

      <ClientOnly
        fallback={
          <div className="flex h-64 items-center justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        }
      >
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Convidar novo interno</CardTitle>
            <CardDescription>
              Cria o acesso e envia um link de login por e-mail. O interno já
              entra com acesso total (sem onboarding de parceiro).
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
              <div>
                <Label className="text-xs">Nome completo</Label>
                <Input
                  value={nome}
                  onChange={(e) => setNome(e.target.value)}
                  placeholder="Nome da pessoa"
                />
              </div>
              <div>
                <Label className="text-xs">E-mail</Label>
                <Input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="email@escritorio.com.br"
                />
              </div>
              <Button onClick={convidar} disabled={enviando}>
                {enviando
                  ? <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  : <UserPlus className="h-4 w-4 mr-2" />}
                Convidar
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              Usuários internos ({lista.length})
            </CardTitle>
            <CardDescription>
              Pessoas com acesso interno (total) à plataforma.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {carregando
              ? (
                <div className="flex items-center justify-center py-6">
                  <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                </div>
              )
              : lista.length === 0
              ? (
                <p className="text-sm text-muted-foreground text-center py-6">
                  Nenhum usuário interno.
                </p>
              )
              : (
                <ul className="divide-y">
                  {lista.map((u) => (
                    <li
                      key={u.id}
                      className="flex items-center justify-between gap-2 py-3"
                    >
                      <div className="min-w-0">
                        <p className="text-sm font-medium truncate">
                          {u.nome || "(sem nome)"}
                          {u.id === usuario?.id && (
                            <span className="text-xs text-muted-foreground">
                              {" "}(você)
                            </span>
                          )}
                        </p>
                        <p className="text-xs text-muted-foreground truncate">
                          {u.email}
                        </p>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        {!u.onboarded_em && (
                          <Badge variant="outline" className="text-xs">
                            convite pendente
                          </Badge>
                        )}
                        <Badge
                          variant={u.ativo ? "secondary" : "outline"}
                          className="text-xs"
                        >
                          {u.ativo ? "ativo" : "inativo"}
                        </Badge>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
          </CardContent>
        </Card>
      </ClientOnly>
    </div>
  );
}

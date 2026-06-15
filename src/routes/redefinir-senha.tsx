import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

import { supabase } from "@/lib/supabase";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { ClientOnly } from "@/components/client-only";

export const Route = createFileRoute("/redefinir-senha")({
  head: () => ({
    meta: [{ title: "Redefinir senha — Mara Sandra Vian Advocacia" }],
  }),
  component: RedefinirSenhaPage,
});

function RedefinirSenhaPage() {
  const navigate = useNavigate();
  const { session, loading: authLoading } = useAuth();
  const [senha, setSenha] = useState("");
  const [confirmar, setConfirmar] = useState("");
  const [salvando, setSalvando] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (senha.length < 6) {
      toast.error("A senha deve ter ao menos 6 caracteres");
      return;
    }
    if (senha !== confirmar) {
      toast.error("As senhas não coincidem");
      return;
    }
    setSalvando(true);
    const { error } = await supabase.auth.updateUser({ password: senha });
    setSalvando(false);
    if (error) {
      toast.error("Não foi possível redefinir a senha", {
        description: error.message,
      });
      return;
    }
    toast.success("Senha redefinida! Você já está conectado.");
    navigate({ to: "/casos" });
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-4 bg-gradient-to-br from-background via-background to-gold-soft/50">
      <div className="w-full max-w-md">
        <div className="mb-8 flex flex-col items-center gap-3">
          <img
            src="/logo.png"
            alt="Mara Sandra Vian Advocacia"
            className="h-32 w-auto object-contain"
          />
        </div>

        <Card className="border-border/60 shadow-sm">
          <CardHeader className="space-y-1">
            <CardTitle className="text-lg">Redefinir senha</CardTitle>
            <CardDescription>Escolha uma nova senha de acesso.</CardDescription>
          </CardHeader>
          <CardContent>
            <ClientOnly
              fallback={
                <div className="flex h-32 items-center justify-center">
                  <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                </div>
              }
            >
              {authLoading ? (
                <div className="flex h-32 items-center justify-center">
                  <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                </div>
              ) : !session ? (
                <div className="space-y-4 text-center">
                  <p className="text-sm text-muted-foreground">
                    O link de redefinição é inválido ou expirou. Solicite um novo
                    na tela de acesso.
                  </p>
                  <Button asChild className="w-full">
                    <Link to="/login">Voltar ao login</Link>
                  </Button>
                </div>
              ) : (
                <form onSubmit={handleSubmit} className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="senha">Nova senha</Label>
                    <Input
                      id="senha"
                      type="password"
                      autoComplete="new-password"
                      placeholder="Ao menos 6 caracteres"
                      value={senha}
                      onChange={(e) => setSenha(e.target.value)}
                      required
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="confirmar">Confirmar nova senha</Label>
                    <Input
                      id="confirmar"
                      type="password"
                      autoComplete="new-password"
                      value={confirmar}
                      onChange={(e) => setConfirmar(e.target.value)}
                      required
                    />
                  </div>
                  <Button type="submit" className="w-full" disabled={salvando}>
                    {salvando && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                    Salvar nova senha
                  </Button>
                </form>
              )}
            </ClientOnly>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

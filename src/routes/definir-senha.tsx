import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";
import { Loader2, KeyRound, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";

import { supabase } from "@/lib/supabase";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ClientOnly } from "@/components/client-only";

export const Route = createFileRoute("/definir-senha")({
  head: () => ({
    meta: [{ title: "Criar sua senha — Mara Sandra Vian Advocacia" }],
  }),
  component: DefinirSenhaPage,
});

const MIN_SENHA = 8;

function DefinirSenhaPage() {
  const navigate = useNavigate();
  const { session, loading: authLoading, precisaSenha, refreshPrecisaSenha } = useAuth();
  const [senha, setSenha] = useState("");
  const [confirmar, setConfirmar] = useState("");
  const [salvando, setSalvando] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (senha.length < MIN_SENHA) {
      toast.error(`A senha deve ter ao menos ${MIN_SENHA} caracteres`);
      return;
    }
    if (senha !== confirmar) {
      toast.error("As senhas não coincidem");
      return;
    }
    setSalvando(true);
    const { error } = await supabase.auth.updateUser({ password: senha });
    if (error) {
      setSalvando(false);
      toast.error("Não foi possível salvar a senha", {
        description: error.message,
      });
      return;
    }
    // Reconsulta o gate antes de sair da tela, senão o layout autenticado
    // devolve o usuário pra cá (o RPC ainda responderia "precisa").
    await refreshPrecisaSenha();
    setSalvando(false);
    toast.success("Senha criada!", {
      description: "Da próxima vez você entra direto com e-mail e senha.",
    });
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
            <CardTitle className="flex items-center gap-2 text-lg">
              <KeyRound className="h-4 w-4 text-[var(--gold)]" />
              Crie sua senha de acesso
            </CardTitle>
            <CardDescription>
              É o último passo do primeiro acesso. Depois disso você entra com e-mail e senha, sem
              depender do link enviado por e-mail.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ClientOnly
              fallback={
                <div className="flex h-32 items-center justify-center">
                  <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                </div>
              }
            >
              {authLoading || precisaSenha === null ? (
                <div className="flex h-32 items-center justify-center">
                  <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                </div>
              ) : !session ? (
                <div className="space-y-4 text-center">
                  <p className="text-sm text-muted-foreground">
                    O link de acesso é inválido ou expirou. Peça um novo na tela de acesso — o botão
                    “Entrar com link mágico” reenvia.
                  </p>
                  <Button asChild className="w-full">
                    <Link to="/login">Voltar ao login</Link>
                  </Button>
                </div>
              ) : !precisaSenha ? (
                <div className="space-y-4 text-center">
                  <CheckCircle2 className="mx-auto h-8 w-8 text-[var(--gold)]" />
                  <p className="text-sm text-muted-foreground">
                    Você já tem uma senha definida. Para trocá-la, use Configurações › Segurança.
                  </p>
                  <Button asChild className="w-full">
                    <Link to="/casos">Ir para o sistema</Link>
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
                      placeholder={`Ao menos ${MIN_SENHA} caracteres`}
                      value={senha}
                      onChange={(e) => setSenha(e.target.value)}
                      required
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="confirmar">Confirmar senha</Label>
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
                    Salvar senha e entrar
                  </Button>
                  <p className="text-center text-xs text-muted-foreground">
                    O link mágico continua funcionando depois — fica como opção, não como obrigação.
                  </p>
                </form>
              )}
            </ClientOnly>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

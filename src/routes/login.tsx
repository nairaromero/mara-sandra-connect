import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState, type FormEvent } from "react";
import { Scale, Loader2 } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "sonner";

export const Route = createFileRoute("/login")({
  component: LoginPage,
});

function LoginPage() {
  const navigate = useNavigate();
  const { session, loading: authLoading } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loadingPass, setLoadingPass] = useState(false);
  const [loadingMagic, setLoadingMagic] = useState(false);

  useEffect(() => {
    if (!authLoading && session) {
      navigate({ to: "/" });
    }
  }, [authLoading, session, navigate]);

  async function handlePasswordLogin(e: FormEvent) {
    e.preventDefault();
    setLoadingPass(true);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setLoadingPass(false);
    if (error) {
      toast.error("Não foi possível entrar", { description: error.message });
      return;
    }
    toast.success("Bem-vindo(a)!");
    navigate({ to: "/" });
  }

  async function handleMagicLink() {
    if (!email) {
      toast.error("Informe seu e-mail para receber o link mágico");
      return;
    }
    setLoadingMagic(true);
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: window.location.origin },
    });
    setLoadingMagic(false);
    if (error) {
      toast.error("Falha ao enviar link", { description: error.message });
      return;
    }
    toast.success("Link enviado!", { description: "Verifique sua caixa de entrada." });
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/30 px-4">
      <div className="w-full max-w-md">
        <div className="mb-8 flex flex-col items-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <Scale className="h-6 w-6" />
          </div>
          <div className="text-center">
            <h1 className="text-2xl font-semibold tracking-tight text-foreground">
              Mara Sandra Advocacia
            </h1>
            <p className="text-sm text-muted-foreground">Plataforma interna · Previdenciário</p>
          </div>
        </div>

        <Card className="border-border/60 shadow-sm">
          <CardHeader className="space-y-1">
            <CardTitle className="text-lg">Acessar a plataforma</CardTitle>
            <CardDescription>
              Acesso restrito a usuários previamente cadastrados pela equipe.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handlePasswordLogin} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="email">E-mail</Label>
                <Input
                  id="email"
                  type="email"
                  autoComplete="email"
                  placeholder="seu@escritorio.com.br"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="password">Senha</Label>
                <Input
                  id="password"
                  type="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                />
              </div>

              <Button type="submit" className="w-full" disabled={loadingPass}>
                {loadingPass && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Entrar
              </Button>

              <div className="relative">
                <div className="absolute inset-0 flex items-center">
                  <span className="w-full border-t border-border" />
                </div>
                <div className="relative flex justify-center text-xs uppercase">
                  <span className="bg-card px-2 text-muted-foreground">ou</span>
                </div>
              </div>

              <Button
                type="button"
                variant="outline"
                className="w-full"
                onClick={handleMagicLink}
                disabled={loadingMagic}
              >
                {loadingMagic && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Entrar com link mágico
              </Button>
            </form>
          </CardContent>
        </Card>

        <p className="mt-6 text-center text-xs text-muted-foreground">
          Problemas para acessar? Fale com a equipe interna do escritório.
        </p>
      </div>
    </div>
  );
}

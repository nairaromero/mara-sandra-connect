import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState, type FormEvent } from "react";
import { Loader2 } from "lucide-react";
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
  const [loadingRecovery, setLoadingRecovery] = useState(false);

  useEffect(() => {
    if (!authLoading && session) {
      navigate({ to: "/casos" });
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
    navigate({ to: "/casos" });
  }

  async function handleMagicLink() {
    if (!email) {
      toast.error("Informe seu e-mail para receber o link mágico");
      return;
    }
    setLoadingMagic(true);
    const { error } = await supabase.auth.signInWithOtp({
      email,
      // Redireciona pra /login (e não pra raiz "/", que é a landing pública).
      // /login detecta a sessão e encaminha pra dentro do sistema (/casos),
      // de onde o gate manda o parceiro pro aceite de termos se necessário.
      options: { emailRedirectTo: `${window.location.origin}/login` },
    });
    setLoadingMagic(false);
    if (error) {
      toast.error("Falha ao enviar link", { description: error.message });
      return;
    }
    toast.success("Link enviado!", { description: "Verifique sua caixa de entrada." });
  }

  async function handleRecuperarSenha() {
    if (!email) {
      toast.error("Informe seu e-mail para recuperar a senha");
      return;
    }
    setLoadingRecovery(true);
    const { error } = await supabase.auth.resetPasswordForEmail(
      email.trim().toLowerCase(),
      { redirectTo: `${window.location.origin}/redefinir-senha` },
    );
    setLoadingRecovery(false);
    if (error) {
      toast.error("Falha ao enviar e-mail", { description: error.message });
      return;
    }
    toast.success("E-mail enviado!", {
      description: "Se houver conta com esse e-mail, você receberá o link para redefinir a senha.",
    });
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-4 bg-gradient-to-br from-background via-background to-gold-soft/50">
      <div className="w-full max-w-md">
        <div className="mb-8 flex flex-col items-center gap-3">
          <img
            src="/logo.png"
            alt="Mara Sandra Vian Advocacia"
            className="h-36 w-auto object-contain"
          />
          <p className="text-sm text-muted-foreground">
            Plataforma interna · Previdenciário
          </p>
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
                <div className="flex justify-end">
                  <button
                    type="button"
                    onClick={handleRecuperarSenha}
                    disabled={loadingRecovery}
                    className="text-xs text-muted-foreground hover:text-[var(--gold)] disabled:opacity-50"
                  >
                    {loadingRecovery ? "Enviando…" : "Esqueci minha senha"}
                  </button>
                </div>
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
